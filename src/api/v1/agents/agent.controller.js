// File: src/api/v1/agents/agent.controller.js
const agentService = require('./agent.service');
const HttpError = require('../../../utils/HttpError');

// Admin: Create Agent
const createAgent = async (req, res, next) => {
  try {
    const newAgent = await agentService.createAgent(req.body);
    res.status(201).json({ message: 'Agent created successfully.', agent: newAgent });
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await agentService.login(email, password);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// Admin: Get All Agents
const getAgents = async (req, res, next) => {
  try {
    const { page, limit, search, isActive } = req.query;
    const result = await agentService.getAgents({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      search,
      isActive: isActive !== undefined ? (isActive === 'true') : undefined, // Convert string to boolean
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// Admin: Get Single Agent by ID
const getAgentById = async (req, res, next) => {
  try {
    const agent = await agentService.getAgentById(req.params.agentId);
    res.status(200).json(agent);
  } catch (error) {
    next(error);
  }
};

// Admin: Update Agent
const updateAgent = async (req, res, next) => {
  try {
    const updatedAgent = await agentService.updateAgent(req.params.agentId, req.body);
    res.status(200).json({ message: 'Agent updated successfully.', agent: updatedAgent });
  } catch (error) {
    next(error);
  }
};

// Admin: Delete Agent
const deleteAgent = async (req, res, next) => {
  try {
    const result = await agentService.deleteAgent(req.params.agentId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const getAllReferredCustomers = async (req, res, next) => {
  try {
    const { page, limit, search } = req.query;
    const result = await agentService.getAllReferredCustomers({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 15,
      search,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// Public: Track Agent Referral Link Click
const trackAgentLink = async (req, res, next) => {
  try {
    const { agentCode } = req.params;
    // Capture metadata about the click (IP, user-agent)
    const metadata = {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      referrer: req.headers['referer'],
    };
    const agent = await agentService.trackAgentLinkClick(agentCode, metadata);

    // Redirect to the app store link (or a Firebase Dynamic Link for app install)
    const APP_STORE_LINK = process.env.APP_STORE_LINK || 'https://play.google.com/store/apps/details?id=com.example.yourapp';
    res.redirect(APP_STORE_LINK); // Always redirect to app store, even on error
  } catch (error) {
    // If agent code is not found, or other error, redirect to a generic page or app store
    console.error(`Error tracking agent link or agent not found: ${error.message}`);
    const APP_STORE_LINK = process.env.APP_STORE_LINK || 'https://play.google.com/store/apps/details?id=com.example.yourapp';
    res.redirect(APP_STORE_LINK); // Always redirect to app store, even on error
  }
};


module.exports = {
  createAgent,
  getAgents,
  getAgentById,
  updateAgent,
  deleteAgent,
  trackAgentLink,
  login,
  getAllReferredCustomers,
};