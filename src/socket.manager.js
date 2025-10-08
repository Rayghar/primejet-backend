// socket.manager.js
const jwt = require('jsonwebtoken');
const config = require('./config/index.js');
const { logger } = require('./config/logger.config');
const chatService = require('./api/v1/chat/chat.service.js');
const Order = require('./models/order.model');
const User = require('./models/user.model');
const Run = require('./models/run.model'); // Import Run model
const fcmService = require('./api/v1/fcm/fcm.service.js');

const onlineUsers = new Map(); // userId -> Set(socketId)

function isUserOnline(userId) {
  return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
}

const initializeSocket = (io) => {
  // --- Authentication Middleware ---
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication error: Token not provided.'));
      
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
        if (order && (order.customerId === userId || order.driverId === userId)) {
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

        const savedMessage = await chatService.createMessage({ chatId, senderId: userId, recipientId, text });
        io.to(chatId).emit('receive_message', savedMessage);
        
        if (tempId) {
          socket.emit('message_ack', { chatId, messageId: savedMessage._id, tempId });
        }

        if (isUserOnline(recipientId)) {
          await chatService.setDeliveredIfSent(savedMessage._id);
          io.to(chatId).emit('message_status', { chatId, messageId: savedMessage._id, status: 'delivered' });
        }
        
        await fcmService.notifyMessage({
            recipientId: recipientId,
            title: `New Message from ${socket.user.name}`,
            body: savedMessage.text,
            data: { type: 'new_message', orderId: chatId, senderId: userId, screen: 'chat_screen' }
        });

      } catch (e) {
        logger.error('[SOCKET] send_message error', e);
      }
    });

    socket.on('mark_read', async ({ chatId }) => {
      if (!chatId) return;
      try {
        const result = await chatService.markChatRead(userId, chatId);
        if (result.modifiedCount > 0) {
          io.to(chatId).emit('chat_read', { chatId });
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

  // ===== FIX: Add a global listener for events from other services =====
  // This requires a simple event emitter setup in your app's main entry point (e.g., server.js)
  const appEvents = require('./utils/eventEmitter'); // Assuming you create this file

  appEvents.on('orderStatusChanged', async ({ order, run, oldStatus }) => {
      logger.info(`[EVENT] orderStatusChanged detected for order ${order.id}`);

      // 1. Emit live socket events
      io.to(`user:${order.customerId}`).emit('order_update', order);
      if (run) {
        io.to(`user:${run.driverId}`).emit('run_update', run);
        io.to('admins').emit('run_update', run);
      }

      // 2. Send push notification if the status has meaningfully changed
      if (oldStatus !== order.status) {
          await fcmService.notifyMessage({
              recipientId: order.customerId,
              title: 'Order Update',
              body: `Your order status is now: ${order.status}`,
              data: { type: 'ORDER_UPDATE', orderId: order.id, screen: 'order_details' }
          });
          logger.info(`[FCM] Sent status update push notification for order ${order.id}`);
      }
  });
};

module.exports = initializeSocket;