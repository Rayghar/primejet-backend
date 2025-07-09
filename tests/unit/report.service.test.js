// tests/unit/api/v1/reports/report.service.test.js
// OR src/api/v1/reports/report.service.test.js

const reportService = require('../../src/api/v1/reports/report.service'); // Adjust path
const Order = require('../../src/models/order.model'); // Adjust path
const User = require('../../src/models/user.model'); // Adjust path
const HttpError = require('../../src/utils/HttpError'); // Adjust path

// --- Mocking Dependencies ---
jest.mock('../../src/models/order.model');
jest.mock('../../src/models/user.model');

describe('Report Service', () => {
  let mockDateNow;

  const mockOrders = [
    { id: 'o1', finalAmountPaid: 1000, status: 'Delivered', orderDate: new Date('2025-05-28T10:00:00.000Z'), driverId: 'd1', toObject: () => mockOrders[0] },
    { id: 'o2', finalAmountPaid: 1500, status: 'Delivered', orderDate: new Date('2025-05-27T10:00:00.000Z'), driverId: 'd2', toObject: () => mockOrders[1] },
    { id: 'o3', finalAmountPaid: 500, status: 'Pending Payment', orderDate: new Date('2025-05-26T10:00:00.000Z'), driverId: 'd1', toObject: () => mockOrders[2] },
  ];

  const mockUsers = [
    { id: 'u1', role: 'customer', status: 'Active', createdAt: new Date('2025-05-20T10:00:00.000Z'), name: 'Cust A', toObject: () => mockUsers[0] },
    { id: 'u2', role: 'customer', status: 'Active', createdAt: new Date('2025-05-27T12:00:00.000Z'), name: 'Cust B', toObject: () => mockUsers[1] },
    { id: 'd1', role: 'driver', status: 'active', name: 'Driver X', toObject: () => mockUsers[2] }, // Matched case in service
    { id: 'd2', role: 'driver', status: 'active', name: 'Driver Y', toObject: () => mockUsers[3] },
  ];

  beforeAll(() => {
    // Freeze time for consistent date calculations in tests
    // Let's assume "now" is 2025-05-29
    mockDateNow = jest.spyOn(Date, 'now').mockReturnValue(new Date('2025-05-29T12:00:00.000Z').getTime());
  });

  afterAll(() => {
    mockDateNow.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    Order.find.mockResolvedValue([]);
    Order.countDocuments.mockResolvedValue(0);
    User.find.mockResolvedValue([]);
    User.countDocuments.mockResolvedValue(0);
  });

  describe('getReports', () => {
    describe('salesOverview', () => {
      it('should calculate sales overview correctly for a weekly period', async () => {
        const relevantOrders = mockOrders.filter(o => new Date(o.orderDate) >= new Date('2025-05-22T00:00:00.000Z')); // Orders from May 22nd onwards
        Order.find.mockImplementation(query => {
            // Simulate date filtering based on query.$gte
            const startDate = query.orderDate?.$gte;
            if (startDate) {
                return Promise.resolve(mockOrders.filter(o => new Date(o.orderDate) >= startDate && o.paymentStatus === 'Completed'));
            }
            return Promise.resolve(mockOrders.filter(o => o.paymentStatus === 'Completed'));
        });
        
        const report = await reportService.getReports('salesOverview', 'weekly');
        
        expect(Order.find).toHaveBeenCalledWith(expect.objectContaining({
          orderDate: { $gte: new Date('2025-05-22T00:00:00.000Z') }, // 7 days before May 29
          paymentStatus: 'Completed',
        }));
        // Assuming mockOrders[0] and mockOrders[1] are completed and within the last week
        const expectedRevenue = (mockOrders[0].finalAmountPaid || 0) + (mockOrders[1].finalAmountPaid || 0);
        const expectedTotalOrders = 2;
        expect(report.totalRevenue).toBe(expectedRevenue);
        expect(report.totalOrders).toBe(expectedTotalOrders);
        expect(report.averageOrderValue).toBe(expectedTotalOrders > 0 ? expectedRevenue / expectedTotalOrders : 0);
        expect(report.period).toBe('weekly');
      });

      it('should handle no orders for salesOverview', async () => {
        Order.find.mockResolvedValue([]);
        const report = await reportService.getReports('salesOverview', 'monthly');
        expect(report.totalRevenue).toBe(0);
        expect(report.totalOrders).toBe(0);
        expect(report.averageOrderValue).toBe(0);
      });
    });

    describe('orderStats', () => {
      it('should calculate order statistics correctly for a monthly period', async () => {
        Order.find.mockImplementation(query => {
            const startDate = query.orderDate?.$gte;
            if (startDate) return Promise.resolve(mockOrders.filter(o => new Date(o.orderDate) >= startDate));
            return Promise.resolve(mockOrders);
        });

        const report = await reportService.getReports('orderStats', 'monthly');
        expect(Order.find).toHaveBeenCalledWith(expect.objectContaining({
          orderDate: { $gte: new Date('2025-04-29T00:00:00.000Z') }, // 1 month before May 29
        }));
        // All 3 mockOrders should be within the last month
        expect(report.totalOrdersInPeriod).toBe(3);
        expect(report.ordersByStatus).toEqual({
          'Delivered': 2,
          'Pending Payment': 1,
        });
        expect(report.period).toBe('monthly');
      });
       // ... (test for no orders)
    });

    describe('customerStats', () => {
      it('should calculate customer statistics correctly for a weekly period', async () => {
        User.countDocuments
            .mockImplementationOnce(query => { // For totalActiveCustomers
                if(query.role === 'customer' && query.status === 'Active') return Promise.resolve(2); // Assume 2 total active customers
                return Promise.resolve(0);
            })
            .mockImplementationOnce(query => { // For newCustomersInPeriod
                const startDate = query.createdAt?.$gte;
                if (startDate && query.role === 'customer') {
                    return Promise.resolve(mockUsers.filter(u => u.role === 'customer' && new Date(u.createdAt) >= startDate).length);
                }
                return Promise.resolve(0);
            });

        const report = await reportService.getReports('customerStats', 'weekly');
        expect(User.countDocuments).toHaveBeenCalledWith({ role: 'customer', status: 'Active' });
        expect(User.countDocuments).toHaveBeenCalledWith({
          role: 'customer',
          createdAt: { $gte: new Date('2025-05-22T00:00:00.000Z') },
        });
        expect(report.totalActiveCustomers).toBe(2); // Total active, not period specific in current service logic
        expect(report.newCustomersInPeriod).toBe(1); // Only mockUsers[1] (Cust B) created in the last week
        expect(report.period).toBe('weekly');
      });
       // ... (test for no new customers)
    });

    describe('driverStats', () => {
      it('should calculate top driver statistics correctly for an allTime period', async () => {
        User.find.mockResolvedValue(mockUsers.filter(u => u.role === 'driver'));
        // Mock Order.countDocuments for each driver
        Order.countDocuments.mockImplementation(query => {
          if (query.driverId === 'd1' && query.status === 'Delivered') return Promise.resolve(2); // d1 has 2 delivered orders (o1, o3 if o3 were delivered) -> let's say 1 for simplicity from mockOrders
          if (query.driverId === 'd2' && query.status === 'Delivered') return Promise.resolve(1); // d2 has 1 delivered order (o2)
          return Promise.resolve(0);
        });
        // Adjusting the mockOrders for clarity for this test
        const specificMockOrders = [
            { driverId: 'd1', status: 'Delivered', orderDate: new Date('2025-01-01')},
            { driverId: 'd1', status: 'Delivered', orderDate: new Date('2025-01-02')}, // Driver d1 has 2
            { driverId: 'd2', status: 'Delivered', orderDate: new Date('2025-01-03')}, // Driver d2 has 1
        ];
         Order.countDocuments.mockImplementation(query => {
            const relevant = specificMockOrders.filter(o => o.driverId === query.driverId && o.status === query.status);
            return Promise.resolve(relevant.length);
        });


        const report = await reportService.getReports('driverStats', 'allTime');
        expect(User.find).toHaveBeenCalledWith({ role: 'driver', status: 'active' });
        expect(report.topDrivers.length).toBeLessThanOrEqual(5);
        expect(report.topDrivers[0]).toEqual({ driverId: 'd1', name: 'Driver X', totalDeliveriesInPeriod: 2 });
        expect(report.topDrivers[1]).toEqual({ driverId: 'd2', name: 'Driver Y', totalDeliveriesInPeriod: 1 });
        expect(report.period).toBe('allTime');
      });

      it('should correctly filter driver deliveries by period (e.g., weekly)', async () => {
          User.find.mockResolvedValue(mockUsers.filter(u => u.role === 'driver'));
          // Mock Order.countDocuments to respect date query
          Order.countDocuments.mockImplementation(query => {
              // query.orderDate.$gte should be approx 2025-05-22
              if (query.driverId === 'd1' && query.status === 'Delivered' && query.orderDate.$gte <= new Date(mockOrders[0].orderDate)) return Promise.resolve(1); // o1 is within week
              if (query.driverId === 'd2' && query.status === 'Delivered' && query.orderDate.$gte <= new Date(mockOrders[1].orderDate)) return Promise.resolve(1); // o2 is within week
              return Promise.resolve(0);
          });

          const report = await reportService.getReports('driverStats', 'weekly');
          expect(Order.countDocuments).toHaveBeenCalledWith(expect.objectContaining({
              status: 'Delivered',
              orderDate: { $gte: new Date('2025-05-22T00:00:00.000Z') }
          }));
          // Based on mockOrders, d1 has o1 (May 28), d2 has o2 (May 27)
          expect(report.topDrivers.find(d => d.driverId === 'd1').totalDeliveriesInPeriod).toBe(1);
          expect(report.topDrivers.find(d => d.driverId === 'd2').totalDeliveriesInPeriod).toBe(1);
      });

       // ... (test for no drivers, no deliveries)
    });

    it('should throw HttpError 400 for invalid report type', async () => {
      await expect(reportService.getReports('invalidType', 'weekly'))
        .rejects.toThrow(new HttpError(400, "Invalid report type specified: 'invalidType'."));
    });
    
    it('should throw HttpError 500 if Order.find fails for salesOverview', async () => {
        Order.find.mockRejectedValue(new Error('DB Error'));
        await expect(reportService.getReports('salesOverview', 'weekly'))
            .rejects.toThrow(new HttpError(500, 'Failed to generate report: DB Error'));
    });
  });
});