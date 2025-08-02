// File: src/api/v1/agents/agent.routes.js
const express = require('express');
const agentController = require('./agent.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { createAgentSchema, updateAgentSchema, getAgentsQuerySchema, agentLoginSchema } = require('./agent.validation');

const router = express.Router();

// ============================= NEW ROUTES =============================
// Public route for agents to log in
router.post('/login', validate(agentLoginSchema), agentController.login);

// Protected route for an agent to get their own performance data
router.get('/me/performance', authMiddleware('agent'), agentController.getMyPerformance);
// ====================================================================

// Public route for tracking agent referral links
router.get('/track/:agentCode', agentController.trackAgentLink);

// Admin routes for managing agents
router.post('/', authMiddleware('admin'), validate(createAgentSchema), agentController.createAgent);
router.get('/', authMiddleware('admin'), validate(getAgentsQuerySchema, 'query'), agentController.getAgents);
router.get('/:agentId', authMiddleware('admin'), agentController.getAgentById);
router.put('/:agentId', authMiddleware('admin'), validate(updateAgentSchema), agentController.updateAgent);
router.delete('/:agentId', authMiddleware('admin'), agentController.deleteAgent);

module.exports = router;
