const jwt = require('jsonwebtoken');
const config = require('./config/index.js');
const { logger } = require('./config/logger.config');
const chatService = require('./api/v1/chat/chat.service.js'); // NOTE: default import (no {})
const Order = require('./models/order.model');
const { Server } = require('socket.io');
const Message = require('./models/message.model'); // <-- your Mongoose Message
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

  function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    path: '/socket.io', // keep default if you didn't change it client-side
  });

  io.on('connection', (socket) => {
    const userId = socket?.user?.id;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    // Join a chat room (chatId == orderId)
    socket.on('join_room', (chatId) => {
      if (!chatId) return;
      socket.join(chatId);
    });

    // Send a message
    socket.on('send_message', async ({ chatId, recipientId, text, tempId }) => {
      try {
        if (!chatId || !recipientId || !text) return;

        // Persist as "sent"
        const msg = await Message.create({
          chatId,
          senderId: userId,
          recipientId,
          text,
          status: 'sent',
        });

        // Broadcast the new message to the room
        io.to(chatId).emit('receive_message', {
          _id: msg._id,
          id: msg._id,           // helpful for client models
          chatId: msg.chatId,
          senderId: msg.senderId,
          recipientId: msg.recipientId,
          text: msg.text,
          status: msg.status,
          createdAt: msg.createdAt,
          updatedAt: msg.updatedAt,
        });

        // Let the sender reconcile optimistic bubble
        if (tempId) {
          socket.emit('message_ack', { tempId, messageId: msg._id.toString() });
        }
      } catch (err) {
        socket.emit('message_error', { message: 'Could not send message' });
      }
    });

    // Recipient confirms the message reached their device
    socket.on('message_delivered', async ({ messageId, chatId }) => {
      try {
        if (!messageId || !chatId) return;

        const res = await Message.updateOne(
          { _id: messageId, recipientId: userId, status: 'sent' },
          { $set: { status: 'delivered' } }
        );

        if (res.modifiedCount) {
          io.to(chatId).emit('message_status', {
            chatId,
            messageId,
            status: 'delivered',
          });
        }
      } catch (err) {
        // swallow
      }
    });

    // User opened the chat: mark all incoming messages as read
    socket.on('mark_read', async ({ chatId }) => {
      try {
        if (!chatId) return;

        const res = await Message.updateMany(
          {
            chatId,
            recipientId: userId,
            status: { $in: ['sent', 'delivered'] },
          },
          { $set: { status: 'read' } }
        );

        if (res.modifiedCount) {
          // Let everyone in the room (incl. the sender) know this chat was read
          io.to(chatId).emit('chat_read', { chatId });
        }
      } catch (err) {
        // swallow
      }
    });

    socket.on('disconnect', () => {});
  });

  return io;
}

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
        if (!chatId || !text) {
          return socket.emit('message_error', { message: 'Invalid payload.' });
        }

        const { ok, otherId } = await getParticipation(chatId, socket.user.id);
        // If user is a legit participant (customer or driver), allow sending even if the other party isn't assigned yet.
        if (!ok) return socket.emit('message_error', { message: 'Not authorized.' });

        const saved = await chatService.saveChatMessage({
          chatId,
          senderId: socket.user.id,
          recipientId: otherId || null,      // may be null until driver is assigned
          text: String(text).slice(0, 2000).trim(),
        });

        io.to(chatId).emit('receive_message', saved);       // broadcast to everyone in the room
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
