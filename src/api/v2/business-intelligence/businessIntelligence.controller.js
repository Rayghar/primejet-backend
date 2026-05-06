// src/api/v2/business-intelligence/businessIntelligence.controller.js
const Order = require('../../../models/order.model');
const User = require('../../../models/user.model');
const DailySummary = require('../../../models/dailySummary.model');
const StockMovement = require('../../../models/stockMovement.model');
const StockIn = require('../../../models/stockIn.model');
const SupportTicket = require('../../../models/supportTicket.model');
const Plant = require('../../../models/plant.model');
const GeneralLedgerEntry = require('../../../models/generalLedgerEntry.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const round = (n, dp = 2) => Math.round(num(n) * 10 ** dp) / 10 ** dp;
const sod = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const eod = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return sod(d); };
const rangeFromQuery = (q = {}) => ({ start: q.startDate ? sod(new Date(q.startDate)) : daysAgo(q.period === 'weekly' ? 7 : q.period === 'yearly' ? 365 : 30), end: q.endDate ? eod(new Date(q.endDate)) : eod(new Date()) });

const deliveredPaidMatch = (start, end) => ({
  $or: [{ orderDate: { $gte: start, $lte: end } }, { orderDate: { $exists: false }, createdAt: { $gte: start, $lte: end } }],
  $expr: { $and: [
    { $eq: [{ $toLower: { $ifNull: ['$status', ''] } }, 'delivered'] },
    { $in: [{ $toLower: { $ifNull: ['$paymentStatus', ''] } }, ['completed','paid','success','successful']] },
  ]},
});

const getActualSnapshot = async (start, end) => {
  const [delivery, pos, customers, tickets, lowStockPlants, failedPostings, stock, expenses] = await Promise.all([
    Order.aggregate([
      { $match: deliveredPaidMatch(start, end) },
      { $project: { revenue: { $ifNull: ['$grandTotal', '$finalAmountPaid'] }, kg: { $cond: [{ $isArray: '$items' }, { $sum: '$items.quantity' }, 0] } } },
      { $group: { _id: null, revenue: { $sum: '$revenue' }, kg: { $sum: '$kg' }, orders: { $sum: 1 } } },
    ]),
    DailySummary.aggregate([
      { $match: { date: { $gte: start, $lte: end }, status: { $in: ['approved','posted','closed'] } } },
      { $group: { _id: null, revenue: { $sum: { $ifNull: ['$sales.totalRevenue', 0] } }, kg: { $sum: { $ifNull: ['$sales.totalKgSold', 0] } }, expenses: { $sum: { $ifNull: ['$expenses.total', 0] } }, count: { $sum: 1 } } },
    ]),
    User.countDocuments({ role: 'customer', createdAt: { $lte: end } }),
    SupportTicket.countDocuments({ status: { $in: ['OPEN','IN_PROGRESS','ESCALATED'] } }).catch(() => 0),
    Plant.countDocuments({ status: { $in: ['Warning', 'Offline', 'Maintenance'] } }).catch(() => 0),
    DailySummary.countDocuments({ 'posting.status': 'FAILED' }).catch(() => 0),
    StockMovement.aggregate([
      { $group: { _id: '$branchId', inKg: { $sum: { $cond: [{ $eq: ['$direction','IN'] }, '$quantityKg', 0] } }, outKg: { $sum: { $cond: [{ $eq: ['$direction','OUT'] }, '$quantityKg', 0] } }, value: { $last: '$runningValue' } } },
    ]).catch(() => []),
    GeneralLedgerEntry.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $group: { _id: '$accountType', debit: { $sum: '$debit' }, credit: { $sum: '$credit' } } },
    ]).catch(() => []),
  ]);
  const d = delivery[0] || {};
  const p = pos[0] || {};
  const totalRevenue = num(d.revenue) + num(p.revenue);
  const totalKg = num(d.kg) + num(p.kg);
  const totalOrders = num(d.orders) + num(p.count);
  const totalExpenses = num(p.expenses);
  const currentStockKg = stock.reduce((s, r) => s + Math.max(0, num(r.inKg) - num(r.outKg)), 0);
  return { totalRevenue, totalKg, totalOrders, customers, openTickets: tickets, lowStockPlants, failedPostings, totalExpenses, currentStockKg, ledgerRows: expenses };
};

const getExecutiveIntelligence = async (req, res, next) => {
  try {
    const { start, end } = rangeFromQuery(req.query);
    const prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - Math.max(1, Math.ceil((end - start) / 86400000)));
    const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1); prevEnd.setHours(23,59,59,999);
    const [current, previous] = await Promise.all([getActualSnapshot(start, end), getActualSnapshot(prevStart, prevEnd)]);
    const grossMarginPerKg = current.totalKg ? (current.totalRevenue - current.totalExpenses) / current.totalKg : 0;
    const revenueGrowthPct = previous.totalRevenue ? ((current.totalRevenue - previous.totalRevenue) / previous.totalRevenue) * 100 : current.totalRevenue ? 100 : 0;
    const kgGrowthPct = previous.totalKg ? ((current.totalKg - previous.totalKg) / previous.totalKg) * 100 : current.totalKg ? 100 : 0;
    const riskScore = Math.min(100, current.openTickets * 4 + current.lowStockPlants * 15 + current.failedPostings * 20);
    res.json({
      period: { start, end },
      scorecards: {
        revenue: round(current.totalRevenue), kgSold: round(current.totalKg), orders: current.totalOrders,
        activeCustomerBase: current.customers, grossMarginPerKg: round(grossMarginPerKg), currentStockKg: round(current.currentStockKg),
        revenueGrowthPct: round(revenueGrowthPct, 1), kgGrowthPct: round(kgGrowthPct, 1), riskScore,
      },
      dataConfidence: {
        level: current.failedPostings > 0 || current.lowStockPlants > 0 ? 'MEDIUM' : 'HIGH',
        reasons: [current.failedPostings ? `${current.failedPostings} failed postings` : null, current.lowStockPlants ? `${current.lowStockPlants} plants require attention` : null].filter(Boolean),
      },
    });
  } catch (error) {
    logger.error('Executive intelligence error:', error);
    next(new HttpError(500, 'Failed to load executive intelligence.'));
  }
};

const getActionRecommendations = async (req, res, next) => {
  try {
    const today = sod(new Date());
    const [overdueCloseouts, failedPostings, openTickets, lowStockPlants, dormantCustomers] = await Promise.all([
      DailySummary.find({ date: { $lt: today }, status: { $in: ['in_progress','pending_approval','rejected'] } }).limit(10).lean(),
      DailySummary.find({ 'posting.status': 'FAILED' }).limit(10).lean(),
      SupportTicket.find({ status: { $in: ['OPEN','IN_PROGRESS','ESCALATED'] } }).sort({ createdAt: 1 }).limit(10).lean().catch(() => []),
      Plant.find({ status: { $in: ['Warning','Offline','Maintenance'] } }).limit(10).lean(),
      User.find({ role: 'customer', status: 'active' }).sort({ updatedAt: 1 }).limit(10).lean(),
    ]);
    const actions = [];
    if (overdueCloseouts.length) actions.push({ priority: 'HIGH', category: 'POS_CLOSE', title: `Close ${overdueCloseouts.length} overdue POS day(s)`, action: 'Review Close Workbench and finalize/reject pending records.' });
    if (failedPostings.length) actions.push({ priority: 'CRITICAL', category: 'FINANCE', title: `Resolve ${failedPostings.length} failed GL posting(s)`, action: 'Open Finance Controls and retry or reverse failed postings.' });
    if (openTickets.length) actions.push({ priority: 'HIGH', category: 'CRM', title: `Resolve ${openTickets.length} open support issue(s)`, action: 'Prioritize escalated tickets and complaint-heavy customers.' });
    if (lowStockPlants.length) actions.push({ priority: 'HIGH', category: 'PLANT', title: `Review ${lowStockPlants.length} plant risk alert(s)`, action: 'Open Plant Reliability Command Center and review stock/maintenance.' });
    if (dormantCustomers.length) actions.push({ priority: 'MEDIUM', category: 'GROWTH', title: 'Call dormant or low-activity customers', action: 'Use Customer CRM follow-up queue for refill reminders and reactivation offers.' });
    res.json({ generatedAt: new Date(), actions });
  } catch (error) {
    logger.error('Action recommendations error:', error);
    next(new HttpError(500, 'Failed to load action recommendations.'));
  }
};

const getModuleIntelligence = async (req, res, next) => {
  try {
    const { start, end } = rangeFromQuery(req.query);
    const [snapshot, branchRows, plantRows] = await Promise.all([
      getActualSnapshot(start, end),
      DailySummary.aggregate([
        { $match: { date: { $gte: start, $lte: end } } },
        { $group: { _id: '$branchId', revenue: { $sum: { $ifNull: ['$sales.totalRevenue', 0] } }, kg: { $sum: { $ifNull: ['$sales.totalKgSold', 0] } }, expenses: { $sum: { $ifNull: ['$expenses.total', 0] } } } },
        { $sort: { revenue: -1 } },
        { $limit: 20 },
      ]),
      Plant.find({}).limit(50).lean(),
    ]);
    res.json({
      period: { start, end },
      sales: { revenue: round(snapshot.totalRevenue), kg: round(snapshot.totalKg), orders: snapshot.totalOrders, averagePricePerKg: snapshot.totalKg ? round(snapshot.totalRevenue / snapshot.totalKg) : 0 },
      finance: { totalExpenses: round(snapshot.totalExpenses), estimatedGrossProfit: round(snapshot.totalRevenue - snapshot.totalExpenses), failedPostings: snapshot.failedPostings },
      operations: { openTickets: snapshot.openTickets, plantsNeedingAttention: snapshot.lowStockPlants, currentStockKg: round(snapshot.currentStockKg) },
      branches: branchRows.map((r) => ({ branchId: String(r._id || ''), revenue: round(r.revenue), kg: round(r.kg), expenses: round(r.expenses), grossProfit: round(num(r.revenue) - num(r.expenses)) })),
      plants: plantRows.map((p) => ({ plantId: p.id, name: p.name, status: p.status, uptime: p.uptime, capacity: p.capacity, outputToday: p.outputToday, monthlyOpex: p.monthlyOpex })),
    });
  } catch (error) {
    logger.error('Module intelligence error:', error);
    next(new HttpError(500, 'Failed to load module intelligence.'));
  }
};

module.exports = { getExecutiveIntelligence, getActionRecommendations, getModuleIntelligence };
