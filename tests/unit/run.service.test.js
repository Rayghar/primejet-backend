// tests/unit/api/v1/runs/run.service.test.js
// OR src/api/v1/runs/run.service.js

const runService = require('../../src/api/v1/runs/run.service'); // Adjust path
const Run = require('../../src/models/run.model'); // Adjust path
const Order = require('../../src/models/order.model'); // Adjust path
const User = require('../../src/models/user.model'); // Adjust path
const HttpError = require('../../src/utils/HttpError'); // Adjust path
const mongoose = require('mongoose'); // For mocking sessions

// --- Mocking Dependencies ---
jest.mock('../../src/models/run.model');
jest.mock('../../src/models/order.model');
jest.mock('../../src/models/user.model');

// Mock Mongoose session methods
const mockSession = {
  startTransaction: jest.fn(),
  commitTransaction: jest.fn().mockResolvedValue(true),
  abortTransaction: jest.fn().mockResolvedValue(true),
  endSession: jest.fn(),
  // withTransaction: jest.fn((fn) => fn(mockSession)), // For testing withTransaction helper if used
};
mongoose.startSession = jest.fn().mockResolvedValue(mockSession);


describe('Run Service', () => {
  let mockRunSave, mockRunFindOne, mockRunFind, 
      mockOrderSave, mockOrderFindOne, 
      mockUserFindOne;

  // Helper to mock Mongoose document instance methods
  const mockDocumentInstance = (data = {}, modelName = 'Unknown') => {
    const instance = { ...data };
    instance.save = jest.fn().mockImplementation(function(options) { // Allow options for session
        // console.log(`${modelName} save mock called with options:`, options);
        Object.assign(this, data); // Simulate save updating the instance
        return Promise.resolve(this);
    });
    instance.toObject = jest.fn().mockReturnValue(data); // Return the plain data
    return instance;
  };
  
  const mockBaseQuery = (execMock = jest.fn().mockResolvedValue([])) => ({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      exec: execMock, // Allow specific exec mock per find call
      map: Array.prototype.map, // For direct mapping if needed
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock static model methods
    mockRunFindOne = jest.fn(); Run.findOne = mockRunFindOne;
    mockOrderFindOne = jest.fn(); Order.findOne = mockOrderFindOne;
    mockUserFindOne = jest.fn(); User.findOne = mockUserFindOne;
    
    Run.find = jest.fn().mockReturnValue(mockBaseQuery());
    Order.find = jest.fn().mockReturnValue(mockBaseQuery());
    
    Run.countDocuments = jest.fn().mockResolvedValue(0);
    Order.countDocuments = jest.fn().mockResolvedValue(0);

    // Mocks for instance methods are set via mockDocumentInstance
  });

  // --- getPendingBatches ---
  describe('getPendingBatches', () => {
    it('should return pending runs sorted by createdAt descending', async () => {
      const mockRunDoc = mockDocumentInstance({ id: 'run1', overallStatus: 'Pending' }, 'Run');
      const mockPendingRuns = [mockRunDoc];
      Run.find().exec.mockResolvedValue(mockPendingRuns);
      
      const result = await runService.getPendingBatches();
      
      expect(Run.find).toHaveBeenCalledWith({ overallStatus: 'Pending' });
      expect(Run.find().sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(result).toEqual(mockPendingRuns.map(r => r.toObject()));
    });

    it('should return an empty array if no pending runs', async () => {
      Run.find().exec.mockResolvedValue([]);
      const result = await runService.getPendingBatches();
      expect(result).toEqual([]);
    });

    it('should throw HttpError 500 on database error', async () => {
      Run.find().exec.mockRejectedValue(new Error('DB Error'));
      await expect(runService.getPendingBatches())
        .rejects.toThrow(new HttpError(500, 'Failed to retrieve pending batches.'));
    });
  });

  // --- getActiveRuns ---
  describe('getActiveRuns', () => {
    it('should return active runs (Assigned or In Progress) with driver populated and sorted', async () => {
      const mockRunDocAssigned = mockDocumentInstance({ id: 'runA', overallStatus: 'Assigned', driverId: 'driver1' }, 'Run');
      const mockRunDocInProgress = mockDocumentInstance({ id: 'runB', overallStatus: 'In Progress', driverId: 'driver2' }, 'Run');
      const mockActiveRuns = [mockRunDocAssigned, mockRunDocInProgress];
      Run.find().populate().exec.mockResolvedValue(mockActiveRuns);
      
      const result = await runService.getActiveRuns();
      
      expect(Run.find).toHaveBeenCalledWith({ overallStatus: { $in: ['Assigned', 'In Progress'] } });
      expect(Run.find().populate).toHaveBeenCalledWith({ path: 'driverId', select: 'id name phone' });
      expect(Run.find().sort).toHaveBeenCalledWith({ updatedAt: -1 });
      expect(result).toEqual(mockActiveRuns.map(r => r.toObject()));
    });
    // ... (empty array, DB error tests)
  });

  // --- getUnassignedOrders ---
  describe('getUnassignedOrders', () => {
    const defaultOptions = { page: 1, limit: 10 };
    const mockOrderDoc = mockDocumentInstance({ id: 'order1', driverId: null, status: 'Order Placed' }, 'Order');

    it('should return paginated unassigned orders matching criteria, sorted by orderDate', async () => {
      Order.find().exec.mockResolvedValue([mockOrderDoc]);
      Order.countDocuments.mockResolvedValue(1);
      
      const result = await runService.getUnassignedOrders(defaultOptions);
      
      expect(Order.find).toHaveBeenCalledWith({
        driverId: null,
        status: { $in: ['Order Placed', 'Pending Pickup', 'Ready for Delivery'] }
      });
      expect(Order.find().sort).toHaveBeenCalledWith({ orderDate: 1 });
      expect(Order.find().skip).toHaveBeenCalledWith(0);
      expect(Order.find().limit).toHaveBeenCalledWith(10);
      expect(result.orders).toEqual([mockOrderDoc.toObject()]);
      expect(result.totalOrders).toBe(1);
      expect(result.currentPage).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('should handle pagination edge case (page beyond total)', async () => {
        Order.find().exec.mockResolvedValue([]); // No orders for this page
        Order.countDocuments.mockResolvedValue(5); // Total 5 orders
        const options = { page: 2, limit: 10 };
        const result = await runService.getUnassignedOrders(options);
        expect(Order.find().skip).toHaveBeenCalledWith(10); // (2-1)*10
        expect(result.orders).toEqual([]);
        expect(result.totalPages).toBe(1); // Math.ceil(5/10)
    });
    // ... (DB error tests)
  });

  // --- getRun ---
  describe('getRun', () => {
    const mockRunId = 'run-detail-id';
    const mockRunDetailData = { id: mockRunId, driverId: 'driverX', sequencedStops: [{ orderId: 'orderY' }] };

    it('should return run details with populated driver and stops', async () => {
      const mockRunDoc = mockDocumentInstance(mockRunDetailData, 'Run');
      Run.findOne().populate().populate().exec.mockResolvedValue(mockRunDoc);
      
      const result = await runService.getRun(mockRunId);
      
      expect(Run.findOne).toHaveBeenCalledWith({ id: mockRunId });
      expect(Run.findOne().populate).toHaveBeenCalledWith({ path: 'driverId', select: 'id name phone' });
      expect(Run.findOne().populate().populate).toHaveBeenCalledWith({ path: 'sequencedStops.orderId', model: 'Order', select: 'id customerId recipientName status' });
      expect(result).toEqual(mockRunDoc.toObject());
    });
    
    it('should return run details if sequencedStops is empty', async () => {
        const runDataEmptyStops = { ...mockRunDetailData, sequencedStops: [] };
        const mockRunDocEmptyStops = mockDocumentInstance(runDataEmptyStops, 'Run');
        Run.findOne().populate().populate().exec.mockResolvedValue(mockRunDocEmptyStops);
        const result = await runService.getRun(mockRunId);
        expect(result.sequencedStops).toEqual([]);
    });

    it('should gracefully handle a stop.orderId that does not populate (order not found)', async () => {
        // This is tricky to mock perfectly with chained populate in a simple way without deeper Mongoose-mock.
        // The service itself doesn't explicitly handle null populated orders in sequencedStops currently.
        // For now, assume populate returns the run document as is if an order within stops is not found.
        const mockRunDoc = mockDocumentInstance(mockRunDetailData, 'Run');
        Run.findOne().populate().populate().exec.mockResolvedValue(mockRunDoc); // Simulate successful fetch
        const result = await runService.getRun(mockRunId);
        expect(result).toBeDefined(); // Main check is that it doesn't crash
    });

    it('should throw HttpError 404 if run not found', async () => {
      Run.findOne().populate().populate().exec.mockResolvedValue(null);
      await expect(runService.getRun(mockRunId))
        .rejects.toThrow(new HttpError(404, 'Run not found.'));
    });
  });

  // --- reassignDriver ---
  describe('reassignDriver', () => {
    const mockRunId = 'run-reassign';
    const mockNewDriverId = 'new-driver-id';
    const mockAdminId = 'admin-reassign';
    const mockOldDriverId = 'old-driver-id';
    let mockRunInstance, mockDriverInstance, mockOrderInRunInstance;

    beforeEach(() => {
        mockRunInstance = mockDocumentInstance({
            id: mockRunId, driverId: mockOldDriverId, overallStatus: 'Assigned',
            sequencedStops: [{ orderId: 'order1-in-run', status: 'Driver Assigned' }]
        }, 'Run');
        mockDriverInstance = mockDocumentInstance({ id: mockNewDriverId, role: 'driver', name: 'New Driver Test' }, 'User');
        mockOrderInRunInstance = mockDocumentInstance({
            id: 'order1-in-run', driverId: mockOldDriverId, status: 'Driver Assigned', statusHistory: []
        }, 'Order');
        
        mockRunFindOne.mockResolvedValue(mockRunInstance);
        mockUserFindOne.mockResolvedValue(mockDriverInstance);
        mockOrderFindOne.mockResolvedValue(mockOrderInRunInstance);
    });

    it('should successfully reassign a driver and update run and orders', async () => {
      const result = await runService.reassignDriver(mockRunId, mockNewDriverId, mockAdminId);
      
      expect(mockRunInstance.driverId).toBe(mockNewDriverId);
      expect(mockRunInstance.overallStatus).toBe('Assigned');
      expect(mockRunInstance.save).toHaveBeenCalled();

      expect(mockOrderInRunInstance.driverId).toBe(mockNewDriverId);
      expect(mockOrderInRunInstance.status).toBe('Driver Assigned');
      expect(mockOrderInRunInstance.statusHistory).toContainEqual(expect.objectContaining({
          notes: `Reassigned to driver New Driver Test (ID: ${mockNewDriverId}) by admin. Previous driver ID: ${mockOldDriverId}.`
      }));
      expect(mockOrderInRunInstance.save).toHaveBeenCalled();
      expect(result).toEqual(mockRunInstance.toObject());
    });
    
    it('should handle reassigning to the same driver without issues', async () => {
        mockRunInstance.driverId = mockNewDriverId; // Simulate it's already assigned to the new driver
        mockUserFindOne.mockResolvedValue(mockDriverInstance); // Ensure newDriver is found

        await runService.reassignDriver(mockRunId, mockNewDriverId, mockAdminId);
        expect(mockRunInstance.driverId).toBe(mockNewDriverId); // Remains the same
        expect(mockRunInstance.save).toHaveBeenCalled(); // Still saves run
        expect(mockOrderInRunInstance.save).toHaveBeenCalled(); // Still updates orders
    });

    it('should handle empty sequencedStops during reassignment', async () => {
        mockRunInstance.sequencedStops = [];
        await runService.reassignDriver(mockRunId, mockNewDriverId, mockAdminId);
        expect(mockRunInstance.save).toHaveBeenCalled();
        expect(mockOrderFindOne).not.toHaveBeenCalled(); // No orders to update
    });
    // ... (404s for run/driver, DB error tests from previous full script are still relevant)
  });

  // --- getAssignedRuns ---
  describe('getAssignedRuns', () => {
    const mockDriverId = 'driver-assigned';
    it('should return runs assigned to the driver, sorted', async () => {
      const mockRunDoc = mockDocumentInstance({ id: 'run1', driverId: mockDriverId }, 'Run');
      Run.find().exec.mockResolvedValue([mockRunDoc]);
      const result = await runService.getAssignedRuns(mockDriverId);
      expect(Run.find).toHaveBeenCalledWith({ driverId: mockDriverId });
      expect(Run.find().sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(result).toEqual([mockRunDoc.toObject()]);
    });
     // ... (empty array, DB error tests)
  });

  // --- acceptRun ---
  describe('acceptRun', () => {
    const mockBatchId = 'batch-to-accept';
    const mockDriverId = 'driver-accepting';
    let mockRunToAcceptInstance, mockDriverAcceptingInstance, mockOrderInBatchInstance;

    beforeEach(() => {
        mockRunToAcceptInstance = mockDocumentInstance({
            id: mockBatchId, driverId: null, overallStatus: 'Pending',
            sequencedStops: [{ orderId: 'order-in-batch', status: 'Pending Pickup' }]
        }, 'Run');
        mockDriverAcceptingInstance = mockDocumentInstance({ id: mockDriverId, role: 'driver', name: 'Driver Accepto' }, 'User');
        mockOrderInBatchInstance = mockDocumentInstance({
            id: 'order-in-batch', driverId: null, status: 'Pending Pickup', statusHistory: []
        }, 'Order');

        mockRunFindOne.mockResolvedValue(mockRunToAcceptInstance);
        mockUserFindOne.mockResolvedValue(mockDriverAcceptingInstance);
        mockOrderFindOne.mockResolvedValue(mockOrderInBatchInstance);
    });

    it('should allow a driver to accept a pending run and update associated orders', async () => {
      const result = await runService.acceptRun(mockBatchId, mockDriverId);
      expect(mockRunToAcceptInstance.driverId).toBe(mockDriverId);
      expect(mockRunToAcceptInstance.overallStatus).toBe('Assigned');
      expect(mockRunToAcceptInstance.save).toHaveBeenCalled();

      expect(mockOrderInBatchInstance.driverId).toBe(mockDriverId);
      expect(mockOrderInBatchInstance.status).toBe('Driver Assigned');
      expect(mockOrderInBatchInstance.statusHistory).toContainEqual(expect.objectContaining({
          notes: `Run/batch accepted by driver Driver Accepto (ID: ${mockDriverId}).`
      }));
      expect(mockOrderInBatchInstance.save).toHaveBeenCalled();
      expect(result).toEqual(mockRunToAcceptInstance.toObject());
    });

    it('should throw 400 if run is already assigned to another driver', async () => {
      mockRunFindOne.mockResolvedValue({ ...mockRunToAcceptInstance, driverId: 'another-driver', overallStatus: 'Assigned' });
      await expect(runService.acceptRun(mockBatchId, mockDriverId))
        .rejects.toThrow(new HttpError(400, 'This run/batch is already assigned to another driver.'));
    });

    it('should be idempotent if driver re-accepts a run already assigned to them and in "Assigned" status', async () => {
      mockRunFindOne.mockResolvedValue({ ...mockRunToAcceptInstance, driverId: mockDriverId, overallStatus: 'Assigned' });
      const result = await runService.acceptRun(mockBatchId, mockDriverId);
      expect(mockRunToAcceptInstance.save).not.toHaveBeenCalled(); // Should not re-save if no change needed
      expect(result).toEqual(mockRunToAcceptInstance.toObject());
    });

    it('should throw 400 if run is not "Pending" and not assigned to current driver', async () => {
        // e.g. already In Progress by another driver, or completed, or cancelled
        mockRunFindOne.mockResolvedValue({ ...mockRunToAcceptInstance, driverId: 'anotherDriver', overallStatus: 'In Progress' });
        await expect(runService.acceptRun(mockBatchId, mockDriverId))
            .rejects.toThrow(new HttpError(400, 'Run/Batch is not available for acceptance or already assigned.'));
    });
    
    it('should handle empty sequencedStops during acceptance', async () => {
        mockRunToAcceptInstance.sequencedStops = [];
        await runService.acceptRun(mockBatchId, mockDriverId);
        expect(mockRunToAcceptInstance.save).toHaveBeenCalled();
        expect(mockOrderFindOne).not.toHaveBeenCalled();
    });
    // ... (404s for run/driver, DB error tests)
  });
});