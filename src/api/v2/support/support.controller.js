// File: src/api/v2/support/support.controller.js
const mongoose = require('mongoose');
const Order = require('../../../models/order.model');
const Run = require('../../../models/run.model');
const User = require('../../../models/user.model');
const CustomerNote = require('../../../models/customerNote.model');
const Message = require('../../../models/message.model');
const SupportTicket = require('../../../models/supportTicket.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const socketManager = require('../../../socket.manager');

const safeInt = (v, d = 10) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const safeStr = (v, d = '') => (typeof v === 'string' ? v.trim() : d);
const arr = (v) => (Array.isArray(v) ? v : []);
const normalizeRunStatus = (s) => String(s || '').toLowerCase();
const terminalTicketStatuses = ['RESOLVED', 'CLOSED'];

const prioritySlaHours = {
  URGENT: { firstResponseHours: 1, resolutionHours: 4 },
  HIGH: { firstResponseHours: 2, resolutionHours: 12 },
  MEDIUM: { firstResponseHours: 4, resolutionHours: 24 },
  LOW: { firstResponseHours: 8, resolutionHours: 48 },
};

const addHours = (date, hours) => new Date(date.getTime() + hours * 60 * 60 * 1000);

const buildSla = (priority = 'MEDIUM', base = new Date()) => {
  const policy = prioritySlaHours[priority] || prioritySlaHours.MEDIUM;
  return {
    firstResponseDueAt: addHours(base, policy.firstResponseHours),
    resolutionDueAt: addHours(base, policy.resolutionHours),
    firstResponseBreached: false,
    resolutionBreached: false,
  };
};

const decorateTicket = (ticket) => {
  if (!ticket) return ticket;
  const t = typeof ticket.toObject === 'function' ? ticket.toObject() : { ...ticket };
  const now = new Date();
  const status = safeStr(t.status);
  const firstResponseDue = t?.sla?.firstResponseDueAt ? new Date(t.sla.firstResponseDueAt) : null;
  const resolutionDue = t?.sla?.resolutionDueAt ? new Date(t.sla.resolutionDueAt) : null;
  const firstResponded = !!t?.sla?.firstRespondedAt;
  const closed = terminalTicketStatuses.includes(status);

  const firstResponseBreached = !firstResponded && !closed && firstResponseDue && firstResponseDue < now;
  const resolutionBreached = !closed && resolutionDue && resolutionDue < now;

  return {
    ...t,
    slaStatus: {
      firstResponseBreached: !!firstResponseBreached,
      resolutionBreached: !!resolutionBreached,
      breached: !!firstResponseBreached || !!resolutionBreached,
      firstResponseDueAt: t?.sla?.firstResponseDueAt || null,
      resolutionDueAt: t?.sla?.resolutionDueAt || null,
    },
  };
};

const buildActor = (req) => ({
  actorId: req.user?.id || req.user?._id || 'system',
  actorEmail: req.user?.email || 'system',
});

const customerMatchForOrders = (customerId) => ({
  $or: [{ customerId }, { userId: customerId }],
});

const getSupportHub = async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(5, safeInt(req.query.limit, 10)));
    const sinceDays = Math.min(30, Math.max(1, safeInt(req.query.sinceDays, 7)));
    const branchId = req.query.branchId || null;

    const since = new Date();
    since.setDate(since.getDate() - sinceDays);

    const runsMatch = {};
    if (branchId) runsMatch.branchId = branchId;

    const activeRuns = await Run.find(runsMatch)
      .select('id overallStatus driverId stops totalStops estimatedStartDate createdAt updatedAt')
      .lean();

    const assignedRuns = activeRuns.filter((r) => normalizeRunStatus(r.overallStatus) === 'assigned');
    const activeDeliveryRuns = activeRuns.filter((r) =>
      ['in progress', 'active', 'on delivery'].includes(normalizeRunStatus(r.overallStatus))
    );

    const orderBaseMatch = {
      status: { $nin: ['Delivered', 'Canceled', 'Failed'] },
      $or: [{ driverId: { $exists: false } }, { driverId: null }, { driverId: '' }],
      createdAt: { $gte: since },
    };
    if (branchId) orderBaseMatch.branchId = branchId;

    const newCustomerOrdersCount = await Order.countDocuments(orderBaseMatch);

    const recentOrders = await Order.aggregate([
      { $match: { ...(branchId ? { branchId } : {}), createdAt: { $gte: since } } },
      { $sort: { createdAt: -1 } },
      { $limit: limit },
      { $addFields: { _customerKey: { $ifNull: ['$userId', '$customerId'] } } },
      {
        $lookup: {
          from: User.collection.name,
          localField: '_customerKey',
          foreignField: 'id',
          as: '_user',
        },
      },
      { $unwind: { path: '$_user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          id: '$id',
          status: '$status',
          paymentStatus: '$paymentStatus',
          grandTotal: '$grandTotal',
          orderDate: '$orderDate',
          createdAt: '$createdAt',
          updatedAt: '$updatedAt',
          branchId: '$branchId',
          customerId: '$_customerKey',
          customerName: { $ifNull: ['$customerName', { $ifNull: ['$_user.name', { $ifNull: ['$_user.fullName', '$recipientName'] }] }] },
          customerEmail: { $ifNull: ['$customerEmail', '$_user.email'] },
          customerPhone: { $ifNull: ['$customerPhone', { $ifNull: ['$_user.phone', '$recipientPhone'] }] },
        },
      },
    ]);

    const attentionCustomers = await Order.aggregate([
      {
        $match: {
          ...(branchId ? { branchId } : {}),
          createdAt: { $gte: since },
          status: { $nin: ['Delivered', 'Canceled', 'Failed'] },
        },
      },
      {
        $addFields: {
          _customerKey: { $ifNull: ['$userId', '$customerId'] },
          _statusLower: { $toLower: { $ifNull: ['$status', ''] } },
        },
      },
      {
        $group: {
          _id: '$_customerKey',
          pendingCount: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $regexMatch: { input: '$_statusLower', regex: 'pending' } },
                    { $regexMatch: { input: '$_statusLower', regex: 'placed' } },
                    { $regexMatch: { input: '$_statusLower', regex: 'processing' } },
                    { $regexMatch: { input: '$_statusLower', regex: 'ready' } },
                  ],
                },
                1,
                0,
              ],
            },
          },
          activeCount: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $regexMatch: { input: '$_statusLower', regex: 'driver assigned' } },
                    { $regexMatch: { input: '$_statusLower', regex: 'delivery' } },
                    { $regexMatch: { input: '$_statusLower', regex: 'in progress' } },
                    { $regexMatch: { input: '$_statusLower', regex: 'pickup' } },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalOrders: { $sum: 1 },
          lastOrderAt: { $max: '$createdAt' },
        },
      },
      { $sort: { lastOrderAt: -1 } },
      { $limit: Math.min(limit, 15) },
      {
        $lookup: {
          from: User.collection.name,
          localField: '_id',
          foreignField: 'id',
          as: '_user',
        },
      },
      { $unwind: { path: '$_user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          customerId: '$_id',
          customerName: { $ifNull: ['$_user.name', { $ifNull: ['$_user.fullName', 'Customer'] }] },
          customerEmail: '$_user.email',
          customerPhone: '$_user.phone',
          pendingCount: 1,
          activeCount: 1,
          totalOrders: 1,
          lastOrderAt: 1,
        },
      },
    ]);

    const openTicketCount = await SupportTicket.countDocuments({ status: { $nin: ['RESOLVED', 'CLOSED'] } });
    const overdueTicketCount = await SupportTicket.countDocuments({
      status: { $nin: ['RESOLVED', 'CLOSED'] },
      'sla.resolutionDueAt': { $lt: new Date() },
    });

    return res.status(200).json({
      ok: true,
      params: { limit, sinceDays, branchId: branchId || null },
      queue: {
        newCustomerOrders: newCustomerOrdersCount,
        ordersAssigned: assignedRuns.length,
        activeDeliveries: activeDeliveryRuns.length,
        totalRuns: activeRuns.length,
        openTickets: openTicketCount,
        overdueTickets: overdueTicketCount,
      },
      recentOrders,
      attentionCustomers,
    });
  } catch (error) {
    logger.error('[SUPPORT HUB] Error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load support hub.'));
  }
};

const getSupportDashboard = async (req, res, next) => {
  try {
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      openTickets,
      inProgressTickets,
      escalatedTickets,
      overdueTickets,
      waitingCustomerTickets,
      recentChats,
      failedDeliveryRuns,
      recentTickets,
    ] = await Promise.all([
      SupportTicket.countDocuments({ status: 'OPEN' }),
      SupportTicket.countDocuments({ status: 'IN_PROGRESS' }),
      SupportTicket.countDocuments({ status: 'ESCALATED' }),
      SupportTicket.countDocuments({ status: { $nin: ['RESOLVED', 'CLOSED'] }, 'sla.resolutionDueAt': { $lt: now } }),
      SupportTicket.countDocuments({ status: 'WAITING_CUSTOMER' }),
      Message.countDocuments({ createdAt: { $gte: since } }),
      Run.countDocuments({
        $or: [
          { failedDeliveryCount: { $gt: 0 } },
          { 'stops.status': { $in: ['CUSTOMER_UNAVAILABLE', 'ISSUE_REPORTED', 'CANCELED'] } },
        ],
        updatedAt: { $gte: since },
      }),
      SupportTicket.find({}).sort({ updatedAt: -1 }).limit(10).lean(),
    ]);

    return res.json({
      ok: true,
      summary: {
        openTickets,
        inProgressTickets,
        escalatedTickets,
        overdueTickets,
        waitingCustomerTickets,
        recentChats,
        failedDeliveryRuns,
      },
      recentTickets: recentTickets.map(decorateTicket),
      slaPolicy: prioritySlaHours,
    });
  } catch (error) {
    logger.error('[SUPPORT DASHBOARD] Error:', error);
    next(new HttpError(500, 'Failed to load support dashboard.'));
  }
};

const listTickets = async (req, res, next) => {
  try {
    const page = Math.max(1, safeInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(5, safeInt(req.query.limit, 20)));
    const skip = (page - 1) * limit;

    const q = {};
    if (req.query.status) q.status = req.query.status;
    if (req.query.priority) q.priority = req.query.priority;
    if (req.query.assignedTeam) q.assignedTeam = req.query.assignedTeam;
    if (req.query.customerId) q.customerId = req.query.customerId;
    if (req.query.orderId) q.orderId = req.query.orderId;
    if (req.query.sourceType) q.sourceType = req.query.sourceType;
    if (req.query.openOnly === 'true') q.status = { $nin: ['RESOLVED', 'CLOSED'] };

    const search = safeStr(req.query.search);
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      q.$or = [
        { ticketNo: rx },
        { subject: rx },
        { description: rx },
        { customerName: rx },
        { customerPhone: rx },
        { customerEmail: rx },
        { orderId: rx },
        { corporateClientName: rx },
        { corporateRequestId: rx },
        { corporateFulfilmentId: rx },
        { corporateSiteId: rx },
      ];
    }

    const [items, total] = await Promise.all([
      SupportTicket.find(q).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      SupportTicket.countDocuments(q),
    ]);

    return res.json({
      ok: true,
      page,
      limit,
      total,
      tickets: items.map(decorateTicket),
    });
  } catch (error) {
    logger.error('[SUPPORT TICKETS] Error:', error);
    next(new HttpError(500, 'Failed to list support tickets.'));
  }
};

const createTicket = async (req, res, next) => {
  try {
    const subject = safeStr(req.body.subject);
    if (!subject) throw new HttpError(400, 'Ticket subject is required.');

    const priority = safeStr(req.body.priority, 'MEDIUM').toUpperCase();
    const now = new Date();
    const { actorId, actorEmail } = buildActor(req);

    const customerId = safeStr(req.body.customerId);
    let customer = null;
    if (customerId) customer = await User.findOne({ id: customerId }).lean();

    const ticket = await SupportTicket.create({
      customerId: customerId || undefined,
      customerName: safeStr(req.body.customerName) || customer?.name,
      customerEmail: safeStr(req.body.customerEmail) || customer?.email,
      customerPhone: safeStr(req.body.customerPhone) || customer?.phone,
      orderId: safeStr(req.body.orderId) || undefined,
      runId: safeStr(req.body.runId) || undefined,
      corporateClientId: safeStr(req.body.corporateClientId) || undefined,
      corporateClientName: safeStr(req.body.corporateClientName) || undefined,
      corporateRequestId: safeStr(req.body.corporateRequestId) || undefined,
      corporateFulfilmentId: safeStr(req.body.corporateFulfilmentId) || undefined,
      corporateSiteId: safeStr(req.body.corporateSiteId) || undefined,
      stopId: safeStr(req.body.stopId) || undefined,
      sourceType: safeStr(req.body.sourceType, 'GENERAL').toUpperCase(),
      category: safeStr(req.body.category, 'GENERAL_ENQUIRY').toUpperCase(),
      subject,
      description: safeStr(req.body.description),
      priority: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(priority) ? priority : 'MEDIUM',
      severity: safeStr(req.body.severity, 'MEDIUM').toUpperCase(),
      status: safeStr(req.body.status, 'OPEN').toUpperCase(),
      assignedTeam: safeStr(req.body.assignedTeam, 'SUPPORT').toUpperCase(),
      assignedTo: safeStr(req.body.assignedTo) || undefined,
      sla: buildSla(['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(priority) ? priority : 'MEDIUM', now),
      createdBy: actorId,
      createdByEmail: actorEmail,
      lastAdminMessageAt: now,
      unreadForAdmin: 0,
      unreadForCustomer: 0,
      notes: req.body.initialNote
        ? [
            {
              text: safeStr(req.body.initialNote),
              noteType: 'INTERNAL',
              authorId: actorId,
              authorEmail: actorEmail,
              createdAt: now,
            },
          ]
        : [],
      activity: [
        {
          action: 'CREATED',
          to: 'OPEN',
          actorId,
          actorEmail,
          note: 'Ticket created',
          createdAt: now,
        },
      ],
    });

    const decorated = decorateTicket(ticket);
    socketManager.emitAdmin('support_ticket_created', { ticket: decorated });
    return res.status(201).json({ ok: true, ticket: decorated });
  } catch (error) {
    logger.error('[SUPPORT CREATE TICKET] Error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to create support ticket.'));
  }
};

const getTicketById = async (req, res, next) => {
  try {
    const ticket = await SupportTicket.findOne({ id: req.params.ticketId }).lean();
    if (!ticket) throw new HttpError(404, 'Support ticket not found.');
    return res.json({ ok: true, ticket: decorateTicket(ticket) });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load support ticket.'));
  }
};

const updateTicket = async (req, res, next) => {
  try {
    const ticket = await SupportTicket.findOne({ id: req.params.ticketId });
    if (!ticket) throw new HttpError(404, 'Support ticket not found.');

    const { actorId, actorEmail } = buildActor(req);
    const changes = [];
    const updatable = ['status', 'priority', 'severity', 'assignedTeam', 'assignedTo', 'category', 'escalationReason', 'resolutionSummary'];

    for (const field of updatable) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        const oldVal = ticket[field] || '';
        let nextVal = req.body[field];
        if (['status', 'priority', 'severity', 'assignedTeam', 'category'].includes(field)) nextVal = safeStr(nextVal).toUpperCase();
        if (String(oldVal || '') !== String(nextVal || '')) {
          changes.push({ field, from: oldVal, to: nextVal });
          ticket[field] = nextVal;
        }
      }
    }

    if (req.body.priority && changes.some((c) => c.field === 'priority')) {
      const created = ticket.createdAt || new Date();
      const newSla = buildSla(ticket.priority, created);
      ticket.sla.firstResponseDueAt = ticket.sla.firstResponseDueAt || newSla.firstResponseDueAt;
      ticket.sla.resolutionDueAt = newSla.resolutionDueAt;
    }

    const now = new Date();
    if (['IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'].includes(ticket.status) && !ticket.sla.firstRespondedAt) {
      ticket.sla.firstRespondedAt = now;
    }
    if (ticket.status === 'RESOLVED' && !ticket.sla.resolvedAt) ticket.sla.resolvedAt = now;
    if (ticket.status === 'CLOSED' && !ticket.closedAt) ticket.closedAt = now;

    ticket.sla.firstResponseBreached = !!(ticket.sla.firstResponseDueAt && !ticket.sla.firstRespondedAt && ticket.sla.firstResponseDueAt < now);
    ticket.sla.resolutionBreached = !!(
      ticket.sla.resolutionDueAt &&
      !terminalTicketStatuses.includes(ticket.status) &&
      ticket.sla.resolutionDueAt < now
    );

    changes.forEach((c) => {
      ticket.activity.push({
        action: `UPDATED_${c.field.toUpperCase()}`,
        from: String(c.from || ''),
        to: String(c.to || ''),
        actorId,
        actorEmail,
        createdAt: now,
      });
    });

    if (safeStr(req.body.note)) {
      ticket.notes.push({
        text: safeStr(req.body.note),
        noteType: 'INTERNAL',
        authorId: actorId,
        authorEmail: actorEmail,
        createdAt: now,
      });
    }

    await ticket.save();
    const decorated = decorateTicket(ticket);
    socketManager.emitAdmin('support_ticket_updated', { ticket: decorated });
    socketManager.emitToRoom(`support-ticket:${ticket.id}`, 'support_ticket_updated', { ticket: decorated });
    socketManager.emitToRoom(`corp-ticket:${ticket.id}`, 'support_ticket_updated', { ticket: decorated });
    return res.json({ ok: true, ticket: decorated });
  } catch (error) {
    logger.error('[SUPPORT UPDATE TICKET] Error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to update support ticket.'));
  }
};

const addTicketNote = async (req, res, next) => {
  try {
    const text = safeStr(req.body.text);
    if (!text) throw new HttpError(400, 'Note text is required.');

    const ticket = await SupportTicket.findOne({ id: req.params.ticketId });
    if (!ticket) throw new HttpError(404, 'Support ticket not found.');

    const { actorId, actorEmail } = buildActor(req);
    const noteType = safeStr(req.body.noteType, 'INTERNAL').toUpperCase();
    const now = new Date();

    ticket.notes.push({
      text,
      noteType: ['INTERNAL', 'CUSTOMER_RESPONSE', 'SYSTEM', 'ESCALATION', 'RESOLUTION'].includes(noteType) ? noteType : 'INTERNAL',
      authorId: actorId,
      authorEmail: actorEmail,
      createdAt: now,
    });

    ticket.activity.push({
      action: 'NOTE_ADDED',
      actorId,
      actorEmail,
      note: noteType,
      createdAt: now,
    });

    if (!ticket.sla.firstRespondedAt && noteType !== 'SYSTEM') {
      ticket.sla.firstRespondedAt = now;
    }

    await ticket.save();
    return res.status(201).json({ ok: true, ticket: decorateTicket(ticket) });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to add ticket note.'));
  }
};

const createTicketFromFailedDelivery = async (req, res, next) => {
  try {
    const runId = safeStr(req.body.runId);
    const stopId = safeStr(req.body.stopId);
    let orderId = safeStr(req.body.orderId);
    if (!runId && !orderId) throw new HttpError(400, 'runId or orderId is required.');

    let run = null;
    let stop = null;
    if (runId) {
      run = await Run.findOne({ id: runId }).lean();
      if (run && stopId) stop = arr(run.stops).find((s) => String(s.stopId || s._id) === stopId);
      if (!orderId && stop?.orderId) orderId = stop.orderId;
    }

    const order = orderId ? await Order.findOne({ id: orderId }).lean() : null;
    const customerId = order?.customerId || order?.userId || safeStr(req.body.customerId);
    const customer = customerId ? await User.findOne({ id: customerId }).lean() : null;

    req.body = {
      customerId,
      customerName: customer?.name || order?.recipientName || req.body.customerName,
      customerEmail: customer?.email || req.body.customerEmail,
      customerPhone: customer?.phone || order?.recipientPhone || req.body.customerPhone,
      orderId,
      runId,
      stopId,
      sourceType: 'FAILED_DELIVERY',
      category: 'FAILED_DELIVERY',
      priority: req.body.priority || 'HIGH',
      severity: req.body.severity || 'HIGH',
      assignedTeam: req.body.assignedTeam || 'OPERATIONS',
      subject: req.body.subject || `Failed delivery follow-up${orderId ? ` for order ${orderId}` : ''}`,
      description:
        req.body.description ||
        stop?.failureReason ||
        stop?.failureNote ||
        'Failed delivery requires customer follow-up.',
      initialNote: req.body.initialNote || stop?.notes || '',
    };

    return createTicket(req, res, next);
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to create failed-delivery support ticket.'));
  }
};


const ticketChatId = (ticket) => (ticket?.corporateClientId ? `corp-ticket:${ticket.id}` : `support-ticket:${ticket.id}`);

const legacyRetailChatIds = (ticket = {}) => {
  const ids = new Set([ticketChatId(ticket)]);
  if (ticket.orderId) ids.add(ticket.orderId);
  if (ticket.customerId) {
    ids.add(ticket.customerId);
    ids.add(`user:${ticket.customerId}`);
    ids.add(`customer:${ticket.customerId}`);
  }
  return Array.from(ids).filter(Boolean);
};

const getTicketMessages = async (req, res, next) => {
  try {
    const ticket = await SupportTicket.findOne({ id: req.params.ticketId }).lean();
    if (!ticket) throw new HttpError(404, 'Support ticket not found.');
    const chatId = ticketChatId(ticket);
    const chatIds = ticket.corporateClientId ? [chatId] : legacyRetailChatIds(ticket);
    const messages = await Message.find({
      $or: [
        { supportTicketId: ticket.id },
        { chatId: { $in: chatIds } },
      ],
    }).sort({ createdAt: 1 }).limit(300).lean();
    return res.json({ ok: true, ticket: decorateTicket(ticket), chatId, chatIds, messages, rows: messages });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load ticket messages.'));
  }
};

const sendTicketMessage = async (req, res, next) => {
  try {
    const text = safeStr(req.body.text);
    if (!text) throw new HttpError(400, 'Message text is required.');
    const ticket = await SupportTicket.findOne({ id: req.params.ticketId });
    if (!ticket) throw new HttpError(404, 'Support ticket not found.');
    const { actorId, actorEmail } = buildActor(req);
    const chatId = ticketChatId(ticket);
    const recipientId = ticket.customerId || ticket.createdBy || ticket.primaryPortalUserId || ticket.corporateClientId || 'customer';
    const message = await Message.create({
      chatId,
      senderId: actorId,
      senderName: req.user?.name || req.user?.email || 'PrimeJet Support',
      recipientId,
      recipientName: ticket.customerName || ticket.corporateClientName || 'Customer',
      text,
      channel: ticket.corporateClientId ? 'CORPORATE_SUPPORT' : 'SUPPORT_TICKET',
      sourceType: ticket.sourceType || (ticket.corporateClientId ? 'CORPORATE' : 'SUPPORT'),
      supportTicketId: ticket.id,
      corporateClientId: ticket.corporateClientId || undefined,
      orderId: ticket.orderId || undefined,
      metadata: { ticketNo: ticket.ticketNo, subject: ticket.subject },
    });
    ticket.notes = Array.isArray(ticket.notes) ? ticket.notes : [];
    ticket.activity = Array.isArray(ticket.activity) ? ticket.activity : [];
    ticket.notes.push({ text, noteType: 'INTERNAL', authorId: actorId, authorEmail, createdAt: new Date() });
    ticket.activity.push({ action: 'ADMIN_MESSAGE', actorId, actorEmail, note: text, createdAt: new Date() });
    ticket.sla = ticket.sla || {};
    if (!ticket.sla.firstRespondedAt) ticket.sla.firstRespondedAt = new Date();
    if (ticket.status === 'OPEN') ticket.status = 'IN_PROGRESS';
    ticket.lastAdminMessageAt = new Date();
    ticket.unreadForCustomer = safeNum(ticket.unreadForCustomer) + 1;
    await ticket.save();
    const decorated = decorateTicket(ticket);
    socketManager.emitAdmin('support_message_created', { ticket: decorated, message });
    socketManager.emitToRoom(`support-ticket:${ticket.id}`, 'support_message_created', { ticketId: ticket.id, message });
    socketManager.emitToRoom(`corp-ticket:${ticket.id}`, 'support_message_created', { ticketId: ticket.id, message });
    if (ticket.customerId) socketManager.emitToUser(ticket.customerId, 'support_message_created', { ticketId: ticket.id, message });
    return res.status(201).json({ ok: true, message, ticket: decorated, row: message });
  } catch (error) {
    logger.error('[SUPPORT TICKET MESSAGE] Error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to send ticket message.'));
  }
};

const getCustomer360 = async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const customer = await User.findOne({ id: customerId }).select('-password').lean();
    if (!customer) throw new HttpError(404, 'Customer not found.');

    const orderMatch = customerMatchForOrders(customerId);
    const [statsAgg, recentOrders, tickets, notes, chatCount] = await Promise.all([
      Order.aggregate([
        { $match: orderMatch },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            deliveredOrders: { $sum: { $cond: [{ $eq: ['$status', 'Delivered'] }, 1, 0] } },
            activeOrders: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['Delivered', 'Canceled', 'Failed']] },
                  0,
                  1,
                ],
              },
            },
            totalSpent: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'Completed'] }, '$grandTotal', 0] } },
            lastOrderDate: { $max: '$orderDate' },
          },
        },
      ]),
      Order.find(orderMatch).sort({ orderDate: -1, createdAt: -1 }).limit(10).lean(),
      SupportTicket.find({ customerId }).sort({ updatedAt: -1 }).limit(10).lean(),
      CustomerNote.find({ customerId }).sort({ createdAt: -1 }).limit(10).lean(),
      Message.countDocuments({ $or: [{ senderId: customerId }, { recipientId: customerId }] }),
    ]);

    const stats = statsAgg[0] || { totalOrders: 0, deliveredOrders: 0, activeOrders: 0, totalSpent: 0, lastOrderDate: null };
    const openTickets = tickets.filter((t) => !terminalTicketStatuses.includes(t.status)).length;

    return res.json({
      ok: true,
      customer,
      summary: {
        ...stats,
        walletBalance: safeNum(customer.walletBalance),
        openTickets,
        totalTickets: tickets.length,
        chatCount,
      },
      recentOrders,
      tickets: tickets.map(decorateTicket),
      notes,
    });
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load customer 360.'));
  }
};

const getCustomerTimeline = async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const limit = Math.min(100, Math.max(10, safeInt(req.query.limit, 50)));

    const [orders, tickets, notes, messages] = await Promise.all([
      Order.find(customerMatchForOrders(customerId)).sort({ createdAt: -1 }).limit(limit).lean(),
      SupportTicket.find({ customerId }).sort({ createdAt: -1 }).limit(limit).lean(),
      CustomerNote.find({ customerId }).sort({ createdAt: -1 }).limit(limit).lean(),
      Message.find({ $or: [{ senderId: customerId }, { recipientId: customerId }] }).sort({ createdAt: -1 }).limit(limit).lean(),
    ]);

    const events = [];
    orders.forEach((o) => {
      events.push({
        type: 'ORDER',
        refId: o.id,
        title: `Order ${o.status || 'updated'}`,
        description: `${o.recipientName || 'Customer'} • ₦${safeNum(o.grandTotal).toLocaleString()}`,
        status: o.status,
        occurredAt: o.createdAt || o.orderDate,
        payload: o,
      });
      arr(o.statusHistory).forEach((h) =>
        events.push({
          type: 'ORDER_STATUS',
          refId: o.id,
          title: `Order status: ${h.status}`,
          description: h.notes || '',
          status: h.status,
          occurredAt: h.timestamp,
          payload: h,
        })
      );
    });

    tickets.forEach((t) =>
      events.push({
        type: 'TICKET',
        refId: t.id,
        title: `${t.ticketNo || 'Ticket'} • ${t.subject}`,
        description: `${t.status} • ${t.priority}`,
        status: t.status,
        occurredAt: t.createdAt,
        payload: decorateTicket(t),
      })
    );

    notes.forEach((n) =>
      events.push({
        type: 'NOTE',
        refId: n.id,
        title: 'Customer note added',
        description: n.text,
        status: 'NOTE',
        occurredAt: n.createdAt,
        payload: n,
      })
    );

    messages.forEach((m) =>
      events.push({
        type: 'CHAT',
        refId: String(m._id || m.id),
        title: 'Chat message',
        description: m.text,
        status: m.status,
        occurredAt: m.createdAt,
        payload: m,
      })
    );

    events.sort((a, b) => new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0));

    return res.json({ ok: true, customerId, timeline: events.slice(0, limit) });
  } catch (error) {
    next(new HttpError(500, 'Failed to load customer timeline.'));
  }
};

module.exports = {
  getSupportHub,
  getSupportDashboard,
  listTickets,
  createTicket,
  getTicketById,
  updateTicket,
  addTicketNote,
  getTicketMessages,
  sendTicketMessage,
  createTicketFromFailedDelivery,
  getCustomer360,
  getCustomerTimeline,
};
