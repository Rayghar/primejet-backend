// File: src/api/v1/agents/agent.routes.js
const express = require('express');
const agentController = require('./agent.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { createAgentSchema, updateAgentSchema, getAgentsQuerySchema, agentLoginSchema } = require('./agent.validation');

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
  '/referred-customers',
  authMiddleware('admin'), // Secure this endpoint for admins
  agentController.getAllReferredCustomers
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

router.post(
  '/login',
  validate(agentLoginSchema),
  agentController.login
);

router.get(
  '/summary/campaign',
  authMiddleware('admin'), // Secure for admins only
  agentController.getCampaignSummary
);


console.log('[AGENT_ROUTES] Agent routes registered.');

module.exports = router;