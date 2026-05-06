// src/api/v2/crm/crm.controller.js
const User = require('../../../models/user.model');
const Order = require('../../../models/order.model');
const DailySummary = require('../../../models/dailySummary.model');
const SupportTicket = require('../../../models/supportTicket.model');
const CustomerNote = require('../../../models/customerNote.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const round = (n, dp = 2) => Math.round(toNum(n) * 10 ** dp) / 10 ** dp;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return startOfDay(d); };
const asArr = (v) => Array.isArray(v) ? v : [];

const paidDeliveredMatch = (from = daysAgo(365), to = endOfDay(new Date())) => ({
  $or: [
    { orderDate: { $gte: from, $lte: to } },
    { orderDate: { $exists: false }, createdAt: { $gte: from, $lte: to } },
  ],
  $expr: {
    $and: [
      { $eq: [{ $toLower: { $ifNull: ['$status', ''] } }, 'delivered'] },
      { $in: [{ $toLower: { $ifNull: ['$paymentStatus', ''] } }, ['completed', 'paid', 'success', 'successful']] },
    ],
  },
});

const getCustomerOrderMetrics = async ({ from = daysAgo(365), to = endOfDay(new Date()), limit = 1000 } = {}) => {
  return Order.aggregate([
    { $match: paidDeliveredMatch(from, to) },
    {
      $project: {
        customerId: 1,
        customerName: '$recipientName',
        customerPhone: '$recipientPhone',
        orderDate: { $ifNull: ['$orderDate', '$createdAt'] },
        grandTotal: { $ifNull: ['$grandTotal', '$finalAmountPaid'] },
        kg: { $cond: [{ $isArray: '$items' }, { $sum: '$items.quantity' }, 0] },
        branchId: { $ifNull: ['$branchId', { $ifNull: ['$serviceZoneId', '$plantId'] }] },
      },
    },
    {
      $group: {
        _id: '$customerId',
        customerName: { $last: '$customerName' },
        customerPhone: { $last: '$customerPhone' },
        lastOrderAt: { $max: '$orderDate' },
        firstOrderAt: { $min: '$orderDate' },
        orderCount: { $sum: 1 },
        totalRevenue: { $sum: { $ifNull: ['$grandTotal', 0] } },
        totalKg: { $sum: { $ifNull: ['$kg', 0] } },
        branchIds: { $addToSet: '$branchId' },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: Number(limit) || 1000 },
  ]);
};

const buildSegment = (m, now = new Date()) => {
  const last = m.lastOrderAt ? new Date(m.lastOrderAt) : null;
  const daysSinceLastOrder = last ? Math.floor((now - last) / (1000 * 60 * 60 * 24)) : null;
  const totalRevenue = toNum(m.totalRevenue);
  const orderCount = toNum(m.orderCount);
  if (!last) return 'NO_ORDER';
  if (daysSinceLastOrder <= 30 && totalRevenue >= 250000) return 'HIGH_VALUE_ACTIVE';
  if (daysSinceLastOrder <= 30) return 'ACTIVE';
  if (daysSinceLastOrder <= 60) return 'DUE_FOR_REFILL';
  if (daysSinceLastOrder <= 90) return 'CHURN_RISK';
  if (orderCount >= 3 || totalRevenue >= 150000) return 'DORMANT_HIGH_VALUE';
  return 'DORMANT';
};

const scoreRfm = (m, now = new Date()) => {
  const daysSinceLastOrder = m.lastOrderAt ? Math.floor((now - new Date(m.lastOrderAt)) / (1000 * 60 * 60 * 24)) : 999;
  const recencyScore = daysSinceLastOrder <= 30 ? 5 : daysSinceLastOrder <= 60 ? 4 : daysSinceLastOrder <= 90 ? 3 : daysSinceLastOrder <= 180 ? 2 : 1;
  const frequencyScore = toNum(m.orderCount) >= 12 ? 5 : toNum(m.orderCount) >= 6 ? 4 : toNum(m.orderCount) >= 3 ? 3 : toNum(m.orderCount) >= 2 ? 2 : 1;
  const monetaryScore = toNum(m.totalRevenue) >= 500000 ? 5 : toNum(m.totalRevenue) >= 250000 ? 4 : toNum(m.totalRevenue) >= 100000 ? 3 : toNum(m.totalRevenue) >= 50000 ? 2 : 1;
  return { recencyScore, frequencyScore, monetaryScore, rfmScore: recencyScore + frequencyScore + monetaryScore };
};

const enrichCustomerMetrics = async (metrics) => {
  const customerIds = metrics.map((m) => String(m._id)).filter(Boolean);
  const [users, tickets, notes] = await Promise.all([
    customerIds.length ? User.find({ id: { $in: customerIds } }).select('id name email phone status walletBalance defaultAddressId createdAt').lean() : [],
    customerIds.length ? SupportTicket.aggregate([
      { $match: { customerId: { $in: customerIds } } },
      { $group: { _id: '$customerId', openTickets: { $sum: { $cond: [{ $in: ['$status', ['OPEN', 'IN_PROGRESS', 'ESCALATED']] }, 1, 0] } }, totalTickets: { $sum: 1 }, lastTicketAt: { $max: '$createdAt' } } },
    ]).catch(() => []) : [],
    customerIds.length && CustomerNote?.aggregate ? CustomerNote.aggregate([
      { $match: { customerId: { $in: customerIds } } },
      { $group: { _id: '$customerId', notesCount: { $sum: 1 }, lastNoteAt: { $max: '$createdAt' } } },
    ]).catch(() => []) : [],
  ]);
  const userMap = new Map(users.map((u) => [String(u.id), u]));
  const ticketMap = new Map(tickets.map((t) => [String(t._id), t]));
  const noteMap = new Map(notes.map((n) => [String(n._id), n]));
  const now = new Date();
  return metrics.map((m) => {
    const id = String(m._id || '');
    const user = userMap.get(id) || {};
    const t = ticketMap.get(id) || {};
    const note = noteMap.get(id) || {};
    const rfm = scoreRfm(m, now);
    const lastOrderAt = m.lastOrderAt ? new Date(m.lastOrderAt) : null;
    const daysSinceLastOrder = lastOrderAt ? Math.floor((now - lastOrderAt) / (1000 * 60 * 60 * 24)) : null;
    const avgOrderValue = toNum(m.orderCount) > 0 ? toNum(m.totalRevenue) / toNum(m.orderCount) : 0;
    const avgKgPerOrder = toNum(m.orderCount) > 0 ? toNum(m.totalKg) / toNum(m.orderCount) : 0;
    const segment = buildSegment(m, now);
    return {
      customerId: id,
      name: user.name || m.customerName || 'Unknown customer',
      phone: user.phone || m.customerPhone || '',
      email: user.email || '',
      status: user.status || 'unknown',
      walletBalance: toNum(user.walletBalance),
      firstOrderAt: m.firstOrderAt,
      lastOrderAt: m.lastOrderAt,
      daysSinceLastOrder,
      orderCount: toNum(m.orderCount),
      totalRevenue: round(m.totalRevenue),
      totalKg: round(m.totalKg),
      avgOrderValue: round(avgOrderValue),
      avgKgPerOrder: round(avgKgPerOrder),
      estimatedNextRefillDate: lastOrderAt ? new Date(lastOrderAt.getTime() + Math.max(14, Math.min(45, avgKgPerOrder ? 30 : 21)) * 86400000) : null,
      segment,
      ...rfm,
      openTickets: toNum(t.openTickets),
      totalTickets: toNum(t.totalTickets),
      lastTicketAt: t.lastTicketAt || null,
      notesCount: toNum(note.notesCount),
      lastNoteAt: note.lastNoteAt || null,
      branchIds: asArr(m.branchIds).filter(Boolean),
    };
  });
};

const getDashboard = async (req, res, next) => {
  try {
    const from = req.query.startDate ? new Date(req.query.startDate) : daysAgo(365);
    const to = req.query.endDate ? new Date(req.query.endDate) : endOfDay(new Date());
    const [totalCustomers, newCustomersThisMonth, metrics, openComplaints] = await Promise.all([
      User.countDocuments({ role: 'customer' }),
      User.countDocuments({ role: 'customer', createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } }),
      getCustomerOrderMetrics({ from, to, limit: 2000 }),
      SupportTicket.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } }).catch(() => 0),
    ]);
    const enriched = await enrichCustomerMetrics(metrics);
    const activeCustomers = enriched.filter((c) => c.daysSinceLastOrder !== null && c.daysSinceLastOrder <= 30).length;
    const dormantCustomers = enriched.filter((c) => ['DORMANT', 'DORMANT_HIGH_VALUE'].includes(c.segment)).length;
    const churnRiskCustomers = enriched.filter((c) => c.segment === 'CHURN_RISK').length;
    const dueForRefill = enriched.filter((c) => c.segment === 'DUE_FOR_REFILL').length;
    const totalRevenue = enriched.reduce((s, c) => s + toNum(c.totalRevenue), 0);
    const totalKg = enriched.reduce((s, c) => s + toNum(c.totalKg), 0);
    const totalOrders = enriched.reduce((s, c) => s + toNum(c.orderCount), 0);
    const repeatCustomers = enriched.filter((c) => c.orderCount > 1).length;
    const dashboard = {
      period: { from, to },
      metrics: {
        totalCustomers,
        knownPurchasingCustomers: enriched.length,
        activeCustomers,
        dormantCustomers,
        churnRiskCustomers,
        dueForRefill,
        newCustomersThisMonth,
        repeatPurchaseRate: enriched.length ? round((repeatCustomers / enriched.length) * 100, 1) : 0,
        averageOrderValue: totalOrders ? round(totalRevenue / totalOrders) : 0,
        averageKgPerOrder: totalOrders ? round(totalKg / totalOrders) : 0,
        totalCustomerRevenue: round(totalRevenue),
        totalCustomerKg: round(totalKg),
        openComplaints,
        loyaltyLiabilityKg: round(enriched.reduce((s, c) => s + (toNum(c.totalKg) % 125), 0)),
      },
      topCustomersByKg: enriched.slice().sort((a, b) => b.totalKg - a.totalKg).slice(0, 20),
      topCustomersByRevenue: enriched.slice().sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 20),
      attentionQueue: enriched.filter((c) => ['DUE_FOR_REFILL', 'CHURN_RISK', 'DORMANT_HIGH_VALUE'].includes(c.segment) || c.openTickets > 0).slice(0, 50),
    };
    res.status(200).json(dashboard);
  } catch (error) {
    logger.error('CRM dashboard error:', error);
    next(new HttpError(500, 'Failed to load CRM dashboard.'));
  }
};

const getSegments = async (req, res, next) => {
  try {
    const metrics = await getCustomerOrderMetrics({ limit: 3000 });
    const enriched = await enrichCustomerMetrics(metrics);
    const grouped = enriched.reduce((acc, c) => {
      acc[c.segment] = acc[c.segment] || { segment: c.segment, count: 0, revenue: 0, kg: 0, customers: [] };
      acc[c.segment].count += 1;
      acc[c.segment].revenue += toNum(c.totalRevenue);
      acc[c.segment].kg += toNum(c.totalKg);
      if (acc[c.segment].customers.length < 50) acc[c.segment].customers.push(c);
      return acc;
    }, {});
    const rows = Object.values(grouped).map((g) => ({ ...g, revenue: round(g.revenue), kg: round(g.kg) })).sort((a, b) => b.revenue - a.revenue);
    res.status(200).json({ rows });
  } catch (error) {
    logger.error('CRM segments error:', error);
    next(new HttpError(500, 'Failed to load CRM segments.'));
  }
};

const getFollowUps = async (req, res, next) => {
  try {
    const metrics = await getCustomerOrderMetrics({ limit: 3000 });
    const enriched = await enrichCustomerMetrics(metrics);
    const rows = enriched
      .filter((c) => ['DUE_FOR_REFILL', 'CHURN_RISK', 'DORMANT_HIGH_VALUE'].includes(c.segment) || c.openTickets > 0)
      .map((c) => ({
        ...c,
        recommendedAction: c.openTickets > 0 ? 'Resolve open complaint before selling' : c.segment === 'DUE_FOR_REFILL' ? 'Call customer for refill reminder' : c.segment === 'CHURN_RISK' ? 'Send reactivation offer' : 'Call high-value dormant customer',
        priority: c.openTickets > 0 || c.segment === 'DORMANT_HIGH_VALUE' ? 'HIGH' : c.segment === 'CHURN_RISK' ? 'MEDIUM' : 'LOW',
      }))
      .sort((a, b) => (b.openTickets - a.openTickets) || (b.totalRevenue - a.totalRevenue))
      .slice(0, 200);
    res.status(200).json({ rows });
  } catch (error) {
    logger.error('CRM follow-up error:', error);
    next(new HttpError(500, 'Failed to load follow-up queue.'));
  }
};

const getCampaignTargets = async (req, res, next) => {
  try {
    const segment = req.query.segment || '';
    const metrics = await getCustomerOrderMetrics({ limit: 3000 });
    let enriched = await enrichCustomerMetrics(metrics);
    if (segment) enriched = enriched.filter((c) => c.segment === segment);
    const rows = enriched
      .filter((c) => c.status !== 'suspended')
      .map((c) => ({ customerId: c.customerId, name: c.name, phone: c.phone, email: c.email, segment: c.segment, totalKg: c.totalKg, totalRevenue: c.totalRevenue, lastOrderAt: c.lastOrderAt }))
      .slice(0, 1000);
    res.status(200).json({ rows });
  } catch (error) {
    logger.error('CRM campaign target error:', error);
    next(new HttpError(500, 'Failed to load campaign targets.'));
  }
};

module.exports = { getDashboard, getSegments, getFollowUps, getCampaignTargets };
