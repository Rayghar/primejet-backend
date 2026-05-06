// File: socket.manager.js  (updated, drop-in)

const jwt = require('jsonwebtoken');
const config = require('./config/index.js');
const { logger } = require('./config/logger.config');
const chatService = require('./api/v1/chat/chat.service.js'); // NOTE: default import (no {})
const Order = require('./models/order.model');
const { Server } = require('socket.io');
const Message = require('./models/message.model'); // <-- your Mongoose Message
const User = require('./models/user.model');

// If your FCM service lives elsewhere, adjust this path:
let fcmService = null;
try {
  // repo-root fcm.service.js (based on files you shared)
  // eslint-disable-next-line import/no-unresolved
  fcmService = require('./fcm.service.js');
} catch (_) {
  try {
    // alternative location (in case your project uses /api/v1/fcm/)
    // eslint-disable-next-line import/no-unresolved
    fcmService = require('./api/v1/fcm/fcm.service.js');
  } catch (_) {
    fcmService = null;
  }
}

// ---------------------------------------------
// Online tracking (unchanged behavior)
// ---------------------------------------------
const onlineUsers = new Map(); // userId -> Set(socketId)
function addOnline(userId, socketId) {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socketId);
}
function removeOnline(userId, socketId) {
  const s = onlineUsers.get(userId);
  if (!s) return;
  s.delete(socketId);
  if (s.size === 0) onlineUsers.delete(userId);
}
function isUserOnline(userId) {
  return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
}

// ---------------------------------------------
// Module-scoped io + safe emit helpers
// ---------------------------------------------
/** @type {Server|undefined} */
let _io;

/**
 * Emit to all admins (sockets joined to "room:admins").
 * Safe: does nothing if io is not ready.
 */
function emitAdmin(event, payload) {
  try {
    if (!_io) return;
    _io.to('room:admins').emit(event, payload);
  } catch (e) {
    logger.warn('[SOCKET] emitAdmin error:', e?.message || e);
  }
}

/**
 * Emit to a specific user’s personal room "user:<userId>".
 */
function emitToUser(userId, event, payload) {
  try {
    if (!_io || !userId) return;
    _io.to(`user:${userId}`).emit(event, payload);
  } catch (e) {
    logger.warn('[SOCKET] emitToUser error:', e?.message || e);
  }
}

/**
 * Emit to an arbitrary room (e.g., an order/chat room).
 */
function emitToRoom(room, event, payload) {
  try {
    if (!_io || !room) return;
    _io.to(room).emit(event, payload);
  } catch (e) {
    logger.warn('[SOCKET] emitToRoom error:', e?.message || e);
  }
}

/**
 * If user has admin privileges, join the admin room.
 * Accepts both `user.role` and `user.roles` (array) shapes.
 */
function registerAdminSocket(socket, user) {
  try {
    const roles = Array.isArray(user?.roles) ? user.roles : [user?.role].filter(Boolean);
    const isAdmin = roles.some(r => ['admin', 'superadmin', 'super_admin'].includes(String(r).toLowerCase()));
    if (isAdmin) {
      socket.join('room:admins');
      logger.info(`[SOCKET] Admin joined admin room: ${user?.id}`);
    }
  } catch (e) {
    logger.warn('[SOCKET] registerAdminSocket error:', e?.message || e);
  }
}

// ---------------------------------------------
// Main initializer (default export)
// ---------------------------------------------
const initializeSocket = (io) => {
  _io = io; // keep a reference for helpers

  // 1) Authenticate socket with JWT from handshake.auth.token
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    logger.debug('[SOCKET_AUTH] New connection attempt...');

    try {
      if (!token) {
        logger.warn('[SOCKET_AUTH] Rejected: Token not provided.');
        return next(new Error('Authentication error: Token not provided.'));
      }

      const jwtSecret = config.jwt.secret;
      if (!jwtSecret) {
        logger.error('[SOCKET_AUTH] Rejected: JWT_SECRET is missing in config.');
        return next(new Error('Server configuration error.'));
      }

      const decoded = jwt.verify(token, jwtSecret);
      logger.debug(`[SOCKET_AUTH] Token verified for user ID: ${decoded.id}`);

      // --- Start Database Debug ---
      logger.debug(`[SOCKET_AUTH] Searching database for user ID: ${decoded.id}`);
      const user = await User.findOne({ id: decoded.id });
      logger.debug(`[SOCKET_AUTH] Database search finished for user ID: ${decoded.id}`);
      // --- End Database Debug ---

      if (!user || user.status !== 'active') {
        logger.warn(`[SOCKET_AUTH] Rejected: User not found or inactive for ID: ${decoded.id}`);
        return next(new Error('Authentication error: User not found or is inactive.'));
      }

      logger.debug(`[SOCKET_AUTH] User authenticated successfully: ${user.id}`);
      socket.user = user.toObject();
      next();

    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        logger.warn(`[SOCKET_AUTH] Rejected: Invalid token. Error: ${error.name}`);
        return next(new Error('Authentication error: Invalid token.'));
      }
      logger.error('[SOCKET_AUTH] Unexpected middleware error:', { message: error.message });
      next(new Error('An unexpected server error occurred during authentication.'));
    }
  });

  // Helper: check user is a participant and get counterparty
  const getParticipation = async (orderId, userUuid) => {
    const order = await Order.findOne({ id: orderId })
      .populate('customer')
      .populate('driver');
    if (!order) return { ok: false };
    const isCustomer = order.customer && order.customer.id === userUuid;
    const isDriver = order.driver && order.driver.id === userUuid;
    if (!isCustomer && !isDriver) return { ok: false };
    const other = isCustomer ? order.driver?.id : order.customer?.id;
    return { ok: true, otherId: other || null };
  };

  io.on('connection', (socket) => {
    const userId = socket?.user?.id;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    logger.info(`[SOCKET] User connected: ${userId}, Socket ID: ${socket.id}`);
    addOnline(userId, socket.id);

    // 1A) Personal room used for unread bubble pushes
    try {
      socket.join(`user:${userId}`);
    } catch (_) {}

    // 1A.1) If admin, also join admin broadcast room
    registerAdminSocket(socket, socket.user);

    // 1B) Join a chat room (chatId == orderId) with authorization
    socket.on('join_room', async (orderId) => {
      try {
        const { ok } = await getParticipation(orderId, userId);
        if (!ok) return socket.emit('message_error', { message: 'Not authorized to join this room.' });
        socket.join(orderId);
        logger.info(`[SOCKET] ${userId} joined room ${orderId}`);
      } catch (e) {
        logger.error('[SOCKET] join_room error', e);
        socket.emit('message_error', { message: 'Failed to join room.' });
      }
    });

    // 1C) Send message → persist, broadcast, ack, delivered heuristic, unread count, FCM push
    socket.on('send_message', async (data = {}) => {
      try {
        const { chatId, recipientId, text, tempId } = data || {};
        if (!chatId || !text) {
          return socket.emit('message_error', { message: 'Invalid payload.' });
        }

        // Ensure sender is participant; compute true counterparty if available
        const { ok, otherId } = await getParticipation(chatId, userId);
        if (!ok) {
          return socket.emit('message_error', { message: 'Not authorized.' });
        }

        const finalRecipientId = otherId || recipientId || null;

        // Persist message (status defaults to "sent" in model/service)
        const saved = await chatService.saveChatMessage({
          chatId,
          senderId: userId,
          recipientId: finalRecipientId,
          text: String(text).slice(0, 2000).trim(),
        });

        // Broadcast to everyone in the chat room
        io.to(chatId).emit('receive_message', {
          _id: saved._id,
          id: saved._id, // handy for clients
          chatId: saved.chatId,
          senderId: saved.senderId,
          recipientId: saved.recipientId,
          text: saved.text,
          status: saved.status, // 'sent'
          createdAt: saved.createdAt,
          updatedAt: saved.updatedAt,
        });

        // ACK to reconcile optimistic bubble
        if (tempId) {
          socket.emit('message_ack', { chatId, messageId: saved._id, tempId });
        }

        // ---- OPTIONAL but implemented: delivered heuristic ----
        try {
          const room = io.sockets.adapter.rooms.get(chatId);
          const someoneElsePresent = room && room.size > 1;
          if (someoneElsePresent) {
            const upd = await Message.updateOne(
              { _id: saved._id, status: 'sent' },
              { $set: { status: 'delivered' } }
            );
            if (upd.modifiedCount) {
              io.to(chatId).emit('message_status', {
                chatId,
                messageId: saved._id,
                status: 'delivered',
              });
            }
          }
        } catch (_) { /* ignore */ }

        // ---- Unread count -> recipient personal room ----
        try {
          if (finalRecipientId) {
            const unread = await Message.countDocuments({
              chatId,
              recipientId: finalRecipientId,
              status: { $in: ['sent', 'delivered'] },
            });
            io.to(`user:${finalRecipientId}`).emit('thread_unread', { chatId, unread });
          }
        } catch (_) { /* ignore */ }

        // ---- FCM push (recipient only) ----
        try {
          if (finalRecipientId && fcmService && typeof fcmService.pushToUser === 'function') {
            await fcmService.pushToUser(finalRecipientId, {
              notification: {
                title: 'New message',
                body:
                  String(saved.text).length > 120
                    ? String(saved.text).slice(0, 117) + '…'
                    : String(saved.text),
              },
              data: {
                type: 'chat',
                chatId: saved.chatId,
                senderId: saved.senderId,
                messageId: String(saved._id),
              },
            });
          }
        } catch (e) {
          logger.warn('[FCM] push error:', e?.message || e);
        }
      } catch (e) {
        logger.error('[SOCKET] send_message error', e);
        socket.emit('message_error', { message: 'Failed to send message.' });
      }
    });

    // Mark read → update DB, emit receipts, clear unread bubble (1D)
    socket.on('mark_read', async ({ chatId }) => {
      try {
        if (!chatId) return;
        const res = await Message.updateMany(
          { chatId, recipientId: userId, status: { $in: ['sent', 'delivered'] } },
          { $set: { status: 'read' } }
        );

        if (res.modifiedCount) {
          io.to(chatId).emit('chat_read', { chatId });              // ticks in chat
          io.to(`user:${userId}`).emit('thread_read', { chatId });  // clear bubble for opener
        }
      } catch (err) {
        logger.error('[SOCKET] mark_read error', err);
        socket.emit('message_error', { message: 'mark_read failed' });
      }
    });

    socket.on('disconnect', () => {
      removeOnline(userId, socket.id);
      logger.info(`[SOCKET] User disconnected: ${userId}`);
    });

    socket.on('update_location', (data) => {
        // data: { driverId, lat, lng }
        // Broadcast to all Admins listening on 'driver_location_update'
        io.emit('driver_location_update', data);
    });
  });
};

// Keep backward compatibility: default export is the initializer
module.exports = initializeSocket;

// Also expose helpers for other modules (e.g., controllers/services) without breaking the default export.
module.exports.emitAdmin = emitAdmin;
module.exports.emitToUser = emitToUser;
module.exports.emitToRoom = emitToRoom;
module.exports.isUserOnline = isUserOnline;