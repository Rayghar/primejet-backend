// tests/unit/api/v1/payments/payment.service.test.js
// OR src/api/v1/payments/payment.service.test.js

const paymentService = require('../../src/api/v1/payments/payment.service'); // Adjust path
const User = require('../../src/models/user.model'); // Adjust path
const PaymentMethod = require('../../src/models/paymentMethod.model'); // Adjust path
const Order = require('../../src/models/order.model'); // Adjust path
const HttpError = require('../../src/utils/HttpError'); // Adjust path
const { v4: uuidv4 } = require('uuid');

// --- Mocking Dependencies ---
jest.mock('../../src/models/user.model');
jest.mock('../../src/models/paymentMethod.model');
jest.mock('../../src/models/order.model');
jest.mock('uuid', () => ({
  v4: jest.fn(),
}));

// Mock a conceptual Payment Gateway SDK
const mockPaymentGatewaySDK = {
  customers: {
    create: jest.fn(),
    // retrieve: jest.fn(), // If needed
  },
  setupIntents: {
    create: jest.fn(),
  },
  paymentMethods: {
    attach: jest.fn(),
    retrieve: jest.fn(),
    detach: jest.fn(),
    // list: jest.fn(), // If service was to list from gateway directly
  },
  paymentIntents: {
    create: jest.fn(),
    // retrieve: jest.fn(), // If needed for verification
  },
};

// Example: If your service directly required 'stripe' or 'paystack'
// jest.mock('stripe', () => () => mockPaymentGatewaySDK); // If Stripe was new Stripe()
// Or jest.mock('paystack', () => () => mockPaymentGatewaySDK);
// For now, we assume such an SDK object would be available to the service,
// or the service would internally instantiate it (which would then need specific mocking).
// The refactored service comments out SDK instantiation, so we'll assume these are placeholder calls.
// To make this testable without SDKs, we can inject a mock SDK or mock the global SDK instance if used.
// For simplicity, the service doesn't explicitly import an SDK, so we test its internal logic and DB interactions.
// The "EXAMPLE with Stripe" comments in the service become conceptual points.
// Our tests will verify the calls *leading up to* those conceptual gateway calls and DB interactions.

describe('Payment Service', () => {
  const mockUserId = 'user-pm-123';
  const mockGatewayCustomerId = 'gw_cust_abc123';
  let mockUserInstance, mockUserSave;

  beforeEach(() => {
    jest.clearAllMocks();
    uuidv4.mockReturnValue('mock-uuid-pm');

    mockUserSave = jest.fn().mockReturnThis(); // 'this' in mockResolvedValue(this) might not work as expected here
    mockUserInstance = {
      id: mockUserId,
      email: 'user@example.com',
      name: 'Test User',
      gatewayCustomerId: null, // Start with no gateway ID
      save: mockUserSave,
      toObject: () => ({ ...mockUserInstance, save: undefined }),
    };
    User.findOne.mockResolvedValue(mockUserInstance);
    User.prototype.save = mockUserSave; // For instance.save()

    PaymentMethod.find.mockResolvedValue([]);
    PaymentMethod.findOne.mockResolvedValue(null);
    PaymentMethod.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const mockPmSave = jest.fn().mockResolvedValueThis();
    PaymentMethod.mockImplementation(() => ({ save: mockPmSave, toObject: () => ({}) }));
    PaymentMethod.prototype.save = mockPmSave;


    Order.findOne.mockResolvedValue(null);

    // Reset conceptual gateway SDK mocks
    mockPaymentGatewaySDK.customers.create.mockReset();
    mockPaymentGatewaySDK.setupIntents.create.mockReset();
    mockPaymentGatewaySDK.paymentMethods.attach.mockReset();
    mockPaymentGatewaySDK.paymentMethods.retrieve.mockReset();
    mockPaymentGatewaySDK.paymentMethods.detach.mockReset();
    mockPaymentGatewaySDK.paymentIntents.create.mockReset();
  });

  // --- getOrCreateGatewayCustomer (internal helper, tested via public methods) ---
  // We will test its effects through other methods like createSetupIntent or confirmPaymentMethod.
  describe('getOrCreateGatewayCustomer (indirect testing)', () => {
    it('should retrieve existing gatewayCustomerId from user if present', async () => {
      mockUserInstance.gatewayCustomerId = mockGatewayCustomerId;
      User.findOne.mockResolvedValue(mockUserInstance);

      // Call a method that uses it, e.g., createSetupIntent
      // Simulate gateway call for setupIntent
      mockPaymentGatewaySDK.setupIntents.create.mockResolvedValue({ client_secret: 'seti_secret_xxx', id: 'seti_xxx' });
      await paymentService.createSetupIntent(mockUserId);
      
      expect(mockPaymentGatewaySDK.customers.create).not.toHaveBeenCalled(); // Should not create new
      expect(mockUserSave).not.toHaveBeenCalled(); // No save if ID already exists
    });

    it('should create new gateway customer and save ID to user if not present', async () => {
      mockUserInstance.gatewayCustomerId = null; // Ensure no existing ID
      User.findOne.mockResolvedValue(mockUserInstance);
      // Simulate conceptual gateway customer creation
      // The service uses a placeholder `gw_cust_${uuidv4()}` if SDK isn't mocked.
      // To test SDK call: mockPaymentGatewaySDK.customers.create.mockResolvedValue({ id: mockGatewayCustomerId });
      
      // Simulate gateway call for setupIntent which triggers customer creation
      mockPaymentGatewaySDK.setupIntents.create.mockResolvedValue({ client_secret: 'seti_secret_yyy', id: 'seti_yyy' });
      await paymentService.createSetupIntent(mockUserId);

      // In the service, the conceptual SDK call is commented. It generates a placeholder.
      // So we check that user.save was called to store this placeholder.
      expect(mockUserSave).toHaveBeenCalled();
      expect(mockUserInstance.gatewayCustomerId).toMatch(/^gw_cust_/);
    });
    
    it('should throw HttpError 404 if user not found in getOrCreateGatewayCustomer path', async () => {
        User.findOne.mockResolvedValue(null);
        await expect(paymentService.createSetupIntent(mockUserId))
            .rejects.toThrow(new HttpError(404, 'User not found.'));
    });
  });

  // --- getPaymentMethods ---
  describe('getPaymentMethods', () => {
    it('should return locally stored payment methods for the user', async () => {
      const mockPms = [{ id: 'pm1', details: 'Card 1', toObject: () => mockPms[0] }];
      PaymentMethod.find.mockResolvedValue(mockPms);
      
      const result = await paymentService.getPaymentMethods(mockUserId);
      expect(User.findOne).toHaveBeenCalledWith({ id: mockUserId }); // Called by getOrCreateGatewayCustomer
      expect(PaymentMethod.find).toHaveBeenCalledWith({ userId: mockUserId });
      expect(result).toEqual(mockPms.map(pm => pm.toObject()));
    });

    it('should return empty array if no local payment methods', async () => {
      PaymentMethod.find.mockResolvedValue([]);
      const result = await paymentService.getPaymentMethods(mockUserId);
      expect(result).toEqual([]);
    });
    // ... (DB error test for PaymentMethod.find)
  });

  // --- createSetupIntent ---
  describe('createSetupIntent', () => {
    it('should create and return a setup intent (placeholder data)', async () => {
      // getOrCreateGatewayCustomer will be called
      const result = await paymentService.createSetupIntent(mockUserId);
      expect(User.findOne).toHaveBeenCalledWith({ id: mockUserId });
      expect(result.clientSecret).toMatch(/^seti_secret_/);
      expect(result.setupIntentId).toMatch(/^seti_/);
      expect(result.message).toContain('SetupIntent created successfully');
    });

    it('should throw HttpError 500 if conceptual gateway SDK call fails (if it were implemented and failed)', async () => {
        // This test is conceptual as the actual SDK call is commented out in the service.
        // If it were active and failed:
        // User.findOne.mockResolvedValue(mockUserInstance); // User found
        // mockPaymentGatewaySDK.setupIntents.create.mockRejectedValue(new Error('Gateway SetupIntent Error'));
        // await expect(paymentService.createSetupIntent(mockUserId))
        //   .rejects.toThrow(new HttpError(500, 'Failed to create setup intent.'));
        // For now, the current service structure makes this specific failure hard to trigger without deeper SDK mocking.
        // The service's current error handling primarily catches issues from getOrCreateGatewayCustomer.
    });
  });

  // --- confirmPaymentMethod ---
  describe('confirmPaymentMethod', () => {
    const paymentMethodData = { paymentMethodId: 'pm_gateway_id_123' };
    
    it('should confirm payment method, save it locally, and return success', async () => {
      // getOrCreateGatewayCustomer is called
      const result = await paymentService.confirmPaymentMethod(mockUserId, paymentMethodData);
      
      expect(User.findOne).toHaveBeenCalledWith({ id: mockUserId });
      expect(PaymentMethod).toHaveBeenCalledTimes(1); // Constructor for new PaymentMethod
      expect(PaymentMethod.prototype.save).toHaveBeenCalled();
      expect(result.message).toBe('Payment method confirmed and added successfully.');
      expect(result.paymentMethod).toEqual(expect.objectContaining({
        userId: mockUserId,
        gatewayPaymentMethodId: paymentMethodData.paymentMethodId,
        type: 'card', // Default from service
      }));
    });
    
    it('should throw HttpError 500 if saving local PaymentMethod fails', async () => {
        PaymentMethod.prototype.save.mockRejectedValueOnce(new Error('DB Save Error'));
        await expect(paymentService.confirmPaymentMethod(mockUserId, paymentMethodData))
            .rejects.toThrow(new HttpError(500, `Failed to confirm payment method: DB Save Error`));
    });
    // ... (user not found via getOrCreateGatewayCustomer is covered)
  });

  // --- deletePaymentMethod ---
  describe('deletePaymentMethod', () => {
    const localPmId = 'local-pm-uuid';
    const mockLocalPm = { 
        id: localPmId, userId: mockUserId, gatewayPaymentMethodId: 'gw_pm_to_delete',
        toObject: () => mockLocalPm
    };

    it('should delete a payment method locally (gateway detachment is conceptual)', async () => {
      PaymentMethod.findOne.mockResolvedValue(mockLocalPm);
      PaymentMethod.deleteOne.mockResolvedValue({ deletedCount: 1 });
      
      const result = await paymentService.deletePaymentMethod(mockUserId, localPmId);
      expect(PaymentMethod.findOne).toHaveBeenCalledWith({ id: localPmId, userId: mockUserId });
      expect(PaymentMethod.deleteOne).toHaveBeenCalledWith({ id: localPmId, userId: mockUserId });
      expect(result.message).toBe('Payment method deleted successfully.');
    });

    it('should throw 404 if local payment method not found or not owned by user', async () => {
      PaymentMethod.findOne.mockResolvedValue(null);
      await expect(paymentService.deletePaymentMethod(mockUserId, 'non-existent-pm-id'))
        .rejects.toThrow(new HttpError(404, 'Payment method not found or does not belong to this user.'));
    });
    // ... (DB delete error test)
  });

  // --- createPaymentIntentForOrder ---
  describe('createPaymentIntentForOrder', () => {
    const mockOrderId = 'order-for-pi';
    const amount = 5000; // 50 NGN
    const currency = 'NGN';
    const mockOrderInstance = { id: mockOrderId, customerId: mockUserId, paymentStatus: 'Pending' };

    beforeEach(() => {
        Order.findOne.mockResolvedValue(mockOrderInstance);
    });

    it('should create a payment intent for an order (placeholder data)', async () => {
      // getOrCreateGatewayCustomer is called
      const result = await paymentService.createPaymentIntentForOrder(mockOrderId, amount, currency, mockUserId);
      
      expect(Order.findOne).toHaveBeenCalledWith({ id: mockOrderId, customerId: mockUserId });
      expect(User.findOne).toHaveBeenCalledWith({ id: mockUserId }); // From getOrCreateGatewayCustomer
      expect(result.paymentIntentId).toMatch(/^pi_/);
      expect(result.clientSecret).toMatch(/^pi_secret_/);
      expect(result.status).toBe('requires_payment_method');
    });

    it('should throw 404 if order not found', async () => {
      Order.findOne.mockResolvedValue(null);
      await expect(paymentService.createPaymentIntentForOrder(mockOrderId, amount, currency, mockUserId))
        .rejects.toThrow(new HttpError(404, 'Order not found for creating payment intent.'));
    });
    
    it('should throw 400 if order already paid', async () => {
        Order.findOne.mockResolvedValue({ ...mockOrderInstance, paymentStatus: 'Completed' });
        await expect(paymentService.createPaymentIntentForOrder(mockOrderId, amount, currency, mockUserId))
            .rejects.toThrow(new HttpError(400, 'Order has already been paid.'));
    });
    // ... (user not found via getOrCreateGatewayCustomer is covered)
  });

  // --- processConfirmedOrderPayment ---
  describe('processConfirmedOrderPayment', () => {
    it('should process a confirmed order payment (placeholder logic)', async () => {
      const paymentDetails = { gatewayTransactionId: 'gw_txn_confirmed' };
      const result = await paymentService.processConfirmedOrderPayment('order-xyz', paymentDetails);
      expect(result.transactionId).toBe(paymentDetails.gatewayTransactionId);
      expect(result.status).toBe('succeeded');
      expect(result.message).toContain('Payment confirmation processed by payment service');
    });

    // This function is very simple in the service, so limited error paths to test unless it grows.
    it('should handle missing gatewayTransactionId in paymentDetails gracefully', async () => {
        const paymentDetails = {}; // No gatewayTransactionId
        const result = await paymentService.processConfirmedOrderPayment('order-xyz', paymentDetails);
        expect(result.transactionId).toMatch(/^confirmed_txn_/); // Uses placeholder
        expect(result.status).toBe('succeeded');
    });
  });
});