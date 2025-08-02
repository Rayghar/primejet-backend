// File: src/api/v1/agents/agent.service.js
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const Agent = require('../../../models/agent.model');
const AgentReferralEvent = require('../../../models/agentReferralEvent.model');
const User = require('../../../models/user.model'); // To update user's referredByAgentId
const HttpError = require('../../../utils/HttpError');
const JWT_SECRET = process.env.JWT_SECRET || 'your-default-super-secret-key-for-dev';


// Base URL for your app's deep links (e.g., from Firebase Dynamic Links or custom scheme)
// This should be configured in your .env file.
const BASE_APP_DEEPLINK_URL = process.env.BASE_APP_DEEPLINK_URL || 'https://yourdomain.com/app';
const APP_STORE_LINK = process.env.APP_STORE_LINK || 'https://play.google.com/store/apps/details?id=com.example.yourapp';

const login = async (email, password) => {
  const agent = await Agent.findOne({ email: email.toLowerCase() }).select('+password');
  if (!agent) {
    throw new HttpError(401, 'Invalid email or password.');
  }

  const isMatch = await bcrypt.compare(password, agent.password);
  if (!isMatch) {
    throw new HttpError(401, 'Invalid email or password.');
  }

  const payload = { id: agent.id, role: 'agent' }; // Assign a specific role for agents
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });

  return { 
    token, 
    agent: agent.toObject() // Return agent data without the password
  };
};
// ====================================================================

// ============================= NEW FUNCTION =============================
const getMyPerformance = async (agentId) => {
  const agent = await Agent.findOne({ id: agentId });
  if (!agent) {
    throw new HttpError(404, 'Agent profile not found.');
  }

  const totalClicks = await AgentReferralEvent.countDocuments({ agentId, eventType: 'LINK_CLICK' });
  const totalRegistrations = agent.totalCustomersReferred || 0;
  
  // Find all customers referred by this agent
  const referredUsers = await User.find({ referredByAgentId: agentId }).select('name email createdAt');
  
  // A more complex query would be needed to check their first order status,
  // but for now we will return their registration details.
  const referredCustomers = referredUsers.map(user => ({
      name: user.name,
      email: user.email,
      registrationDate: user.createdAt,
      firstOrderStatus: 'Pending' // This would be populated by a more complex query
  }));

  return {
    agent: agent.toObject(),
    totalClicks,
    totalRegistrations,
    referredCustomers,
  };
};




// Helper to generate a unique agent code
const generateUniqueAgentCode = async (length = 6) => {
  let agentCode;
  let isUnique = false;
  while (!isUnique) {
    agentCode = crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length).toUpperCase();
    const existingAgent = await Agent.findOne({ agentCode });
    if (!existingAgent) {
      isUnique = true;
    }
  }
  return agentCode;
};

// Admin: Create a new agent
const createAgent = async (agentData) => {
  const { name, email, phone, password, agentCode: providedAgentCode, isActive } = agentData;

  // Check for uniqueness of email, phone, and agentCode
  const existingAgentByPhone = await Agent.findOne({ phone });
  if (existingAgentByPhone) {
    throw new HttpError(409, 'Agent with this phone number already exists.');
  }
  if (email) {
    const existingAgentByEmail = await Agent.findOne({ email });
    if (existingAgentByEmail) {
      throw new HttpError(409, 'Agent with this email already exists.');
    }
  }

  const agentCodeToUse = providedAgentCode ? providedAgentCode.toUpperCase() : await generateUniqueAgentCode();
  const existingAgentByCode = await Agent.findOne({ agentCode: agentCodeToUse });
  if (existingAgentByCode) {
    throw new HttpError(409, `Agent code '${agentCodeToUse}' already exists. Please choose another.`);
  }

  const referralLink = `${BASE_APP_DEEPLINK_URL}/agent_onboard?agentCode=${agentCodeToUse}`;

  const newAgent = new Agent({
    id: uuidv4(),
    name,
    email,
    phone,
    password, // Pass the plain password here
    agentCode: agentCodeToUse,
    referralLink: `${BASE_APP_DEEPLINK_URL}/agent_onboard?agentCode=${agentCodeToUse}`,
    isActive,
  });

  await newAgent.save();
  return newAgent.toObject();
};

// Admin: Get all agents with pagination and search
const getAgents = async ({ page = 1, limit = 10, search = '', isActive }) => {
  const query = {};
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    query.$or = [
      { name: searchRegex },
      { email: searchRegex },
      { phone: searchRegex },
      { agentCode: searchRegex },
    ];
  }
  if (typeof isActive === 'boolean') {
    query.isActive = isActive;
  }

  const totalAgents = await Agent.countDocuments(query);
  const agents = await Agent.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  return {
    agents: agents.map(agent => agent.toObject()),
    currentPage: page,
    totalPages: Math.ceil(totalAgents / limit),
    totalAgents,
  };
};

// Admin: Get a single agent by ID
const getAgentById = async (agentId) => {
  const agent = await Agent.findOne({ id: agentId });
  if (!agent) {
    throw new HttpError(404, 'Agent not found.');
  }
  return agent.toObject();
};

// Admin: Update an agent
const updateAgent = async (agentId, updateData) => {
  const agent = await Agent.findOne({ id: agentId });
  if (!agent) {
    throw new HttpError(404, 'Agent not found for update.');
  }

  // Handle uniqueness checks for email, phone, agentCode if they are being updated
  if (updateData.phone && updateData.phone !== agent.phone) {
    const existingAgent = await Agent.findOne({ phone: updateData.phone, id: { $ne: agentId } });
    if (existingAgent) throw new HttpError(409, 'Phone number is already used by another agent.');
  }
  if (updateData.email && updateData.email !== agent.email) {
    const existingAgent = await Agent.findOne({ email: updateData.email, id: { $ne: agentId } });
    if (existingAgent) throw new HttpError(409, 'Email is already used by another agent.');
  }
  if (updateData.agentCode && updateData.agentCode.toUpperCase() !== agent.agentCode) {
    const existingAgent = await Agent.findOne({ agentCode: updateData.agentCode.toUpperCase(), id: { $ne: agentId } });
    if (existingAgent) throw new HttpError(409, 'Agent code is already in use.');
    updateData.agentCode = updateData.agentCode.toUpperCase(); // Ensure uppercase
    // If agent code changes, the referralLink needs to be updated too
    updateData.referralLink = `${BASE_APP_DEEPLINK_URL}/agent_onboard?agentCode=${updateData.agentCode}`;
  }

  Object.keys(updateData).forEach(key => {
    if (updateData[key] !== undefined && key !== 'id' && key !== 'referralLink' && key !== 'totalCustomersReferred') {
      agent[key] = updateData[key];
    }
  });

  await agent.save();
  return agent.toObject();
};

// Admin: Delete an agent
const deleteAgent = async (agentId) => {
  const agent = await Agent.findOneAndDelete({ id: agentId });
  if (!agent) {
    throw new HttpError(404, 'Agent not found for deletion.');
  }
  // Optional: Also delete associated AgentReferralEvents if desired
  await AgentReferralEvent.deleteMany({ agentId });
  return { message: 'Agent and associated referral events deleted successfully.' };
};

// Public: Track a link click
const trackAgentLinkClick = async (agentCode, metadata = {}) => {
  const agent = await Agent.findOne({ agentCode: agentCode.toUpperCase() });
  if (!agent) {
    console.warn(`[AGENT_SERVICE] Agent code '${agentCode}' not found for link click tracking.`);
    return null; // Or throw HttpError if you want to indicate invalid code
  }

  const event = new AgentReferralEvent({
    id: uuidv4(),
    agentId: agent.id,
    eventType: 'LINK_CLICK',
    metadata: {
      ...metadata,
      userAgent: metadata.userAgent || 'unknown', // Example: capture user agent
      ipAddress: metadata.ipAddress || 'unknown', // Example: capture IP
    },
  });
  await event.save();
  console.log(`[AGENT_SERVICE] Logged LINK_CLICK for agent ${agent.id}.`);
  return agent; // Return the agent to allow redirection
};

// Internal: Mark customer as registered via agent
const markCustomerRegisteredByAgent = async (agentCode, customerId) => {
  const agent = await Agent.findOne({ agentCode: agentCode.toUpperCase() });
  if (!agent) {
    console.warn(`[AGENT_SERVICE] Agent code '${agentCode}' not found when marking customer ${customerId} as registered.`);
    return;
  }

  // Check if this customer has already been attributed to this agent
  const existingEvent = await AgentReferralEvent.findOne({
    agentId: agent.id,
    customerId: customerId,
    eventType: 'CUSTOMER_REGISTERED',
  });

  if (existingEvent) {
    console.log(`[AGENT_SERVICE] Customer ${customerId} already registered via agent ${agent.id}. Skipping duplicate event.`);
    return;
  }

  // Update agent's totalCustomersReferred count
  agent.totalCustomersReferred = (agent.totalCustomersReferred || 0) + 1;
  await agent.save();

  // Log the customer registration event
  const event = new AgentReferralEvent({
    id: uuidv4(),
    agentId: agent.id,
    customerId: customerId,
    eventType: 'CUSTOMER_REGISTERED',
  });
  await event.save();
  console.log(`[AGENT_SERVICE] Logged CUSTOMER_REGISTERED for customer ${customerId} via agent ${agent.id}.`);
};

// Admin: Get agent performance report (simple)
const getAgentPerformance = async (agentId) => {
  const agent = await Agent.findOne({ id: agentId });
  if (!agent) {
    throw new HttpError(404, 'Agent not found.');
  }

  const totalClicks = await AgentReferralEvent.countDocuments({ agentId, eventType: 'LINK_CLICK' });
  const totalRegistrations = await AgentReferralEvent.countDocuments({ agentId, eventType: 'CUSTOMER_REGISTERED' });

  return {
    agent: agent.toObject(),
    totalClicks,
    totalRegistrations,
    conversionRate: totalClicks > 0 ? (totalRegistrations / totalClicks) * 100 : 0,
  };
};


module.exports = {
  login,
  getMyPerformance,
  generateUniqueAgentCode,
  createAgent,
  getAgents,
  getAgentById,
  updateAgent,
  deleteAgent,
  trackAgentLinkClick,
  markCustomerRegisteredByAgent,
  getAgentPerformance,
};