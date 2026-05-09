// File: src/api/v2/business/business.controller.js
const CorporateClient = require('../../../models/corporateClient.model');
const CorporateSite = require('../../../models/corporateSite.model');
const CorporateRequest = require('../../../models/corporateRequest.model');
const CorporateFulfilment = require('../../../models/corporateFulfilment.model');
const CorporateInvoice = require('../../../models/corporateInvoice.model');
const SupportTicket = require('../../../models/supportTicket.model');
const Message = require('../../../models/message.model');
const Promotion = require('../../../models/promotion.model');
const User = require('../../../models/user.model');
const WalletTransaction = require('../../../models/walletTransaction.model');
const axios = require('axios');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const { ensureInvoiceForFulfilment, recordInvoicePayment, invoiceToStatementRows, buildBillingSummaryFromInvoices } = require('../corporate-clients/corporateBilling.service');
const { actorFromReq, transitionRequest, transitionFulfilment, syncPaymentFromInvoiceOrFulfilment } = require('../corporate-clients/corporateLifecycle.service');
const socketManager = require('../../../socket.manager');

const corporateRoles = ['corporate_admin', 'corporate_requester', 'corporate_approver', 'corporate_viewer'];
const requestOpenStatuses = ['SUBMITTED', 'UNDER_REVIEW', 'QUOTED', 'APPROVED', 'SCHEDULED', 'IN_TRANSIT'];
const fulfilmentOpenStatuses = ['REQUESTED', 'SCHEDULED', 'IN_TRANSIT', 'DELAYED'];
const corporatePaymentRefPrefix = 'CORP';

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const round = (n, dp = 2) => Math.round(toNum(n) * 10 ** dp) / 10 ** dp;
const now = () => new Date();
const asDate = (v) => (v === '' || v === null || v === undefined ? undefined : v);
const arr = (v) => (Array.isArray(v) ? v : []);
const escapeRegex = (s = '') => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isCorporateUser = (user = {}) => corporateRoles.includes(user.role) && user.corporateClientId;
const canSubmit = (user = {}) => ['corporate_admin', 'corporate_requester', 'corporate_approver'].includes(user.role);
const canApprove = (user = {}) => ['corporate_admin', 'corporate_approver'].includes(user.role);
const canManageSites = (user = {}) => ['corporate_admin'].includes(user.role);

const requireCorporate = async (req) => {
  if (!isCorporateUser(req.user)) throw new HttpError(403, 'Corporate portal access is required.');
  const client = await CorporateClient.findOne({ id: req.user.corporateClientId, portalEnabled: true }).lean();
  if (!client) throw new HttpError(403, 'Corporate portal is not enabled for this account.');
  if (client.status === 'BLACKLISTED' || client.portalStatus === 'SUSPENDED') throw new HttpError(403, 'Corporate portal access is suspended for this account.');
  return client;
};

const siteFilterForUser = (user = {}, base = {}) => {
  const filter = { ...base, clientId: user.corporateClientId };
  const allowed = arr(user.corporateSiteAccess).filter(Boolean);
  if (allowed.length && user.role !== 'corporate_admin') filter.id = { $in: allowed };
  return filter;
};

const ensureSiteAllowed = async (user, siteId) => {
  if (!siteId) return null;
  const filter = siteFilterForUser(user, { id: siteId, status: { $ne: 'INACTIVE' } });
  const site = await CorporateSite.findOne(filter).lean();
  if (!site) throw new HttpError(403, 'Selected delivery site is not available to this user.');
  return site;
};

const addRequestTimeline = (doc, req, status, note) => {
  doc.statusHistory = Array.isArray(doc.statusHistory) ? doc.statusHistory : [];
  doc.statusHistory.unshift({
    status,
    note,
    timestamp: now(),
    updatedBy: req.user?.id,
    updatedByName: req.user?.name || req.user?.email,
  });
  doc.statusHistory = doc.statusHistory.slice(0, 40);
};

const cleanSitePayload = (body = {}) => ({
  siteName: body.siteName,
  siteType: body.siteType,
  address: body.address,
  city: body.city,
  state: body.state,
  latitude: body.latitude === '' || body.latitude === undefined ? undefined : toNum(body.latitude),
  longitude: body.longitude === '' || body.longitude === undefined ? undefined : toNum(body.longitude),
  siteContactName: body.siteContactName,
  siteContactPhone: body.siteContactPhone,
  siteContactEmail: body.siteContactEmail,
  preferredDeliveryWindow: body.preferredDeliveryWindow,
  deliveryInstructions: body.deliveryInstructions,
  defaultProductType: body.defaultProductType,
  estimatedMonthlyKg: toNum(body.estimatedMonthlyKg),
});

const cleanRequestPayload = (body = {}) => ({
  siteId: body.siteId,
  requestType: body.requestType,
  priority: body.priority,
  requestedKg: toNum(body.requestedKg),
  cylinderLines: arr(body.cylinderLines).map((line) => ({ sizeKg: toNum(line.sizeKg), quantity: toNum(line.quantity) })).filter((line) => line.sizeKg || line.quantity),
  requestedDeliveryDate: asDate(body.requestedDeliveryDate),
  preferredDeliveryWindow: body.preferredDeliveryWindow,
  paymentType: body.paymentType,
  poNumber: body.poNumber,
  deliveryContactName: body.deliveryContactName,
  deliveryContactPhone: body.deliveryContactPhone,
  notes: body.notes,
});

const getMonnifyBaseUrl = () => (process.env.NODE_ENV === 'production' ? 'https://api.monnify.com' : 'https://sandbox.monnify.com');

const getMonnifyAccessToken = async () => {
  const apiKey = process.env.MONNIFY_API_KEY;
  const secretKey = process.env.MONNIFY_SECRET_KEY;
  if (!apiKey || !secretKey) throw new HttpError(500, 'Payment gateway configuration is missing.');
  const authString = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
  const loginRes = await axios.post(`${getMonnifyBaseUrl()}/api/v1/auth/login`, {}, { headers: { Authorization: `Basic ${authString}` } });
  return loginRes.data?.responseBody?.accessToken;
};

const ticketFilterForUser = (user = {}, extra = {}) => ({
  ...extra,
  corporateClientId: user.corporateClientId,
});

const toPublicTicket = (ticket) => ({
  ...(typeof ticket.toObject === 'function' ? ticket.toObject() : ticket),
  chatId: `corp-ticket:${ticket.id}`,
});


const invoiceCodeFor = (f = {}) => f.invoiceNumber || f.orderCode || `INV-${String(f.id || '').slice(0, 8).toUpperCase()}`;

const toInvoiceRow = (f = {}) => {
  const revenue = round(toNum(f.revenue || (toNum(f.deliveredKg || f.requestedKg) * toNum(f.sellingPricePerKg))));
  const paid = round(toNum(f.amountPaid));
  const outstanding = round(toNum(f.outstandingAmount !== undefined ? f.outstandingAmount : Math.max(0, revenue - paid)));
  return {
    ...f,
    invoiceNumber: invoiceCodeFor(f),
    invoiceReference: invoiceCodeFor(f),
    invoiceDate: f.actualDeliveredAt || f.createdAt,
    dueDate: f.paymentDueDate,
    revenue,
    amountPaid: paid,
    outstandingAmount: outstanding,
    paymentStatus: f.paymentStatus || (outstanding <= 0 ? 'PAID' : paid > 0 ? 'PART_PAID' : 'UNPAID'),
    statementType: 'INVOICE',
  };
};

const buildBillingSummary = (rows = [], client = {}) => {
  const invoices = rows.map(toInvoiceRow);
  const nowDate = new Date();
  const openInvoices = invoices.filter((r) => toNum(r.outstandingAmount) > 0 && r.paymentStatus !== 'PAID');
  const overdueInvoices = openInvoices.filter((r) => r.dueDate && new Date(r.dueDate) < nowDate);
  const totalInvoiceValue = round(invoices.reduce((sum, r) => sum + toNum(r.revenue), 0));
  const totalPaid = round(invoices.reduce((sum, r) => sum + toNum(r.amountPaid), 0));
  const outstanding = round(invoices.reduce((sum, r) => sum + toNum(r.outstandingAmount), 0));
  const deliveredKg = round(invoices.reduce((sum, r) => sum + toNum(r.deliveredKg), 0));
  const creditLimit = toNum(client.creditLimit);
  return {
    totalInvoiceValue,
    totalPaid,
    outstanding,
    deliveredKg,
    openInvoiceCount: openInvoices.length,
    overdueInvoiceCount: overdueInvoices.length,
    creditLimit,
    availableCredit: Math.max(0, round(creditLimit - outstanding)),
    creditUtilizationPct: creditLimit > 0 ? round((outstanding / creditLimit) * 100) : 0,
    hasCreditRisk: creditLimit > 0 && outstanding > creditLimit,
    hasOverdue: overdueInvoices.length > 0,
  };
};

const buildStatement = (rows = [], client = {}) => {
  const invoiceRows = rows.map(toInvoiceRow).sort((a, b) => new Date(a.invoiceDate || a.createdAt || 0) - new Date(b.invoiceDate || b.createdAt || 0));
  let balance = 0;
  const lines = [];
  invoiceRows.forEach((r) => {
    const invoiceValue = toNum(r.revenue);
    const paid = toNum(r.amountPaid);
    if (invoiceValue > 0) {
      balance = round(balance + invoiceValue);
      lines.push({
        id: `${r.id || r.invoiceNumber}-invoice`,
        type: 'INVOICE',
        date: r.invoiceDate || r.createdAt,
        reference: r.invoiceNumber,
        description: `${r.deliverySiteName || 'Corporate LPG delivery'} • ${round(toNum(r.deliveredKg || r.requestedKg))}kg`,
        debit: invoiceValue,
        credit: 0,
        balance,
        fulfilmentId: r.id,
      });
    }
    if (paid > 0) {
      balance = round(balance - paid);
      lines.push({
        id: `${r.id || r.invoiceNumber}-payment`,
        type: 'PAYMENT',
        date: r.lastPaymentAt || r.updatedAt || r.createdAt,
        reference: r.paymentReference || r.invoiceNumber,
        description: `Payment received for ${r.invoiceNumber}`,
        debit: 0,
        credit: paid,
        balance,
        fulfilmentId: r.id,
      });
    }
  });
  return {
    client: { id: client.id, companyName: client.companyName, clientCode: client.clientCode, billingEmail: client.billingEmail, paymentTerms: client.paymentTerms },
    openingBalance: 0,
    closingBalance: round(balance),
    lines: lines.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
  };
};


const ensureClientInvoices = async (client, actor = {}) => {
  const fulfilments = await CorporateFulfilment.find({
    clientId: client.id,
    $or: [{ status: 'DELIVERED' }, { revenue: { $gt: 0 } }, { outstandingAmount: { $gt: 0 } }, { invoiceNumber: { $exists: true, $ne: '' } }],
  }).sort({ createdAt: -1 }).limit(500);
  for (const f of fulfilments) {
    await ensureInvoiceForFulfilment({ client, request: null, fulfilment: f, actor, forceRefresh: false }).catch((err) => logger.warn('Business invoice ensure skipped:', err.message));
  }
  return CorporateInvoice.find({ clientId: client.id }).sort({ invoiceDate: -1, createdAt: -1 }).limit(500).lean();
};

const publicInvoiceRow = (inv = {}) => ({
  ...inv,
  invoiceReference: inv.invoiceNumber,
  invoiceDate: inv.invoiceDate || inv.createdAt,
  dueDate: inv.dueDate,
  revenue: round(toNum(inv.totalAmount)),
  amountPaid: round(toNum(inv.amountPaid)),
  outstandingAmount: round(toNum(inv.outstandingAmount)),
  paymentStatus: inv.paymentStatus,
  statementType: 'INVOICE',
});

const getMe = async (req, res, next) => {
  try {
    const client = await requireCorporate(req);
    const [siteCount, openRequestCount, openFulfilmentCount] = await Promise.all([
      CorporateSite.countDocuments(siteFilterForUser(req.user, { status: { $ne: 'INACTIVE' } })),
      CorporateRequest.countDocuments({ clientId: client.id, status: { $in: requestOpenStatuses } }),
      CorporateFulfilment.countDocuments({ clientId: client.id, status: { $in: fulfilmentOpenStatuses } }),
    ]);
    res.status(200).json({
      user: req.user,
      client,
      summary: { siteCount, openRequestCount, openFulfilmentCount },
    });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load corporate profile.'));
  }
};

const getDashboard = async (req, res, next) => {
  try {
    const client = await requireCorporate(req);
    const siteFilter = siteFilterForUser(req.user, { status: { $ne: 'INACTIVE' } });
    const [sites, requests, fulfilments] = await Promise.all([
      CorporateSite.find(siteFilter).sort({ siteName: 1 }).limit(50).lean(),
      CorporateRequest.find({ clientId: client.id }).sort({ createdAt: -1 }).limit(80).lean(),
      CorporateFulfilment.find({ clientId: client.id }).sort({ createdAt: -1 }).limit(80).lean(),
    ]);
    const siteIds = new Set(sites.map((s) => s.id));
    const scopedRequests = arr(req.user.corporateSiteAccess).length && req.user.role !== 'corporate_admin'
      ? requests.filter((r) => !r.siteId || siteIds.has(r.siteId))
      : requests;
    const scopedFulfilments = arr(req.user.corporateSiteAccess).length && req.user.role !== 'corporate_admin'
      ? fulfilments.filter((f) => !f.deliverySiteName || scopedRequests.some((r) => r.linkedFulfilmentId === f.id || r.siteName === f.deliverySiteName))
      : fulfilments;
    const delivered = scopedFulfilments.filter((f) => f.status === 'DELIVERED');
    const open = scopedFulfilments.filter((f) => fulfilmentOpenStatuses.includes(f.status));
    const outstanding = scopedFulfilments.reduce((sum, f) => sum + toNum(f.outstandingAmount), 0);
    const onTime = delivered.filter((f) => ['ON_TIME', 'NOT_APPLICABLE'].includes(f.slaStatus));
    const revenue = scopedFulfilments.reduce((sum, f) => sum + toNum(f.revenue), 0);
    const paid = scopedFulfilments.reduce((sum, f) => sum + toNum(f.amountPaid), 0);
    const deliveredKg = round(delivered.reduce((sum, f) => sum + toNum(f.deliveredKg), 0));
    const requestedKg = round(scopedRequests.reduce((sum, r) => sum + toNum(r.requestedKg), 0));
    const bySite = sites.map((site) => {
      const siteReqs = scopedRequests.filter((r) => r.siteId === site.id || r.siteName === site.siteName);
      const siteFulfilments = scopedFulfilments.filter((f) => f.deliverySiteName === site.siteName || siteReqs.some((r) => r.linkedFulfilmentId === f.id));
      return {
        id: site.id,
        siteName: site.siteName,
        requestedKg: round(siteReqs.reduce((sum, r) => sum + toNum(r.requestedKg), 0)),
        deliveredKg: round(siteFulfilments.filter((f) => f.status === 'DELIVERED').reduce((sum, f) => sum + toNum(f.deliveredKg), 0)),
        spend: round(siteFulfilments.reduce((sum, f) => sum + toNum(f.revenue), 0)),
        openRequests: siteReqs.filter((r) => requestOpenStatuses.includes(r.status)).length,
      };
    });
    res.status(200).json({
      client,
      metrics: {
        siteCount: sites.length,
        openRequests: scopedRequests.filter((r) => requestOpenStatuses.includes(r.status)).length,
        pendingApproval: scopedRequests.filter((r) => r.requiresClientApproval && !r.approvedAt).length,
        openDeliveries: open.length,
        deliveredCount: delivered.length,
        deliveredKg,
        requestedKg,
        revenue: round(revenue),
        paid: round(paid),
        outstandingAmount: round(outstanding),
        creditLimit: toNum(client.creditLimit),
        creditAvailable: Math.max(0, toNum(client.creditLimit) - outstanding),
        onTimeDeliveryRate: delivered.length ? round((onTime.length / delivered.length) * 100) : 0,
      },
      analytics: {
        bySite,
        monthly: scopedFulfilments.reduce((acc, f) => {
          const d = f.actualDeliveredAt || f.createdAt;
          const key = d ? new Date(d).toISOString().slice(0, 7) : 'unknown';
          acc[key] = acc[key] || { period: key, deliveredKg: 0, revenue: 0, outstanding: 0, deliveries: 0 };
          acc[key].deliveredKg = round(acc[key].deliveredKg + toNum(f.deliveredKg));
          acc[key].revenue = round(acc[key].revenue + toNum(f.revenue));
          acc[key].outstanding = round(acc[key].outstanding + toNum(f.outstandingAmount));
          acc[key].deliveries += 1;
          return acc;
        }, {}),
      },
      recentRequests: scopedRequests.slice(0, 10),
      recentFulfilments: scopedFulfilments.slice(0, 10),
      sites: sites.slice(0, 12),
    });
  } catch (error) {
    logger.error('Business dashboard error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load business dashboard.'));
  }
};

const listSites = async (req, res, next) => {
  try {
    await requireCorporate(req);
    const rows = await CorporateSite.find(siteFilterForUser(req.user, { status: { $ne: 'INACTIVE' } })).sort({ siteName: 1 }).lean();
    res.status(200).json({ rows });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load delivery sites.'));
  }
};

const createSite = async (req, res, next) => {
  try {
    const client = await requireCorporate(req);
    if (!canManageSites(req.user)) return next(new HttpError(403, 'Only corporate admins can request or add delivery sites.'));
    const payload = cleanSitePayload(req.body);
    if (!payload.siteName || !payload.address) return next(new HttpError(400, 'Site name and address are required.'));
    payload.clientId = client.id;
    payload.clientName = client.companyName;
    payload.assignedBranchId = client.assignedBranchId;
    payload.assignedBranchName = client.assignedBranchName;
    payload.status = 'PENDING_REVIEW';
    payload.createdBy = req.user?.id;
    payload.updatedBy = req.user?.id;
    const site = await CorporateSite.create(payload);
    res.status(201).json({ message: 'Delivery site submitted for review.', site });
  } catch (error) {
    logger.error('Business site create error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to create delivery site.'));
  }
};

const requestFilterFromQuery = (req) => {
  const filter = { clientId: req.user.corporateClientId };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.siteId) filter.siteId = req.query.siteId;
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(req.query.search), 'i');
    filter.$or = [{ requestCode: rx }, { siteName: rx }, { poNumber: rx }, { notes: rx }];
  }
  const allowed = arr(req.user.corporateSiteAccess).filter(Boolean);
  if (allowed.length && req.user.role !== 'corporate_admin') filter.$and = [{ $or: [{ siteId: { $in: allowed } }, { siteId: { $exists: false } }, { siteId: '' }] }];
  return filter;
};

const listRequests = async (req, res, next) => {
  try {
    await requireCorporate(req);
    const rows = await CorporateRequest.find(requestFilterFromQuery(req)).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 100, 300)).lean();
    res.status(200).json({ rows });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load corporate requests.'));
  }
};

const createRequest = async (req, res, next) => {
  try {
    const client = await requireCorporate(req);
    if (!canSubmit(req.user)) return next(new HttpError(403, 'Your portal role cannot submit requests.'));
    const payload = cleanRequestPayload(req.body);
    if (!payload.requestedKg || payload.requestedKg <= 0) return next(new HttpError(400, 'Requested KG is required.'));
    const site = await ensureSiteAllowed(req.user, payload.siteId);
    payload.clientId = client.id;
    payload.clientName = client.companyName;
    payload.siteName = site?.siteName || req.body.siteName;
    payload.deliveryAddress = site?.address || req.body.deliveryAddress || client.address;
    payload.preferredDeliveryWindow = payload.preferredDeliveryWindow || site?.preferredDeliveryWindow;
    payload.deliveryContactName = payload.deliveryContactName || site?.siteContactName || client.contactPerson;
    payload.deliveryContactPhone = payload.deliveryContactPhone || site?.siteContactPhone || client.phone || client.whatsappPhone;
    payload.estimatedPricePerKg = toNum(client.agreedPricePerKg);
    payload.requestSource = 'BUSINESS_PORTAL';
    payload.status = client.requiresInternalApproval && req.user.role === 'corporate_requester' ? 'DRAFT' : 'SUBMITTED';
    payload.requiresClientApproval = client.requiresInternalApproval && req.user.role === 'corporate_requester';
    payload.createdBy = req.user.id;
    payload.createdByName = req.user.name || req.user.email;
    payload.updatedBy = req.user.id;
    const request = new CorporateRequest(payload);
    addRequestTimeline(request, req, request.status, request.requiresClientApproval ? 'Request drafted and awaiting company approver.' : 'Request submitted from Business Portal.');
    await request.save();
    res.status(201).json({ message: request.requiresClientApproval ? 'Request saved for company approval.' : 'Corporate request submitted.', request });
  } catch (error) {
    logger.error('Business request create error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to create corporate request.'));
  }
};

const getRequest = async (req, res, next) => {
  try {
    await requireCorporate(req);
    const request = await CorporateRequest.findOne({ ...requestFilterFromQuery(req), id: req.params.requestId }).lean();
    if (!request) return next(new HttpError(404, 'Corporate request not found.'));
    const fulfilment = request.linkedFulfilmentId ? await CorporateFulfilment.findOne({ id: request.linkedFulfilmentId, clientId: req.user.corporateClientId }).lean() : null;
    res.status(200).json({ request, fulfilment });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load corporate request.'));
  }
};

const approveRequest = async (req, res, next) => {
  try {
    await requireCorporate(req);
    if (!canApprove(req.user)) return next(new HttpError(403, 'Your portal role cannot approve corporate requests.'));
    const request = await CorporateRequest.findOne({ clientId: req.user.corporateClientId, id: req.params.requestId });
    if (!request) return next(new HttpError(404, 'Corporate request not found.'));
    if (!['DRAFT', 'SUBMITTED'].includes(request.status)) return next(new HttpError(400, 'Only draft/submitted requests can be approved by the client.'));
    request.status = 'SUBMITTED';
    request.requiresClientApproval = false;
    request.approvedByClientUserId = req.user.id;
    request.approvedByClientUserName = req.user.name || req.user.email;
    request.approvedAt = now();
    request.updatedBy = req.user.id;
    addRequestTimeline(request, req, 'SUBMITTED', 'Approved by corporate client approver and submitted to PrimeJet.');
    await request.save();
    res.status(200).json({ message: 'Request approved and submitted.', request });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to approve corporate request.'));
  }
};

const cancelRequest = async (req, res, next) => {
  try {
    await requireCorporate(req);
    const request = await CorporateRequest.findOne({ clientId: req.user.corporateClientId, id: req.params.requestId });
    if (!request) return next(new HttpError(404, 'Corporate request not found.'));
    if (['SCHEDULED', 'IN_TRANSIT', 'DELIVERED'].includes(request.status)) return next(new HttpError(400, 'This request can no longer be cancelled from the portal. Contact your relationship manager.'));
    request.status = 'CANCELLED';
    request.updatedBy = req.user.id;
    addRequestTimeline(request, req, 'CANCELLED', req.body.note || 'Cancelled by corporate portal user.');
    await request.save();
    res.status(200).json({ message: 'Request cancelled.', request });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to cancel corporate request.'));
  }
};

const listFulfilments = async (req, res, next) => {
  try {
    await requireCorporate(req);
    const filter = { clientId: req.user.corporateClientId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
    const rows = await CorporateFulfilment.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 100, 300)).lean();
    res.status(200).json({ rows });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load deliveries.'));
  }
};

const listInvoices = async (req, res, next) => {
  try {
    const client = await requireCorporate(req);
    const invoices = await ensureClientInvoices(client, actorFromReq(req));
    const rows = invoices.map(publicInvoiceRow);
    res.status(200).json({ rows, summary: buildBillingSummaryFromInvoices(invoices, client), statement: { client: { id: client.id, companyName: client.companyName, clientCode: client.clientCode, billingEmail: client.billingEmail, paymentTerms: client.paymentTerms }, openingBalance: 0, closingBalance: buildBillingSummaryFromInvoices(invoices, client).outstanding, lines: invoiceToStatementRows(invoices) } });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load invoices.'));
  }
};

const getStatement = async (req, res, next) => {
  try {
    const client = await requireCorporate(req);
    const invoices = await ensureClientInvoices(client, actorFromReq(req));
    const summary = buildBillingSummaryFromInvoices(invoices, client);
    res.status(200).json({
      ok: true,
      summary,
      statement: {
        client: { id: client.id, companyName: client.companyName, clientCode: client.clientCode, billingEmail: client.billingEmail, paymentTerms: client.paymentTerms },
        openingBalance: 0,
        closingBalance: summary.outstanding,
        lines: invoiceToStatementRows(invoices),
      },
      rows: invoices.map(publicInvoiceRow),
    });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load statement.'));
  }
};

const getBilling = async (req, res, next) => {
  try {
    const client = await requireCorporate(req);
    const invoices = await ensureClientInvoices(client, actorFromReq(req));
    const summary = buildBillingSummaryFromInvoices(invoices, client);
    res.status(200).json({
      ok: true,
      client: { id: client.id, companyName: client.companyName, clientCode: client.clientCode, paymentTerms: client.paymentTerms, creditLimit: client.creditLimit, billingEmail: client.billingEmail },
      summary,
      invoices: invoices.map(publicInvoiceRow),
      statement: {
        client: { id: client.id, companyName: client.companyName, clientCode: client.clientCode, billingEmail: client.billingEmail, paymentTerms: client.paymentTerms },
        openingBalance: 0,
        closingBalance: summary.outstanding,
        lines: invoiceToStatementRows(invoices),
      },
    });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load corporate billing.'));
  }
};

const confirmDelivery = async (req, res, next) => {
  try {
    await requireCorporate(req);
    const fulfilment = await CorporateFulfilment.findOne({ id: req.params.fulfilmentId, clientId: req.user.corporateClientId });
    if (!fulfilment) return next(new HttpError(404, 'Delivery not found.'));
    if (fulfilment.status !== 'DELIVERED') return next(new HttpError(400, 'Only delivered fulfilments can be confirmed.'));
    fulfilment.customerConfirmed = true;
    fulfilment.customerConfirmedAt = now();
    fulfilment.serviceNotes = [fulfilment.serviceNotes, req.body.note].filter(Boolean).join('\n');
    fulfilment.updatedBy = req.user.id;
    fulfilment.statusHistory = Array.isArray(fulfilment.statusHistory) ? fulfilment.statusHistory : [];
    fulfilment.statusHistory.unshift({ status: 'CUSTOMER_CONFIRMED', note: req.body.note || 'Confirmed by corporate customer.', timestamp: now(), updatedBy: req.user.id, updatedByName: req.user.name || req.user.email });
    await fulfilment.save();
    await syncPaymentFromInvoiceOrFulfilment(fulfilment, { actor: actorFromReq(req) });
    socketManager.emitAdmin('corporate_delivery_confirmed', { fulfilmentId: fulfilment.id, corporateClientId: fulfilment.clientId, by: req.user.id });
    res.status(200).json({ message: 'Delivery confirmed.', fulfilment });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to confirm delivery.'));
  }
};


const getWallet = async (req, res, next) => {
  try {
    const client = await requireCorporate(req);
    const user = await User.findOne({ id: req.user.id }).select('id name email walletBalance').lean();
    const transactions = await WalletTransaction.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(20).lean().catch(() => []);
    res.status(200).json({
      client: { id: client.id, companyName: client.companyName, creditLimit: client.creditLimit },
      walletBalance: toNum(user?.walletBalance),
      transactions,
    });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load corporate wallet.'));
  }
};

const getPromotions = async (req, res, next) => {
  try {
    await requireCorporate(req);
    const nowDate = new Date();
    const rows = await Promotion.find({
      isActive: true,
      validFrom: { $lte: nowDate },
      validUntil: { $gte: nowDate },
    }).sort({ validUntil: 1 }).limit(50).lean();
    res.status(200).json({ rows });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load promotions.'));
  }
};

const listSupportTickets = async (req, res, next) => {
  try {
    await requireCorporate(req);
    const rows = await SupportTicket.find(ticketFilterForUser(req.user)).sort({ createdAt: -1 }).limit(100).lean();
    res.status(200).json({ rows: rows.map(toPublicTicket) });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load support tickets.'));
  }
};

const createSupportTicket = async (req, res, next) => {
  try {
    const client = await requireCorporate(req);
    const subject = String(req.body.subject || '').trim();
    const description = String(req.body.description || '').trim();
    if (!subject) return next(new HttpError(400, 'Subject is required.'));
    if (!description) return next(new HttpError(400, 'Description is required.'));
    const ticket = new SupportTicket({
      corporateClientId: client.id,
      corporateClientName: client.companyName,
      corporateRequestId: req.body.corporateRequestId,
      corporateFulfilmentId: req.body.corporateFulfilmentId,
      corporateSiteId: req.body.corporateSiteId,
      customerId: req.user.id,
      customerName: req.user.name,
      customerEmail: req.user.email,
      customerPhone: req.user.phone,
      sourceType: 'CORPORATE',
      category: req.body.category || 'GENERAL_ENQUIRY',
      subject,
      description,
      priority: req.body.priority || 'MEDIUM',
      severity: req.body.severity || req.body.priority || 'MEDIUM',
      assignedTeam: req.body.assignedTeam || 'SUPPORT',
      createdBy: req.user.id,
      createdByEmail: req.user.email,
      lastCustomerMessageAt: now(),
      unreadForAdmin: 1,
      unreadForCustomer: 0,
      notes: [{ text: description, noteType: 'CUSTOMER_RESPONSE', authorId: req.user.id, authorEmail: req.user.email }],
      activity: [{ action: 'CREATED', to: 'OPEN', actorId: req.user.id, actorEmail: req.user.email, note: 'Created from Gas2Door Business portal.' }],
    });
    await ticket.save();
    const firstMessage = await Message.create({
      chatId: `corp-ticket:${ticket.id}`,
      senderId: req.user.id,
      senderName: req.user.name || req.user.email || client.companyName,
      recipientId: 'support',
      recipientName: 'PrimeJet Support',
      text: description,
      channel: 'CORPORATE_SUPPORT',
      sourceType: 'CORPORATE',
      supportTicketId: ticket.id,
      corporateClientId: client.id,
      metadata: { ticketNo: ticket.ticketNo, subject: ticket.subject },
    });
    socketManager.emitAdmin('support_ticket_created', { ticket: toPublicTicket(ticket), message: firstMessage });
    socketManager.emitToRoom(`support-ticket:${ticket.id}`, 'support_message_created', { ticketId: ticket.id, message: firstMessage });
    socketManager.emitToRoom(`corp-ticket:${ticket.id}`, 'support_message_created', { ticketId: ticket.id, message: firstMessage });
    res.status(201).json({ message: 'Support ticket created.', ticket: toPublicTicket(ticket) });
  } catch (error) {
    logger.error('Corporate support ticket create error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to create support ticket.'));
  }
};

const listTicketMessages = async (req, res, next) => {
  try {
    await requireCorporate(req);
    const ticket = await SupportTicket.findOne(ticketFilterForUser(req.user, { id: req.params.ticketId })).lean();
    if (!ticket) return next(new HttpError(404, 'Support ticket not found.'));
    const chatId = `corp-ticket:${ticket.id}`;
    const rows = await Message.find({ chatId }).sort({ createdAt: 1 }).limit(200).lean();
    res.status(200).json({ ticket: toPublicTicket(ticket), rows });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load support messages.'));
  }
};

const addTicketMessage = async (req, res, next) => {
  try {
    await requireCorporate(req);
    const text = String(req.body.text || '').trim();
    if (!text) return next(new HttpError(400, 'Message text is required.'));
    const ticket = await SupportTicket.findOne(ticketFilterForUser(req.user, { id: req.params.ticketId }));
    if (!ticket) return next(new HttpError(404, 'Support ticket not found.'));
    ticket.notes = Array.isArray(ticket.notes) ? ticket.notes : [];
    ticket.notes.unshift({ text, noteType: 'CUSTOMER_RESPONSE', authorId: req.user.id, authorEmail: req.user.email });
    ticket.activity = Array.isArray(ticket.activity) ? ticket.activity : [];
    ticket.activity.unshift({ action: 'CUSTOMER_MESSAGE', actorId: req.user.id, actorEmail: req.user.email, note: text });
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') ticket.status = 'OPEN';
    ticket.lastCustomerMessageAt = now();
    ticket.unreadForAdmin = toNum(ticket.unreadForAdmin) + 1;
    await ticket.save();
    const message = await Message.create({
      chatId: `corp-ticket:${ticket.id}`,
      senderId: req.user.id,
      senderName: req.user.name || req.user.email || ticket.corporateClientName,
      recipientId: 'support',
      recipientName: 'PrimeJet Support',
      text,
      channel: 'CORPORATE_SUPPORT',
      sourceType: 'CORPORATE',
      supportTicketId: ticket.id,
      corporateClientId: ticket.corporateClientId,
      metadata: { ticketNo: ticket.ticketNo, subject: ticket.subject },
    });
    socketManager.emitAdmin('support_message_created', { ticket: toPublicTicket(ticket), message });
    socketManager.emitToRoom(`support-ticket:${ticket.id}`, 'support_message_created', { ticketId: ticket.id, message });
    socketManager.emitToRoom(`corp-ticket:${ticket.id}`, 'support_message_created', { ticketId: ticket.id, message });
    res.status(201).json({ message: 'Support message sent.', row: message, ticket: toPublicTicket(ticket) });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to send support message.'));
  }
};

const initializeFulfilmentPayment = async (req, res, next) => {
  try {
    const client = await requireCorporate(req);
    const fulfilment = await CorporateFulfilment.findOne({ id: req.params.fulfilmentId, clientId: client.id });
    if (!fulfilment) return next(new HttpError(404, 'Corporate invoice/delivery not found.'));
    const invoice = await ensureInvoiceForFulfilment({ client, request: null, fulfilment, actor: actorFromReq(req), forceRefresh: true });
    const outstanding = toNum(invoice?.outstandingAmount || fulfilment.outstandingAmount || fulfilment.revenue - fulfilment.amountPaid);
    if (outstanding <= 0) return res.status(200).json({ message: 'No payment required.', paymentNeeded: false, fulfilment });
    const accessToken = await getMonnifyAccessToken();
    const contractCode = process.env.MONNIFY_CONTRACT_CODE;
    if (!contractCode) throw new HttpError(500, 'Payment gateway contract code is missing.');
    const frontendUrl = process.env.FRONTEND_URL || process.env.WEB_FRONTEND_URL || 'http://localhost:3002';
    const paymentReference = `${corporatePaymentRefPrefix}_${fulfilment.id}_${Date.now()}`;
    const initRes = await axios.post(
      `${getMonnifyBaseUrl()}/api/v1/merchant/transactions/init-transaction`,
      {
        amount: outstanding,
        customerName: req.user.name || client.contactPerson || client.companyName,
        customerEmail: req.user.email || client.billingEmail || client.email || 'info@primejetgas.com',
        paymentReference,
        paymentDescription: `Corporate LPG payment ${fulfilment.orderCode || fulfilment.id}`,
        currencyCode: 'NGN',
        contractCode,
        redirectUrl: `${frontendUrl}/business/invoices?payment=${encodeURIComponent(fulfilment.id)}`,
        paymentMethods: ['CARD', 'ACCOUNT_TRANSFER'],
        metaData: {
          sourceType: 'CORPORATE_FULFILMENT',
          fulfilmentId: fulfilment.id,
          clientId: client.id,
        },
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const body = initRes.data?.responseBody || {};
    fulfilment.paymentMethod = 'ONLINE';
    fulfilment.paymentGateway = 'MONNIFY';
    fulfilment.paymentStatus = 'PROCESSING';
    fulfilment.paymentReference = paymentReference;
    fulfilment.paymentGatewayReference = body.transactionReference;
    fulfilment.statusHistory = Array.isArray(fulfilment.statusHistory) ? fulfilment.statusHistory : [];
    fulfilment.statusHistory.unshift({ status: 'PAYMENT_INITIALIZED', note: `Corporate online payment initialized. Ref: ${paymentReference}`, timestamp: now(), updatedBy: req.user.id, updatedByName: req.user.name || req.user.email });
    await fulfilment.save();
    if (invoice) {
      invoice.paymentStatus = 'PROCESSING';
      invoice.events = Array.isArray(invoice.events) ? invoice.events : [];
      invoice.events.unshift({ status: 'PAYMENT_INITIALIZED', note: `Monnify payment initialized. Ref: ${paymentReference}`, updatedBy: req.user.id, updatedByName: req.user.name || req.user.email });
      await invoice.save();
    }
    await syncPaymentFromInvoiceOrFulfilment(fulfilment, { actor: actorFromReq(req), paymentMethod: 'monnify', paymentGateway: 'monnify' });
    res.status(200).json({
      success: true,
      paymentNeeded: true,
      checkoutUrl: body.checkoutUrl,
      accessCode: body.transactionReference,
      paymentReference,
      amount: outstanding,
      currency: 'NGN',
      fulfilment,
      invoice,
    });
  } catch (error) {
    logger.error('Corporate payment initialize error:', error.response?.data || error);
    next(error instanceof HttpError ? error : new HttpError(502, error.response?.data?.responseMessage || error.message || 'Failed to initialize corporate payment.'));
  }
};

module.exports = {
  getMe,
  getDashboard,
  listSites,
  createSite,
  listRequests,
  createRequest,
  getRequest,
  approveRequest,
  cancelRequest,
  listFulfilments,
  listInvoices,
  getStatement,
  getBilling,
  confirmDelivery,
  getWallet,
  getPromotions,
  listSupportTickets,
  createSupportTicket,
  listTicketMessages,
  addTicketMessage,
  initializeFulfilmentPayment,
};
