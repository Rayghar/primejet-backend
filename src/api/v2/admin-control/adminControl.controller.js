// src/api/v2/admin-control/adminControl.controller.js
const User = require('../../../models/user.model');
const Plant = require('../../../models/plant.model');
const BranchPrice = require('../../../models/branchPrice.model');
const BranchStockConfig = require('../../../models/branchStockConfig.model');
const LpgProduct = require('../../../models/lpgProduct.model');
const ChartOfAccount = require('../../../models/chartOfAccount.model');
const DailySummary = require('../../../models/dailySummary.model');
const GeneralLedgerEntry = require('../../../models/generalLedgerEntry.model');
const Config = require('../../../models/config.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const safeCount = (model, filter) => model.countDocuments(filter).catch(() => 0);

const getControlCenter = async (req, res, next) => {
  try {
    const [activeUsers, inactiveUsers, usersWithoutBranch, plants, products, activePrices, stockMappings, failedPostings, unpostedDays, coaCount] = await Promise.all([
      safeCount(User, { status: 'active' }),
      safeCount(User, { status: { $ne: 'active' } }),
      safeCount(User, { role: { $ne: 'customer' }, $or: [{ branchId: { $exists: false } }, { branchId: null }, { branchId: '' }] }),
      Plant.find({}).lean().catch(() => []),
      LpgProduct.find({}).lean().catch(() => []),
      safeCount(BranchPrice, { status: 'ACTIVE' }),
      safeCount(BranchStockConfig, { isActive: { $ne: false } }),
      safeCount(DailySummary, { 'posting.status': 'FAILED' }),
      safeCount(DailySummary, { status: 'approved', 'posting.status': { $in: ['UNPOSTED','QUEUED','FAILED'] } }),
      safeCount(ChartOfAccount, {}),
    ]);
    const plantsWithoutStockMapping = Math.max(0, plants.length - stockMappings);
    const productsWithoutPrice = Math.max(0, products.length - activePrices);
    res.json({
      metrics: { activeUsers, inactiveUsers, usersWithoutBranch, plants: plants.length, products: products.length, activePrices, stockMappings, plantsWithoutStockMapping, productsWithoutPrice, failedPostings, unpostedDays, coaCount },
      health: {
        status: failedPostings || plantsWithoutStockMapping || productsWithoutPrice ? 'ATTENTION_REQUIRED' : 'GOOD',
        blockers: [
          failedPostings ? `${failedPostings} failed posting(s)` : null,
          plantsWithoutStockMapping ? `${plantsWithoutStockMapping} plant(s) without stock mapping` : null,
          productsWithoutPrice ? `${productsWithoutPrice} product(s) without active price` : null,
          coaCount === 0 ? 'Chart of accounts is empty' : null,
        ].filter(Boolean),
      },
    });
  } catch (error) {
    logger.error('Admin control center error:', error);
    next(new HttpError(500, 'Failed to load administration control center.'));
  }
};

const getDataQuality = async (req, res, next) => {
  try {
    const [usersWithoutPhone, customersWithoutOrders, plantsWithoutMappings, productsWithoutPrices, duplicatePhones, failedPostingSamples] = await Promise.all([
      safeCount(User, { role: 'customer', $or: [{ phone: { $exists: false } }, { phone: '' }, { phone: null }] }),
      safeCount(User, { role: 'customer', createdAt: { $lte: new Date() } }),
      Plant.find({}).lean().then(async (plants) => {
        const mappings = await BranchStockConfig.find({ isActive: { $ne: false } }).select('branchId').lean().catch(() => []);
        const mapped = new Set(mappings.map((m) => String(m.branchId)));
        return plants.filter((p) => !mapped.has(String(p.id))).map((p) => ({ plantId: p.id, name: p.name, issue: 'Missing plant-to-stock mapping' }));
      }).catch(() => []),
      LpgProduct.find({}).lean().then(async (products) => {
        const prices = await BranchPrice.find({ status: 'ACTIVE' }).select('productId productSku').lean().catch(() => []);
        const priced = new Set(prices.flatMap((p) => [String(p.productId || ''), String(p.productSku || '')]));
        return products.filter((p) => !priced.has(String(p.id)) && !priced.has(String(p.code || ''))).map((p) => ({ productId: p.id, name: p.name, issue: 'Missing active branch price' }));
      }).catch(() => []),
      User.aggregate([{ $match: { phone: { $nin: [null, ''] } } }, { $group: { _id: '$phone', count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }, { $limit: 20 }]).catch(() => []),
      DailySummary.find({ 'posting.status': 'FAILED' }).select('dailySummaryId branchId date posting').limit(20).lean().catch(() => []),
    ]);
    res.json({
      score: Math.max(0, 100 - (usersWithoutPhone * 2 + plantsWithoutMappings.length * 10 + productsWithoutPrices.length * 10 + duplicatePhones.length * 3 + failedPostingSamples.length * 5)),
      checks: [
        { name: 'Customers missing phone', severity: usersWithoutPhone ? 'MEDIUM' : 'OK', count: usersWithoutPhone },
        { name: 'Plants without stock mapping', severity: plantsWithoutMappings.length ? 'HIGH' : 'OK', count: plantsWithoutMappings.length, samples: plantsWithoutMappings },
        { name: 'Products without active price', severity: productsWithoutPrices.length ? 'HIGH' : 'OK', count: productsWithoutPrices.length, samples: productsWithoutPrices },
        { name: 'Duplicate phone numbers', severity: duplicatePhones.length ? 'MEDIUM' : 'OK', count: duplicatePhones.length, samples: duplicatePhones },
        { name: 'Failed GL postings', severity: failedPostingSamples.length ? 'HIGH' : 'OK', count: failedPostingSamples.length, samples: failedPostingSamples },
      ],
    });
  } catch (error) {
    logger.error('Data quality error:', error);
    next(new HttpError(500, 'Failed to load data quality dashboard.'));
  }
};

const getSystemHealth = async (req, res, next) => {
  try {
    const [lastLedger, lastDailySummary, failedPostings, configCount] = await Promise.all([
      GeneralLedgerEntry.findOne({}).sort({ createdAt: -1 }).lean().catch(() => null),
      DailySummary.findOne({}).sort({ updatedAt: -1 }).lean().catch(() => null),
      safeCount(DailySummary, { 'posting.status': 'FAILED' }),
      safeCount(Config, {}),
    ]);
    res.json({
      generatedAt: new Date(),
      api: { status: 'UP' },
      dataFreshness: { lastLedgerAt: lastLedger?.createdAt || null, lastDailySummaryAt: lastDailySummary?.updatedAt || null },
      jobs: { failedPostings },
      configuration: { configRecords: configCount },
      status: failedPostings ? 'DEGRADED' : 'HEALTHY',
    });
  } catch (error) {
    logger.error('System health error:', error);
    next(new HttpError(500, 'Failed to load system health.'));
  }
};

const getOperationsGuide = async (req, res) => {
  res.json({
    modules: [
      { module: 'Customer CRM', purpose: 'Manage retention, reactivation, LTV and complaint recovery.', keyActions: ['Review follow-up queue daily', 'Call due-for-refill customers', 'Resolve complaint-heavy customers first'] },
      { module: 'Business Intelligence', purpose: 'Executive decision intelligence across growth, operations, finance and plant risks.', keyActions: ['Review recommendations weekly', 'Investigate negative margin/risk alerts', 'Separate actuals from projections'] },
      { module: 'Plant Reliability', purpose: 'Control stock, maintenance, uptime, safety and plant profitability.', keyActions: ['Check low-stock plants daily', 'Log maintenance and safety checks', 'Review stock days of cover'] },
      { module: 'Administration', purpose: 'Control configuration, access, data quality and system health.', keyActions: ['Review data quality blockers', 'Resolve missing prices/mappings', 'Audit critical config changes'] },
    ],
  });
};

module.exports = { getControlCenter, getDataQuality, getSystemHealth, getOperationsGuide };
