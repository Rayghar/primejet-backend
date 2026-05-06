// File: src/api/v2/whatsapp/whatsapp.service.js
const https = require('https');
const Config = require('../../../models/config.model');
const Order = require('../../../models/order.model');
const User = require('../../../models/user.model');
const SupportTicket = require('../../../models/supportTicket.model');
const WhatsAppContact = require('../../../models/whatsappContact.model');
const WhatsAppMessageLog = require('../../../models/whatsappMessageLog.model');
const WhatsAppActionRequest = require('../../../models/whatsappActionRequest.model');
const WhatsAppOrderDraft = require('../../../models/whatsappOrderDraft.model');
const Notification = require('../../../models/notification.model');
const { logger } = require('../../../config/logger.config');

const DEFAULT_GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v20.0';

const normalizePhone = (phone = '') => String(phone || '').replace(/[^0-9]/g, '');
const lastDigits = (phone = '', count = 10) => normalizePhone(phone).slice(-count);
const money = (value) => `₦${Number(value || 0).toLocaleString('en-NG')}`;

const DEFAULT_CONFIG_ON_INSERT = {
  systemName: 'PrimeJet Gas Delivery Configuration',
  feeSettings: {
    vatPercentage: 7.5,
    serviceFeePercentage: 2.5,
    baseDeliveryFee: 500,
    expressDeliverySurcharge: 200,
  },
  routingSettings: {
    maxPickupWindowMinutes: 60,
    maxBatchWeightKg: 500,
  },
};

const DEFAULT_WHATSAPP_SETTINGS = {
  enabled: false,
  mode: 'DRY_RUN',
  graphVersion: DEFAULT_GRAPH_VERSION,
  businessAccountId: '',
  phoneNumberId: '',
  displayPhoneNumber: '',
  webhookVerifyToken: '',
  webhookCallbackUrl: '',
  accessToken: '',
  appSecret: '',
  defaultCountryCode: '234',
  signatureValidationRequired: false,
  welcomeMessage: 'Welcome to PrimeJet Gas 👋',
  mainMenuText: '',
  fallbackMessage: 'Thank you. I did not fully understand that yet.\nReply 1 for order status, 2 for refill, 3 for payment help, 4 for complaint, or 5 for support.',
  businessHoursMessage: '',
  afterHoursMessage: 'We are currently outside business hours. Your request has been received and our team will follow up.',
  orderStatusKeywords: ['1', 'status', 'order status', 'track', 'track order'],
  refillKeywords: ['2', 'order', 'new order', 'refill', 'gas', 'buy gas', 'reorder'],
  paymentKeywords: ['3', 'payment', 'wallet', 'pay', 'refund'],
  complaintKeywords: ['4', 'complaint', 'issue', 'problem', 'report'],
  supportKeywords: ['5', 'support', 'agent', 'human', 'representative'],
  requireAdminReview: true,
  autoCreateCustomer: true,
  defaultPaymentMethod: 'TRANSFER',
  defaultCity: 'Lagos',
  defaultState: 'Lagos',
  allowedCylinderSizes: [3, 5, 6, 12.5, 25, 50],
  minimumOrderFields: ['cylinderSizeKg', 'quantity', 'addressText', 'customerPhone', 'paymentPreference'],
  teamRouting: {
    GENERAL_MENU: 'BOT',
    ORDER_STATUS: 'BOT',
    NEW_ORDER: 'SALES',
    ORDER_DRAFT: 'SALES',
    ORDER_DRAFT_CONFIRMED: 'SALES',
    PAYMENT_HELP: 'FINANCE',
    COMPLAINT: 'SUPPORT',
    SPEAK_TO_AGENT: 'SUPPORT',
    UNKNOWN: 'SUPPORT',
  },
  templates: {
    orderConfirmation: '',
    paymentReminder: '',
    deliveryUpdate: '',
    complaintAcknowledgement: '',
    languageCode: 'en',
  },
};

const isMaskedSecret = (value) => {
  const text = String(value || '');
  return !text || text.includes('•') || text.startsWith('***') || text === '__UNCHANGED__';
};

const maskSecret = (value) => {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '••••••••';
  return `${text.slice(0, 4)}••••••••${text.slice(-4)}`;
};

const cleanArray = (value, fallback = []) => {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
  return fallback;
};

const normalizeMode = (mode) => {
  const value = String(mode || '').toUpperCase();
  if (['DISABLED', 'DRY_RUN', 'LIVE'].includes(value)) return value;
  return 'DRY_RUN';
};

const getSavedWhatsAppSettings = async () => {
  const doc = await Config.findOne().select('whatsappSettings').lean().catch((error) => {
    logger.warn('[WHATSAPP] Failed to load DB settings; falling back to environment variables', { error: error.message });
    return null;
  });
  return doc?.whatsappSettings || {};
};

const getConfig = async () => {
  const saved = await getSavedWhatsAppSettings();
  const merged = {
    ...DEFAULT_WHATSAPP_SETTINGS,
    ...saved,
    graphVersion: saved.graphVersion || process.env.WHATSAPP_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
    webhookVerifyToken: saved.webhookVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
    accessToken: saved.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: saved.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    businessAccountId: saved.businessAccountId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    appSecret: saved.appSecret || process.env.WHATSAPP_APP_SECRET || '',
    teamRouting: { ...DEFAULT_WHATSAPP_SETTINGS.teamRouting, ...(saved.teamRouting || {}) },
    templates: { ...DEFAULT_WHATSAPP_SETTINGS.templates, ...(saved.templates || {}) },
  };
  merged.mode = normalizeMode(saved.mode || process.env.WHATSAPP_MODE || merged.mode);
  if (!merged.enabled || merged.mode === 'DISABLED') {
    merged.effectiveMode = 'DISABLED';
    merged.dryRun = true;
  } else if (merged.mode !== 'LIVE' || !merged.accessToken || !merged.phoneNumberId) {
    merged.effectiveMode = 'DRY_RUN';
    merged.dryRun = true;
  } else {
    merged.effectiveMode = 'LIVE';
    merged.dryRun = false;
  }
  return merged;
};

const getPublicBaseUrl = (req) => {
  if (!req) return process.env.PUBLIC_BACKEND_URL || '';
  const forwardedProto = req.get?.('x-forwarded-proto');
  const proto = forwardedProto || req.protocol || 'https';
  const host = req.get?.('host');
  return host ? `${proto}://${host}` : (process.env.PUBLIC_BACKEND_URL || '');
};

const buildWebhookUrl = (req, saved = {}) => saved.webhookCallbackUrl || (getPublicBaseUrl(req) ? `${getPublicBaseUrl(req)}/api/v2/whatsapp/webhook` : '');

const sanitizeSettingsForClient = (settings = {}, req) => {
  const merged = { ...DEFAULT_WHATSAPP_SETTINGS, ...settings, teamRouting: { ...DEFAULT_WHATSAPP_SETTINGS.teamRouting, ...(settings.teamRouting || {}) }, templates: { ...DEFAULT_WHATSAPP_SETTINGS.templates, ...(settings.templates || {}) } };
  const hasAccessToken = !!(settings.accessToken || process.env.WHATSAPP_ACCESS_TOKEN);
  const hasAppSecret = !!(settings.appSecret || process.env.WHATSAPP_APP_SECRET);
  return {
    ...merged,
    webhookCallbackUrl: buildWebhookUrl(req, merged),
    accessToken: hasAccessToken ? maskSecret(settings.accessToken || process.env.WHATSAPP_ACCESS_TOKEN) : '',
    appSecret: hasAppSecret ? maskSecret(settings.appSecret || process.env.WHATSAPP_APP_SECRET) : '',
    hasAccessToken,
    hasAppSecret,
  };
};

const buildSettingsUpdate = (payload = {}, existing = {}) => {
  const allowed = [
    'enabled', 'mode', 'graphVersion', 'businessAccountId', 'phoneNumberId', 'displayPhoneNumber',
    'webhookVerifyToken', 'webhookCallbackUrl', 'accessToken', 'appSecret', 'defaultCountryCode',
    'signatureValidationRequired', 'welcomeMessage', 'mainMenuText', 'fallbackMessage',
    'businessHoursMessage', 'afterHoursMessage', 'orderStatusKeywords', 'refillKeywords',
    'paymentKeywords', 'complaintKeywords', 'supportKeywords', 'requireAdminReview',
    'autoCreateCustomer', 'defaultPaymentMethod', 'defaultCity', 'defaultState',
    'allowedCylinderSizes', 'minimumOrderFields', 'teamRouting', 'templates',
  ];
  const update = {};
  allowed.forEach((key) => {
    if (payload[key] === undefined) return;
    if (['accessToken', 'appSecret'].includes(key) && isMaskedSecret(payload[key])) return;
    if (key === 'mode') update[key] = normalizeMode(payload[key]);
    else if (['orderStatusKeywords', 'refillKeywords', 'paymentKeywords', 'complaintKeywords', 'supportKeywords', 'minimumOrderFields'].includes(key)) update[key] = cleanArray(payload[key], existing[key] || DEFAULT_WHATSAPP_SETTINGS[key]);
    else if (key === 'allowedCylinderSizes') update[key] = (Array.isArray(payload[key]) ? payload[key] : String(payload[key] || '').split(',')).map(Number).filter((v) => Number.isFinite(v) && v > 0);
    else if (typeof payload[key] === 'object' && payload[key] !== null && !Array.isArray(payload[key])) update[key] = { ...(existing[key] || {}), ...payload[key] };
    else update[key] = payload[key];
  });
  return update;
};

const updateWebhookRuntimeStatus = async (updates = {}) => {
  const $set = {};
  Object.entries(updates).forEach(([key, value]) => { $set[`whatsappSettings.${key}`] = value; });
  return Config.findOneAndUpdate(
    {},
    { $set, $setOnInsert: DEFAULT_CONFIG_ON_INSERT },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).catch((error) => logger.warn('[WHATSAPP] Failed to update runtime status', { error: error.message }));
};

const buildMenuText = () => [
  'Welcome to PrimeJet Gas 👋',
  '',
  'Reply with a number:',
  '1. Check my order status',
  '2. Start a new gas order / refill request',
  '3. Payment or wallet help',
  '4. Report a complaint',
  '5. Speak to support',
  '',
  'You can also type: menu, status, order, refill, complaint, support.',
].join('\n');

const keywordMatch = (value, keywords = []) => {
  const normalized = String(value || '').trim().toLowerCase();
  return (keywords || []).some((keyword) => {
    const item = String(keyword || '').trim().toLowerCase();
    return item && (normalized === item || normalized.startsWith(`${item} `));
  });
};

const mapIntent = (text = '', config = {}) => {
  const value = String(text || '').trim().toLowerCase();
  if (!value || ['hi', 'hello', 'hey', 'menu', 'start', '0'].includes(value)) return 'GENERAL_MENU';
  if (keywordMatch(value, config.orderStatusKeywords || ['1', 'status', 'order status', 'track', 'track order']) || value.startsWith('status ')) return 'ORDER_STATUS';
  if (keywordMatch(value, config.refillKeywords || ['2', 'order', 'new order', 'refill', 'gas', 'buy gas', 'reorder'])) return 'NEW_ORDER';
  if (['confirm', 'yes', 'submit'].includes(value)) return 'ORDER_DRAFT_CONFIRMED';
  if (['cancel', 'stop'].includes(value)) return 'CANCEL_FLOW';
  if (['edit', 'change'].includes(value)) return 'EDIT_FLOW';
  if (keywordMatch(value, config.paymentKeywords || ['3', 'payment', 'wallet', 'pay', 'refund'])) return 'PAYMENT_HELP';
  if (keywordMatch(value, config.complaintKeywords || ['4', 'complaint', 'issue', 'problem', 'report'])) return 'COMPLAINT';
  if (keywordMatch(value, config.supportKeywords || ['5', 'support', 'agent', 'human', 'representative'])) return 'SPEAK_TO_AGENT';
  return 'UNKNOWN';
};

const extractInboundMessages = (payload = {}) => {
  const messages = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change.value || {};
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const contactsByWaId = new Map(contacts.map((c) => [c.wa_id, c]));
      const inbound = Array.isArray(value.messages) ? value.messages : [];
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      inbound.forEach((message) => {
        const contact = contactsByWaId.get(message.from) || {};
        const text = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';
        const interactiveId = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || message.button?.payload;
        messages.push({
          kind: 'message',
          providerMessageId: message.id,
          waId: message.from,
          phone: normalizePhone(message.from),
          profileName: contact.profile?.name || '',
          messageType: (message.type || 'text').toUpperCase(),
          text: interactiveId || text,
          displayText: text,
          rawPayload: message,
        });
      });
      statuses.forEach((status) => {
        messages.push({
          kind: 'status',
          providerMessageId: status.id,
          waId: status.recipient_id,
          phone: normalizePhone(status.recipient_id),
          messageType: 'STATUS',
          status: String(status.status || '').toUpperCase(),
          rawPayload: status,
        });
      });
    }
  }
  return messages;
};

const httpPostJson = ({ hostname, path, headers, body }) => new Promise((resolve, reject) => {
  const payload = JSON.stringify(body);
  const req = https.request(
    { method: 'POST', hostname, path, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } },
    (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : {}; } catch (_e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const err = new Error(`WhatsApp API failed with HTTP ${res.statusCode}`);
        err.response = parsed;
        return reject(err);
      });
    }
  );
  req.on('error', reject);
  req.write(payload);
  req.end();
});

const httpGetJson = ({ hostname, path, headers }) => new Promise((resolve, reject) => {
  const req = https.request(
    { method: 'GET', hostname, path, headers: { 'Content-Type': 'application/json', ...headers } },
    (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : {}; } catch (_e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const err = new Error(`WhatsApp API failed with HTTP ${res.statusCode}`);
        err.response = parsed;
        return reject(err);
      });
    }
  );
  req.on('error', reject);
  req.end();
});

const sendTextMessage = async (to, text, options = {}) => {
  const config = await getConfig();
  const phone = normalizePhone(to);
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'text',
    text: { preview_url: false, body: String(text || '').slice(0, 4000) },
  };

  const log = await WhatsAppMessageLog.create({
    waId: phone,
    phone,
    direction: 'OUTBOUND',
    messageType: options.messageType || 'TEXT',
    text,
    intent: options.intent,
    status: config.dryRun ? 'DRY_RUN' : 'QUEUED',
    sentPayload: body,
  });

  if (config.effectiveMode === 'DISABLED') return { dryRun: true, disabled: true, logId: log.id, payload: body };
  if (config.dryRun) return { dryRun: true, logId: log.id, payload: body };

  try {
    const response = await httpPostJson({
      hostname: 'graph.facebook.com',
      path: `/${config.graphVersion}/${config.phoneNumberId}/messages`,
      headers: { Authorization: `Bearer ${config.accessToken}` },
      body,
    });
    log.status = 'SENT';
    log.providerMessageId = response?.messages?.[0]?.id || log.providerMessageId;
    await log.save();
    return { dryRun: false, response, logId: log.id };
  } catch (error) {
    log.status = 'FAILED';
    log.errorMessage = error.message;
    await log.save();
    logger.error('[WHATSAPP] Failed to send message', { error: error.message, response: error.response });
    return { dryRun: false, failed: true, error: error.message, response: error.response, logId: log.id };
  }
};

const findCustomerByPhone = async (phone) => {
  const suffix = lastDigits(phone);
  if (!suffix) return null;
  return User.findOne({ role: 'customer', phone: { $regex: `${suffix}$` } }).lean();
};

const findLatestOrderForPhone = async (phone, customerId) => {
  const suffix = lastDigits(phone);
  const or = [];
  if (customerId) or.push({ customerId });
  if (suffix) or.push({ recipientPhone: { $regex: `${suffix}$` } });
  if (!or.length) return null;
  return Order.findOne({ $or: or }).sort({ createdAt: -1 }).lean();
};

const findOrderByText = async (text, phone, customerId) => {
  const raw = String(text || '').trim();
  const tokens = raw.split(/\s+/).filter(Boolean);
  const candidate = tokens[tokens.length - 1];
  if (candidate && candidate.length >= 5 && !['status', 'track', 'order'].includes(candidate.toLowerCase())) {
    const suffix = lastDigits(phone);
    const or = [{ id: candidate }, { id: { $regex: `${candidate}$`, $options: 'i' } }];
    const filter = { $or: or };
    const order = await Order.findOne(filter).sort({ createdAt: -1 }).lean();
    if (order && (order.customerId === customerId || lastDigits(order.recipientPhone) === suffix)) return order;
  }
  return findLatestOrderForPhone(phone, customerId);
};

const buildOrderStatusReply = (order) => {
  if (!order) {
    return [
      'I could not find a recent order linked to this WhatsApp number.',
      'Please reply with 5 to speak to support, or send “status” followed by your order ID if you have it.',
    ].join('\n');
  }
  const amount = Number(order.grandTotal || order.finalAmountPaid || 0).toLocaleString('en-NG');
  const address = order.deliveryAddressSnapshot?.fullAddress || 'Address not available';
  return [
    `Order Status: ${order.status}`,
    `Order ID: ${order.id}`,
    `Payment: ${order.paymentStatus}`,
    `Amount: ₦${amount}`,
    `Address: ${address}`,
    order.estimatedDeliveryTime ? `ETA: ${new Date(order.estimatedDeliveryTime).toLocaleString()}` : '',
    '',
    'Reply 2 to start another refill, 4 to report a complaint, or 5 to speak to support.',
  ].filter(Boolean).join('\n');
};

const createAdminNotification = async ({ title, body, type = 'chat', priority = 'normal', data = {} }) => {
  const admins = await User.find({ role: 'admin', status: 'active' }).select('id').lean();
  const docs = admins.map((admin) => ({ userId: admin.id, title, body, type, priority, source: 'whatsapp.business.layer', data, channels: ['in_app'] }));
  if (!docs.length) return [];
  return Notification.insertMany(docs, { ordered: false }).catch(() => []);
};

const createSupportTicketFromWhatsapp = async ({ contact, inboundText, requestType, order }) => {
  const category = requestType === 'PAYMENT_HELP' ? 'PAYMENT_ISSUE' : requestType === 'COMPLAINT' ? 'GENERAL_ENQUIRY' : 'ORDER_UPDATE';
  const subject = requestType === 'PAYMENT_HELP'
    ? 'WhatsApp payment/wallet help request'
    : requestType === 'COMPLAINT'
      ? 'WhatsApp customer complaint'
      : 'WhatsApp support handoff request';

  return SupportTicket.create({
    customerId: contact.linkedCustomerId,
    customerName: contact.linkedCustomerName || contact.profileName || `WhatsApp ${contact.phone}`,
    customerPhone: contact.phone,
    orderId: order?.id,
    sourceType: requestType === 'PAYMENT_HELP' ? 'PAYMENT' : 'CHAT',
    category,
    subject,
    description: inboundText || subject,
    priority: requestType === 'COMPLAINT' ? 'HIGH' : 'MEDIUM',
    severity: requestType === 'COMPLAINT' ? 'HIGH' : 'MEDIUM',
    assignedTeam: requestType === 'PAYMENT_HELP' ? 'FINANCE' : 'SUPPORT',
    notes: [{ text: `Created from WhatsApp conversation. Customer wrote: ${inboundText || ''}`, noteType: 'SYSTEM' }],
    activity: [{ action: 'CREATED_FROM_WHATSAPP', note: inboundText || '' }],
  });
};

const upsertContact = async ({ waId, phone, profileName }) => {
  const customer = await findCustomerByPhone(phone);
  const update = {
    waId,
    phone,
    profileName: profileName || undefined,
    linkedCustomerId: customer?.id,
    linkedCustomerName: customer?.name,
    lastMessageAt: new Date(),
  };
  return WhatsAppContact.findOneAndUpdate(
    { waId },
    { $set: update, $setOnInsert: { status: 'ACTIVE', optInStatus: 'UNKNOWN' } },
    { new: true, upsert: true }
  );
};

const parseOrderDraftDetails = (text = '') => {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();
  const kgMatch = lower.match(/(3|5|6|12\.5|12|25|50)\s*kg/);
  const qtyMatch = lower.match(/(?:x|qty|quantity|units?|cylinders?)\s*(\d+)/) || lower.match(/^(\d+)\s*(?:x|units?|cylinders?)/);
  const amountMatch = lower.match(/(?:amount|budget|price|total)\s*[:=-]?\s*([0-9,]+)/);
  const paymentMatch = lower.match(/\b(transfer|cash|pos|wallet|paystack|card)\b/);
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const deliveryArea = parts.length > 1 ? parts.slice(1).join(', ') : undefined;
  const addressText = /address\s*[:=-]/i.test(raw) ? raw.split(/address\s*[:=-]/i).pop().trim() : undefined;
  const size = kgMatch ? Number(kgMatch[1]) : undefined;
  return {
    cylinderSizeKg: size,
    quantity: qtyMatch ? Number(qtyMatch[1]) : undefined,
    productText: size ? `${size}kg LPG refill` : undefined,
    deliveryArea,
    addressText: addressText || deliveryArea,
    estimatedAmount: amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : undefined,
    paymentPreference: paymentMatch
      ? { transfer: 'TRANSFER', cash: 'CASH_ON_DELIVERY', pos: 'POS_ON_DELIVERY', wallet: 'WALLET', paystack: 'PAYSTACK_LINK', card: 'PAYSTACK_LINK' }[paymentMatch[1]]
      : undefined,
  };
};

const evaluateDraft = (draft) => {
  const issues = [];
  if (!draft.cylinderSizeKg) issues.push('Cylinder/refill size is missing');
  if (!draft.quantity || draft.quantity < 1) issues.push('Quantity is missing');
  if (!draft.addressText && !draft.deliveryArea) issues.push('Delivery area/address is missing');
  const score = Math.max(0, 100 - issues.length * 30 - (!draft.linkedCustomerId && !draft.customerId ? 10 : 0));
  return { issues, score };
};

const summarizeDraft = (draft) => [
  `Refill request summary (${draft.draftNo})`,
  `Product: ${draft.productText || `${draft.cylinderSizeKg || '?'}kg LPG refill`}`,
  `Quantity: ${draft.quantity || '?'}`,
  `Delivery area/address: ${draft.addressText || draft.deliveryArea || 'Not provided'}`,
  `Payment preference: ${draft.paymentPreference || 'UNKNOWN'}`,
  draft.estimatedAmount ? `Estimated amount: ${money(draft.estimatedAmount)}` : '',
].filter(Boolean).join('\n');

const getOpenDraftForPhone = async (phone) => WhatsAppOrderDraft.findOne({
  phone: normalizePhone(phone),
  status: { $in: ['OPEN', 'READY'] },
  stage: { $nin: ['CANCELLED', 'CONVERTED_TO_ORDER'] },
}).sort({ updatedAt: -1 });

const ensureActionRequestForDraft = async ({ contact, draft, inboundText }) => {
  if (draft.requestId) return WhatsAppActionRequest.findOne({ id: draft.requestId });
  const request = await WhatsAppActionRequest.create({
    waId: contact.waId,
    phone: contact.phone,
    customerId: contact.linkedCustomerId,
    customerName: contact.linkedCustomerName || contact.profileName,
    orderDraftId: draft.id,
    requestType: 'ORDER_DRAFT',
    status: draft.status === 'SUBMITTED' ? 'OPEN' : 'WAITING_CUSTOMER',
    priority: 'HIGH',
    assignedTeam: 'SALES',
    subject: `WhatsApp refill request ${draft.draftNo}`,
    lastInboundText: inboundText,
    botResponse: summarizeDraft(draft),
    metadata: { draftStage: draft.stage, draftNo: draft.draftNo },
    activity: [{ action: 'ORDER_DRAFT_CREATED', note: inboundText }],
  });
  draft.requestId = request.id;
  await draft.save();
  return request;
};

const startOrContinueOrderDraft = async ({ contact, text, confirmation = false, edit = false, cancel = false }) => {
  let draft = await getOpenDraftForPhone(contact.phone);
  if (cancel && draft) {
    draft.status = 'CANCELLED';
    draft.stage = 'CANCELLED';
    draft.cancelledAt = new Date();
    draft.activity.push({ action: 'CUSTOMER_CANCELLED', note: text });
    await draft.save();
    return { draft, reply: 'Your WhatsApp refill request has been cancelled. Reply 2 anytime to start again.' };
  }

  if (!draft || edit) {
    draft = await WhatsAppOrderDraft.create({
      waId: contact.waId,
      phone: contact.phone,
      customerId: contact.linkedCustomerId,
      customerName: contact.linkedCustomerName || contact.profileName,
      customerPhone: contact.phone,
      stage: 'WAITING_DETAILS',
      status: 'OPEN',
      lastCustomerText: text,
      activity: [{ action: edit ? 'CUSTOMER_EDIT_RESTART' : 'DRAFT_STARTED', note: text }],
    });
  }

  if (confirmation) {
    const { issues } = evaluateDraft(draft);
    if (issues.length) {
      draft.stage = issues.includes('Delivery area/address is missing') ? 'WAITING_ADDRESS' : 'WAITING_DETAILS';
      draft.validationIssues = issues;
      await draft.save();
      return { draft, reply: `I still need: ${issues.join(', ')}. Please send details like: 12.5kg refill, Ajah, address: House 4 Example Estate.` };
    }
    draft.status = 'SUBMITTED';
    draft.stage = 'READY_FOR_ADMIN_REVIEW';
    draft.submittedAt = new Date();
    draft.activity.push({ action: 'CUSTOMER_CONFIRMED_DRAFT', note: text });
    const request = await ensureActionRequestForDraft({ contact, draft, inboundText: text });
    request.status = 'OPEN';
    request.requestType = 'ORDER_DRAFT_CONFIRMED';
    request.activity.push({ action: 'CUSTOMER_CONFIRMED_DRAFT', note: draft.draftNo });
    await request.save();
    await draft.save();
    await createAdminNotification({
      title: 'WhatsApp refill request ready for review',
      body: `${draft.customerName || draft.phone}: ${draft.draftNo}`,
      type: 'order',
      priority: 'high',
      data: { draftId: draft.id, requestId: request.id, phone: draft.phone },
    });
    return { draft, request, reply: `Thank you. Your refill request ${draft.draftNo} has been sent to our sales team. They will confirm price, payment and dispatch details shortly.` };
  }

  const parsed = parseOrderDraftDetails(text);
  Object.entries(parsed).forEach(([key, value]) => {
    if (value !== undefined && value !== '') draft[key] = value;
  });
  draft.lastCustomerText = text;
  draft.activity.push({ action: 'CUSTOMER_PROVIDED_DETAILS', note: text });
  const { issues, score } = evaluateDraft(draft);
  draft.validationIssues = issues;
  draft.confidenceScore = score;
  if (issues.length) {
    draft.stage = issues.includes('Delivery area/address is missing') ? 'WAITING_ADDRESS' : 'WAITING_DETAILS';
    await draft.save();
    return { draft, reply: `Please send the missing detail(s): ${issues.join(', ')}. Example: 12.5kg refill x1, Ajah, address: House 4 Example Estate.` };
  }
  draft.stage = 'READY_FOR_CUSTOMER_CONFIRMATION';
  draft.status = 'READY';
  await draft.save();
  await ensureActionRequestForDraft({ contact, draft, inboundText: text });
  return { draft, reply: `${summarizeDraft(draft)}\n\nReply CONFIRM to send this to our sales team, EDIT to change it, or CANCEL to cancel.` };
};

const createActionRequest = async ({ contact, requestType, inboundText, botResponse, order, ticket, draft }) => {
  const subjectMap = {
    GENERAL_MENU: 'Customer opened WhatsApp menu',
    ORDER_STATUS: 'Customer requested order status',
    NEW_ORDER: 'Customer requested new order/refill',
    ORDER_DRAFT: 'Customer is creating a WhatsApp refill request',
    ORDER_DRAFT_CONFIRMED: 'Customer confirmed WhatsApp refill request',
    PAYMENT_HELP: 'Customer requested payment/wallet help',
    COMPLAINT: 'Customer reported complaint',
    SPEAK_TO_AGENT: 'Customer requested human support',
    UNKNOWN: 'Unclassified WhatsApp message',
  };
  return WhatsAppActionRequest.create({
    waId: contact.waId,
    phone: contact.phone,
    customerId: contact.linkedCustomerId,
    customerName: contact.linkedCustomerName || contact.profileName,
    orderId: order?.id,
    supportTicketId: ticket?.id,
    orderDraftId: draft?.id,
    requestType,
    status: ['COMPLAINT', 'SPEAK_TO_AGENT', 'PAYMENT_HELP', 'NEW_ORDER', 'ORDER_DRAFT', 'ORDER_DRAFT_CONFIRMED'].includes(requestType) ? 'OPEN' : 'RESOLVED',
    priority: requestType === 'COMPLAINT' ? 'HIGH' : 'MEDIUM',
    assignedTeam: requestType === 'PAYMENT_HELP' ? 'FINANCE' : ['COMPLAINT', 'SPEAK_TO_AGENT'].includes(requestType) ? 'SUPPORT' : ['NEW_ORDER', 'ORDER_DRAFT', 'ORDER_DRAFT_CONFIRMED'].includes(requestType) ? 'SALES' : 'BOT',
    subject: subjectMap[requestType] || subjectMap.UNKNOWN,
    lastInboundText: inboundText,
    botResponse,
    metadata: { orderStatus: order?.status, paymentStatus: order?.paymentStatus, draftNo: draft?.draftNo },
    activity: [{ action: 'WHATSAPP_INBOUND_PROCESSED', note: inboundText }],
    resolvedAt: ['GENERAL_MENU', 'ORDER_STATUS'].includes(requestType) ? new Date() : undefined,
  });
};

const handleInboundMessage = async (message) => {
  if (!message.providerMessageId) return { skipped: true, reason: 'missing_message_id' };
  const existing = await WhatsAppMessageLog.findOne({ providerMessageId: message.providerMessageId }).lean();
  if (existing) return { skipped: true, reason: 'duplicate_message' };

  const contact = await upsertContact(message);
  const runtimeConfig = await getConfig();
  let intent = mapIntent(message.text, runtimeConfig);

  await WhatsAppMessageLog.create({
    providerMessageId: message.providerMessageId,
    waId: message.waId,
    phone: message.phone,
    direction: 'INBOUND',
    messageType: message.messageType === 'INTERACTIVE' ? 'INTERACTIVE' : 'TEXT',
    text: message.displayText || message.text,
    intent,
    status: 'RECEIVED',
    rawPayload: message.rawPayload,
  });

  let order = null;
  let ticket = null;
  let draft = null;
  let reply = runtimeConfig.mainMenuText || buildMenuText();
  let actionRequest = null;
  const openDraft = await getOpenDraftForPhone(message.phone);

  if (intent === 'CANCEL_FLOW' && openDraft) {
    const result = await startOrContinueOrderDraft({ contact, text: message.displayText || message.text, cancel: true });
    draft = result.draft;
    reply = result.reply;
    intent = 'ORDER_DRAFT';
  } else if (intent === 'EDIT_FLOW' && openDraft) {
    const result = await startOrContinueOrderDraft({ contact, text: message.displayText || message.text, edit: true });
    draft = result.draft;
    reply = 'No problem. Please resend the refill details, for example: 12.5kg refill x1, Ajah, address: House 4 Example Estate.';
    intent = 'ORDER_DRAFT';
  } else if (intent === 'ORDER_DRAFT_CONFIRMED' && openDraft) {
    const result = await startOrContinueOrderDraft({ contact, text: message.displayText || message.text, confirmation: true });
    draft = result.draft;
    actionRequest = result.request;
    reply = result.reply;
  } else if (intent === 'NEW_ORDER' || (openDraft && intent === 'UNKNOWN')) {
    const result = await startOrContinueOrderDraft({ contact, text: message.displayText || message.text });
    draft = result.draft;
    reply = result.reply;
    intent = 'ORDER_DRAFT';
  } else if (intent === 'ORDER_STATUS') {
    order = await findOrderByText(message.displayText || message.text, message.phone, contact.linkedCustomerId);
    reply = buildOrderStatusReply(order);
  } else if (intent === 'PAYMENT_HELP') {
    order = await findLatestOrderForPhone(message.phone, contact.linkedCustomerId);
    ticket = await createSupportTicketFromWhatsapp({ contact, inboundText: message.displayText || message.text, requestType: intent, order });
    reply = `Payment/wallet help request received. Ticket: ${ticket.ticketNo}. Finance/support will follow up.`;
  } else if (intent === 'COMPLAINT' || intent === 'SPEAK_TO_AGENT') {
    order = await findLatestOrderForPhone(message.phone, contact.linkedCustomerId);
    ticket = await createSupportTicketFromWhatsapp({ contact, inboundText: message.displayText || message.text, requestType: intent, order });
    reply = `Support request received. Ticket: ${ticket.ticketNo}. A team member will follow up shortly.`;
  } else if (intent === 'UNKNOWN') {
    reply = runtimeConfig.fallbackMessage || [
      'Thank you. I did not fully understand that yet.',
      'Reply 1 for order status, 2 for refill, 3 for payment help, 4 for complaint, or 5 for support.',
    ].join('\n');
  }

  if (!actionRequest && !draft?.requestId) {
    actionRequest = await createActionRequest({ contact, requestType: intent, inboundText: message.displayText || message.text, botResponse: reply, order, ticket, draft });
  } else if (!actionRequest && draft?.requestId) {
    actionRequest = await WhatsAppActionRequest.findOne({ id: draft.requestId });
  }

  contact.lastIntent = intent;
  contact.status = ['COMPLAINT', 'SPEAK_TO_AGENT', 'PAYMENT_HELP'].includes(intent) ? 'HANDOFF_TO_SUPPORT' : openDraft ? 'WAITING_CUSTOMER' : 'ACTIVE';
  await contact.save();

  await sendTextMessage(message.phone, reply, { intent });

  if (['ORDER_DRAFT_CONFIRMED', 'PAYMENT_HELP', 'COMPLAINT', 'SPEAK_TO_AGENT'].includes(intent)) {
    await createAdminNotification({
      title: 'New WhatsApp customer request',
      body: `${contact.linkedCustomerName || contact.profileName || contact.phone}: ${actionRequest?.subject || intent}`,
      type: 'chat',
      priority: intent === 'COMPLAINT' || intent === 'ORDER_DRAFT_CONFIRMED' ? 'high' : 'normal',
      data: { requestId: actionRequest?.id, phone: contact.phone, requestType: intent, draftId: draft?.id },
    });
  }

  return { contactId: contact.id, requestId: actionRequest?.id, draftId: draft?.id, intent, ticketNo: ticket?.ticketNo };
};

const handleStatusEvent = async (message) => {
  if (!message.providerMessageId) return { skipped: true, reason: 'missing_status_id' };
  const mapped = message.status === 'DELIVERED' ? 'DELIVERED' : message.status === 'READ' ? 'READ' : message.status === 'FAILED' ? 'FAILED' : 'SENT';
  await WhatsAppMessageLog.findOneAndUpdate({ providerMessageId: message.providerMessageId }, { $set: { status: mapped, rawPayload: message.rawPayload } }, { new: true });
  return { statusUpdated: mapped };
};

const processWebhookPayload = async (payload) => {
  const events = extractInboundMessages(payload);
  const results = [];
  for (const event of events) {
    if (event.kind === 'status') results.push(await handleStatusEvent(event));
    else results.push(await handleInboundMessage(event));
  }
  await updateWebhookRuntimeStatus({
    lastWebhookReceivedAt: new Date(),
    lastInboundPhone: events.find((event) => event.phone)?.phone || '',
    lastWebhookStatus: events.length ? 'RECEIVED' : 'NO_EVENTS',
    lastError: '',
  });
  return { receivedEvents: events.length, results };
};

const verifyWebhook = async (query = {}) => {
  const config = await getConfig();
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode === 'subscribe' && token && config.verifyToken && token === config.verifyToken) return { ok: true, challenge };
  return { ok: false };
};

const getSetupChecklist = async (req) => {
  const config = await getConfig();
  const webhookUrl = buildWebhookUrl(req, config);
  return [
    { key: 'WHATSAPP_ENABLED', label: 'WhatsApp integration enabled', ready: !!config.enabled, informational: config.effectiveMode !== 'LIVE' },
    { key: 'WHATSAPP_MODE', label: `Current runtime mode: ${config.effectiveMode}`, ready: config.effectiveMode === 'LIVE', informational: config.effectiveMode !== 'LIVE' },
    { key: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', label: 'Webhook verify token configured', ready: !!config.webhookVerifyToken },
    { key: 'WHATSAPP_WEBHOOK_URL', label: 'Webhook callback URL available', ready: !!webhookUrl },
    { key: 'WHATSAPP_ACCESS_TOKEN', label: 'Cloud API access token configured', ready: !!config.accessToken },
    { key: 'WHATSAPP_PHONE_NUMBER_ID', label: 'Business phone number ID configured', ready: !!config.phoneNumberId },
    { key: 'WHATSAPP_BUSINESS_ACCOUNT_ID', label: 'WhatsApp Business Account ID configured', ready: !!config.businessAccountId, optional: true },
    { key: 'WHATSAPP_APP_SECRET', label: 'App secret configured for webhook signature validation', ready: !!config.appSecret, optional: true },
    { key: 'DRY_RUN_MODE', label: 'Dry-run prevents real outbound WhatsApp messages', ready: config.dryRun, informational: true },
  ];
};

const getDashboard = async (req) => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [contacts, openRequests, todayInbound, handoffs, dryRunOutbound, orderDraftsReady, submittedDrafts, recentRequests, config, readiness] = await Promise.all([
    WhatsAppContact.countDocuments({}),
    WhatsAppActionRequest.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED'] } }),
    WhatsAppMessageLog.countDocuments({ direction: 'INBOUND', createdAt: { $gte: startOfDay } }),
    WhatsAppContact.countDocuments({ status: 'HANDOFF_TO_SUPPORT' }),
    WhatsAppMessageLog.countDocuments({ direction: 'OUTBOUND', status: 'DRY_RUN' }),
    WhatsAppOrderDraft.countDocuments({ status: 'READY' }),
    WhatsAppOrderDraft.countDocuments({ status: { $in: ['SUBMITTED', 'IN_REVIEW'] } }),
    WhatsAppActionRequest.find({}).sort({ createdAt: -1 }).limit(12).lean(),
    getConfig(),
    getSetupChecklist(req),
  ]);
  return { summary: { contacts, openRequests, todayInbound, handoffs, dryRunOutbound, orderDraftsReady, submittedDrafts, mode: config.effectiveMode }, recentRequests, readiness };
};

const getSettings = async (req) => {
  const saved = await getSavedWhatsAppSettings();
  return {
    settings: sanitizeSettingsForClient(saved, req),
    runtime: await getHealth(req),
  };
};

const updateSettings = async (payload = {}, user = {}, req) => {
  const existing = await getSavedWhatsAppSettings();
  const update = buildSettingsUpdate(payload, existing);
  update.updatedBy = user?.name || user?.email || user?.id || 'admin';
  const $set = {};
  Object.entries(update).forEach(([key, value]) => { $set[`whatsappSettings.${key}`] = value; });
  const doc = await Config.findOneAndUpdate(
    {},
    { $set, $setOnInsert: DEFAULT_CONFIG_ON_INSERT },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();

  logger.info('[WHATSAPP] Settings updated from Admin configuration panel', {
    actor: update.updatedBy,
    changedFields: Object.keys(update).map((key) => ['accessToken', 'appSecret'].includes(key) ? `${key}:changed` : key),
  });

  return {
    message: 'WhatsApp settings updated successfully.',
    settings: sanitizeSettingsForClient(doc?.whatsappSettings || {}, req),
    runtime: await getHealth(req),
  };
};

const getHealth = async (req) => {
  const config = await getConfig();
  const webhookUrl = buildWebhookUrl(req, config);
  const missing = [];
  if (!config.webhookVerifyToken) missing.push('webhookVerifyToken');
  if (!config.phoneNumberId) missing.push('phoneNumberId');
  if (!config.accessToken) missing.push('accessToken');
  const readiness = await getSetupChecklist(req);
  return {
    enabled: !!config.enabled,
    configuredMode: config.mode,
    effectiveMode: config.effectiveMode,
    dryRun: config.dryRun,
    webhookUrl,
    missing,
    canSendLive: config.effectiveMode === 'LIVE',
    signatureValidationActive: !!config.appSecret,
    lastWebhookReceivedAt: config.lastWebhookReceivedAt,
    lastInboundPhone: config.lastInboundPhone,
    lastWebhookStatus: config.lastWebhookStatus,
    lastError: config.lastError,
    readiness,
  };
};

const testConnection = async (req) => {
  const config = await getConfig();
  const checkedAt = new Date();
  if (config.effectiveMode !== 'LIVE') {
    await updateWebhookRuntimeStatus({ lastHealthCheckAt: checkedAt, lastWebhookStatus: 'DRY_RUN_CHECK' });
    return {
      ok: true,
      dryRun: true,
      mode: config.effectiveMode,
      message: 'Dry-run/disabled mode active. Live Graph API validation was skipped.',
      health: await getHealth(req),
    };
  }

  try {
    const response = await httpGetJson({
      hostname: 'graph.facebook.com',
      path: `/${config.graphVersion}/${config.phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`,
      headers: { Authorization: `Bearer ${config.accessToken}` },
    });
    await updateWebhookRuntimeStatus({
      lastHealthCheckAt: checkedAt,
      lastWebhookStatus: 'GRAPH_API_OK',
      lastError: '',
      displayPhoneNumber: response.display_phone_number || config.displayPhoneNumber,
    });
    return { ok: true, dryRun: false, response, health: await getHealth(req) };
  } catch (error) {
    await updateWebhookRuntimeStatus({ lastHealthCheckAt: checkedAt, lastWebhookStatus: 'GRAPH_API_FAILED', lastError: error.message });
    return { ok: false, dryRun: false, error: error.message, response: error.response, health: await getHealth(req) };
  }
};

const sendTestMessage = async ({ to, text } = {}) => {
  if (!to) throw new Error('Test recipient WhatsApp number is required');
  const message = text || 'PrimeJet Gas WhatsApp integration test message. If you received this, the Business App can send WhatsApp messages.';
  const result = await sendTextMessage(to, message, { intent: 'ADMIN_TEST_MESSAGE', messageType: 'TEST' });
  return { message: 'Test message processed.', result };
};

const syncTemplates = async (req) => {
  const config = await getConfig();
  if (config.effectiveMode !== 'LIVE' || !config.businessAccountId) {
    return {
      ok: true,
      dryRun: true,
      templates: config.templates,
      message: 'Template sync requires LIVE mode, access token and WhatsApp Business Account ID. Current stored template names were returned.',
      health: await getHealth(req),
    };
  }
  try {
    const response = await httpGetJson({
      hostname: 'graph.facebook.com',
      path: `/${config.graphVersion}/${config.businessAccountId}/message_templates?fields=name,status,language,category`,
      headers: { Authorization: `Bearer ${config.accessToken}` },
    });
    return { ok: true, dryRun: false, templates: response.data || [], response };
  } catch (error) {
    return { ok: false, error: error.message, response: error.response };
  }
};

const listRequests = async (query = {}) => {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.requestType) filter.requestType = query.requestType;
  if (query.phone) filter.phone = { $regex: normalizePhone(query.phone) };
  const limit = Math.min(Number(query.limit || 50), 200);
  const requests = await WhatsAppActionRequest.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  return { requests };
};

const listConversations = async (query = {}) => {
  const limit = Math.min(Number(query.limit || 50), 200);
  const contacts = await WhatsAppContact.find({}).sort({ lastMessageAt: -1 }).limit(limit).lean();
  return { contacts };
};

const getMessagesForPhone = async (phone, query = {}) => {
  const normalized = normalizePhone(phone);
  const limit = Math.min(Number(query.limit || 80), 200);
  const messages = await WhatsAppMessageLog.find({ phone: normalized }).sort({ createdAt: -1 }).limit(limit).lean();
  return { messages: messages.reverse() };
};

const resolveRequest = async (requestId, user, body = {}) => {
  const request = await WhatsAppActionRequest.findOne({ id: requestId });
  if (!request) throw new Error('WhatsApp request not found');
  request.status = body.status || 'RESOLVED';
  request.resolvedAt = ['RESOLVED', 'CLOSED'].includes(request.status) ? new Date() : request.resolvedAt;
  request.activity.push({ action: 'ADMIN_STATUS_UPDATE', note: body.note || '', actorId: user?.id, actorName: user?.name || user?.email });
  await request.save();
  return request;
};

const simulateInbound = async ({ phone, text, profileName }) => {
  const normalized = normalizePhone(phone);
  const synthetic = { kind: 'message', providerMessageId: `SIM-${Date.now()}-${Math.floor(Math.random() * 10000)}`, waId: normalized, phone: normalized, profileName: profileName || 'Simulated Customer', messageType: 'TEXT', text, displayText: text, rawPayload: { simulated: true, text } };
  return handleInboundMessage(synthetic);
};

const sendManualMessage = async ({ to, text, user }) => {
  if (!to || !text) throw new Error('Recipient phone and message text are required');
  const result = await sendTextMessage(to, text, { intent: 'ADMIN_REPLY' });
  await WhatsAppActionRequest.create({
    waId: normalizePhone(to),
    phone: normalizePhone(to),
    requestType: 'SPEAK_TO_AGENT',
    status: 'RESOLVED',
    assignedTeam: 'SUPPORT',
    subject: 'Manual WhatsApp admin reply',
    lastInboundText: '',
    botResponse: text,
    activity: [{ action: 'ADMIN_MANUAL_REPLY', note: text, actorId: user?.id, actorName: user?.name || user?.email }],
    resolvedAt: new Date(),
  });
  return result;
};

const listOrderDrafts = async (query = {}) => {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.stage) filter.stage = query.stage;
  if (query.phone) filter.phone = { $regex: normalizePhone(query.phone) };
  const limit = Math.min(Number(query.limit || 50), 200);
  const drafts = await WhatsAppOrderDraft.find(filter).sort({ updatedAt: -1 }).limit(limit).lean();
  return { drafts };
};

const getOrderDraft = async (draftId) => {
  const draft = await WhatsAppOrderDraft.findOne({ id: draftId }).lean();
  if (!draft) throw new Error('WhatsApp order draft not found');
  return { draft };
};

const updateOrderDraft = async (draftId, body = {}, user) => {
  const draft = await WhatsAppOrderDraft.findOne({ id: draftId });
  if (!draft) throw new Error('WhatsApp order draft not found');
  ['cylinderSizeKg', 'quantity', 'productText', 'deliveryArea', 'addressText', 'deliveryInstructions', 'paymentPreference', 'estimatedAmount', 'adminNote'].forEach((field) => {
    if (body[field] !== undefined) draft[field] = body[field];
  });
  const { issues, score } = evaluateDraft(draft);
  draft.validationIssues = issues;
  draft.confidenceScore = score;
  if (!issues.length && ['OPEN', 'READY'].includes(draft.status)) {
    draft.status = 'READY';
    draft.stage = 'READY_FOR_ADMIN_REVIEW';
  }
  draft.activity.push({ action: 'ADMIN_UPDATED_DRAFT', note: body.note || 'Draft updated from business app', actorId: user?.id, actorName: user?.name || user?.email });
  await draft.save();
  return { draft };
};

const cancelOrderDraft = async (draftId, body = {}, user) => {
  const draft = await WhatsAppOrderDraft.findOne({ id: draftId });
  if (!draft) throw new Error('WhatsApp order draft not found');
  draft.status = 'CANCELLED';
  draft.stage = 'CANCELLED';
  draft.cancelledAt = new Date();
  draft.activity.push({ action: 'ADMIN_CANCELLED_DRAFT', note: body.reason || '', actorId: user?.id, actorName: user?.name || user?.email });
  await draft.save();
  return { draft };
};

const searchCustomers = async (query = {}) => {
  const q = String(query.q || query.phone || '').trim();
  if (!q) return { customers: [] };
  const phone = normalizePhone(q);
  const filter = { role: 'customer', $or: [] };
  if (phone) filter.$or.push({ phone: { $regex: `${lastDigits(phone)}$` } });
  filter.$or.push({ name: { $regex: q, $options: 'i' } }, { email: { $regex: q, $options: 'i' } });
  const customers = await User.find(filter).select('id name email phone walletBalance status createdAt').limit(20).lean();
  return { customers };
};

const linkContactToCustomer = async (contactId, body = {}, user) => {
  const contact = await WhatsAppContact.findOne({ id: contactId });
  if (!contact) throw new Error('WhatsApp contact not found');
  const customer = await User.findOne({ id: body.customerId, role: 'customer' }).lean();
  if (!customer) throw new Error('Customer not found');
  contact.linkedCustomerId = customer.id;
  contact.linkedCustomerName = customer.name;
  contact.tags = Array.from(new Set([...(contact.tags || []), 'LINKED_CUSTOMER']));
  contact.metadata = contact.metadata || new Map();
  contact.metadata.set('linkedBy', user?.name || user?.email || 'admin');
  await contact.save();
  await WhatsAppOrderDraft.updateMany({ phone: contact.phone, customerId: { $exists: false } }, { $set: { customerId: customer.id, customerName: customer.name } });
  return { contact };
};

const createCustomerFromContact = async (contactId, body = {}, user) => {
  const contact = await WhatsAppContact.findOne({ id: contactId });
  if (!contact) throw new Error('WhatsApp contact not found');
  const email = body.email || `wa-${contact.phone}@whatsapp.gas2door.ng`;
  let customer = await User.findOne({ email }).lean();
  if (!customer) {
    const doc = await User.create({
      name: body.name || contact.profileName || `WhatsApp ${contact.phone}`,
      email,
      phone: contact.phone,
      password: body.password || `WA-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      role: 'customer',
      status: 'active',
      isVerified: true,
    });
    customer = doc.toObject();
  }
  contact.linkedCustomerId = customer.id;
  contact.linkedCustomerName = customer.name;
  contact.tags = Array.from(new Set([...(contact.tags || []), 'CUSTOMER_CREATED_FROM_WHATSAPP']));
  contact.metadata = contact.metadata || new Map();
  contact.metadata.set('customerCreatedBy', user?.name || user?.email || 'admin');
  await contact.save();
  await WhatsAppOrderDraft.updateMany({ phone: contact.phone }, { $set: { customerId: customer.id, customerName: customer.name } });
  return { contact, customer };
};

const convertDraftToOrder = async (draftId, body = {}, user) => {
  const runtimeConfig = await getConfig();
  const draft = await WhatsAppOrderDraft.findOne({ id: draftId });
  if (!draft) throw new Error('WhatsApp order draft not found');
  const { issues } = evaluateDraft(draft);
  if (issues.length) throw new Error(`Draft is incomplete: ${issues.join(', ')}`);
  let customerId = draft.customerId;
  let customer = customerId ? await User.findOne({ id: customerId }) : null;
  if (!customer && (body.createCustomerIfMissing || runtimeConfig.autoCreateCustomer)) {
    const contact = await WhatsAppContact.findOne({ phone: draft.phone });
    const created = await createCustomerFromContact(contact.id, { name: draft.customerName || contact.profileName }, user);
    customer = await User.findOne({ id: created.customer.id });
    customerId = customer.id;
  }
  if (!customer) throw new Error('Draft must be linked to a customer before converting to an order, or createCustomerIfMissing must be true');
  const qty = Number(draft.quantity || 1);
  const total = Number(body.grandTotal ?? draft.estimatedAmount ?? 0);
  const unitPrice = qty ? total / qty : total;
  const size = draft.cylinderSizeKg || 12.5;
  const order = await Order.create({
    customerId: customer.id,
    type: 'GAS',
    channel: 'DELIVERY',
    items: [{ cylinderId: `LPG_${String(size).replace('.', '_')}KG`, productName: draft.productText || `${size}kg LPG refill`, quantity: qty, unitPrice: Math.max(0, unitPrice || 0) }],
    deliveryAddressSnapshot: {
      fullAddress: draft.addressText || draft.deliveryArea || 'WhatsApp customer address pending confirmation',
      street: draft.addressText || draft.deliveryArea || 'WhatsApp address',
      city: draft.deliveryArea || runtimeConfig.defaultCity || 'Lagos',
      state: runtimeConfig.defaultState || 'Lagos',
      country: 'Nigeria',
      latitude: 0,
      longitude: 0,
      deliveryInstructions: draft.deliveryInstructions || 'Created from WhatsApp order intake. Confirm exact location before dispatch.',
    },
    recipientName: customer.name,
    recipientPhone: draft.phone,
    itemsSubtotal: total,
    grandTotal: total,
    finalAmountPaid: 0,
    status: 'Order Placed',
    paymentStatus: 'Pending',
    paymentMethod: body.paymentMethod || runtimeConfig.defaultPaymentMethod || 'payOnPickup',
    paymentGateway: null,
    deliveryLatitude: 0,
    deliveryLongitude: 0,
    metadata: new Map(Object.entries({ source: 'WHATSAPP', draftNo: draft.draftNo, paymentPreference: draft.paymentPreference || 'UNKNOWN' })),
    statusHistory: [{ status: 'Order Placed', timestamp: new Date(), notes: 'Created from WhatsApp order draft.', updatedBy: user?.id, updaterRole: 'admin' }],
    orderDate: new Date(),
    placedAt: new Date(),
  });
  draft.status = 'CONVERTED';
  draft.stage = 'CONVERTED_TO_ORDER';
  draft.linkedOrderId = order.id;
  draft.convertedAt = new Date();
  draft.activity.push({ action: 'CONVERTED_TO_ORDER', note: order.id, actorId: user?.id, actorName: user?.name || user?.email });
  await draft.save();
  if (draft.requestId) {
    await WhatsAppActionRequest.findOneAndUpdate({ id: draft.requestId }, { $set: { status: 'RESOLVED', orderId: order.id, resolvedAt: new Date() }, $push: { activity: { action: 'CONVERTED_TO_ORDER', note: order.id, actorId: user?.id, actorName: user?.name || user?.email } } });
  }
  await sendTextMessage(draft.phone, `Your WhatsApp refill request ${draft.draftNo} has been created as order ${order.id}. Our team will confirm payment and dispatch details.`, { intent: 'ORDER_CREATED_FROM_WHATSAPP' });
  return { draft, order };
};

module.exports = {
  verifyWebhook,
  processWebhookPayload,
  getDashboard,
  getSetupChecklist,
  listRequests,
  listConversations,
  getMessagesForPhone,
  resolveRequest,
  simulateInbound,
  sendManualMessage,
  sendTextMessage,
  listOrderDrafts,
  getOrderDraft,
  updateOrderDraft,
  cancelOrderDraft,
  convertDraftToOrder,
  searchCustomers,
  linkContactToCustomer,
  createCustomerFromContact,
  getSettings,
  updateSettings,
  getHealth,
  testConnection,
  sendTestMessage,
  syncTemplates,
};
