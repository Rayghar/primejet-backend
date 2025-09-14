// src/socket.manager.js
const jwt = require('jsonwebtoken');
const config = require('./config/index.js');
const { logger } = require('./config/logger.config');
const { chatService } = require('./api/v1/chat/chat.service.js'); // We'll update chat.service to export new methods

const initializeSocket = (io) => {
  // Middleware to authenticate socket connections using the app's JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error: Token not provided.'));
    }
    jwt.verify(token, config.jwt.secret, (err, decoded) => {
      if (err) {
        return next(new Error('Authentication error: Invalid token.'));
      }
      socket.user = decoded; // Attach user payload (e.g., { id, role }) to the socket
      next();
    });
  });

  io.on('connection', (socket) => {
    logger.info(`[SOCKET] User connected: ${socket.user.id}, Socket ID: ${socket.id}`);

    // Have the client join a room based on the orderId
    socket.on('join_room', (orderId) => {
      socket.join(orderId);
      logger.info(`[SOCKET] User ${socket.user.id} joined room: ${orderId}`);
    });

    // Listen for new messages from a client
    socket.on('send_message', async (data) => {
      // data = { chatId (orderId), recipientId, text }
      const messagePayload = {
        chatId: data.chatId,
        senderId: socket.user.id,
        recipientId: data.recipientId,
        text: data.text,
      };
      
      try {
        // 1. Save the message to the MongoDB database
        const savedMessage = await chatService.saveChatMessage(messagePayload);
        
        // 2. Send the message to the other user in the room
        // We emit to the room (which is the chatId/orderId)
        io.to(data.chatId).emit('receive_message', savedMessage);
        logger.info(`[SOCKET] Message sent from ${socket.user.id} in room ${data.chatId}`);

      } catch (error) {
        logger.error('[SOCKET] Error saving or sending message:', error);
        // Optionally, emit an error back to the sender
        socket.emit('message_error', { message: 'Failed to send message.' });
      }
    });

    socket.on('disconnect', () => {
      logger.info(`[SOCKET] User disconnected: ${socket.user.id}`);
    });
  });
};

module.exports = initializeSocket;