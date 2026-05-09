// File: src/api/v2/corporate-clients/corporateOrderBridge.service.js
const mongoose = require('mongoose');
const Order = require('../../../models/order.model');
const Run = require('../../../models/run.model');
const User = require('../../../models/user.model');
const CorporateSite = require('../../../models/corporateSite.model');
const HttpError = require('../../../utils/HttpError');
const { syncOperationalOrderFromFulfilment } = require('./corporateLifecycle.service');

const toNum = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clean = (value) => (value === undefined || value === null ? '' : String(value).trim());
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const mapPayment = (method = '', gateway = '') => {
  const m = String(method || '').toUpperCase();
  const g = String(gateway || '').toUpperCase();
  if (m === 'WALLET') return { paymentMethod: 'wallet', paymentGateway: 'wallet' };
  if (m === 'PAY_ON_DELIVERY' || m === 'PAY_ON_PICKUP') return { paymentMethod: 'payOnPickup', paymentGateway: null };
  if (m === 'ACCOUNT_TERMS' || m === 'CREDIT') return { paymentMethod: 'account_terms', paymentGateway: null };
  if (g === 'MONNIFY' || m === 'ONLINE') return { paymentMethod: 'monnify', paymentGateway: 'monnify' };
  if (g === 'PAYSTACK') return { paymentMethod: 'paystack', paymentGateway: 'paystack' };
  if (m === 'TRANSFER') return { paymentMethod: 'bank_transfer', paymentGateway: 'manual' };
  if (m === 'PREPAID') return { paymentMethod: 'monnify', paymentGateway: 'monnify' };
  return { paymentMethod: 'payOnPickup', paymentGateway: null };
};

const deriveOrderStatus = (fulfilment = {}) => {
  const method = String(fulfilment.paymentMethod || '').toUpperCase();
  const status = String(fulfilment.status || '').toUpperCase();
  if (status === 'DELIVERED') return 'Delivered';
  if (status === 'IN_TRANSIT') return 'Out for Delivery';
  if (status === 'SCHEDULED') return 'Order Placed';
  if (status === 'CANCELLED') return 'Canceled';
  if (status === 'FAILED') return 'Failed';
  if (['ACCOUNT_TERMS', 'CREDIT', 'PAY_ON_DELIVERY'].includes(method)) return 'Order Placed';
  if (fulfilment.paymentStatus === 'PAID') return 'Order Placed';
  return 'Pending Payment';
};

const derivePaymentStatus = (fulfilment = {}) => {
  const method = String(fulfilment.paymentMethod || '').toUpperCase();
  if (fulfilment.paymentStatus === 'PAID') return 'Completed';
  if (fulfilment.paymentStatus === 'PROCESSING') return 'Processing (Gateway)';
  if (fulfilment.paymentStatus === 'PART_PAID') return 'Processing (Gateway)';
  if (['ACCOUNT_TERMS', 'CREDIT', 'PAY_ON_DELIVERY'].includes(method)) return 'Pending';
  return 'Pending';
};

const getCorporateOrderCustomer = async (client, actorUserId) => {
  const primary = await User.findOne({ corporateClientId: client.id, isCorporatePrimaryContact: true, status: { $ne: 'suspended' } }).lean();
  if (primary) return primary;
  const first = await User.findOne({ corporateClientId: client.id, status: { $ne: 'suspended' } }).sort({ createdAt: 1 }).lean();
  if (first) return first;
  const actor = actorUserId ? await User.findOne({ id: actorUserId }).lean() : null;
  if (actor) return actor;
  throw new HttpError(400, 'Corporate order cannot be created because the client has no portal user/contact user. Create a portal login first.');
};

const buildCorporateOrderPayload = async ({ client, request, fulfilment, actorUserId }) => {
  const customer = await getCorporateOrderCustomer(client, actorUserId);
  const site = request?.siteId ? await CorporateSite.findOne({ id: request.siteId, clientId: client.id }).lean() : null;
  const requestedKg = toNum(fulfilment.requestedKg || request?.requestedKg);
  const deliveredKg = toNum(fulfilment.deliveredKg);
  const effectiveKg = deliveredKg || requestedKg || 1;
  const unitPrice = toNum(fulfilment.sellingPricePerKg || request?.estimatedPricePerKg || client.agreedPricePerKg);
  const itemSubtotal = Math.max(0, effectiveKg * unitPrice);
  const deliveryFee = toNum(fulfilment.deliveryCost);
  const grandTotal = itemSubtotal + deliveryFee;
  const fullAddress = clean(fulfilment.deliveryAddress || request?.deliveryAddress || site?.address || client.address || 'Corporate delivery address');
  const branchCandidate = fulfilment.branchId || client.assignedBranchId;
  const mappedPayment = mapPayment(fulfilment.paymentMethod, fulfilment.paymentGateway);

  const payload = {
    sourceType: 'CORPORATE_FULFILMENT',
    sourceId: fulfilment.id,
    customerId: customer.id,
    type: 'GAS',
    channel: 'DELIVERY',
    items: [
      {
        cylinderId: `CORPORATE-${fulfilment.id}`,
        productName: `${client.companyName || 'Corporate'} LPG ${effectiveKg}kg`,
        quantity: 1,
        unitPrice: itemSubtotal,
      },
    ],
    deliveryAddressSnapshot: {
      fullAddress,
      street: fullAddress,
      city: site?.city || client.city || 'Lagos',
      state: site?.state || client.state || 'Lagos',
      country: 'Nigeria',
      deliveryInstructions: clean(site?.deliveryInstructions || request?.notes || fulfilment.serviceNotes),
    },
    recipientName: clean(request?.deliveryContactName || site?.siteContactName || client.contactPerson || customer.name || client.companyName),
    recipientPhone: clean(request?.deliveryContactPhone || site?.siteContactPhone || client.phone || customer.phone || client.whatsappPhone || '00000000000'),
    itemsSubtotal: itemSubtotal,
    discountAmount: 0,
    vatAmount: 0,
    serviceFeeAmount: 0,
    deliveryFee,
    walletAmountUsed: 0,
    grandTotal,
    finalAmountPaid: toNum(fulfilment.amountPaid),
    status: deriveOrderStatus(fulfilment),
    paymentStatus: derivePaymentStatus(fulfilment),
    paymentMethod: mappedPayment.paymentMethod,
    paymentGateway: mappedPayment.paymentGateway,
    paymentIntentId: fulfilment.paymentReference || undefined,
    paymentGatewayReference: fulfilment.paymentGatewayReference || undefined,
    paymentTransactionId: fulfilment.paymentReference || undefined,
    estimatedDeliveryTime: fulfilment.promisedAt || fulfilment.scheduledAt || request?.requestedDeliveryDate || undefined,
    actualDeliveryTime: fulfilment.actualDeliveredAt || undefined,
    orderDate: fulfilment.requestedAt || request?.createdAt || new Date(),
    placedAt: fulfilment.requestedAt || request?.createdAt || new Date(),
    metadata: {
      sourceType: 'CORPORATE_FULFILMENT',
      corporateClientId: clean(client.id),
      corporateClientName: clean(client.companyName),
      corporateRequestId: clean(request?.id),
      corporateRequestCode: clean(request?.requestCode),
      corporateFulfilmentId: clean(fulfilment.id),
      corporateFulfilmentCode: clean(fulfilment.orderCode),
      corporateSiteId: clean(request?.siteId || site?.id),
      corporateSiteName: clean(request?.siteName || site?.siteName || fulfilment.deliverySiteName),
      poNumber: clean(request?.poNumber),
      paymentTerms: clean(client.paymentTerms || fulfilment.paymentMethod),
      branchKey: clean(client.assignedBranchId || fulfilment.branchId),
      paymentGateway: clean(mappedPayment.paymentGateway),
    },
    statusHistory: [
      {
        status: deriveOrderStatus(fulfilment),
        timestamp: new Date(),
        notes: `Created from corporate fulfilment ${fulfilment.orderCode || fulfilment.id}`,
        updatedBy: actorUserId || 'system',
        updaterRole: 'admin',
      },
    ],
  };

  if (isObjectId(branchCandidate)) payload.branchId = branchCandidate;
  if (fulfilment.driverId) payload.driverId = fulfilment.driverId;
  if (fulfilment.linkedRunId) payload.runId = fulfilment.linkedRunId;
  if (fulfilment.actualDeliveredAt || String(fulfilment.status).toUpperCase() === 'DELIVERED') payload.deliveredAt = fulfilment.actualDeliveredAt || new Date();
  if (String(fulfilment.status).toUpperCase() === 'IN_TRANSIT') payload.outForDeliveryAt = fulfilment.dispatchStartedAt || new Date();
  return payload;
};

const createOperationalOrderForFulfilment = async ({ client, request, fulfilment, actorUserId, force = false }) => {
  const existing = await Order.findOne({
    $or: [
      ...(fulfilment.linkedOrderId ? [{ id: fulfilment.linkedOrderId }] : []),
      { sourceType: 'CORPORATE_FULFILMENT', sourceId: fulfilment.id },
      { 'metadata.corporateFulfilmentId': fulfilment.id },
    ],
  });
  if (existing && !force) {
    fulfilment.linkedOrderId = existing.id;
    await fulfilment.save();
    return { order: existing.toObject ? existing.toObject() : existing, created: false };
  }

  const payload = await buildCorporateOrderPayload({ client, request, fulfilment, actorUserId });
  let order;
  if (existing && force) {
    Object.assign(existing, payload, { id: existing.id });
    order = await existing.save();
  } else {
    order = await Order.create(payload);
  }

  fulfilment.linkedOrderId = order.id;
  fulfilment.paymentGateway = String(order.paymentGateway || '').toUpperCase() || fulfilment.paymentGateway;
  fulfilment.statusHistory = Array.isArray(fulfilment.statusHistory) ? fulfilment.statusHistory : [];
  fulfilment.statusHistory.unshift({
    status: 'ORDER_CREATED',
    note: `Operational order ${order.id} created/linked for dispatch/order management.`,
    timestamp: new Date(),
    updatedBy: actorUserId,
    updatedByName: 'BMA',
  });
  await fulfilment.save();
  await syncOperationalOrderFromFulfilment(fulfilment, { actor: { id: actorUserId || 'system', name: 'BMA' } });
  return { order: order.toObject ? order.toObject() : order, created: !existing };
};

const removeFromPreviousRunIfMoved = async ({ fulfilment, nextRunId, actorUserId }) => {
  if (!fulfilment.linkedRunId || fulfilment.linkedRunId === nextRunId) return;
  const oldRun = await Run.findOne({ id: fulfilment.linkedRunId });
  if (!oldRun) return;
  const load = toNum(fulfilment.requestedKg || fulfilment.deliveredKg);
  const before = (oldRun.stops || []).length;
  oldRun.stops = (oldRun.stops || []).filter((s) => String(s.orderId) !== String(fulfilment.linkedOrderId));
  if (oldRun.stops.length !== before) {
    oldRun.estimatedLoadKg = Math.max(0, toNum(oldRun.estimatedLoadKg) - load);
    oldRun.statusHistory = Array.isArray(oldRun.statusHistory) ? oldRun.statusHistory : [];
    oldRun.statusHistory.push({ status: oldRun.overallStatus || 'Pending', timestamp: new Date(), notes: `Corporate order ${fulfilment.linkedOrderId} moved to run ${nextRunId}.`, updatedBy: actorUserId, updaterRole: 'admin' });
    await oldRun.save();
  }
};

const linkFulfilmentToRun = async ({ fulfilment, runId, actorUserId, sequence }) => {
  if (!runId) throw new HttpError(400, 'runId is required.');
  if (!fulfilment.linkedOrderId) throw new HttpError(400, 'Create/link an operational order before assigning a run.');
  const run = await Run.findOne({ id: runId });
  if (!run) throw new HttpError(404, 'Run not found.');

  await removeFromPreviousRunIfMoved({ fulfilment, nextRunId: runId, actorUserId });

  const loadKg = toNum(fulfilment.requestedKg || fulfilment.deliveredKg);
  const existingStop = (run.stops || []).find((s) => String(s.orderId) === String(fulfilment.linkedOrderId));
  if (!existingStop) {
    const nextSequence = Number(sequence) || ((run.stops || []).length + 1);
    run.stops.push({
      orderId: fulfilment.linkedOrderId,
      sequence: nextSequence,
      status: 'Pending',
      estimatedLoadKg: loadKg,
      notes: `Corporate fulfilment ${fulfilment.orderCode || fulfilment.id}`,
      statusHistory: [{ status: 'Pending', timestamp: new Date(), notes: 'Added from corporate fulfilment control.', updatedBy: actorUserId, updaterRole: 'admin' }],
    });
    run.estimatedLoadKg = toNum(run.estimatedLoadKg) + loadKg;
    run.statusHistory = Array.isArray(run.statusHistory) ? run.statusHistory : [];
    run.statusHistory.push({ status: run.overallStatus || 'Pending', timestamp: new Date(), notes: `Corporate order ${fulfilment.linkedOrderId} linked.`, updatedBy: actorUserId, updaterRole: 'admin' });
    await run.save();
  } else if (sequence && existingStop.sequence !== Number(sequence)) {
    existingStop.sequence = Number(sequence);
    await run.save();
  }

  await Order.findOneAndUpdate({ id: fulfilment.linkedOrderId }, { $set: { runId } });
  fulfilment.linkedRunId = runId;
  fulfilment.statusHistory = Array.isArray(fulfilment.statusHistory) ? fulfilment.statusHistory : [];
  fulfilment.statusHistory.unshift({ status: 'RUN_LINKED', note: `Linked to run ${run.runCode || run.id}.`, timestamp: new Date(), updatedBy: actorUserId, updatedByName: 'BMA' });
  await fulfilment.save();
  await syncOperationalOrderFromFulfilment(fulfilment, { actor: { id: actorUserId || 'system', name: 'BMA' } });
  return { run: run.toObject ? run.toObject() : run, fulfilment, idempotent: !!existingStop };
};

module.exports = {
  createOperationalOrderForFulfilment,
  linkFulfilmentToRun,
  mapPayment,
};
