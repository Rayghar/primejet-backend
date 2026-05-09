// File: src/api/v2/corporate-clients/corporateLifecycle.service.js
// One place for request / fulfilment / order / invoice status synchronisation.

const Order = require('../../../models/order.model');
const CorporateRequest = require('../../../models/corporateRequest.model');
const { ensureInvoiceForFulfilment } = require('./corporateBilling.service');

const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());
const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const actorFromReq = (req = {}) => ({
  id: req.user?.id || req.user?._id || req.userId || 'system',
  name: req.user?.name || req.user?.email || req.userName || 'system',
  email: req.user?.email || '',
});

const appendHistory = (doc, status, note, actor = {}, field = 'statusHistory') => {
  if (!doc) return;
  doc[field] = Array.isArray(doc[field]) ? doc[field] : [];
  const prev = doc[field][0];
  if (prev && prev.status === status && prev.note === note) return;
  doc[field].unshift({
    status,
    note,
    timestamp: new Date(),
    updatedBy: actor.id || actor.actorId || 'system',
    updatedByName: actor.name || actor.email || 'system',
  });
  doc[field] = doc[field].slice(0, 60);
};

const fulfilmentToRequestStatus = (status = '') => {
  const s = clean(status).toUpperCase();
  if (s === 'SCHEDULED') return 'SCHEDULED';
  if (s === 'IN_TRANSIT') return 'IN_TRANSIT';
  if (s === 'DELIVERED') return 'DELIVERED';
  if (s === 'CANCELLED') return 'CANCELLED';
  if (s === 'FAILED') return 'REJECTED';
  if (s === 'DELAYED') return 'SCHEDULED';
  return 'APPROVED';
};

const fulfilmentToOrderStatus = (fulfilment = {}) => {
  const status = clean(fulfilment.status).toUpperCase();
  if (status === 'DELIVERED') return 'Delivered';
  if (status === 'IN_TRANSIT') return 'Out for Delivery';
  if (status === 'SCHEDULED') return 'Order Placed';
  if (status === 'CANCELLED') return 'Canceled';
  if (status === 'FAILED') return 'Failed';
  return 'Order Placed';
};

const fulfilmentToOrderPaymentStatus = (fulfilment = {}) => {
  const s = clean(fulfilment.paymentStatus).toUpperCase();
  if (s === 'PAID') return 'Completed';
  if (s === 'PROCESSING') return 'Processing (Gateway)';
  if (s === 'PART_PAID') return 'Processing (Gateway)';
  if (s === 'WAIVED') return 'Completed';
  return 'Pending';
};

const transitionRequest = async (request, status, { actor = {}, note, save = true } = {}) => {
  if (!request || !status) return request;
  const next = clean(status).toUpperCase();
  if (request.status !== next) request.status = next;
  request.updatedBy = actor.id || request.updatedBy;
  appendHistory(request, next, note || `Request moved to ${next}.`, actor);
  if (save) await request.save();
  return request;
};

const transitionFulfilment = async (fulfilment, status, { actor = {}, note, save = true, client, request } = {}) => {
  if (!fulfilment || !status) return fulfilment;
  const next = clean(status).toUpperCase();
  if (fulfilment.status !== next) fulfilment.status = next;
  fulfilment.updatedBy = actor.id || fulfilment.updatedBy;
  if (next === 'IN_TRANSIT' && !fulfilment.dispatchStartedAt) fulfilment.dispatchStartedAt = new Date();
  if (next === 'DELIVERED' && !fulfilment.actualDeliveredAt) fulfilment.actualDeliveredAt = new Date();
  appendHistory(fulfilment, next, note || `Fulfilment moved to ${next}.`, actor);
  if (save) await fulfilment.save();

  if (next === 'DELIVERED' && client) {
    await ensureInvoiceForFulfilment({ client, request, fulfilment, actor, forceRefresh: false });
  }
  await syncOperationalOrderFromFulfilment(fulfilment, { actor });
  await syncRequestFromFulfilment(fulfilment, { actor });
  return fulfilment;
};

const syncRequestFromFulfilment = async (fulfilment, { actor = {}, request } = {}) => {
  if (!fulfilment?.id) return null;
  const req = request || await CorporateRequest.findOne({ linkedFulfilmentId: fulfilment.id });
  if (!req) return null;
  const nextStatus = fulfilmentToRequestStatus(fulfilment.status);
  if (req.status !== nextStatus) {
    req.status = nextStatus;
    if (nextStatus === 'DELIVERED' && !req.deliveredAt) req.deliveredAt = fulfilment.actualDeliveredAt || new Date();
    req.updatedBy = actor.id || req.updatedBy;
    appendHistory(req, nextStatus, `Synced from fulfilment ${fulfilment.orderCode || fulfilment.id}.`, actor);
    await req.save();
  }
  return req;
};

const syncOperationalOrderFromFulfilment = async (fulfilment, { actor = {}, paymentPatch = {} } = {}) => {
  if (!fulfilment?.linkedOrderId) return null;
  const order = await Order.findOne({ id: fulfilment.linkedOrderId });
  if (!order) return null;
  const status = fulfilmentToOrderStatus(fulfilment);
  const paymentStatus = fulfilmentToOrderPaymentStatus(fulfilment);
  const update = {
    status,
    paymentStatus,
    finalAmountPaid: toNum(fulfilment.amountPaid),
    paymentIntentId: fulfilment.paymentReference || order.paymentIntentId,
    paymentGatewayReference: fulfilment.paymentGatewayReference || order.paymentGatewayReference,
    paymentTransactionId: fulfilment.paymentReference || order.paymentTransactionId,
  };
  if (fulfilment.linkedRunId) update.runId = fulfilment.linkedRunId;
  if (fulfilment.actualDeliveredAt || status === 'Delivered') {
    update.deliveredAt = fulfilment.actualDeliveredAt || new Date();
    update.actualDeliveryTime = fulfilment.actualDeliveredAt || order.actualDeliveryTime || new Date();
  }
  if (fulfilment.dispatchStartedAt || status === 'Out for Delivery') update.outForDeliveryAt = fulfilment.dispatchStartedAt || order.outForDeliveryAt || new Date();
  if (paymentPatch.paymentMethod) update.paymentMethod = paymentPatch.paymentMethod;
  if (paymentPatch.paymentGateway !== undefined) update.paymentGateway = paymentPatch.paymentGateway;

  Object.assign(order, update);
  order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  order.statusHistory.push({
    status,
    timestamp: new Date(),
    notes: `Synced from corporate fulfilment ${fulfilment.orderCode || fulfilment.id}.`,
    updatedBy: actor.id || 'system',
    updaterRole: 'system',
  });
  await order.save();
  return order;
};

const syncPaymentFromInvoiceOrFulfilment = async (fulfilment, { actor = {}, paymentMethod, paymentGateway } = {}) => {
  if (!fulfilment) return null;
  return syncOperationalOrderFromFulfilment(fulfilment, { actor, paymentPatch: { paymentMethod, paymentGateway } });
};

module.exports = {
  actorFromReq,
  appendHistory,
  transitionRequest,
  transitionFulfilment,
  syncRequestFromFulfilment,
  syncOperationalOrderFromFulfilment,
  syncPaymentFromInvoiceOrFulfilment,
  fulfilmentToOrderStatus,
  fulfilmentToOrderPaymentStatus,
};
