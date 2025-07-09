// tests/unit/api/v1/chat/chat.service.test.js
// OR src/api/v1/chat/chat.service.js

const chatService = require('../../src/api/v1/chat/chat.service'); // Adjust path
const User = require('../../src/models/user.model'); // Adjust path
const Order = require('../../src/models/order.model'); // Adjust path
const firebaseService = require('../../src/services/firebase.service'); // Adjust path
const HttpError = require('../../src/utils/HttpError'); // Adjust path

// --- Mocking Dependencies ---
jest.mock('../../src/models/user.model');
jest.mock('../../src/models/order.model');
jest.mock('../../src/services/firebase.service.js'); // Mock the entire firebaseService

describe('Chat Service', () => {
  const mockOrderId = 'order-123';
  const mockSenderId = 'user-sender-123';
  const mockRecipientId = 'user-recipient-456';
  const mockAdminId = 'user-admin-789';

  let mockSender, mockRecipient, mockAdmin, mockOrder;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSender = { id: mockSenderId, role: 'customer', name: 'Sender User', toObject: () => mockSender };
    mockRecipient = { id: mockRecipientId, role: 'driver', name: 'Recipient Driver', toObject: () => mockRecipient };
    mockAdmin = { id: mockAdminId, role: 'admin', name: 'Admin User', toObject: () => mockAdmin };
    mockOrder = { 
      id: mockOrderId, 
      customerId: mockSenderId, 
      driverId: mockRecipientId, // Assume recipient is the assigned driver for one scenario
      toObject: () => mockOrder 
    };

    // Default mock implementations
    User.findOne.mockImplementation(({ id }) => {
      if (id === mockSenderId) return Promise.resolve({ select: jest.fn().mockResolvedValue(mockSender) });
      if (id === mockRecipientId) return Promise.resolve({ select: jest.fn().mockResolvedValue(mockRecipient) });
      if (id === mockAdminId) return Promise.resolve({ select: jest.fn().mockResolvedValue(mockAdmin) });
      return Promise.resolve({ select: jest.fn().mockResolvedValue(null) }); // Default to not found
    });

    Order.findOne.mockImplementation(({ id }) => {
      if (id === mockOrderId) return Promise.resolve({ select: jest.fn().mockResolvedValue(mockOrder) });
      return Promise.resolve({ select: jest.fn().mockResolvedValue(null) }); // Default to not found
    });

    firebaseService.initiateChat.mockResolvedValue({ chatId: 'firebase-chat-id-xyz' });
  });

  describe('initiateChatSession', () => {
    it('should successfully initiate chat between customer (sender) and assigned driver (recipient)', async () => {
      const result = await chatService.initiateChatSession(mockOrderId, mockSenderId, mockRecipientId);
      
      expect(User.findOne).toHaveBeenCalledTimes(2);
      expect(Order.findOne).toHaveBeenCalledWith({ id: mockOrderId });
      expect(firebaseService.initiateChat).toHaveBeenCalledWith(mockOrderId, mockSenderId, mockRecipientId);
      expect(result).toEqual({
        chatId: 'firebase-chat-id-xyz',
        message: `Chat session initiated with ${mockRecipient.name}.`,
        participants: [
            { userId: mockSender.id, name: mockSender.name, role: mockSender.role },
            { userId: mockRecipient.id, name: mockRecipient.name, role: mockRecipient.role }
        ]
      });
    });

    it('should successfully initiate chat between driver (sender) and customer (recipient)', async () => {
      // Swap sender and recipient for this test
      User.findOne.mockImplementation(({ id }) => {
        if (id === mockRecipientId) return Promise.resolve({ select: jest.fn().mockResolvedValue(mockRecipient) }); // Driver is now sender
        if (id === mockSenderId) return Promise.resolve({ select: jest.fn().mockResolvedValue(mockSender) });   // Customer is now recipient
        return Promise.resolve({ select: jest.fn().mockResolvedValue(null) });
      });
      mockOrder.customerId = mockSenderId; // Customer ID on order
      mockOrder.driverId = mockRecipientId; // Driver ID on order

      const result = await chatService.initiateChatSession(mockOrderId, mockRecipientId, mockSenderId); // Driver initiates
      
      expect(firebaseService.initiateChat).toHaveBeenCalledWith(mockOrderId, mockRecipientId, mockSenderId);
      expect(result.message).toBe(`Chat session initiated with ${mockSender.name}.`);
    });
    
    it('should successfully initiate chat between admin (sender) and customer (recipient)', async () => {
      User.findOne.mockImplementation(({ id }) => {
        if (id === mockAdminId) return Promise.resolve({ select: jest.fn().mockResolvedValue(mockAdmin) });
        if (id === mockSenderId) return Promise.resolve({ select: jest.fn().mockResolvedValue(mockSender) }); // Customer
        return Promise.resolve({ select: jest.fn().mockResolvedValue(null) });
      });
      mockOrder.customerId = mockSenderId; // Customer is part of the order

      const result = await chatService.initiateChatSession(mockOrderId, mockAdminId, mockSenderId);
      expect(firebaseService.initiateChat).toHaveBeenCalledWith(mockOrderId, mockAdminId, mockSenderId);
      expect(result.message).toBe(`Chat session initiated with ${mockSender.name}.`);
    });

    it('should throw HttpError 404 if sender not found', async () => {
      User.findOne.mockImplementation(({ id }) => {
        if (id === mockSenderId) return Promise.resolve({ select: jest.fn().mockResolvedValue(null) }); // Sender not found
        if (id === mockRecipientId) return Promise.resolve({ select: jest.fn().mockResolvedValue(mockRecipient) });
        return Promise.resolve({ select: jest.fn().mockResolvedValue(null) });
      });
      await expect(chatService.initiateChatSession(mockOrderId, mockSenderId, mockRecipientId))
        .rejects.toThrow(new HttpError(404, `Sender (user ID: ${mockSenderId}) not found.`));
    });

    it('should throw HttpError 404 if recipient not found', async () => {
      User.findOne.mockImplementation(({ id }) => {
        if (id === mockSenderId) return Promise.resolve({ select: jest.fn().mockResolvedValue(mockSender) });
        if (id === mockRecipientId) return Promise.resolve({ select: jest.fn().mockResolvedValue(null) }); // Recipient not found
        return Promise.resolve({ select: jest.fn().mockResolvedValue(null) });
      });
      await expect(chatService.initiateChatSession(mockOrderId, mockSenderId, mockRecipientId))
        .rejects.toThrow(new HttpError(404, `Recipient (user ID: ${mockRecipientId}) not found.`));
    });

    it('should throw HttpError 404 if order not found', async () => {
      Order.findOne.mockImplementationOnce(() => Promise.resolve({ select: jest.fn().mockResolvedValue(null) }));
      await expect(chatService.initiateChatSession(mockOrderId, mockSenderId, mockRecipientId))
        .rejects.toThrow(new HttpError(404, `Order (ID: ${mockOrderId}) not found for chat context.`));
    });

    it('should throw HttpError 403 if customer tries to chat with another customer for an order', async () => {
      const anotherCustomerId = 'another-customer-id';
      const mockAnotherCustomer = { id: anotherCustomerId, role: 'customer', name: 'Another Customer', toObject: () => mockAnotherCustomer };
      User.findOne.mockImplementation(({ id }) => {
        if (id === mockSenderId) return Promise.resolve({ select: jest.fn().mockResolvedValue(mockSender) }); // Sender is customer
        if (id === anotherCustomerId) return Promise.resolve({ select: jest.fn().mockResolvedValue(mockAnotherCustomer) }); // Recipient is also customer
        return Promise.resolve({ select: jest.fn().mockResolvedValue(null) });
      });
      // Order belongs to sender, but they are trying to chat with another customer
      mockOrder.customerId = mockSenderId;
      mockOrder.driverId = 'some-driver-id'; 

      await expect(chatService.initiateChatSession(mockOrderId, mockSenderId, anotherCustomerId))
        .rejects.toThrow(new HttpError(403, 'These users are not authorized to chat in the context of this order.'));
    });
    
    it('should throw HttpError 403 if customer tries to chat with a driver not assigned to the order', async () => {
        const unassignedDriverId = 'unassigned-driver-id';
        const mockUnassignedDriver = {id: unassignedDriverId, role: 'driver', name: 'Unassigned Driver'};
        User.findOne.mockImplementation(({ id }) => {
            if (id === mockSenderId) return Promise.resolve({ select: jest.fn().mockResolvedValue(mockSender) }); // Sender is customer
            if (id === unassignedDriverId) return Promise.resolve({ select: jest.fn().mockResolvedValue(mockUnassignedDriver) });
            return Promise.resolve({ select: jest.fn().mockResolvedValue(null) });
        });
        mockOrder.customerId = mockSenderId;
        mockOrder.driverId = 'definitely-not-unassigned-driver-id'; // Order assigned to different driver

        await expect(chatService.initiateChatSession(mockOrderId, mockSenderId, unassignedDriverId))
            .rejects.toThrow(new HttpError(403, 'These users are not authorized to chat in the context of this order.'));
    });

    it('should throw HttpError (from firebaseService) if firebaseService.initiateChat fails', async () => {
      const firebaseErrorMsg = 'Firebase chat creation failed';
      firebaseService.initiateChat.mockRejectedValueOnce(new Error(firebaseErrorMsg)); // Simulate firebaseService failure
      
      await expect(chatService.initiateChatSession(mockOrderId, mockSenderId, mockRecipientId))
        .rejects.toThrow(new HttpError(500, `Failed to initiate chat: ${firebaseErrorMsg}`));
    });
    
    it('should throw HttpError 500 for unexpected User.findOne error', async () => {
        User.findOne.mockRejectedValueOnce(new Error('DB User find error'));
        await expect(chatService.initiateChatSession(mockOrderId, mockSenderId, mockRecipientId))
            .rejects.toThrow(new HttpError(500, 'Failed to initiate chat session due to an unexpected error.'));
    });
    
    it('should throw HttpError 500 for unexpected Order.findOne error', async () => {
        Order.findOne.mockRejectedValueOnce(new Error('DB Order find error'));
        await expect(chatService.initiateChatSession(mockOrderId, mockSenderId, mockRecipientId))
            .rejects.toThrow(new HttpError(500, 'Failed to initiate chat session due to an unexpected error.'));
    });
  });
});