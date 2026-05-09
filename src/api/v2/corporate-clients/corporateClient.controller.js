// File: src/api/v2/corporate-clients/corporateClient.controller.js
const CorporateClient = require('../../../models/corporateClient.model');
const CorporateFulfilment = require('../../../models/corporateFulfilment.model');
const CorporateSite = require('../../../models/corporateSite.model');
const CorporateRequest = require('../../../models/corporateRequest.model');
const WhatsAppContact = require('../../../models/whatsappContact.model');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const crypto = require('crypto');
const { createOperationalOrderForFulfilment, linkFulfilmentToRun, mapPayment } = require('./corporateOrderBridge.service');
const CorporateInvoice = require('../../../models/corporateInvoice.model');
const { actorFromReq, transitionRequest, transitionFulfilment, syncOperationalOrderFromFulfilment, syncPaymentFromInvoiceOrFulfilment } = require('./corporateLifecycle.service');
const { ensureInvoiceForFulfilment, recordInvoicePayment, invoiceToStatementRows, buildBillingSummaryFromInvoices } = require('./corporateBilling.service');
const { corporateClientBranchFilter, corporateFulfilmentBranchFilter, clientIdsForBranchScope, assertClientAccess } = require('./corporateAccess.service');

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const round = (n, dp = 2) => Math.round(toNum(n) * 10 ** dp) / 10 ** dp;
const arr = (v) => (Array.isArray(v) ? v : []);
const escapeRegex = (s = '') => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const now = () => new Date();
const asDate = (v) => (v === '' || v === null || v === undefined ? undefined : v);
const terminalStatuses = ['DELIVERED', 'CANCELLED', 'FAILED'];
const openStatuses = ['REQUESTED', 'SCHEDULED', 'IN_TRANSIT', 'DELAYED'];
const andFilter = (...filters) => {
  const parts = filters.filter((f) => f && typeof f === 'object' && Object.keys(f).length);
  if (!parts.length) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts };
};

const cleanClientPayload = (body = {}) => ({
  companyName: body.companyName,
  clientCode: body.clientCode,
  contactPerson: body.contactPerson,
  contactRole: body.contactRole,
  phone: body.phone,
  email: body.email,
  industry: body.industry,
  source: body.source,
  stage: body.stage,
  status: body.status,
  expectedMonthlyKg: toNum(body.expectedMonthlyKg),
  estimatedMonthlyRevenue: toNum(body.estimatedMonthlyRevenue),
  agreedPricePerKg: toNum(body.agreedPricePerKg),
  paymentTerms: body.paymentTerms,
  creditLimit: toNum(body.creditLimit),
  slaExpectation: body.slaExpectation,
  address: body.address,
  city: body.city,
  state: body.state,
  latitude: body.latitude === '' || body.latitude === undefined ? undefined : toNum(body.latitude),
  longitude: body.longitude === '' || body.longitude === undefined ? undefined : toNum(body.longitude),
  assignedBranchId: body.assignedBranchId,
  assignedBranchName: body.assignedBranchName,
  relationshipManagerId: body.relationshipManagerId,
  relationshipManagerName: body.relationshipManagerName,
  whatsappPhone: body.whatsappPhone || body.phone,
  whatsappContactId: body.whatsappContactId,
  customerId: body.customerId,
  anniversaryDate: asDate(body.anniversaryDate),
  nextFollowUpDate: asDate(body.nextFollowUpDate),
  lastContactedAt: asDate(body.lastContactedAt),
  portalEnabled: body.portalEnabled === undefined ? undefined : Boolean(body.portalEnabled),
  portalStatus: body.portalStatus,
  billingEmail: body.billingEmail || body.email,
  billingCycle: body.billingCycle,
  requiresInternalApproval: body.requiresInternalApproval === undefined ? undefined : Boolean(body.requiresInternalApproval),
  defaultApprovalMode: body.defaultApprovalMode,
  defaultCreditHoldPolicy: body.defaultCreditHoldPolicy,
  contractStartDate: asDate(body.contractStartDate),
  contractEndDate: asDate(body.contractEndDate),
  onboardingChecklist: body.onboardingChecklist,
  tags: arr(body.tags),
  notes: body.notes,
});

const cleanFulfilmentPayload = (body = {}) => ({
  orderCode: body.orderCode,
  orderType: body.orderType,
  priority: body.priority,
  requestSource: body.requestSource,
  requestReference: body.requestReference,
  requestedKg: toNum(body.requestedKg),
  deliveredKg: toNum(body.deliveredKg || body.requestedKg),
  sellingPricePerKg: toNum(body.sellingPricePerKg),
  costPerKg: toNum(body.costPerKg),
  deliveryCost: toNum(body.deliveryCost),
  amountPaid: toNum(body.amountPaid),
  paymentStatus: body.paymentStatus,
  paymentMethod: body.paymentMethod,
  invoiceNumber: body.invoiceNumber,
  paymentDueDate: asDate(body.paymentDueDate),
  requestedAt: asDate(body.requestedAt),
  promisedAt: asDate(body.promisedAt),
  scheduledAt: asDate(body.scheduledAt),
  dispatchStartedAt: asDate(body.dispatchStartedAt),
  actualDeliveredAt: asDate(body.actualDeliveredAt),
  status: body.status,
  vehicleType: body.vehicleType,
  truckId: body.truckId,
  truckName: body.truckName,
  truckTripId: body.truckTripId,
  vanId: body.vanId,
  vanName: body.vanName,
  driverId: body.driverId,
  driverName: body.driverName,
  relationshipManagerId: body.relationshipManagerId,
  relationshipManagerName: body.relationshipManagerName,
  branchId: body.branchId,
  branchName: body.branchName,
  deliveryAddress: body.deliveryAddress,
  deliverySiteName: body.deliverySiteName,
  linkedOrderId: body.linkedOrderId,
  linkedRunId: body.linkedRunId,
  linkedWhatsAppDraftId: body.linkedWhatsAppDraftId,
  stockInReference: body.stockInReference,
  customerConfirmed: body.customerConfirmed === undefined ? undefined : Boolean(body.customerConfirmed),
  delayReason: body.delayReason,
  serviceNotes: body.serviceNotes,
});


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
  assignedBranchId: body.assignedBranchId,
  assignedBranchName: body.assignedBranchName,
  defaultProductType: body.defaultProductType,
  estimatedMonthlyKg: toNum(body.estimatedMonthlyKg),
  status: body.status,
});

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

const generateTempPassword = () => `G2D-Corp-${crypto.randomBytes(3).toString('hex').toUpperCase()}!`;

const cleanCorporateUserPayload = (body = {}) => ({
  name: body.name || body.portalUserName || body.contactPerson,
  email: body.email || body.portalUserEmail,
  phone: body.phone || body.portalUserPhone,
  password: body.password || body.portalPassword,
  role: body.role || body.corporateRole || 'corporate_admin',
  corporateRole: body.corporateRole || body.role || 'corporate_admin',
  corporateSiteAccess: arr(body.corporateSiteAccess),
  department: body.department,
  jobTitle: body.jobTitle || body.contactRole,
  isCorporatePrimaryContact: body.isCorporatePrimaryContact === undefined ? true : Boolean(body.isCorporatePrimaryContact),
  mustChangePassword: body.mustChangePassword === undefined ? true : Boolean(body.mustChangePassword),
  status: body.status || 'active',
});

const createPortalUserRecord = async (client, body = {}, req) => {
  const payload = cleanCorporateUserPayload(body);
  if (!payload.name) payload.name = client.contactPerson || `${client.companyName} Admin`;
  if (!payload.email) throw new HttpError(400, 'Corporate portal user email is required.');
  if (!payload.phone) payload.phone = client.phone || client.whatsappPhone || '00000000000';
  const allowedRoles = ['corporate_admin', 'corporate_requester', 'corporate_approver', 'corporate_viewer'];
  if (!allowedRoles.includes(payload.role)) payload.role = 'corporate_admin';
  if (!allowedRoles.includes(payload.corporateRole)) payload.corporateRole = payload.role;

  const existing = await User.findOne({ email: String(payload.email).toLowerCase() }).lean();
  if (existing) throw new HttpError(409, 'A user with this email already exists. Use a different email or update the existing user.');

  const generatedPassword = payload.password ? null : generateTempPassword();
  const user = await User.create({
    name: payload.name,
    email: String(payload.email).toLowerCase(),
    phone: payload.phone,
    password: payload.password || generatedPassword,
    role: payload.role,
    corporateRole: payload.corporateRole,
    corporateClientId: client.id,
    corporateClientName: client.companyName,
    corporateSiteAccess: payload.corporateSiteAccess,
    department: payload.department,
    jobTitle: payload.jobTitle,
    isCorporatePrimaryContact: payload.isCorporatePrimaryContact,
    mustChangePassword: payload.mustChangePassword,
    status: payload.status,
    isVerified: true,
    createdBy: req.user?.id,
    updatedBy: req.user?.id,
  });

  await CorporateClient.findOneAndUpdate(
    { id: client.id },
    {
      $set: {
        portalEnabled: true,
        portalStatus: 'INVITED',
        primaryPortalUserId: client.primaryPortalUserId || user.id,
        updatedBy: req.user?.id,
      },
    },
    { new: true }
  );

  const safeUser = user.toObject();
  delete safeUser.password;
  return { user: safeUser, temporaryPassword: generatedPassword };
};

const addStatusMilestone = (doc, req, status, note) => {
  doc.statusHistory = Array.isArray(doc.statusHistory) ? doc.statusHistory : [];
  doc.statusHistory.unshift({
    status,
    note,
    timestamp: now(),
    updatedBy: req.user?.id,
    updatedByName: req.user?.name || req.user?.email,
  });
  doc.statusHistory = doc.statusHistory.slice(0, 30);
};

const recalculateClientRollups = async (clientId, userId) => {
  if (!clientId) return null;
  const rows = await CorporateFulfilment.find({ clientId }).lean();
  const deliveredRows = rows.filter((r) => r.status === 'DELIVERED');
  const openRows = rows.filter((r) => openStatuses.includes(r.status));
  const onTimeRows = deliveredRows.filter((r) => r.slaStatus === 'ON_TIME' || r.slaStatus === 'NOT_APPLICABLE');
  const turnaroundRows = deliveredRows.filter((r) => toNum(r.turnaroundMinutes) > 0);
  const lastRow = [...rows].sort((a, b) => new Date(b.actualDeliveredAt || b.updatedAt || b.createdAt || 0) - new Date(a.actualDeliveredAt || a.updatedAt || a.createdAt || 0))[0];
  const rollup = {
    lifetimeRequestedKg: round(rows.reduce((sum, r) => sum + toNum(r.requestedKg), 0)),
    lifetimeDeliveredKg: round(rows.reduce((sum, r) => sum + toNum(r.deliveredKg), 0)),
    lifetimeRevenue: round(rows.reduce((sum, r) => sum + toNum(r.revenue), 0)),
    lifetimeGrossMargin: round(rows.reduce((sum, r) => sum + toNum(r.grossMargin), 0)),
    fulfilmentCount: rows.length,
    openFulfilmentCount: openRows.length,
    delayedFulfilmentCount: rows.filter((r) => r.status === 'DELAYED' || r.slaStatus === 'LATE' || r.slaStatus === 'MISSED').length,
    outstandingBalance: round(rows.reduce((sum, r) => sum + toNum(r.outstandingAmount), 0)),
    averageTurnaroundMinutes: turnaroundRows.length ? round(turnaroundRows.reduce((sum, r) => sum + toNum(r.turnaroundMinutes), 0) / turnaroundRows.length) : 0,
    onTimeDeliveryRate: deliveredRows.length ? round((onTimeRows.length / deliveredRows.length) * 100) : 0,
    lastFulfilmentAt: lastRow?.actualDeliveredAt || lastRow?.updatedAt || lastRow?.createdAt,
    lastOrderStatus: lastRow?.status,
    updatedBy: userId,
  };
  const update = { $set: rollup };
  if (deliveredRows.length) update.$set.stage = 'ACTIVE';
  if (deliveredRows.length) update.$set['onboardingChecklist.firstFulfilmentCompleted'] = true;
  return CorporateClient.findOneAndUpdate({ id: clientId }, update, { new: true });
};

const getDashboard = async (req, res, next) => {
  try {
    const branchClientFilter = corporateClientBranchFilter(req.user);
    const branchFulfilmentFilter = corporateFulfilmentBranchFilter(req.user);
    const [stageAgg, clients, fulfilmentAgg, dueFollowUps, recentFulfilments, whatsappLinked, control] = await Promise.all([
      CorporateClient.aggregate([{ $match: branchClientFilter }, { $group: { _id: '$stage', count: { $sum: 1 }, expectedMonthlyKg: { $sum: { $ifNull: ['$expectedMonthlyKg', 0] } } } }]),
      CorporateClient.find(branchClientFilter).sort({ updatedAt: -1 }).limit(12).lean(),
      CorporateFulfilment.aggregate([
        { $match: branchFulfilmentFilter },
        { $group: { _id: null, count: { $sum: 1 }, requestedKg: { $sum: '$requestedKg' }, deliveredKg: { $sum: '$deliveredKg' }, revenue: { $sum: '$revenue' }, grossMargin: { $sum: '$grossMargin' }, outstandingAmount: { $sum: '$outstandingAmount' }, delayed: { $sum: { $cond: [{ $eq: ['$status', 'DELAYED'] }, 1, 0] } }, delivered: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0] } } } },
      ]),
      CorporateClient.find(andFilter(branchClientFilter, { nextFollowUpDate: { $lte: now() }, stage: { $nin: ['LOST'] } })).sort({ nextFollowUpDate: 1 }).limit(20).lean(),
      CorporateFulfilment.find(branchFulfilmentFilter).sort({ createdAt: -1 }).limit(10).lean(),
      CorporateClient.countDocuments(andFilter(branchClientFilter, { $or: [{ whatsappContactId: { $exists: true, $ne: '' } }, { whatsappPhone: { $exists: true, $ne: '' } }] })),
      buildFulfilmentControlPayload(req.user),
    ]);

    const stages = stageAgg.reduce((acc, row) => {
      acc[row._id || 'UNKNOWN'] = { count: row.count, expectedMonthlyKg: round(row.expectedMonthlyKg) };
      return acc;
    }, {});
    const f = fulfilmentAgg[0] || {};
    res.status(200).json({
      metrics: {
        totalCorporateClients: await CorporateClient.countDocuments(branchClientFilter),
        activeCorporateClients: await CorporateClient.countDocuments(andFilter(branchClientFilter, { stage: 'ACTIVE' })),
        leadsAndProspects: await CorporateClient.countDocuments(andFilter(branchClientFilter, { stage: { $in: ['LEAD', 'PROSPECT'] } })),
        onboarding: await CorporateClient.countDocuments(andFilter(branchClientFilter, { stage: 'ONBOARDING' })),
        whatsappLinked,
        followUpsDue: dueFollowUps.length,
        fulfilmentCount: toNum(f.count),
        requestedKg: round(f.requestedKg),
        deliveredKg: round(f.deliveredKg),
        fulfilmentRevenue: round(f.revenue),
        grossMargin: round(f.grossMargin),
        outstandingAmount: round(f.outstandingAmount),
        delayedFulfilments: toNum(f.delayed),
        deliveredFulfilments: toNum(f.delivered),
        onTimeDeliveryRate: control.metrics.onTimeDeliveryRate,
        averageTurnaroundMinutes: control.metrics.averageTurnaroundMinutes,
        overdueFulfilments: control.metrics.overdueFulfilments,
      },
      stages,
      recentClients: clients,
      dueFollowUps,
      recentFulfilments,
      fulfilmentControl: control,
    });
  } catch (error) {
    logger.error('Corporate client dashboard error:', error);
    next(new HttpError(500, 'Failed to load corporate client dashboard.'));
  }
};

const listClients = async (req, res, next) => {
  try {
    const { search = '', stage = '', rm = '', branchId = '', limit = 100, outstandingOnly = '' } = req.query;
    const baseFilter = {};
    if (stage) baseFilter.stage = stage;
    if (rm) baseFilter.relationshipManagerId = rm;
    if (branchId) baseFilter.assignedBranchId = branchId;
    if (outstandingOnly === 'true') baseFilter.outstandingBalance = { $gt: 0 };
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      baseFilter.$or = [{ companyName: rx }, { contactPerson: rx }, { phone: rx }, { email: rx }, { industry: rx }, { clientCode: rx }];
    }
    const filter = andFilter(corporateClientBranchFilter(req.user), baseFilter);
    const rows = await CorporateClient.find(filter).sort({ updatedAt: -1 }).limit(Math.min(Number(limit) || 100, 500)).lean();
    res.status(200).json({ rows });
  } catch (error) {
    logger.error('Corporate client list error:', error);
    next(new HttpError(500, 'Failed to load corporate clients.'));
  }
};

const createClient = async (req, res, next) => {
  try {
    if (!req.body.companyName) return next(new HttpError(400, 'Company name is required.'));
    const payload = cleanClientPayload(req.body);
    payload.createdBy = req.user?.id;
    payload.updatedBy = req.user?.id;
    if (payload.portalEnabled === undefined) payload.portalEnabled = Boolean(req.body.createPortalUser || req.body.portalUserEmail);
    if (payload.portalEnabled && !payload.portalStatus) payload.portalStatus = 'INVITED';
    const client = await CorporateClient.create(payload);

    let portalUser = null;
    if (req.body.createPortalUser || req.body.portalUserEmail || req.body.portalUser?.email) {
      const userPayload = req.body.portalUser || {
        name: req.body.portalUserName || client.contactPerson,
        email: req.body.portalUserEmail || client.email,
        phone: req.body.portalUserPhone || client.phone,
        password: req.body.portalPassword,
        corporateRole: req.body.portalUserRole || 'corporate_admin',
        jobTitle: client.contactRole,
      };
      portalUser = await createPortalUserRecord(client, userPayload, req);
    }

    let defaultSite = null;
    if (req.body.createDefaultSite !== false && client.address) {
      defaultSite = await CorporateSite.create({
        clientId: client.id,
        clientName: client.companyName,
        siteName: req.body.defaultSiteName || 'Primary Delivery Site',
        siteType: req.body.defaultSiteType || 'OTHER',
        address: client.address,
        city: client.city || 'Lagos',
        state: client.state || 'Lagos',
        siteContactName: client.contactPerson,
        siteContactPhone: client.phone || client.whatsappPhone,
        siteContactEmail: client.email,
        assignedBranchId: client.assignedBranchId,
        assignedBranchName: client.assignedBranchName,
        estimatedMonthlyKg: client.expectedMonthlyKg || 0,
        status: 'ACTIVE',
        createdBy: req.user?.id,
        updatedBy: req.user?.id,
      }).catch((err) => {
        logger.warn('Default corporate site was not created:', err.message);
        return null;
      });
    }

    const refreshedClient = await CorporateClient.findOne({ id: client.id }).lean();
    res.status(201).json({ message: 'Corporate client created successfully.', client: refreshedClient || client, portalUser, defaultSite });
  } catch (error) {
    logger.error('Corporate client create error:', error);
    next(new HttpError(500, error.message || 'Failed to create corporate client.'));
  }
};

const getClient = async (req, res, next) => {
  try {
    const { clientId } = req.params;
    const [client, fulfilments, users, sites, requests] = await Promise.all([
      CorporateClient.findOne({ id: clientId }).lean(),
      CorporateFulfilment.find({ clientId }).sort({ createdAt: -1 }).limit(100).lean(),
      User.find({ corporateClientId: clientId }).select('-password -otp -passwordResetToken').sort({ createdAt: -1 }).lean(),
      CorporateSite.find({ clientId }).sort({ siteName: 1 }).lean(),
      CorporateRequest.find({ clientId }).sort({ createdAt: -1 }).limit(100).lean(),
    ]);
    if (!client) return next(new HttpError(404, 'Corporate client not found.'));
    assertClientAccess(req.user, client);
    res.status(200).json({ client, fulfilments, users, sites, requests });
  } catch (error) {
    logger.error('Corporate client details error:', error);
    next(new HttpError(500, 'Failed to load corporate client.'));
  }
};

const updateClient = async (req, res, next) => {
  try {
    const payload = cleanClientPayload(req.body);
    Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
    payload.updatedBy = req.user?.id;
    const existingClient = await CorporateClient.findOne({ id: req.params.clientId }).lean();
    if (!existingClient) return next(new HttpError(404, 'Corporate client not found.'));
    assertClientAccess(req.user, existingClient);
    const client = await CorporateClient.findOneAndUpdate({ id: req.params.clientId }, { $set: payload }, { new: true, runValidators: true });
    res.status(200).json({ message: 'Corporate client updated successfully.', client });
  } catch (error) {
    logger.error('Corporate client update error:', error);
    next(new HttpError(500, error.message || 'Failed to update corporate client.'));
  }
};

const addActivity = async (req, res, next) => {
  try {
    const activity = {
      type: req.body.type || 'NOTE',
      title: req.body.title,
      note: req.body.note,
      outcome: req.body.outcome,
      nextFollowUpDate: asDate(req.body.nextFollowUpDate),
      createdBy: req.user?.id,
      createdByName: req.user?.name || req.user?.email,
      createdAt: now(),
    };
    const update = { $push: { activities: { $each: [activity], $position: 0 } }, $set: { lastContactedAt: now(), updatedBy: req.user?.id } };
    if (activity.nextFollowUpDate) update.$set.nextFollowUpDate = activity.nextFollowUpDate;
    const existingClientForActivity = await CorporateClient.findOne({ id: req.params.clientId }).lean();
    if (!existingClientForActivity) return next(new HttpError(404, 'Corporate client not found.'));
    assertClientAccess(req.user, existingClientForActivity);
    const client = await CorporateClient.findOneAndUpdate({ id: req.params.clientId }, update, { new: true, runValidators: true });
    res.status(201).json({ message: 'Activity added successfully.', client });
  } catch (error) {
    logger.error('Corporate client activity error:', error);
    next(new HttpError(500, error.message || 'Failed to add activity.'));
  }
};

const fulfilmentFilterFromQuery = (query = {}, params = {}) => {
  const filter = {};
  if (params.clientId) filter.clientId = params.clientId;
  if (query.status) filter.status = query.status;
  if (query.slaStatus) filter.slaStatus = query.slaStatus;
  if (query.branchId) filter.branchId = query.branchId;
  if (query.rm) filter.relationshipManagerId = query.rm;
  if (query.vehicleType) filter.vehicleType = query.vehicleType;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.overdue === 'true') filter.status = { $in: openStatuses }, filter.promisedAt = { $lt: now() };
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ clientName: rx }, { orderCode: rx }, { requestReference: rx }, { driverName: rx }, { truckName: rx }, { vanName: rx }, { invoiceNumber: rx }];
  }
  return filter;
};

const listFulfilments = async (req, res, next) => {
  try {
    const filter = andFilter(corporateFulfilmentBranchFilter(req.user), fulfilmentFilterFromQuery(req.query, req.params));
    const rows = await CorporateFulfilment.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 100, 500)).lean();
    res.status(200).json({ rows });
  } catch (error) {
    logger.error('Corporate fulfilment list error:', error);
    next(new HttpError(500, 'Failed to load corporate fulfilments.'));
  }
};

const createFulfilment = async (req, res, next) => {
  try {
    const client = await CorporateClient.findOne({ id: req.params.clientId }).lean();
    if (!client) return next(new HttpError(404, 'Corporate client not found.'));
    assertClientAccess(req.user, client);
    const payload = cleanFulfilmentPayload(req.body);
    payload.clientId = client.id;
    payload.clientName = client.companyName;
    payload.relationshipManagerId = payload.relationshipManagerId || client.relationshipManagerId;
    payload.relationshipManagerName = payload.relationshipManagerName || client.relationshipManagerName;
    payload.branchId = payload.branchId || client.assignedBranchId;
    payload.branchName = payload.branchName || client.assignedBranchName;
    payload.deliveryAddress = payload.deliveryAddress || client.address;
    payload.sellingPricePerKg = payload.sellingPricePerKg || client.agreedPricePerKg || 0;
    payload.requestedAt = payload.requestedAt || now();
    if (payload.status === 'SCHEDULED' && !payload.scheduledAt) payload.scheduledAt = now();
    if (payload.status === 'IN_TRANSIT' && !payload.dispatchStartedAt) payload.dispatchStartedAt = now();
    if (payload.status === 'DELIVERED' && !payload.actualDeliveredAt) payload.actualDeliveredAt = now();
    payload.createdBy = req.user?.id;
    payload.updatedBy = req.user?.id;
    const fulfilment = new CorporateFulfilment(payload);
    addStatusMilestone(fulfilment, req, fulfilment.status, 'Corporate fulfilment created.');
    await fulfilment.save();
    if (fulfilment.status === 'DELIVERED') await ensureInvoiceForFulfilment({ client, request: null, fulfilment, actor: actorFromReq(req) });
    let operationalOrder = null;
    if (req.body.createOperationalOrder === true) {
      const bridge = await createOperationalOrderForFulfilment({ client, request: null, fulfilment, actorUserId: req.user?.id });
      operationalOrder = bridge.order;
    }
    const updatedClient = await recalculateClientRollups(client.id, req.user?.id);
    res.status(201).json({ message: operationalOrder ? 'Corporate fulfilment and operational order created successfully.' : 'Corporate fulfilment created successfully.', fulfilment, operationalOrder, client: updatedClient });
  } catch (error) {
    logger.error('Corporate fulfilment create error:', error);
    next(new HttpError(500, error.message || 'Failed to create corporate fulfilment.'));
  }
};

const updateFulfilment = async (req, res, next) => {
  try {
    const payload = cleanFulfilmentPayload(req.body);
    Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
    payload.updatedBy = req.user?.id;
    const fulfilment = await CorporateFulfilment.findOne({ id: req.params.fulfilmentId, clientId: req.params.clientId });
    if (!fulfilment) return next(new HttpError(404, 'Corporate fulfilment not found.'));
    const clientForFulfilment = await CorporateClient.findOne({ id: fulfilment.clientId }).lean();
    assertClientAccess(req.user, clientForFulfilment);
    const previousStatus = fulfilment.status;
    Object.assign(fulfilment, payload);
    if (payload.status === 'SCHEDULED' && !fulfilment.scheduledAt) fulfilment.scheduledAt = now();
    if (payload.status === 'IN_TRANSIT' && !fulfilment.dispatchStartedAt) fulfilment.dispatchStartedAt = now();
    if (payload.status === 'DELIVERED' && !fulfilment.actualDeliveredAt) fulfilment.actualDeliveredAt = now();
    if (payload.status && payload.status !== previousStatus) addStatusMilestone(fulfilment, req, payload.status, req.body.statusNote || req.body.serviceNotes || 'Status updated.');
    await fulfilment.save();
    if (payload.status) await transitionFulfilment(fulfilment, payload.status, { actor: actorFromReq(req), note: req.body.statusNote || req.body.serviceNotes || 'Status updated.', client: clientForFulfilment });
    else await syncOperationalOrderFromFulfilment(fulfilment, { actor: actorFromReq(req) });
    const client = await recalculateClientRollups(fulfilment.clientId, req.user?.id);
    res.status(200).json({ message: 'Corporate fulfilment updated successfully.', fulfilment, client });
  } catch (error) {
    logger.error('Corporate fulfilment update error:', error);
    next(new HttpError(500, error.message || 'Failed to update corporate fulfilment.'));
  }
};

const updateFulfilmentStatus = async (req, res, next) => {
  try {
    const fulfilment = await CorporateFulfilment.findOne({ id: req.params.fulfilmentId });
    if (!fulfilment) return next(new HttpError(404, 'Corporate fulfilment not found.'));
    const status = req.body.status;
    if (!status) return next(new HttpError(400, 'Status is required.'));
    if (req.body.actualDeliveredAt) fulfilment.actualDeliveredAt = req.body.actualDeliveredAt;
    if (req.body.customerConfirmed !== undefined) fulfilment.customerConfirmed = Boolean(req.body.customerConfirmed);
    if (req.body.delayReason !== undefined) fulfilment.delayReason = req.body.delayReason;
    if (req.body.serviceNotes !== undefined) fulfilment.serviceNotes = req.body.serviceNotes;
    if (status === 'DELIVERED' && !toNum(fulfilment.deliveredKg) && toNum(fulfilment.requestedKg)) fulfilment.deliveredKg = toNum(fulfilment.requestedKg);
    const clientForStatus = await CorporateClient.findOne({ id: fulfilment.clientId }).lean();
    assertClientAccess(req.user, clientForStatus);
    await transitionFulfilment(fulfilment, status, { actor: actorFromReq(req), note: req.body.note || req.body.delayReason || 'Status updated from fulfilment control tower.', client: clientForStatus });
    const linkedRequest = await CorporateRequest.findOne({ linkedFulfilmentId: fulfilment.id }).lean();
    const invoice = status === 'DELIVERED' ? await CorporateInvoice.findOne({ fulfilmentId: fulfilment.id }).lean() : null;
    const client = await recalculateClientRollups(fulfilment.clientId, req.user?.id);
    res.status(200).json({ message: 'Corporate fulfilment status updated.', fulfilment, client, linkedRequest, invoice });
  } catch (error) {
    logger.error('Corporate fulfilment status update error:', error);
    next(new HttpError(500, error.message || 'Failed to update corporate fulfilment status.'));
  }
};

const linkWhatsAppContact = async (req, res, next) => {
  try {
    const { waId, phone, contactId } = req.body;
    const client = await CorporateClient.findOne({ id: req.params.clientId });
    if (!client) return next(new HttpError(404, 'Corporate client not found.'));
    let contact = null;
    if (contactId) contact = await WhatsAppContact.findOne({ id: contactId });
    if (!contact && waId) contact = await WhatsAppContact.findOne({ waId });
    if (!contact && phone) contact = await WhatsAppContact.findOne({ phone });
    client.whatsappContactId = contact?.id || contactId || client.whatsappContactId;
    client.whatsappPhone = contact?.phone || phone || client.whatsappPhone;
    client.onboardingChecklist = { ...(client.onboardingChecklist || {}), whatsappLinked: true };
    client.updatedBy = req.user?.id;
    await client.save();
    res.status(200).json({ message: 'WhatsApp contact linked to corporate client.', client, contact });
  } catch (error) {
    logger.error('Corporate WhatsApp link error:', error);
    next(new HttpError(500, error.message || 'Failed to link WhatsApp contact.'));
  }
};


const listClientUsers = async (req, res, next) => {
  try {
    const client = await CorporateClient.findOne({ id: req.params.clientId }).lean();
    if (!client) return next(new HttpError(404, 'Corporate client not found.'));
    assertClientAccess(req.user, client);
    const rows = await User.find({ corporateClientId: client.id }).select('-password -otp -passwordResetToken').sort({ createdAt: -1 }).lean();
    res.status(200).json({ rows });
  } catch (error) {
    logger.error('Corporate user list error:', error);
    next(new HttpError(500, 'Failed to load corporate portal users.'));
  }
};

const createClientUser = async (req, res, next) => {
  try {
    const client = await CorporateClient.findOne({ id: req.params.clientId });
    if (!client) return next(new HttpError(404, 'Corporate client not found.'));
    assertClientAccess(req.user, client);
    const result = await createPortalUserRecord(client, req.body, req);
    res.status(201).json({ message: 'Corporate portal user created. Share the credentials securely with the customer.', ...result });
  } catch (error) {
    logger.error('Corporate portal user create error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to create corporate portal user.'));
  }
};

const updateClientUser = async (req, res, next) => {
  try {
    const allowed = ['name', 'phone', 'role', 'corporateRole', 'corporateSiteAccess', 'department', 'jobTitle', 'isCorporatePrimaryContact', 'mustChangePassword', 'status'];
    const payload = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) payload[key] = req.body[key];
    });
    if (payload.role && !['corporate_admin', 'corporate_requester', 'corporate_approver', 'corporate_viewer'].includes(payload.role)) {
      return next(new HttpError(400, 'Invalid corporate role.'));
    }
    if (payload.corporateRole && !['corporate_admin', 'corporate_requester', 'corporate_approver', 'corporate_viewer'].includes(payload.corporateRole)) {
      return next(new HttpError(400, 'Invalid corporate role.'));
    }
    if (payload.role && !payload.corporateRole) payload.corporateRole = payload.role;
    if (payload.corporateRole && !payload.role) payload.role = payload.corporateRole;
    const user = await User.findOneAndUpdate({ id: req.params.userId, corporateClientId: req.params.clientId }, { $set: payload }, { new: true, runValidators: true }).select('-password -otp -passwordResetToken');
    if (!user) return next(new HttpError(404, 'Corporate portal user not found.'));
    res.status(200).json({ message: 'Corporate portal user updated.', user });
  } catch (error) {
    logger.error('Corporate portal user update error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to update corporate portal user.'));
  }
};

const listSites = async (req, res, next) => {
  try {
    const client = await CorporateClient.findOne({ id: req.params.clientId }).lean();
    if (!client) return next(new HttpError(404, 'Corporate client not found.'));
    assertClientAccess(req.user, client);
    const rows = await CorporateSite.find({ clientId: req.params.clientId }).sort({ siteName: 1 }).lean();
    res.status(200).json({ rows });
  } catch (error) {
    logger.error('Corporate sites list error:', error);
    next(new HttpError(500, 'Failed to load corporate sites.'));
  }
};

const createSite = async (req, res, next) => {
  try {
    const client = await CorporateClient.findOne({ id: req.params.clientId }).lean();
    if (!client) return next(new HttpError(404, 'Corporate client not found.'));
    assertClientAccess(req.user, client);
    const payload = cleanSitePayload(req.body);
    if (!payload.siteName || !payload.address) return next(new HttpError(400, 'Site name and address are required.'));
    payload.clientId = client.id;
    payload.clientName = client.companyName;
    payload.assignedBranchId = payload.assignedBranchId || client.assignedBranchId;
    payload.assignedBranchName = payload.assignedBranchName || client.assignedBranchName;
    payload.status = payload.status || 'ACTIVE';
    payload.createdBy = req.user?.id;
    payload.updatedBy = req.user?.id;
    const site = await CorporateSite.create(payload);
    await CorporateClient.findOneAndUpdate({ id: client.id }, { $set: { 'onboardingChecklist.deliverySitesConfirmed': true, updatedBy: req.user?.id } });
    res.status(201).json({ message: 'Corporate site created.', site });
  } catch (error) {
    logger.error('Corporate site create error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to create corporate site.'));
  }
};

const listRequests = async (req, res, next) => {
  try {
    const filter = {};
    if (req.params.clientId) filter.clientId = req.params.clientId;
    if (req.query.clientId) filter.clientId = req.query.clientId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(req.query.search), 'i');
      filter.$or = [{ clientName: rx }, { requestCode: rx }, { siteName: rx }, { poNumber: rx }];
    }
    if (!filter.clientId) {
      const scopedClientIds = await clientIdsForBranchScope(CorporateClient, req.user);
      if (Array.isArray(scopedClientIds)) filter.clientId = { $in: scopedClientIds };
    } else {
      const scopedClient = await CorporateClient.findOne({ id: filter.clientId }).lean();
      assertClientAccess(req.user, scopedClient);
    }
    const rows = await CorporateRequest.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 100, 500)).lean();
    res.status(200).json({ rows });
  } catch (error) {
    logger.error('Corporate request list error:', error);
    next(new HttpError(500, 'Failed to load corporate requests.'));
  }
};

const reviewRequest = async (req, res, next) => {
  try {
    const request = await CorporateRequest.findOne({ id: req.params.requestId });
    if (!request) return next(new HttpError(404, 'Corporate request not found.'));
    const clientForRequest = await CorporateClient.findOne({ id: request.clientId }).lean();
    assertClientAccess(req.user, clientForRequest);
    const status = req.body.status || 'UNDER_REVIEW';
    request.internalNote = req.body.internalNote || request.internalNote;
    request.reviewedBy = req.user?.id;
    request.reviewedByName = req.user?.name || req.user?.email;
    request.reviewedAt = now();
    request.updatedBy = req.user?.id;
    if (req.body.estimatedPricePerKg !== undefined) request.estimatedPricePerKg = toNum(req.body.estimatedPricePerKg);
    if (req.body.scheduledAt) request.scheduledAt = req.body.scheduledAt;
    if (status === 'DELIVERED' && !request.deliveredAt) request.deliveredAt = now();
    await transitionRequest(request, status, { actor: actorFromReq(req), note: req.body.note || req.body.internalNote || 'Request updated from BMA.' });
    res.status(200).json({ message: 'Corporate request updated.', request });
  } catch (error) {
    logger.error('Corporate request review error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to update corporate request.'));
  }
};

const convertRequestToFulfilment = async (req, res, next) => {
  try {
    const request = await CorporateRequest.findOne({ id: req.params.requestId });
    if (!request) return next(new HttpError(404, 'Corporate request not found.'));
    if (request.linkedFulfilmentId) return next(new HttpError(409, 'Request has already been converted to fulfilment.'));
    const client = await CorporateClient.findOne({ id: request.clientId }).lean();
    if (!client) return next(new HttpError(404, 'Corporate client not found.'));
    assertClientAccess(req.user, client);

    const paymentMethod = request.paymentType === 'PREPAID' ? 'ONLINE' : (request.paymentType || client.paymentTerms || 'ACCOUNT_TERMS');
    const fulfilment = new CorporateFulfilment({
      clientId: client.id,
      clientName: client.companyName,
      orderType: request.requestType === 'RECURRING_REFILL' ? 'BULK_REFILL' : request.requestType,
      priority: request.priority,
      requestSource: request.requestSource === 'BUSINESS_PORTAL' ? 'OTHER' : request.requestSource,
      requestReference: request.requestCode || request.poNumber,
      requestedKg: request.requestedKg,
      deliveredKg: 0,
      sellingPricePerKg: req.body.sellingPricePerKg !== undefined ? toNum(req.body.sellingPricePerKg) : toNum(request.estimatedPricePerKg || client.agreedPricePerKg),
      costPerKg: toNum(req.body.costPerKg),
      deliveryCost: toNum(req.body.deliveryCost),
      paymentStatus: (request.paymentType === 'CREDIT' || request.paymentType === 'ACCOUNT_TERMS' || (client.paymentTerms && client.paymentTerms.startsWith('CREDIT'))) ? 'CREDIT' : 'UNPAID',
      paymentMethod,
      requestedAt: request.createdAt || now(),
      promisedAt: req.body.promisedAt || request.requestedDeliveryDate,
      scheduledAt: req.body.scheduledAt || request.scheduledAt,
      status: req.body.status || 'REQUESTED',
      relationshipManagerId: client.relationshipManagerId,
      relationshipManagerName: client.relationshipManagerName,
      branchId: req.body.branchId || client.assignedBranchId,
      branchName: req.body.branchName || client.assignedBranchName,
      deliverySiteName: request.siteName,
      deliveryAddress: request.deliveryAddress || client.address,
      serviceNotes: [request.notes, request.poNumber ? `PO/Ref: ${request.poNumber}` : '', 'Created from Business Portal request.'].filter(Boolean).join('\n'),
      createdBy: req.user?.id,
      updatedBy: req.user?.id,
    });
    addStatusMilestone(fulfilment, req, fulfilment.status, 'Created from corporate portal request.');
    await fulfilment.save();

    let operationalOrder = null;
    if (req.body.createOperationalOrder !== false) {
      const bridge = await createOperationalOrderForFulfilment({ client, request, fulfilment, actorUserId: req.user?.id });
      operationalOrder = bridge.order;
    }

    request.linkedFulfilmentId = fulfilment.id;
    request.linkedFulfilmentCode = fulfilment.orderCode;
    request.reviewedBy = req.user?.id;
    request.reviewedByName = req.user?.name || req.user?.email;
    request.reviewedAt = now();
    request.updatedBy = req.user?.id;
    await transitionRequest(request, fulfilment.status === 'SCHEDULED' ? 'SCHEDULED' : 'APPROVED', { actor: actorFromReq(req), note: `Converted to fulfilment ${fulfilment.orderCode}${operationalOrder ? ` and operational order ${operationalOrder.id}` : ''}.` });
    const updatedClient = await recalculateClientRollups(client.id, req.user?.id);
    res.status(201).json({
      message: operationalOrder ? 'Corporate request converted to fulfilment and operational order.' : 'Corporate request converted to fulfilment.',
      request,
      fulfilment,
      operationalOrder,
      client: updatedClient,
    });
  } catch (error) {
    logger.error('Corporate request conversion error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to convert request to fulfilment.'));
  }
};

const createOperationalOrder = async (req, res, next) => {
  try {
    const fulfilment = await CorporateFulfilment.findOne({ id: req.params.fulfilmentId });
    if (!fulfilment) return next(new HttpError(404, 'Corporate fulfilment not found.'));
    const client = await CorporateClient.findOne({ id: fulfilment.clientId }).lean();
    if (!client) return next(new HttpError(404, 'Corporate client not found.'));
    assertClientAccess(req.user, client);
    const request = await CorporateRequest.findOne({ linkedFulfilmentId: fulfilment.id }).lean();
    const bridge = await createOperationalOrderForFulfilment({ client, request, fulfilment, actorUserId: req.user?.id, force: req.body.force === true });
    res.status(201).json({ message: bridge.created ? 'Operational order created and linked.' : 'Existing operational order already linked.', fulfilment, operationalOrder: bridge.order });
  } catch (error) {
    logger.error('Corporate operational order create error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to create operational order.'));
  }
};

const linkRunToFulfilment = async (req, res, next) => {
  try {
    const fulfilment = await CorporateFulfilment.findOne({ id: req.params.fulfilmentId });
    if (!fulfilment) return next(new HttpError(404, 'Corporate fulfilment not found.'));
    const clientForRun = await CorporateClient.findOne({ id: fulfilment.clientId }).lean();
    assertClientAccess(req.user, clientForRun);
    const result = await linkFulfilmentToRun({ fulfilment, runId: req.body.runId, sequence: req.body.sequence, actorUserId: req.user?.id });
    res.status(200).json({ message: 'Corporate fulfilment linked to run.', ...result });
  } catch (error) {
    logger.error('Corporate fulfilment run link error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to link run.'));
  }
};

const getRelationshipManagers = async (req, res, next) => {
  try {
    const rows = await User.find({ role: { $in: ['sales_agent', 'manager', 'operations_manager', 'plant_manager', 'admin'] }, status: { $ne: 'suspended' } })
      .select('id name email phone role status')
      .sort({ name: 1 })
      .lean();
    res.status(200).json({ rows });
  } catch (error) {
    logger.error('Relationship manager list error:', error);
    next(new HttpError(500, 'Failed to load relationship managers.'));
  }
};

const groupSum = (rows, keyFn, valueFns = {}) => {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row) || 'Unassigned';
    const cur = map.get(key) || { label: key, count: 0 };
    cur.count += 1;
    Object.entries(valueFns).forEach(([name, fn]) => { cur[name] = round(toNum(cur[name]) + toNum(fn(row))); });
    map.set(key, cur);
  });
  return Array.from(map.values()).sort((a, b) => toNum(b.revenue || b.deliveredKg || b.count) - toNum(a.revenue || a.deliveredKg || a.count));
};

const buildFulfilmentControlPayload = async (user) => {
  const rows = await CorporateFulfilment.find(corporateFulfilmentBranchFilter(user)).sort({ createdAt: -1 }).limit(500).lean();
  const current = now();
  const openRows = rows.filter((r) => openStatuses.includes(r.status));
  const deliveredRows = rows.filter((r) => r.status === 'DELIVERED');
  const overdueRows = openRows.filter((r) => r.promisedAt && new Date(r.promisedAt) < current);
  const atRiskRows = openRows.filter((r) => r.slaStatus === 'AT_RISK');
  const onTimeRows = deliveredRows.filter((r) => r.slaStatus === 'ON_TIME' || r.slaStatus === 'NOT_APPLICABLE');
  const turnaroundRows = deliveredRows.filter((r) => toNum(r.turnaroundMinutes) > 0);
  const pipeline = ['REQUESTED', 'SCHEDULED', 'IN_TRANSIT', 'DELAYED', 'DELIVERED', 'FAILED', 'CANCELLED'].reduce((acc, status) => {
    const stageRows = rows.filter((r) => r.status === status);
    acc[status] = {
      count: stageRows.length,
      requestedKg: round(stageRows.reduce((sum, r) => sum + toNum(r.requestedKg), 0)),
      deliveredKg: round(stageRows.reduce((sum, r) => sum + toNum(r.deliveredKg), 0)),
      revenue: round(stageRows.reduce((sum, r) => sum + toNum(r.revenue), 0)),
    };
    return acc;
  }, {});

  return {
    metrics: {
      openFulfilments: openRows.length,
      overdueFulfilments: overdueRows.length,
      atRiskFulfilments: atRiskRows.length,
      deliveredFulfilments: deliveredRows.length,
      requestedKg: round(rows.reduce((sum, r) => sum + toNum(r.requestedKg), 0)),
      deliveredKg: round(rows.reduce((sum, r) => sum + toNum(r.deliveredKg), 0)),
      revenue: round(rows.reduce((sum, r) => sum + toNum(r.revenue), 0)),
      grossMargin: round(rows.reduce((sum, r) => sum + toNum(r.grossMargin), 0)),
      outstandingAmount: round(rows.reduce((sum, r) => sum + toNum(r.outstandingAmount), 0)),
      averageTurnaroundMinutes: turnaroundRows.length ? round(turnaroundRows.reduce((sum, r) => sum + toNum(r.turnaroundMinutes), 0) / turnaroundRows.length) : 0,
      onTimeDeliveryRate: deliveredRows.length ? round((onTimeRows.length / deliveredRows.length) * 100) : 0,
    },
    pipeline,
    overdueFulfilments: overdueRows.sort((a, b) => new Date(a.promisedAt) - new Date(b.promisedAt)).slice(0, 20),
    atRiskFulfilments: atRiskRows.sort((a, b) => new Date(a.promisedAt || a.createdAt) - new Date(b.promisedAt || b.createdAt)).slice(0, 20),
    latestFulfilments: rows.slice(0, 30),
    byRelationshipManager: groupSum(rows, (r) => r.relationshipManagerName || r.relationshipManagerId || 'Unassigned RM', {
      deliveredKg: (r) => r.deliveredKg,
      revenue: (r) => r.revenue,
      outstandingAmount: (r) => r.outstandingAmount,
    }).slice(0, 12),
    byVehicle: groupSum(rows, (r) => r.truckName || r.vanName || r.vehicleType || 'Unassigned vehicle', {
      deliveredKg: (r) => r.deliveredKg,
      revenue: (r) => r.revenue,
      grossMargin: (r) => r.grossMargin,
    }).slice(0, 12),
    byClient: groupSum(rows, (r) => r.clientName, {
      deliveredKg: (r) => r.deliveredKg,
      revenue: (r) => r.revenue,
      outstandingAmount: (r) => r.outstandingAmount,
    }).slice(0, 12),
  };
};

const getFulfilmentControl = async (req, res, next) => {
  try {
    const payload = await buildFulfilmentControlPayload(req.user);
    res.status(200).json(payload);
  } catch (error) {
    logger.error('Corporate fulfilment control error:', error);
    next(new HttpError(500, 'Failed to load corporate fulfilment control.'));
  }
};


const buildCorporateBillingDashboardPayload = async (user) => {
  const clientFilter = corporateClientBranchFilter(user);
  const fulfilmentFilter = corporateFulfilmentBranchFilter(user);
  const [clients, fulfilments] = await Promise.all([
    CorporateClient.find(clientFilter).sort({ outstandingBalance: -1, lifetimeRevenue: -1 }).limit(500).lean(),
    CorporateFulfilment.find(fulfilmentFilter).sort({ paymentDueDate: 1, createdAt: -1 }).limit(1000),
  ]);

  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const invoiceable = fulfilments.filter((f) => toNum(f.revenue) > 0 || toNum(f.outstandingAmount) > 0 || f.invoiceNumber || f.status === 'DELIVERED');
  for (const f of invoiceable) {
    const client = clientsById.get(f.clientId);
    if (client) {
      // Best-effort migration to invoice-as-source-of-truth; failures should not block the dashboard.
      await ensureInvoiceForFulfilment({ client, request: null, fulfilment: f, actor: { id: 'system', name: 'Corporate Billing Dashboard' }, forceRefresh: false }).catch((err) => logger.warn('Invoice backfill skipped:', err.message));
    }
  }

  const invoices = await CorporateInvoice.find({ clientId: { $in: clients.map((c) => c.id) } }).sort({ dueDate: 1, createdAt: -1 }).limit(1500).lean();
  const nowDate = now();
  const outstandingRows = invoices.filter((inv) => toNum(inv.outstandingAmount) > 0 && inv.paymentStatus !== 'PAID');
  const overdueRows = outstandingRows.filter((inv) => inv.dueDate && new Date(inv.dueDate) < nowDate);
  const byClient = clients.map((client) => {
    const rows = invoices.filter((inv) => inv.clientId === client.id);
    const outstanding = round(rows.reduce((sum, inv) => sum + toNum(inv.outstandingAmount), 0));
    const revenue = round(rows.reduce((sum, inv) => sum + toNum(inv.totalAmount), 0));
    const paid = round(rows.reduce((sum, inv) => sum + toNum(inv.amountPaid), 0));
    const creditLimit = toNum(client.creditLimit);
    const clientOverdue = rows.filter((inv) => toNum(inv.outstandingAmount) > 0 && inv.dueDate && new Date(inv.dueDate) < nowDate);
    return {
      id: client.id,
      clientCode: client.clientCode,
      companyName: client.companyName,
      relationshipManagerName: client.relationshipManagerName,
      paymentTerms: client.paymentTerms,
      creditLimit,
      revenue,
      paid,
      outstanding,
      openInvoices: rows.filter((inv) => toNum(inv.outstandingAmount) > 0).length,
      overdueInvoices: clientOverdue.length,
      availableCredit: Math.max(0, round(creditLimit - outstanding)),
      creditUtilizationPct: creditLimit > 0 ? round((outstanding / creditLimit) * 100) : 0,
      creditRisk: creditLimit > 0 && outstanding > creditLimit,
      overdue: clientOverdue.length > 0,
    };
  }).sort((a, b) => toNum(b.outstanding) - toNum(a.outstanding));
  return {
    metrics: {
      totalInvoiceValue: round(invoices.reduce((sum, inv) => sum + toNum(inv.totalAmount), 0)),
      totalPaid: round(invoices.reduce((sum, inv) => sum + toNum(inv.amountPaid), 0)),
      totalOutstanding: round(outstandingRows.reduce((sum, inv) => sum + toNum(inv.outstandingAmount), 0)),
      overdueAmount: round(overdueRows.reduce((sum, inv) => sum + toNum(inv.outstandingAmount), 0)),
      openInvoices: outstandingRows.length,
      overdueInvoices: overdueRows.length,
      creditBreaches: byClient.filter((c) => c.creditRisk).length,
    },
    byClient: byClient.slice(0, 100),
    overdueInvoices: overdueRows.slice(0, 50),
    openInvoices: outstandingRows.slice(0, 100),
  };
};

const getBillingDashboard = async (req, res, next) => {
  try {
    const payload = await buildCorporateBillingDashboardPayload(req.user);
    res.status(200).json(payload);
  } catch (error) {
    logger.error('Corporate billing dashboard error:', error);
    next(new HttpError(500, 'Failed to load corporate billing dashboard.'));
  }
};

const recordFulfilmentPayment = async (req, res, next) => {
  try {
    const fulfilment = await CorporateFulfilment.findOne({ id: req.params.fulfilmentId });
    if (!fulfilment) return next(new HttpError(404, 'Corporate fulfilment not found.'));
    const clientRecord = await CorporateClient.findOne({ id: fulfilment.clientId }).lean();
    assertClientAccess(req.user, clientRecord);
    const amount = toNum(req.body.amount);
    if (amount <= 0) return next(new HttpError(400, 'Payment amount must be greater than zero.'));

    const request = await CorporateRequest.findOne({ linkedFulfilmentId: fulfilment.id }).lean();
    let invoice = await ensureInvoiceForFulfilment({ client: clientRecord, request, fulfilment, actor: actorFromReq(req), forceRefresh: true });
    invoice = await recordInvoicePayment({
      fulfilment,
      invoice,
      amount,
      paymentMethod: req.body.paymentMethod || fulfilment.paymentMethod || 'TRANSFER',
      paymentGateway: req.body.paymentGateway || 'MANUAL',
      paymentReference: req.body.paymentReference || fulfilment.paymentReference,
      actor: actorFromReq(req),
      note: `Payment recorded from BMA: ₦${amount.toLocaleString()}${req.body.paymentReference ? ` (${req.body.paymentReference})` : ''}`,
    });

    fulfilment.paymentMethod = req.body.paymentMethod || fulfilment.paymentMethod || 'TRANSFER';
    fulfilment.paymentGateway = req.body.paymentGateway || fulfilment.paymentGateway || 'MANUAL';
    fulfilment.paymentReference = req.body.paymentReference || fulfilment.paymentReference;
    fulfilment.lastPaymentAt = now();
    fulfilment.statusHistory = Array.isArray(fulfilment.statusHistory) ? fulfilment.statusHistory : [];
    fulfilment.statusHistory.unshift({
      status: 'PAYMENT_RECORDED',
      note: `Payment recorded: ₦${amount.toLocaleString()}${req.body.paymentReference ? ` (${req.body.paymentReference})` : ''}`,
      timestamp: now(),
      updatedBy: req.user?.id,
      updatedByName: req.user?.name || req.user?.email,
    });
    await fulfilment.save();

    const mappedPayment = mapPayment(fulfilment.paymentMethod, fulfilment.paymentGateway);
    await syncPaymentFromInvoiceOrFulfilment(fulfilment, { actor: actorFromReq(req), paymentMethod: mappedPayment.paymentMethod, paymentGateway: mappedPayment.paymentGateway });
    const client = await recalculateClientRollups(fulfilment.clientId, req.user?.id);
    res.status(200).json({ message: 'Corporate payment recorded.', fulfilment, invoice, client });
  } catch (error) {
    logger.error('Corporate payment record error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to record corporate payment.'));
  }
};

module.exports = {
  getDashboard,
  getFulfilmentControl,
  getBillingDashboard,
  recordFulfilmentPayment,
  listClients,
  createClient,
  getClient,
  updateClient,
  addActivity,
  listFulfilments,
  createFulfilment,
  updateFulfilment,
  updateFulfilmentStatus,
  linkWhatsAppContact,
  listClientUsers,
  createClientUser,
  updateClientUser,
  listSites,
  createSite,
  listRequests,
  reviewRequest,
  convertRequestToFulfilment,
  createOperationalOrder,
  linkRunToFulfilment,
  getRelationshipManagers,
};
