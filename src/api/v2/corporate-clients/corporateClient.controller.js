// File: src/api/v2/corporate-clients/corporateClient.controller.js
const CorporateClient = require('../../../models/corporateClient.model');
const CorporateFulfilment = require('../../../models/corporateFulfilment.model');
const WhatsAppContact = require('../../../models/whatsappContact.model');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

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
    const [stageAgg, clients, fulfilmentAgg, dueFollowUps, recentFulfilments, whatsappLinked, control] = await Promise.all([
      CorporateClient.aggregate([{ $group: { _id: '$stage', count: { $sum: 1 }, expectedMonthlyKg: { $sum: { $ifNull: ['$expectedMonthlyKg', 0] } } } }]),
      CorporateClient.find({}).sort({ updatedAt: -1 }).limit(12).lean(),
      CorporateFulfilment.aggregate([
        { $group: { _id: null, count: { $sum: 1 }, requestedKg: { $sum: '$requestedKg' }, deliveredKg: { $sum: '$deliveredKg' }, revenue: { $sum: '$revenue' }, grossMargin: { $sum: '$grossMargin' }, outstandingAmount: { $sum: '$outstandingAmount' }, delayed: { $sum: { $cond: [{ $eq: ['$status', 'DELAYED'] }, 1, 0] } }, delivered: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0] } } } },
      ]),
      CorporateClient.find({ nextFollowUpDate: { $lte: now() }, stage: { $nin: ['LOST'] } }).sort({ nextFollowUpDate: 1 }).limit(20).lean(),
      CorporateFulfilment.find({}).sort({ createdAt: -1 }).limit(10).lean(),
      CorporateClient.countDocuments({ $or: [{ whatsappContactId: { $exists: true, $ne: '' } }, { whatsappPhone: { $exists: true, $ne: '' } }] }),
      buildFulfilmentControlPayload(),
    ]);

    const stages = stageAgg.reduce((acc, row) => {
      acc[row._id || 'UNKNOWN'] = { count: row.count, expectedMonthlyKg: round(row.expectedMonthlyKg) };
      return acc;
    }, {});
    const f = fulfilmentAgg[0] || {};
    res.status(200).json({
      metrics: {
        totalCorporateClients: await CorporateClient.countDocuments({}),
        activeCorporateClients: await CorporateClient.countDocuments({ stage: 'ACTIVE' }),
        leadsAndProspects: await CorporateClient.countDocuments({ stage: { $in: ['LEAD', 'PROSPECT'] } }),
        onboarding: await CorporateClient.countDocuments({ stage: 'ONBOARDING' }),
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
    const filter = {};
    if (stage) filter.stage = stage;
    if (rm) filter.relationshipManagerId = rm;
    if (branchId) filter.assignedBranchId = branchId;
    if (outstandingOnly === 'true') filter.outstandingBalance = { $gt: 0 };
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ companyName: rx }, { contactPerson: rx }, { phone: rx }, { email: rx }, { industry: rx }, { clientCode: rx }];
    }
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
    const client = await CorporateClient.create(payload);
    res.status(201).json({ message: 'Corporate client created successfully.', client });
  } catch (error) {
    logger.error('Corporate client create error:', error);
    next(new HttpError(500, error.message || 'Failed to create corporate client.'));
  }
};

const getClient = async (req, res, next) => {
  try {
    const { clientId } = req.params;
    const [client, fulfilments] = await Promise.all([
      CorporateClient.findOne({ id: clientId }).lean(),
      CorporateFulfilment.find({ clientId }).sort({ createdAt: -1 }).limit(100).lean(),
    ]);
    if (!client) return next(new HttpError(404, 'Corporate client not found.'));
    res.status(200).json({ client, fulfilments });
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
    const client = await CorporateClient.findOneAndUpdate({ id: req.params.clientId }, { $set: payload }, { new: true, runValidators: true });
    if (!client) return next(new HttpError(404, 'Corporate client not found.'));
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
    const client = await CorporateClient.findOneAndUpdate({ id: req.params.clientId }, update, { new: true, runValidators: true });
    if (!client) return next(new HttpError(404, 'Corporate client not found.'));
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
    const filter = fulfilmentFilterFromQuery(req.query, req.params);
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
    const updatedClient = await recalculateClientRollups(client.id, req.user?.id);
    res.status(201).json({ message: 'Corporate fulfilment created successfully.', fulfilment, client: updatedClient });
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
    const previousStatus = fulfilment.status;
    Object.assign(fulfilment, payload);
    if (payload.status === 'SCHEDULED' && !fulfilment.scheduledAt) fulfilment.scheduledAt = now();
    if (payload.status === 'IN_TRANSIT' && !fulfilment.dispatchStartedAt) fulfilment.dispatchStartedAt = now();
    if (payload.status === 'DELIVERED' && !fulfilment.actualDeliveredAt) fulfilment.actualDeliveredAt = now();
    if (payload.status && payload.status !== previousStatus) addStatusMilestone(fulfilment, req, payload.status, req.body.statusNote || req.body.serviceNotes || 'Status updated.');
    await fulfilment.save();
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
    fulfilment.status = status;
    if (req.body.actualDeliveredAt) fulfilment.actualDeliveredAt = req.body.actualDeliveredAt;
    if (req.body.customerConfirmed !== undefined) fulfilment.customerConfirmed = Boolean(req.body.customerConfirmed);
    if (req.body.delayReason !== undefined) fulfilment.delayReason = req.body.delayReason;
    if (req.body.serviceNotes !== undefined) fulfilment.serviceNotes = req.body.serviceNotes;
    if (status === 'SCHEDULED' && !fulfilment.scheduledAt) fulfilment.scheduledAt = now();
    if (status === 'IN_TRANSIT' && !fulfilment.dispatchStartedAt) fulfilment.dispatchStartedAt = now();
    if (status === 'DELIVERED' && !fulfilment.actualDeliveredAt) fulfilment.actualDeliveredAt = now();
    fulfilment.updatedBy = req.user?.id;
    addStatusMilestone(fulfilment, req, status, req.body.note || req.body.delayReason || 'Status updated from fulfilment control tower.');
    await fulfilment.save();
    const client = await recalculateClientRollups(fulfilment.clientId, req.user?.id);
    res.status(200).json({ message: 'Corporate fulfilment status updated.', fulfilment, client });
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

const buildFulfilmentControlPayload = async () => {
  const rows = await CorporateFulfilment.find({}).sort({ createdAt: -1 }).limit(500).lean();
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
    const payload = await buildFulfilmentControlPayload();
    res.status(200).json(payload);
  } catch (error) {
    logger.error('Corporate fulfilment control error:', error);
    next(new HttpError(500, 'Failed to load corporate fulfilment control.'));
  }
};

module.exports = {
  getDashboard,
  getFulfilmentControl,
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
  getRelationshipManagers,
};
