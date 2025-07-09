// tests/unit/api/v1/orders/order.service.test.js
// OR src/api/v1/orders/order.service.test.js

const orderService = require('../../src/api/v1/orders/order.service'); // Adjust path
const Order = require('../../src/models/order.model'); // Adjust path
const User = require('../../src/models/user.model'); // Adjust path
const Config = require('../../src/models/config.model'); // Adjust path
const Promotion = require('../../src/models/promotion.model'); // Adjust path
const HttpError = require('../../src/utils/HttpError'); // Adjust path
const { firestore } = require('../../src/config/firebase.config.js'); // Adjust path
const { v4: uuidv4 } = require('uuid');

// --- Mocking Dependencies ---
jest.mock('../../src/models/order.model');
jest.mock('../../src/models/user.model');
jest.mock('../../src/models/config.model');
jest.mock('../../src/models/promotion.model');
jest.mock('../../src/config/firebase.config.js', () => ({
  firestore: {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    set: jest.fn().mockResolvedValue(true), // For chat initiation if called
    add: jest.fn().mockResolvedValue({ id: 'mock-firestore-id' }), // For feedback
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ empty: true, docs: [] }), // Default to no results
  },
}));
jest.mock('uuid', () => ({
  v4: jest.fn(),
}));

describe('Order Service', () => {
  let mockOrderSave, mockUserSave, mockConfigFindOne, mockPromotionFindOne, mockOrderFindOne, mockOrderFind, mockOrderCountDocuments, mockOrderDeleteOne, mockUserFindOne;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock implementations for model methods
    mockOrderSave = jest.fn().mockResolvedValue(this); // 'this' refers to the mock instance
    mockUserSave = jest.fn().mockResolvedValue(this);

    Order.prototype.save = mockOrderSave;
    User.prototype.save = mockUserSave; // If User instances are saved directly

    mockUserFindOne = jest.fn();
    User.findOne = mockUserFindOne;
    
    mockConfigFindOne = jest.fn();
    Config.findOne = mockConfigFindOne;

    mockPromotionFindOne = jest.fn();
    Promotion.findOne = mockPromotionFindOne;

    mockOrderFindOne = jest.fn();
    Order.findOne = mockOrderFindOne;

    mockOrderFind = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(), // Add populate mock
        map: Array.prototype.map, // Allow .map if it returns an array of mongoose docs
        exec: jest.fn().mockResolvedValue([]), // Default to empty array
    });
    Order.find = mockOrderFind;
    
    mockOrderCountDocuments = jest.fn().mockResolvedValue(0);
    Order.countDocuments = mockOrderCountDocuments;

    mockOrderDeleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
    Order.deleteOne = mockOrderDeleteOne;

    uuidv4.mockReturnValue('mock-order-uuid');
  });

  // --- Test getOrder ---
  describe('getOrder', () => {
    const mockOrderId = 'order123';
    const mockRequestingUserId = 'user123';
    const mockOrder = {
      id: mockOrderId,
      customerId: mockRequestingUserId,
      driverId: 'driver456',
      toObject: () => ({ ...mockOrder }), // Simple toObject mock
    };

    it('should retrieve and return an order if found and authorized (customer)', async () => {
      mockOrderFindOne.mockResolvedValue(mockOrder);
      const result = await orderService.getOrder(mockOrderId, mockRequestingUserId, 'customer');
      expect(mockOrderFindOne).toHaveBeenCalledWith({ id: mockOrderId });
      expect(result).toEqual(mockOrder);
    });

    it('should retrieve and return an order if found and authorized (driver)', async () => {
      mockOrderFindOne.mockResolvedValue({ ...mockOrder, customerId: 'otherUser', driverId: mockRequestingUserId });
      const result = await orderService.getOrder(mockOrderId, mockRequestingUserId, 'driver');
      expect(result).toEqual({ ...mockOrder, customerId: 'otherUser', driverId: mockRequestingUserId });
    });

    it('should retrieve and return an order if found (admin)', async () => {
      mockOrderFindOne.mockResolvedValue(mockOrder);
      const result = await orderService.getOrder(mockOrderId, 'adminUser', 'admin');
      expect(result).toEqual(mockOrder);
    });

    it('should throw HttpError 404 if order not found', async () => {
      mockOrderFindOne.mockResolvedValue(null);
      await expect(orderService.getOrder(mockOrderId, mockRequestingUserId, 'customer'))
        .rejects.toThrow(new HttpError(404, 'Order not found.'));
    });

    it('should throw HttpError 403 if customer tries to access another user\'s order', async () => {
      mockOrderFindOne.mockResolvedValue({ ...mockOrder, customerId: 'anotherUser' });
      await expect(orderService.getOrder(mockOrderId, mockRequestingUserId, 'customer'))
        .rejects.toThrow(new HttpError(403, 'You are not authorized to access this order.'));
    });

    it('should throw HttpError 403 if driver tries to access an order not assigned to them', async () => {
      mockOrderFindOne.mockResolvedValue({ ...mockOrder, driverId: 'anotherDriver' });
      await expect(orderService.getOrder(mockOrderId, mockRequestingUserId, 'driver'))
        .rejects.toThrow(new HttpError(403, 'You are not authorized to access this order as a driver.'));
    });

    it('should throw HttpError 500 on database error', async () => {
        mockOrderFindOne.mockRejectedValue(new Error('DB Error'));
        await expect(orderService.getOrder(mockOrderId, mockRequestingUserId, 'customer'))
            .rejects.toThrow(new HttpError(500, 'Failed to retrieve order due to an unexpected error.'));
    });
  });

  // --- Test placeOrder ---
  describe('placeOrder', () => {
    const mockCustomerId = 'cust123';
    const mockCustomerRole = 'customer';
    const mockOrderData = {
      deliveryAddressId: 'addr123',
      items: [{ cylinderId: 'cyl1', quantity: 1, unitPrice: 5000, productName: '12kg Cylinder' }],
      recipientName: 'John Doe',
      recipientPhone: '+1234567890',
      deliveryAddressSnapshot: { fullAddress: '1 Test St' },
    };
    const mockUserInstance = {
      id: mockCustomerId,
      role: 'customer',
      walletBalance: 10000, // 100 NGN if amount is in kobo
      save: mockUserSave,
    };
    const mockConfigInstance = {
      feeSettings: {
        vatPercentage: 7.5,
        serviceFeePercentage: 5,
        baseDeliveryFee: 1000, // 10 NGN
        expressDeliverySurcharge: 500, // 5 NGN
      },
    };

    beforeEach(() => {
        mockUserFindOne.mockResolvedValue(mockUserInstance);
        mockConfigFindOne.mockResolvedValue(mockConfigInstance);
        mockPromotionFindOne.mockResolvedValue(null); // Default to no promotion
        Order.mockImplementation(() => ({ // Mock the Order constructor
            ...mockOrderData, // Spread basic data
            id: 'mock-order-uuid',
            customerId: mockCustomerId,
            itemsSubtotal: 0, // Will be calculated
            // ... other fields that get calculated ...
            save: mockOrderSave.mockResolvedValue({ // mock save to return the instance with toObject
                ...mockOrderData,
                id: 'mock-order-uuid',
                toObject: () => ({...mockOrderData, id: 'mock-order-uuid'})
            }),
            toObject: () => ({...mockOrderData, id: 'mock-order-uuid'})
        }));
    });

    it('should place an order successfully without promo and without wallet if payment needed', async () => {
      const result = await orderService.placeOrder(mockOrderData, mockCustomerId, mockCustomerRole);
      expect(mockUserFindOne).toHaveBeenCalledWith({ id: mockCustomerId });
      expect(mockConfigFindOne).toHaveBeenCalled();
      expect(Order).toHaveBeenCalledTimes(1); // Constructor called
      expect(mockOrderSave).toHaveBeenCalledTimes(1); // Order saved
      expect(mockUserSave).not.toHaveBeenCalled(); // Wallet not used

      expect(result.orderId).toBe('mock-order-uuid');
      expect(result.paymentNeeded).toBe(true);
      // itemsSubtotal = 5000
      // discount = 0
      // vat = 5000 * 0.075 = 375
      // serviceFee = 5000 * 0.05 = 250
      // deliveryFee = 1000
      // totalBeforeWallet = 5000 + 375 + 250 + 1000 = 6625
      // walletUsed = 0
      // grandTotalToPay = 6625
      expect(result.grandTotalToPay).toBe(6625);
      expect(result.message).toBe('Order placed successfully.');
    });

    it('should apply percentage promotion correctly', async () => {
        const mockPromo = {
            promoCode: 'SAVE10', isActive: true, validUntil: new Date(Date.now() + 86400000), validFrom: new Date(Date.now() - 86400000),
            type: 'Percentage Discount', value: 10 // 10%
        };
        mockPromotionFindOne.mockResolvedValue(mockPromo);
        const result = await orderService.placeOrder({ ...mockOrderData, promoCodeApplied: 'SAVE10' }, mockCustomerId, mockCustomerRole);
        // itemsSubtotal = 5000
        // discount = 5000 * 0.10 = 500
        // subtotalAfterDiscount = 4500
        // vat = 4500 * 0.075 = 337.5
        // serviceFee = 4500 * 0.05 = 225
        // deliveryFee = 1000
        // totalBeforeWallet = 4500 + 337.5 + 225 + 1000 = 6062.5
        expect(result.grandTotalToPay).toBe(6062.5);
    });

    it('should use wallet balance if requested and sufficient, making payment not needed', async () => {
        mockUserInstance.walletBalance = 700000; // Sufficient balance (e.g. 7000 NGN if amount in kobo)
        mockUserFindOne.mockResolvedValue(mockUserInstance);
        
        const result = await orderService.placeOrder({ ...mockOrderData, useWalletBalance: true }, mockCustomerId, mockCustomerRole);
        expect(mockUserSave).toHaveBeenCalledTimes(1); // User wallet balance updated
        expect(result.paymentNeeded).toBe(false);
        expect(result.grandTotalToPay).toBe(0); // Fully paid by wallet
        expect(mockUserInstance.walletBalance).toBe(700000 - 6625); // Assuming previous total of 6625
    });
    
    it('should use partial wallet balance if requested and insufficient for full payment', async () => {
        mockUserInstance.walletBalance = 3000; // 30 NGN, less than 66.25 NGN order
        mockUserFindOne.mockResolvedValue(mockUserInstance);

        const result = await orderService.placeOrder({ ...mockOrderData, useWalletBalance: true }, mockCustomerId, mockCustomerRole);
        expect(mockUserSave).toHaveBeenCalledTimes(1);
        expect(result.paymentNeeded).toBe(true);
        expect(result.grandTotalToPay).toBe(6625 - 3000); // 3625 remaining
        expect(mockUserInstance.walletBalance).toBe(0);
    });

    it('should throw 404 if user not found', async () => {
        mockUserFindOne.mockResolvedValue(null);
        await expect(orderService.placeOrder(mockOrderData, mockCustomerId, mockCustomerRole))
            .rejects.toThrow(new HttpError(404, 'User placing order not found.'));
    });

    it('should throw 403 if role is not customer', async () => {
        mockUserFindOne.mockResolvedValue({ ...mockUserInstance, role: 'driver' }); // User exists but is a driver
        await expect(orderService.placeOrder(mockOrderData, mockCustomerId, 'driver' /* or user.role is driver */))
            .rejects.toThrow(new HttpError(403, 'Only customers can place orders.'));
    });
    
    it('should throw 500 if config not found', async () => {
        mockConfigFindOne.mockResolvedValue(null);
        await expect(orderService.placeOrder(mockOrderData, mockCustomerId, mockCustomerRole))
            .rejects.toThrow(new HttpError(500, 'System configuration for fees not found or incomplete.'));
    });

    it('should throw 400 if promo code is invalid', async () => {
        mockPromotionFindOne.mockResolvedValue(null); // Invalid promo code
        await expect(orderService.placeOrder({ ...mockOrderData, promoCodeApplied: 'INVALIDPROMO' }, mockCustomerId, mockCustomerRole))
            .rejects.toThrow(new HttpError(400, 'Invalid or expired promo code.'));
    });
  });

  // --- Test cancelOrder ---
  describe('cancelOrder', () => {
    const mockOrderId = 'order-to-cancel';
    const mockCustomerId = 'customer-who-owns-order';
    const mockOrderToCancel = {
      id: mockOrderId,
      customerId: mockCustomerId,
      status: 'Pending Payment',
      paymentStatus: 'Pending',
      walletAmountUsed: 500, // Example: 5 NGN
      toObject: () => ({ ...mockOrderToCancel }),
      save: mockOrderSave,
    };

    it('should cancel an order successfully and refund wallet if applicable', async () => {
      mockUserFindOne.mockResolvedValue({ id: mockCustomerId, role: 'customer', walletBalance: 1000, save: mockUserSave });
      mockOrderFindOne.mockResolvedValue(mockOrderToCancel);
      // Order.deleteOne is not used in the refactored service, it updates status.
      // mockOrderDeleteOne.mockResolvedValue({ deletedCount: 1 }); 
      mockOrderSave.mockResolvedValueOnce(); // For order status update
      mockUserSave.mockResolvedValueOnce(); // For wallet refund

      const result = await orderService.cancelOrder(mockOrderId, mockCustomerId, 'customer');
      
      expect(mockOrderFindOne).toHaveBeenCalledWith({ id: mockOrderId });
      expect(mockUserFindOne).toHaveBeenCalledWith({ id: mockCustomerId });
      expect(mockOrderToCancel.status).toBe('Canceled by Customer');
      expect(mockOrderSave).toHaveBeenCalled();
      expect(mockUserSave).toHaveBeenCalled(); // Wallet balance updated
      expect(result).toEqual({ message: 'Order canceled successfully.' });
    });

    it('should throw 404 if order not found', async () => {
      mockUserFindOne.mockResolvedValue({ id: mockCustomerId, role: 'customer' });
      mockOrderFindOne.mockResolvedValue(null);
      await expect(orderService.cancelOrder(mockOrderId, mockCustomerId, 'customer'))
        .rejects.toThrow(new HttpError(404, 'Order not found.'));
    });

    it('should throw 403 if user is not the owner of the order', async () => {
      mockUserFindOne.mockResolvedValue({ id: mockCustomerId, role: 'customer' });
      mockOrderFindOne.mockResolvedValue({ ...mockOrderToCancel, customerId: 'another-customer' });
      await expect(orderService.cancelOrder(mockOrderId, mockCustomerId, 'customer'))
        .rejects.toThrow(new HttpError(403, 'You are not authorized to cancel this order.'));
    });

    it('should throw 400 if order is not in "Pending Payment" status', async () => {
      mockUserFindOne.mockResolvedValue({ id: mockCustomerId, role: 'customer' });
      mockOrderFindOne.mockResolvedValue({ ...mockOrderToCancel, status: 'Delivered', paymentStatus: 'Completed' });
      await expect(orderService.cancelOrder(mockOrderId, mockCustomerId, 'customer'))
        .rejects.toThrow(new HttpError(400, `Order in status 'Delivered' with payment status 'Completed' cannot be canceled by the customer.`));
    });
  });

  // --- Skeletons for other methods (Expand these similarly) ---

  describe('getOrders', () => {
    it('should retrieve orders for a customer', async () => {
        // Mock User.find().sort().skip().limit() and User.countDocuments()
        // Assert correct query parameters and role filtering
    });
    it('should retrieve orders for a driver', async () => {});
    it('should allow admin to retrieve orders with filters', async () => {});
    it('should throw 500 on DB error', async () => {});
  });

  describe('processPayment', () => {
    it('should process payment and update order status', async () => {});
    it('should throw 404 if user or order not found', async () => {});
    it('should throw 403 if not customer', async () => {});
    it('should throw 400 if payment already completed', async () => {});
  });

  describe('submitFeedback', () => {
    it('should submit feedback for a delivered order', async () => {
        // Mock User.findOne, Order.findOne, firestore.collection().doc().set()
    });
    it('should throw 400 if order not delivered', async () => {});
    // ... other error cases
  });

  describe('getLocationHistory', () => {
    it('should get location history for an authorized user', async () => {
        // Mock Order.findOne, firestore.collection().where().orderBy().get()
    });
    // ... error and authorization cases
  });

  describe('driverUpdateOrderStatus', () => {
    it('should allow driver to update status of their assigned order', async () => {});
    // ... error and authorization cases
  });

  describe('adminGetOrders', () => {
    it('should retrieve orders with admin filters and pagination', async () => {});
    // ... error cases
  });

  describe('adminUpdateOrderStatus', () => {
    it('should allow admin to update any order status', async () => {});
    // ... error cases
  });

  describe('adminAssignDriver', () => {
    it('should assign a driver to an order by admin', async () => {});
    // ... error cases (order not found, driver not found, etc.)
  });

});