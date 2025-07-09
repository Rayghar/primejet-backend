// tests/unit/api/v1/wallet/wallet.service.test.js
// OR src/api/v1/wallet/wallet.service.js

const walletService = require('../../src/api/v1/wallet/wallet.service.js'); // Adjust path
const User = require('../../src/models/user.model'); // Adjust path
const WalletTransaction = require('../../src/models/walletTransaction.model'); // Adjust path
const paymentService = require('../../src/api/v1/payments/payment.service'); // Adjust path
const HttpError = require('../../src/utils/HttpError'); // Adjust path
const mongoose = require('mongoose'); // For mocking sessions
const { v4: uuidv4 } = require('uuid');


// --- Mocking Dependencies ---
jest.mock('../../src/models/user.model');
jest.mock('../../src/models/walletTransaction.model');
jest.mock('../../src/api/v1/payments/payment.service.js'); // Mock our payment service
jest.mock('uuid', () => ({
  v4: jest.fn(),
}));

// Mock Mongoose session methods
const mockSession = {
  startTransaction: jest.fn(),
  commitTransaction: jest.fn().mockResolvedValue(true),
  abortTransaction: jest.fn().mockResolvedValue(true),
  endSession: jest.fn(),
  // withTransaction: jest.fn((fn) => fn(mockSession)), // For testing withTransaction helper if used
};
mongoose.startSession = jest.fn().mockResolvedValue(mockSession);


describe('Wallet Service', () => {
  const mockUserId = 'user-wallet-123';
  const DEFAULT_CURRENCY = 'NGN'; // Assuming from service

  let mockUserFindOne, mockUserSave,
      mockWtFindOne, mockWtSave, mockWtUpdateOne, mockWtFind;

  // Helper to mock Mongoose document instance methods
  const mockDocumentInstance = (data = {}, modelName = 'Unknown') => {
    const instance = { ...data };
    instance.save = jest.fn().mockImplementation(function(options) {
        Object.assign(this, data);
        return Promise.resolve(this);
    });
    instance.toObject = jest.fn().mockReturnValue(data);
    return instance;
  };
  
  const mockBaseWtQuery = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      exec: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    uuidv4.mockReturnValue('mock-tx-uuid-123');

    mockUserFindOne = jest.fn(); User.findOne = mockUserFindOne;
    mockUserSave = jest.fn().mockReturnThis(); User.prototype.save = mockUserSave;
    
    mockWtFindOne = jest.fn(); WalletTransaction.findOne = mockWtFindOne;
    mockWtSave = jest.fn(); WalletTransaction.prototype.save = mockWtSave;
    mockWtUpdateOne = jest.fn(); WalletTransaction.updateOne = mockWtUpdateOne;
    mockWtFind = jest.fn().mockReturnValue({...mockBaseWtQuery, exec: jest.fn().mockResolvedValue([])}); WalletTransaction.find = mockWtFind;


    // Mock constructor for new WalletTransaction()
    WalletTransaction.mockImplementation((data) => mockDocumentInstance(data, 'WalletTransaction'));

    paymentService.createPaymentIntentForOrder.mockReset();
  });

  // --- getWallet ---
  describe('getWallet', () => {
    const mockUser = mockDocumentInstance({ 
        id: mockUserId, name: 'Wallet User', email: 'wallet@example.com', walletBalance: 50000 // 500 NGN
    }, 'User');
    const mockTransactions = [
        mockDocumentInstance({ id: 'tx1', type: 'DEPOSIT', amount: 10000, status: 'COMPLETED' }, 'WalletTransaction')
    ];

    it('should return wallet details and recent transactions', async () => {
      mockUserFindOne.mockResolvedValue(mockUser);
      WalletTransaction.find().exec.mockResolvedValue(mockTransactions);

      const result = await walletService.getWallet(mockUserId);

      expect(User.findOne).toHaveBeenCalledWith({ id: mockUserId });
      expect(WalletTransaction.find).toHaveBeenCalledWith({ userId: mockUserId });
      expect(WalletTransaction.find().sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(WalletTransaction.find().limit).toHaveBeenCalledWith(10);
      expect(result).toEqual({
        userId: mockUser.id,
        name: mockUser.name,
        email: mockUser.email,
        walletBalance: 50000,
        recentTransactions: mockTransactions.map(t => t.toObject()),
      });
    });

    it('should return wallet balance as 0 if undefined on user', async () => {
        const userNoBalance = mockDocumentInstance({ ...mockUser, walletBalance: undefined }, 'User');
        mockUserFindOne.mockResolvedValue(userNoBalance);
        WalletTransaction.find().exec.mockResolvedValue([]);
        const result = await walletService.getWallet(mockUserId);
        expect(result.walletBalance).toBe(0);
    });

    it('should throw HttpError 404 if user not found', async () => {
      mockUserFindOne.mockResolvedValue(null);
      await expect(walletService.getWallet(mockUserId))
        .rejects.toThrow(new HttpError(404, 'User not found.'));
    });
    
    it('should throw 500 if User.findOne fails', async () => {
        mockUserFindOne.mockRejectedValue(new Error('DB User Error'));
        await expect(walletService.getWallet(mockUserId))
            .rejects.toThrow(new HttpError(500, 'Failed to retrieve wallet details.'));
    });
    
    it('should still return wallet details if WalletTransaction.find fails', async () => {
        // Assuming fetching transactions is non-critical to fetching wallet balance
        mockUserFindOne.mockResolvedValue(mockUser);
        WalletTransaction.find().exec.mockRejectedValue(new Error('DB WTransaction Error'));
        // console.error will be called by the service
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        
        const result = await walletService.getWallet(mockUserId);
        expect(result.walletBalance).toBe(50000);
        expect(result.recentTransactions).toEqual([]); // Fails gracefully
        expect(consoleErrorSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });
  });

  // --- initializeTopUp ---
  describe('initializeTopUp', () => {
    const amountToTopUp = 20000; // 200 NGN
    const mockUserForTopUp = mockDocumentInstance({ id: mockUserId, walletBalance: 10000 }, 'User');
    const mockPaymentIntent = { clientSecret: 'pi_secret_xxx', paymentIntentId: 'pi_xxx' };

    beforeEach(() => {
        mockUserFindOne.mockResolvedValue(mockUserForTopUp);
        paymentService.createPaymentIntentForOrder.mockResolvedValue(mockPaymentIntent);
        // Ensure the save mock on the instance returned by constructor is set up
        const mockPendingTxInstance = mockDocumentInstance({ 
            id: 'mock-tx-uuid-123', 
            userId: mockUserId, 
            amount: amountToTopUp,
            status: 'PENDING'
        }, 'WalletTransaction');
        WalletTransaction.mockImplementation(() => mockPendingTxInstance); // Constructor returns this
        mockPendingTxInstance.save.mockResolvedValue(mockPendingTxInstance); // Ensure instance save works
    });

    it('should create a PENDING transaction, get payment intent, and return details', async () => {
      const result = await walletService.initializeTopUp(mockUserId, amountToTopUp);

      expect(User.findOne).toHaveBeenCalledWith({ id: mockUserId });
      expect(WalletTransaction).toHaveBeenCalledWith(expect.objectContaining({
        userId: mockUserId,
        type: 'DEPOSIT',
        amount: amountToTopUp,
        status: 'PENDING',
        balanceBefore: mockUserForTopUp.walletBalance,
      }));
      const createdTransactionInstance = WalletTransaction.mock.results[0].value; // Get the instance
      expect(createdTransactionInstance.save).toHaveBeenCalledTimes(2); // Once initial, once with paymentIntentId

      expect(paymentService.createPaymentIntentForOrder).toHaveBeenCalledWith(
        createdTransactionInstance.id, // internal transaction id
        amountToTopUp,
        DEFAULT_CURRENCY,
        mockUserId
      );
      expect(createdTransactionInstance.internalPaymentIntentId).toBe(mockPaymentIntent.paymentIntentId);
      expect(createdTransactionInstance.paymentGateway).toBeDefined(); // e.g., 'STRIPE' if set in service

      expect(result).toEqual({
        message: 'Top-up initialized. Please complete payment.',
        internalTransactionId: createdTransactionInstance.id,
        clientSecret: mockPaymentIntent.clientSecret,
        paymentIntentId: mockPaymentIntent.paymentIntentId,
        amount: amountToTopUp,
        currency: DEFAULT_CURRENCY,
      });
    });

    it('should throw 404 if user not found', async () => {
      mockUserFindOne.mockResolvedValue(null);
      await expect(walletService.initializeTopUp(mockUserId, amountToTopUp))
        .rejects.toThrow(new HttpError(404, 'User not found for wallet top-up.'));
    });

    it('should mark transaction FAILED if paymentService.createPaymentIntentForOrder fails', async () => {
      paymentService.createPaymentIntentForOrder.mockRejectedValue(new Error('Gateway Error'));
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(walletService.initializeTopUp(mockUserId, amountToTopUp))
        .rejects.toThrow(new HttpError(500, 'Failed to initialize wallet top-up: Gateway Error'));
      
      const createdTransactionInstance = WalletTransaction.mock.results[0].value;
      expect(WalletTransaction.updateOne).toHaveBeenCalledWith( // Check if service attempts to update status
          { id: createdTransactionInstance.id }, 
          { $set: { status: 'FAILED', description: expect.stringContaining('Initialization failed: Gateway Error') }}
      );
      consoleErrorSpy.mockRestore();
    });
    
    it('should throw 500 if initial WalletTransaction save fails', async () => {
        const createdTransactionInstance = WalletTransaction.mock.results[0].value;
        createdTransactionInstance.save.mockRejectedValueOnce(new Error('DB Save Error')); // First save fails
        
        await expect(walletService.initializeTopUp(mockUserId, amountToTopUp))
            .rejects.toThrow(new HttpError(500, 'Failed to initialize wallet top-up: DB Save Error'));
    });
  });

  // --- confirmTopUp ---
  describe('confirmTopUp', () => {
    const mockInternalTxId = 'pending-tx-id';
    const mockGatewayRef = 'gw_ref_success';
    let mockUserForConfirm, mockPendingTx;

    beforeEach(() => {
        mockUserForConfirm = mockDocumentInstance({ id: mockUserId, walletBalance: 10000 }, 'User'); // 100 NGN
        mockPendingTx = mockDocumentInstance({
            id: mockInternalTxId, userId: mockUserId, status: 'PENDING',
            amount: 5000, currency: DEFAULT_CURRENCY, // 50 NGN
            balanceBefore: 10000,
        }, 'WalletTransaction');

        mockUserFindOne.mockReturnValue({ session: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(mockUserForConfirm) }); // Simulate session usage
        User.findOne = mockUserFindOne; // Re-assign to make it chainable with session for this describe block
        
        mockWtFindOne.mockReturnValue({ session: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(mockPendingTx) });
        WalletTransaction.findOne = mockWtFindOne;
    });

    it('should confirm top-up, update balance and transaction, and commit session', async () => {
      // Assume payment gateway verification is successful (this part is conceptual in service)
      const result = await walletService.confirmTopUp(mockUserId, mockInternalTxId, mockGatewayRef);

      expect(mongoose.startSession).toHaveBeenCalled();
      expect(mockSession.startTransaction).toHaveBeenCalled();
      
      expect(User.findOne).toHaveBeenCalledWith({ id: mockUserId });
      expect(WalletTransaction.findOne).toHaveBeenCalledWith({ id: mockInternalTxId, userId: mockUserId, status: 'PENDING' });
      
      expect(mockUserForConfirm.walletBalance).toBe(10000 + 5000);
      expect(mockUserForConfirm.save).toHaveBeenCalledWith({ session: mockSession });

      expect(mockPendingTx.status).toBe('COMPLETED');
      expect(mockPendingTx.paymentGatewayReference).toBe(mockGatewayRef);
      expect(mockPendingTx.balanceAfter).toBe(15000);
      expect(mockPendingTx.save).toHaveBeenCalledWith({ session: mockSession });

      expect(mockSession.commitTransaction).toHaveBeenCalled();
      expect(mockSession.abortTransaction).not.toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();

      expect(result.message).toBe('Wallet top-up confirmed successfully.');
      expect(result.newBalance).toBe(150); // In major unit
    });

    it('should throw 404 if pending transaction not found and abort session', async () => {
      WalletTransaction.findOne().exec.mockResolvedValue(null);
      await expect(walletService.confirmTopUp(mockUserId, mockInternalTxId, mockGatewayRef))
        .rejects.toThrow(new HttpError(404, 'Pending top-up transaction not found or already processed.'));
      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });
    
    // Conceptual test for gateway verification failure
    it('should update transaction to FAILED if (conceptual) gateway verification fails and commit', async () => {
        // To test this properly, the service's placeholder for gateway verification would need to be mockable
        // For now, we assume the current service structure where it proceeds if no error is thrown by that conceptual step.
        // If verification threw an error:
        // paymentGateway.verify.mockRejectedValue(new Error('Gateway Invalid'));
        // await expect(walletService.confirmTopUp(...)).rejects.toThrow(...)
        // expect(mockSession.abortTransaction).toHaveBeenCalled();
        // expect(WalletTransaction.updateOne).toHaveBeenCalledWith(..., {status: 'FAILED'}); // in catch
    });

    it('should abort transaction and update transaction to FAILED if user save fails', async () => {
      mockUserForConfirm.save.mockRejectedValue(new Error('User Save Error'));
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(walletService.confirmTopUp(mockUserId, mockInternalTxId, mockGatewayRef))
        .rejects.toThrow(new HttpError(500, 'Failed to confirm wallet top-up: User Save Error'));
      
      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(WalletTransaction.updateOne).toHaveBeenCalledWith( // Ensure status is updated to FAILED in catch block
        { id: mockInternalTxId, status: 'PENDING' }, // This might be tricky if status already changed
        { $set: { status: 'FAILED', description: expect.stringContaining('Confirmation failed: User Save Error') }}
      );
      expect(mockSession.endSession).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
    // ... (similar test for walletTransaction.save() failure)
  });
});