// File: src/api/v2/whatsapp/whatsapp.controller.js
const service = require('./whatsapp.service');

const verifyWebhook = async (req, res, next) => {
  try {
    const result = await service.verifyWebhook(req.query || {});
    if (result.ok) return res.status(200).send(result.challenge);
    return res.sendStatus(403);
  } catch (error) { return next(error); }
};

const receiveWebhook = async (req, res, next) => {
  try { return res.status(200).json({ ok: true, ...(await service.processWebhookPayload(req.body || {})) }); } catch (error) { return next(error); }
};

const getDashboard = async (req, res, next) => { try { res.json(await service.getDashboard(req)); } catch (error) { next(error); } };
const getSetupChecklist = async (req, res, next) => { try { res.json({ checklist: await service.getSetupChecklist(req) }); } catch (error) { next(error); } };
const getSettings = async (req, res, next) => { try { res.json(await service.getSettings(req)); } catch (error) { next(error); } };
const updateSettings = async (req, res, next) => { try { res.json(await service.updateSettings(req.body, req.user, req)); } catch (error) { next(error); } };
const getHealth = async (req, res, next) => { try { res.json(await service.getHealth(req)); } catch (error) { next(error); } };
const testConnection = async (req, res, next) => { try { res.json(await service.testConnection(req)); } catch (error) { next(error); } };
const sendTestMessage = async (req, res, next) => { try { res.status(201).json(await service.sendTestMessage(req.body)); } catch (error) { next(error); } };
const syncTemplates = async (req, res, next) => { try { res.json(await service.syncTemplates(req)); } catch (error) { next(error); } };
const listRequests = async (req, res, next) => { try { res.json(await service.listRequests(req.query)); } catch (error) { next(error); } };
const listConversations = async (req, res, next) => { try { res.json(await service.listConversations(req.query)); } catch (error) { next(error); } };
const getMessagesForPhone = async (req, res, next) => { try { res.json(await service.getMessagesForPhone(req.params.phone, req.query)); } catch (error) { next(error); } };
const resolveRequest = async (req, res, next) => { try { res.json({ request: await service.resolveRequest(req.params.requestId, req.user, req.body) }); } catch (error) { next(error); } };
const simulateInbound = async (req, res, next) => { try { res.status(201).json(await service.simulateInbound(req.body)); } catch (error) { next(error); } };
const sendManualMessage = async (req, res, next) => { try { res.status(201).json(await service.sendManualMessage({ ...req.body, user: req.user })); } catch (error) { next(error); } };

const listOrderDrafts = async (req, res, next) => { try { res.json(await service.listOrderDrafts(req.query)); } catch (error) { next(error); } };
const getOrderDraft = async (req, res, next) => { try { res.json(await service.getOrderDraft(req.params.draftId)); } catch (error) { next(error); } };
const updateOrderDraft = async (req, res, next) => { try { res.json(await service.updateOrderDraft(req.params.draftId, req.body, req.user)); } catch (error) { next(error); } };
const cancelOrderDraft = async (req, res, next) => { try { res.json(await service.cancelOrderDraft(req.params.draftId, req.body, req.user)); } catch (error) { next(error); } };
const convertDraftToOrder = async (req, res, next) => { try { res.status(201).json(await service.convertDraftToOrder(req.params.draftId, req.body, req.user)); } catch (error) { next(error); } };
const searchCustomers = async (req, res, next) => { try { res.json(await service.searchCustomers(req.query)); } catch (error) { next(error); } };
const linkContactToCustomer = async (req, res, next) => { try { res.json(await service.linkContactToCustomer(req.params.contactId, req.body, req.user)); } catch (error) { next(error); } };
const createCustomerFromContact = async (req, res, next) => { try { res.status(201).json(await service.createCustomerFromContact(req.params.contactId, req.body, req.user)); } catch (error) { next(error); } };

module.exports = {
  verifyWebhook,
  receiveWebhook,
  getDashboard,
  getSetupChecklist,
  listRequests,
  listConversations,
  getMessagesForPhone,
  resolveRequest,
  simulateInbound,
  sendManualMessage,
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
