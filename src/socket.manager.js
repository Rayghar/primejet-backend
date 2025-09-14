const jwt = require('jsonwebtoken');
const config = require('./config/index.js');
const { logger } = require('./config/logger.config');
const chatService = require('./api/v1/chat/chat.service.js'); // NOTE: default import (no {})
const Order = require('./models/order.model');

const initializeSocket = (io) => {
  // 1) Authenticate socket with JWT from handshake.auth.token
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error: Token not provided.'));
    jwt.verify(token, config.jwt.secret, (err, decoded) => {
      if (err) return next(new Error('Authentication error: Invalid token.'));
      socket.user = decoded; // e.g., { id, role, ... }
      next();
    });
  });

  // Helper: check user is a participant and get counterparty
  const getParticipation = async (orderId, userUuid) => {
    const order = await Order.findOne({ id: orderId }).populate('customer').populate('driver');
    if (!order) return { ok: false };
    const isCustomer = order.customer && order.customer.id === userUuid;
    const isDriver   = order.driver   && order.driver.id   === userUuid;
    if (!isCustomer && !isDriver) return { ok: false };
    const other = isCustomer ? order.driver?.id : order.customer?.id;
    return { ok: true, otherId: other || null };
  };

  io.on('connection', (socket) => {
    logger.info(`[SOCKET] User connected: ${socket.user.id}, Socket ID: ${socket.id}`);

    // 2) Only allow joining rooms you belong to
    socket.on('join_room', async (orderId) => {
      try {
        const { ok } = await getParticipation(orderId, socket.user.id);
        if (!ok) return socket.emit('message_error', { message: 'Not authorized to join this room.' });
        socket.join(orderId);
        logger.info(`[SOCKET] ${socket.user.id} joined room ${orderId}`);
      } catch (e) {
        logger.error('[SOCKET] join_room error', e);
        socket.emit('message_error', { message: 'Failed to join room.' });
      }
    });

    // 3) Only allow sending to your own chat; server sets real recipientId
    socket.on('send_message', async (data = {}) => {
      try {
        const { chatId, text, tempId } = data;
        if (!chatId || !text) return socket.emit('message_error', { message: 'Invalid payload.' });

        const { ok, otherId } = await getParticipation(chatId, socket.user.id);
        if (!ok || !otherId) return socket.emit('message_error', { message: 'Not authorized.' });

        const saved = await chatService.saveChatMessage({
          chatId,
          senderId: socket.user.id,
          recipientId: otherId,                         // server decides the counterparty
          text: String(text).slice(0, 2000).trim(),     // limit & sanitize
        });

        io.to(chatId).emit('receive_message', saved);   // broadcast to room
        socket.emit('message_ack', { chatId, messageId: saved._id, tempId }); // ack to sender
      } catch (e) {
        logger.error('[SOCKET] send_message error', e);
        socket.emit('message_error', { message: 'Failed to send message.' });
      }
    });

    socket.on('disconnect', () => {
      logger.info(`[SOCKET] User disconnected: ${socket.user.id}`);
    });
  });
};

module.exports = initializeSocket;
