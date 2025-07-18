// src/api/v1/webhooks/monnify.controller.js (or equivalent)
const crypto = require('crypto');
const { MONNIFY_SECRET_KEY } = process.env; // Load from env, not hardcoded
const orderService = require('../orders/order.service');
const { logger } = require('../../../config/logger.config.js');

const handleMonnifyWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['monnify-signature']; // Monnify uses this header
    const rawBody = JSON.stringify(req.body);

    if (!signature) {
      logger.error('[WEBHOOK] Missing signature.');
      return res.status(401).json({ status: 'error', message: 'Unauthorized' });
    }

    const expectedSignature = crypto.createHmac('sha512', MONNIFY_SECRET_KEY)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== signature) {
      logger.warn('[WEBHOOK] Invalid signature.');
      return res.status(403).json({ status: 'error', message: 'Invalid signature' });
    }

    logger.info('[WEBHOOK] Signature verified. Processing...');

    const { eventType, eventData } = req.body;
    if (eventType === 'SUCCESSFUL_TRANSACTION') {
      const orderId = eventData.product.reference; // Assuming orderId is in reference
      const paymentStatus = eventData.paymentStatus;
      const amountPaid = eventData.amountPaid;
      const transactionReference = eventData.transactionReference;

      logger.info(`[WEBHOOK] Updating order ${orderId} to PAID. Amount: ${amountPaid}`);

      await orderService.updateOrderStatus({
        orderId,
        newStatus: 'Order Placed', // Or your desired status
        paymentStatus: 'Completed',
        finalAmountPaid: amountPaid / 100, // Convert to Naira if needed
        paymentDetails: {
          method: eventData.paymentMethod,
          transactionId: transactionReference,
          paidAt: eventData.paidOn,
        },
      });

      logger.info(`[WEBHOOK] Order ${orderId} updated successfully.`);
    }

    // Acknowledge with JSON
    return res.status(200).json({ status: 'success', message: 'Webhook processed' });
  } catch (error) {
    logger.error('[WEBHOOK] Error:', { message: error.message, stack: error.stack });
    return res.status(500).json({ status: 'error', message: 'Internal error' });
  }
};

module.exports = { handleMonnifyWebhook };