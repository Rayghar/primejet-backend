// src/api/v2/pricing/priceOverride.service.js
const mongoose = require('mongoose');
const PriceOverrideRequest = require('../../../models/priceOverrideRequest.model');
const HttpError = require('../../../utils/HttpError');
const { assertEffectivePriceExists, assertValidPlant, assertOpenPeriod, parseDate, toNum, hasVal } = require('../control/operationalValidation.service');
const { writeControlAudit } = require('../control/auditTrail.service');

const findByAnyId = async (id) => PriceOverrideRequest.findOne({
  $or: [{ overrideId: String(id) }, mongoose.Types.ObjectId.isValid(String(id)) ? { _id: id } : null].filter(Boolean),
});

const list = async (filters = {}) => {
  const q = {};
  if (filters.branchId) q.branchId = String(filters.branchId);
  if (filters.status) q.status = String(filters.status).toUpperCase();
  return PriceOverrideRequest.find(q).sort({ createdAt: -1 }).limit(Number(filters.limit) || 200).lean();
};

const request = async (payload = {}, userId = 'system') => {
  const branchId = String(payload.branchId || payload.plantId || '').trim();
  const businessDate = parseDate(payload.businessDate || payload.date || new Date());
  if (!branchId) throw new HttpError(400, 'branchId is required.');
  if (!businessDate) throw new HttpError(400, 'businessDate is invalid.');
  await assertValidPlant(branchId, { requireOperational: false });
  await assertOpenPeriod(businessDate, 'request a price override');
  const price = await assertEffectivePriceExists({ branchId, productId: payload.productId, productSku: payload.productSku, businessDate });
  const requested = toNum(payload.requestedPricePerKg ?? payload.pricePerKg, 0);
  if (requested <= 0) throw new HttpError(400, 'requestedPricePerKg must be greater than zero.');
  if (Math.abs(requested - toNum(price.pricePerKg, 0)) < 0.01) throw new HttpError(400, 'Requested price is the same as the configured effective price; override is not required.');
  if (!hasVal(payload.reason)) throw new HttpError(400, 'Override reason is required.');
  const validUntil = payload.validUntil ? parseDate(payload.validUntil) : new Date(businessDate.getTime() + 24 * 60 * 60 * 1000);
  const row = await PriceOverrideRequest.create({
    branchId,
    productId: price.productId || payload.productId || null,
    productSku: price.productSku || payload.productSku || null,
    businessDate,
    configuredPricePerKg: toNum(price.pricePerKg, 0),
    requestedPricePerKg: requested,
    variancePerKg: requested - toNum(price.pricePerKg, 0),
    reason: String(payload.reason).trim(),
    status: 'REQUESTED',
    requestedBy: userId,
    validUntil,
  });
  await writeControlAudit({ branchId, businessDate, action: 'PRICE_OVERRIDE_REQUESTED', performedBy: userId, reason: row.reason, meta: { overrideId: row.overrideId, configuredPricePerKg: row.configuredPricePerKg, requestedPricePerKg: row.requestedPricePerKg } });
  return row;
};

const approve = async (id, payload = {}, userId = 'system') => {
  const row = await findByAnyId(id);
  if (!row) throw new HttpError(404, 'Price override request not found.');
  if (!['REQUESTED', 'APPROVED'].includes(row.status)) throw new HttpError(400, `Cannot approve override from status ${row.status}.`);
  row.status = 'APPROVED';
  row.approvedBy = userId;
  row.approvedAt = new Date();
  row.approvalComment = payload.comment || payload.approvalComment || null;
  await row.save();
  await writeControlAudit({ branchId: row.branchId, businessDate: row.businessDate, action: 'PRICE_OVERRIDE_APPROVED', performedBy: userId, reason: row.approvalComment, meta: { overrideId: row.overrideId } });
  return row;
};

const reject = async (id, payload = {}, userId = 'system') => {
  const row = await findByAnyId(id);
  if (!row) throw new HttpError(404, 'Price override request not found.');
  if (!hasVal(payload.reason)) throw new HttpError(400, 'Rejection reason is required.');
  row.status = 'REJECTED';
  row.rejectedBy = userId;
  row.rejectedAt = new Date();
  row.rejectionReason = String(payload.reason).trim();
  await row.save();
  await writeControlAudit({ branchId: row.branchId, businessDate: row.businessDate, action: 'PRICE_OVERRIDE_REJECTED', performedBy: userId, reason: row.rejectionReason, meta: { overrideId: row.overrideId } });
  return row;
};

const assertApprovedOverrideForSale = async ({ overrideId, branchId, productId, productSku, requestedPricePerKg, businessDate }) => {
  if (!overrideId) throw new HttpError(409, 'PRICE_OVERRIDE_APPROVAL_REQUIRED');
  const row = await findByAnyId(overrideId);
  if (!row) throw new HttpError(409, 'PRICE_OVERRIDE_APPROVAL_REQUIRED');
  if (row.status !== 'APPROVED') throw new HttpError(409, `Price override is ${row.status}; approval is required before sale can be logged.`);
  if (row.validUntil && new Date(row.validUntil) < new Date()) throw new HttpError(409, 'Approved price override has expired.');
  if (String(row.branchId) !== String(branchId)) throw new HttpError(400, 'Approved price override belongs to a different branch.');
  if (productId && row.productId && String(row.productId) !== String(productId)) throw new HttpError(400, 'Approved price override belongs to a different product.');
  if (productSku && row.productSku && String(row.productSku) !== String(productSku)) throw new HttpError(400, 'Approved price override belongs to a different product SKU.');
  if (Math.abs(toNum(row.requestedPricePerKg, 0) - toNum(requestedPricePerKg, 0)) > 0.01) throw new HttpError(400, 'Approved price override does not match entered price.');
  return row;
};

const markUsed = async (overrideId, { saleId, userId }) => {
  if (!overrideId) return null;
  const row = await findByAnyId(overrideId);
  if (!row) return null;
  row.status = 'USED';
  row.saleId = saleId || null;
  row.usedAt = new Date();
  row.usedBy = userId || null;
  await row.save();
  return row;
};

module.exports = { list, request, approve, reject, assertApprovedOverrideForSale, markUsed };
