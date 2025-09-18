// socket.manager.js
const jwt = require('jsonwebtoken');
const { logger } = require('./config/logger.config');
const config = require('./config/index.js');
const Order = require('./models/order.model');
const Message = require('./models/message.model');
const chatService = require('./api/v1/chat/chat.service.js');

/**
 * Attach all socket middleware and event handlers to an existing io instance.
 * Call from server.js after you create the HTTP server.
 */
function initializeSocket(io) {
  // 1) Authenticate every socket using the JWT passed in handshake.auth.token
  io.use((socket, next) => {
    const token = socket.handshake?.auth?.token;
    if (!token) return next(new Error('Authentication error: Token not provided.'));
    jwt.verify(token, config.jwt.secret, (err, user) => {
      if (err) return next(new Error('Authentication error: Invalid token.'));
      socket.user = user; // expect at least { id: 'uuid', ... }
      next();
    });
  });

  // Helper — verify the user belongs to the order chat and return the counterparty's id
  async function getParticipation(orderId, userUuid) {
    const order = await Order.findOne({ id: orderId }).lean();
    if (!order) return { ok: false };
    const isCustomer = order.customerId === userUuid;
    const isDriver   = order.driverId === userUuid;
    if (!isCustomer && !isDriver) return { ok: false };
    const otherId = isCustomer ? order.driverId : order.customerId;
    return { ok: true, otherId: otherId || null };
  }

  io.on('connection', (socket) => {
    const userId = socket.user?.id;
    logger.info(`[SOCKET] Connected ${userId} (${socket.id})`);

    // --- join a chat room (chatId === orderId) ---
    socket.on('join_room', async (chatId) => {
      try {
        if (!chatId) return;
        const { ok } = await getParticipation(chatId, userId);
        if (!ok) return socket.emit('message_error', { message: 'Not authorized to join this chat.' });
        socket.join(chatId);
        logger.info(`[SOCKET] ${userId} joined ${chatId}`);
      } catch (e) {
        logger.error('[SOCKET] join_room error', e);
        socket.emit('message_error', { message: 'Failed to join room.' });
      }
    });

    // --- send a message ---
    socket.on('send_message', async ({ chatId, text, tempId }) => {
      try {
        if (!chatId || !text) return socket.emit('message_error', { message: 'Invalid payload.' });
        const { ok, otherId } = await getParticipation(chatId, userId);
        if (!ok) return socket.emit('message_error', { message: 'Not authorized.' });

        const saved = await chatService.saveChatMessage({
          chatId,
          senderId: userId,
          recipientId: otherId || null,   // may be null if driver not yet assigned
          text: String(text).slice(0, 2000).trim(),
        });

        io.to(chatId).emit('receive_message', saved);
        if (tempId) socket.emit('message_ack', { chatId, messageId: saved._id, tempId });
      } catch (e) {
        logger.error('[SOCKET] send_message error', e);
        socket.emit('message_error', { message: 'Failed to send message.' });
      }
    });

    // --- delivery receipt (recipient device confirms it got the message) ---
    socket.on('message_delivered', async ({ messageId, chatId }) => {
      try {
        if (!messageId || !chatId) return;
        const res = await Message.updateOne(
          { _id: messageId, recipientId: userId, status: 'sent' },
          { $set: { status: 'delivered' } }
        );
        if (res.modifiedCount) {
          io.to(chatId).emit('message_status', { chatId, messageId, status: 'delivered' });
        }
      } catch (_) {}
    });

    // --- mark all incoming messages in this chat as read ---
    socket.on('mark_read', async ({ chatId }) => {
      try {
        if (!chatId) return;
        const res = await Message.updateMany(
          { chatId, recipientId: userId, status: { $in: ['sent', 'delivered'] } },
          { $set: { status: 'read' } }
        );
        if (res.modifiedCount) {
          io.to(chatId).emit('chat_read', { chatId });
        }
      } catch (_) {}
    });

    socket.on('disconnect', () => {
      logger.info(`[SOCKET] Disconnected ${userId}`);
    });
  });
}

module.exports = initializeSocket;
