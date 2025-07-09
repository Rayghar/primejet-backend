// File: src/api/v1/agents/agent.routes.js
const express = require('express');
const agentController = require('./agent.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { createAgentSchema, updateAgentSchema, getAgentsQuerySchema } = require('./agent.validation');

const router = express.Router();

console.log('[AGENT_ROUTES] Registering agent routes...');

// Public route for tracking agent referral links (no auth needed for click tracking)
router.get(
  '/track/:agentCode',
  agentController.trackAgentLink // Handle link clicks and redirect
);

// Admin routes for managing agents
router.post(
  '/',
  authMiddleware('admin'),
  validate(createAgentSchema),
  agentController.createAgent
);

router.get(
  '/',
  authMiddleware('admin'),
  validate(getAgentsQuerySchema, 'query'), // Validate query parameters for list
  agentController.getAgents
);

router.get(
  '/:agentId',
  authMiddleware('admin'),
  agentController.getAgentById
);

router.put(
  '/:agentId',
  authMiddleware('admin'),
  validate(updateAgentSchema),
  agentController.updateAgent
);

router.delete(
  '/:agentId',
  authMiddleware('admin'),
  agentController.deleteAgent
);


console.log('[AGENT_ROUTES] Agent routes registered.');

module.exports = router;