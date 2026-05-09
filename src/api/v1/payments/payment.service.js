// File: src/api/v1/payments/payment.service.js
const crypto = require('crypto');
const sha512 = require('js-sha512').sha512;
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service');
const CorporateFulfilment = require('../../../models/corporateFulfilment.model');
const CorporateClient = require('../../../models/corporateClient.model');
const CorporateRequest = require('../../../models/corporateRequest.model');
const { ensureInvoiceForFulfilment, recordInvoicePayment } = require('../../v2/corporate-clients/corporateBilling.service');
const { syncPaymentFromInvoiceOrFulfilment } = require('../../v2/corporate-clients/corporateLifecycle.service');
const { mapPayment } = require('../../v2/corporate-clients/corporateOrderBridge.service');
const powerService = require('../utilities/power.service'); // ✅ Import Power Service
const dotenv = require('dotenv');

dotenv.config();

const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY;

/**
 * Compute the Hash of the request body for security verification
 */
const computeMonnifyDocHash = (requestBodyString, secretKey) => {
  const result = sha512.hmac(secretKey, requestBodyString);
  logger.debug(`[Payment Service] Computed hash: ${result}`);
  return result;
};

/**
 * Verify that the webhook actually came from Monnify
 */
const verifyMonnifySignature = ({ signature, rawBodyString }) => {
  if (!signature || !rawBodyString || !MONNIFY_SECRET_KEY) {
    logger.error('[Payment Service] Missing verification parameters.');
    throw new HttpError(401, 'Missing required verification parameters.');
  }

  const computedHash = computeMonnifyDocHash(rawBodyString, MONNIFY_SECRET_KEY);

  if (computedHash !== signature) {
    logger.warn(
      `[Payment Service] Signature Mismatch! Computed: ${computedHash}, Received: ${signature}`
    );
    throw new HttpError(401, 'Invalid Monnify signature.');
  }
};

/**
 * Monnify paymentReference is configured by us. For orders we prefix: <orderId>_<timestamp> (recommended).
 * Recover orderId safely:
 *  - Prefer UUIDv4 found anywhere inside the paymentReference
 *  - Else fall back to split('_')[0]
 *  - Else return the raw reference
 */
const extractOrderIdFromPaymentReference = (paymentReference) => {
  const ref = (paymentReference || '').toString();
  const m = ref.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  if (m && m[0]) return m[0];
  if (ref.includes('_')) return ref.split('_')[0];
  return ref || null;
};

/**
 * Process the verified webhook event
 */
const processWebhookEvent = async (eventData, eventType) => {
  logger.info(`[Payment Service] Processing event: ${eventType}`);

  const {
    paymentReference,
    paymentStatus,
    transactionReference,
    amountPaid,
    paymentMethod,
    responseMessage,
  } = eventData;

  // ✅ Corporate payments use reference format: CORP_<fulfilmentId>_<timestamp>.
  // Handle them before the legacy retail order path so the retail order lookup is not attempted.
  if (String(paymentReference || '').startsWith('CORP_')) {
    const parts = String(paymentReference).split('_');
    const fulfilmentId = parts[1];
    if (!fulfilmentId) {
      logger.warn(`[Payment Service] Corporate webhook missing fulfilment ID. Ref: ${paymentReference}`);
      return;
    }

    const fulfilment = await CorporateFulfilment.findOne({ id: fulfilmentId });
    if (!fulfilment) {
      logger.warn(`[Payment Service] Corporate fulfilment ${fulfilmentId} not found for payment ref ${paymentReference}.`);
      return;
    }

    const actor = { id: 'system', name: 'Monnify Webhook', email: 'system' };
    const client = await CorporateClient.findOne({ id: fulfilment.clientId }).lean();
    const request = await CorporateRequest.findOne({ linkedFulfilmentId: fulfilment.id }).lean();

    fulfilment.paymentGateway = 'MONNIFY';
    fulfilment.paymentReference = paymentReference;
    fulfilment.paymentGatewayReference = transactionReference;
    fulfilment.lastPaymentAt = eventData.paidOn ? new Date(eventData.paidOn) : new Date();
    fulfilment.statusHistory = Array.isArray(fulfilment.statusHistory) ? fulfilment.statusHistory : [];

    let invoice = await ensureInvoiceForFulfilment({ client: client || {}, request, fulfilment, actor, forceRefresh: true });

    if (paymentStatus === 'PAID') {
      const paidNaira = Number(amountPaid || 0);
      const alreadyRecorded = Array.isArray(invoice?.paymentHistory) && invoice.paymentHistory.some((p) =>
        [p.reference, p.gatewayReference].filter(Boolean).map(String).includes(String(transactionReference || paymentReference)) ||
        String(p.reference || '') === String(paymentReference || '')
      );
      if (!alreadyRecorded && paidNaira > 0) {
        invoice = await recordInvoicePayment({
          fulfilment,
          invoice,
          amount: paidNaira,
          paymentMethod: paymentMethod || 'MONNIFY',
          paymentGateway: 'MONNIFY',
          paymentReference: transactionReference || paymentReference,
          actor,
          note: `Corporate payment confirmed by Monnify. Ref: ${transactionReference || paymentReference}`,
        });
      }
      fulfilment.paymentStatus = invoice?.paymentStatus || fulfilment.paymentStatus || 'PAID';
      fulfilment.statusHistory.unshift({ status: 'PAYMENT_CONFIRMED', note: `Corporate payment confirmed by Monnify. Ref: ${transactionReference || paymentReference}`, timestamp: new Date(), updatedBy: 'system', updatedByName: 'Monnify Webhook' });
    } else if (paymentStatus === 'FAILED' || paymentStatus === 'CANCELLED') {
      fulfilment.paymentStatus = 'UNPAID';
      if (invoice) {
        invoice.paymentStatus = 'UNPAID';
        invoice.events = Array.isArray(invoice.events) ? invoice.events : [];
        invoice.events.unshift({ status: 'PAYMENT_FAILED', note: `Corporate payment ${paymentStatus}. ${responseMessage || ''}`, updatedBy: 'system', updatedByName: 'Monnify Webhook' });
        await invoice.save();
      }
      fulfilment.statusHistory.unshift({ status: 'PAYMENT_FAILED', note: `Corporate payment ${paymentStatus}. ${responseMessage || ''}`, timestamp: new Date(), updatedBy: 'system', updatedByName: 'Monnify Webhook' });
    }

    await fulfilment.save();
    const mapped = mapPayment(fulfilment.paymentMethod || paymentMethod || 'ONLINE', fulfilment.paymentGateway || 'MONNIFY');
    await syncPaymentFromInvoiceOrFulfilment(fulfilment, { actor, paymentMethod: mapped.paymentMethod, paymentGateway: mapped.paymentGateway });

    // Recalculate a minimal client exposure snapshot without invoking GL or posting logic.
    try {
      const clientId = fulfilment.clientId;
      const rows = await CorporateFulfilment.find({ clientId }).lean();
      const outstandingBalance = rows.reduce((sum, f) => sum + Number(f.outstandingAmount || 0), 0);
      const lifetimeDeliveredKg = rows.filter((f) => f.status === 'DELIVERED').reduce((sum, f) => sum + Number(f.deliveredKg || 0), 0);
      await CorporateClient.findOneAndUpdate({ id: clientId }, { $set: { outstandingBalance, lifetimeDeliveredKg, updatedBy: 'system' } });
    } catch (rollupError) {
      logger.warn(`[Payment Service] Corporate payment rollup refresh failed: ${rollupError.message}`);
    }

    logger.info(`[Payment Service] Corporate fulfilment payment processed: ${fulfilmentId} -> ${paymentStatus}`);
    return;
  }

  // ✅ Extract Order ID safely
  const orderId = extractOrderIdFromPaymentReference(paymentReference);

  logger.debug(
    `[Payment Service] Extracted Order ID: ${orderId}, Status: ${paymentStatus}`
  );

  if (!orderId) {
    throw new HttpError(400, 'Webhook payload missing order ID.');
  }

  // 1. Prepare Payment Details
  const paymentDetails = {
    method: paymentMethod || 'Monnify',
    transactionId: transactionReference,
    amount: amountPaid,
    paidAt: eventData.paidOn ? new Date(eventData.paidOn) : new Date(),
    monnifyStatus: paymentStatus,
    monnifyResponseMessage: responseMessage,
  };

  // 2. Fetch the Order to determine its TYPE (Gas vs Power)
  // Webhook is server-to-server; there is no req.user. Use a system context so authz checks pass.
  let targetOrder = null;
  try {
    targetOrder = await orderService.getOrder(orderId, {
      id: 'system',
      role: 'admin',
    });
  } catch (e) {
    logger.warn(
      `[Payment Service] Order ${orderId} not found (or not accessible). Skipping logic.`
    );
    return;
  }

  // 2b. Idempotency guard: if we already processed a successful payment / delivered vending, exit early.
  try {
    const status = (targetOrder?.status || '').toString().toLowerCase();
    const paymentStat = (targetOrder?.paymentStatus || '').toString().toLowerCase();
    const meta = targetOrder?.metadata || {};
    const token =
      typeof meta?.get === 'function' ? meta.get('token') : meta?.token;

    if (
      paymentStatus === 'PAID' &&
      (status === 'delivered' || status === 'completed' || token)
    ) {
      logger.info(
        `[Payment Service] Idempotent webhook: order ${orderId} already delivered. Skipping vending/update.`
      );
      return;
    }

    if (
      paymentStatus === 'PAID' &&
      paymentStat === 'completed' &&
      status === 'processing' &&
      targetOrder?.type === 'POWER'
    ) {
      // Still allow vendPower to run if token not present; but avoid repeated updates.
      logger.info(
        `[Payment Service] Order ${orderId} already marked Processing+Completed. Continuing to vending check.`
      );
    }
  } catch (_) {
    // Do not block webhook processing on idempotency check errors.
  }

  // 3. Define Default Updates (for Gas/Delivery)
  let newOrderStatus = null;
  let newPaymentStatus = null;
  let finalAmountForOrder = amountPaid * 100; // Preserving your existing Kobo logic
  let updateNotes = '';

  switch (paymentStatus) {
    case 'PAID':
      newPaymentStatus = 'Completed';
      newOrderStatus = 'Order Placed'; // Default for Gas
      updateNotes = `Payment confirmed via Monnify. Ref: ${transactionReference}`;
      break;
    case 'FAILED':
      newPaymentStatus = 'Failed';
      newOrderStatus = 'Failed';
      updateNotes = `Payment failed. Reason: ${responseMessage}`;
      break;
    case 'CANCELLED':
      newPaymentStatus = 'Failed';
      newOrderStatus = 'Canceled';
      updateNotes = `Payment cancelled by customer.`;
      break;
    default:
      return; // Ignore other statuses
  }

  // ========================================================================
  // ⚡ POWER VENDING LOGIC (High Priority Intercept)
  // ========================================================================
  if (targetOrder && targetOrder.type === 'POWER') {
    if (paymentStatus === 'PAID') {
      logger.info(
        `[Payment Service] ⚡ Power Order detected (${orderId}). Initiating Vending...`
      );

      try {
        // A. Mark Payment as Completed FIRST (so we have record of money)
        await orderService.updateOrderStatus({
          orderId: orderId,
          status: 'Processing', // Show "Processing" while we vend
          paymentStatus: 'Completed',
          paymentDetails: paymentDetails,
          verifiedAmount: finalAmountForOrder,
          notes: `${updateNotes} [System] Initiating Electricity Vending.`,
        });

        // B. Trigger Vending
        const vendResult = await powerService.vendPower(orderId);

        logger.info(
          `[Payment Service] ✅ Vending Success for ${orderId}. Token: ${vendResult.token}`
        );

        // C. STOP HERE (do not fall through to Gas logic)
        return;
      } catch (powerError) {
        logger.error(
          `[Payment Service] 🚨 Vending Error: ${powerError.message}`,
          { stack: powerError.stack }
        );
        // vendPower typically updates order status to "Vending Failed" internally.
        return;
      }
    }
  }
  // ========================================================================

  // 4. Standard Gas/Delivery Order Update
  try {
    await orderService.updateOrderStatus({
      orderId: orderId,
      status: newOrderStatus,
      paymentStatus: newPaymentStatus,
      paymentDetails: paymentDetails,
      verifiedAmount: finalAmountForOrder,
      notes: updateNotes,
    });
    logger.info(
      `[Payment Service] Standard Order ${orderId} updated to ${newOrderStatus}`
    );
  } catch (error) {
    logger.error(
      `[Payment Service] Failed to update order ${orderId}: ${error.message}`,
      { stack: error.stack }
    );
    // Don't throw; ensures webhook path stays stable.
  }
};

/**
 * Entry point for Monnify Webhook
 */
const processMonnifyWebhook = async ({ signature, rawBodyString }) => {
  logger.info('[Payment Service] Webhook received.');

  // 1. Verify
  verifyMonnifySignature({ signature, rawBodyString });

  // 2. Parse
  let payload;
  try {
    payload = JSON.parse(rawBodyString);
  } catch (error) {
    throw new HttpError(400, 'Invalid JSON payload.');
  }

  // 3. Process
  const { eventType, eventData } = payload;
  if (eventType === 'SUCCESSFUL_TRANSACTION') {
    await processWebhookEvent(eventData, eventType);
  } else {
    logger.info(`[Payment Service] Ignoring event type: ${eventType}`);
  }

  logger.info('[Payment Service] Webhook processing complete.');
};

module.exports = {
  processMonnifyWebhook,
  verifyMonnifySignature,
};
