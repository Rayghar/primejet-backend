const express = require('express');
const router = express.Router();
const auth = require('../../../middleware/auth.middleware');
const controller = require('./historicalMigration.controller');
const { requirePermission } = require('../../../middleware/permission.middleware');

router.get('/template', auth(['admin', 'manager', 'finance_lead']), requirePermission('migration.view'), controller.getTemplate);
router.get('/batches', auth(['admin', 'manager', 'finance_lead']), requirePermission('migration.view'), controller.listBatches);
router.post('/batches', auth(['admin', 'manager', 'finance_lead']), requirePermission('migration.upload'), controller.createBatch);
router.get('/batches/:batchId', auth(['admin', 'manager', 'finance_lead']), requirePermission('migration.view'), controller.getBatch);
router.patch('/staging/:recordId', auth(['admin', 'manager', 'finance_lead']), requirePermission('migration.validate'), controller.updateStagingRecord);
router.post('/batches/:batchId/dry-run', auth(['admin', 'manager', 'finance_lead']), requirePermission('migration.validate'), controller.dryRun);
router.post('/repair-tender-splits', auth(['admin', 'finance_lead']), requirePermission('migration.import'), controller.repairTenderSplits);
router.get('/repair-tender-splits/jobs', auth(['admin', 'finance_lead']), requirePermission('migration.import'), controller.listTenderRepairJobs);
router.post('/repair-tender-splits/jobs', auth(['admin', 'finance_lead']), requirePermission('migration.import'), controller.startTenderRepairJob);
router.get('/repair-tender-splits/jobs/:jobId', auth(['admin', 'finance_lead']), requirePermission('migration.import'), controller.getTenderRepairJob);
router.post('/batches/:batchId/import', auth(['admin', 'manager', 'finance_lead']), requirePermission('migration.import'), controller.importBatch);

module.exports = router;
