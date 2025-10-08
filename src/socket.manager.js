// socket.manager.js
const jwt = require('jsonwebtoken');
const config = require('./config/index.js');
const { logger } = require('./config/logger.config');
const chatService = require('./api/v1/chat/chat.service.js');
const Order = require('./models/order.model');
const User = require('./models/user.model');
const fcmService = require('./api/v1/fcm/fcm.service.js');

const onlineUsers = new Map(); // userId -> Set(socketId)

function isUserOnline(userId) {
  return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
}

const initializeSocket = (io) => {
  // --- Authentication Middleware ---
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication error: Token not provided.'));
    }
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      const user = await User.findOne({ id: decoded.id }).lean();
      if (!user || user.status !== 'active') {
        return next(new Error('Authentication error: User not found or is inactive.'));
      }
      socket.user = user;
      next();
    } catch (error) {
      return next(new Error('Authentication error: Invalid token.'));
    }
  });

  // --- Connection Handler ---
  io.on('connection', (socket) => {
    const userId = socket.user.id;
    logger.info(`[SOCKET] User connected: ${userId}, Socket ID: ${socket.id}`);
    
    // Add user to online map
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    // --- Room Management ---
    socket.join(`user:${userId}`);
    if (socket.user.role === 'admin') {
      socket.join('admins');
      logger.info(`[SOCKET] Admin user ${userId} joined 'admins' room`);
    }

    socket.on('join_room', async (chatId) => {
      try {
        const order = await Order.findOne({ id: chatId }).lean();
        if (!order) return;

        const isParticipant = order.customerId === userId || order.driverId === userId;
        if (isParticipant) {
          socket.join(chatId);
          logger.info(`[SOCKET] User ${userId} joined chat room: ${chatId}`);
        }
      } catch (e) {
        logger.error('[SOCKET] join_room error', e);
      }
    });

    // --- Message Handling ---
    socket.on('send_message', async (data = {}) => {
      const { chatId, text, tempId } = data;
      if (!chatId || !text) return;

      try {
        const order = await Order.findOne({ id: chatId }).lean();
        if (!order) return;

        const isCustomer = order.customerId === userId;
        const recipientId = isCustomer ? order.driverId : order.customerId;
        if (!recipientId) return;

        // 1. Create and save the message using the service
        const savedMessage = await chatService.createMessage({
          chatId,
          senderId: userId,
          recipientId,
          text,
        });

        // 2. Broadcast the message to the chat room
        io.to(chatId).emit('receive_message', savedMessage);
        logger.info(`[SOCKET] Broadcast 'receive_message' to room ${chatId}`);
        
        // 3. Acknowledge the sender to replace temp ID
        if (tempId) {
          socket.emit('message_ack', { chatId, messageId: savedMessage._id, tempId });
        }

        // 4. Handle 'delivered' status if recipient is online
        if (isUserOnline(recipientId)) {
          await chatService.setDeliveredIfSent(savedMessage._id);
          io.to(chatId).emit('message_status', { chatId, messageId: savedMessage._id, status: 'delivered' });
        }
        
        // 5. Send a push notification to the recipient
        const sender = socket.user;
        await fcmService.notifyMessage({
            recipientId: recipientId,
            title: `New Message from ${sender.name}`,
            body: savedMessage.text,
            data: {
                type: 'new_message',
                orderId: chatId, // a.k.a orderId
                senderId: sender.id,
                screen: 'chat_screen'
            }
        });
        logger.info(`[FCM] Sent chat push notification to ${recipientId}`);

      } catch (e) {
        logger.error('[SOCKET] send_message error', e);
        socket.emit('message_error', { message: 'Failed to send message.' });
      }
    });

    socket.on('mark_read', async ({ chatId }) => {
      if (!chatId) return;
      try {
        const result = await chatService.markChatRead(userId, chatId);
        if (result.modifiedCount > 0) {
          // Notify the room so the sender's ticks turn blue
          io.to(chatId).emit('chat_read', { chatId });
          logger.info(`[SOCKET] Broadcast 'chat_read' to room ${chatId} for user ${userId}`);
        }
      } catch (err) {
        logger.error('[SOCKET] mark_read error', err);
      }
    });
    
    // --- Disconnect Handler ---
    socket.on('disconnect', () => {
      if (onlineUsers.has(userId)) {
        onlineUsers.get(userId).delete(socket.id);
        if (onlineUsers.get(userId).size === 0) {
          onlineUsers.delete(userId);
        }
      }
      logger.info(`[SOCKET] User disconnected: ${userId}`);
    });
  });
};

module.exports = initializeSocket;