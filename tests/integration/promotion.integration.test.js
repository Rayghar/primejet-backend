// tests/integration/api/v1/promotion.integration.test.js
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../../src/app'); // Adjust path to your main app.js file
const Promotion = require('../../src/models/promotion.model'); // Adjust path
const { v4: uuidv4 } = require('uuid'); // If needed for seeding data
const globalConfig = require('../../src/config'); // For JWT secret if creating admin tokens

// If you create admin tokens for admin-only routes in this test file:
// const jwt = require('jsonwebtoken');
// const generateAdminToken = () => {
//   return jwt.sign({ id: 'admin-test-id', role: 'admin' }, globalConfig.jwt.secret, { expiresIn: '1h' });
// };

let mongoServer;
const HOOK_TIMEOUT = 30000; // 30 seconds, adjust as needed

// --- Test Database Setup ---
beforeAll(async () => {
  try {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  } catch (err) {
    console.error("Error in beforeAll during MongoDB setup:", err);
    // It's crucial to re-throw or handle this, otherwise mongoServer might be undefined leading to `afterAll` errors
    throw err; 
  }
}, HOOK_TIMEOUT); // Apply timeout to beforeAll

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) { // Check if mongoServer was successfully initialized
    await mongoServer.stop();
  }
});

// Clear and seed data before each test if necessary for this module
beforeEach(async () => {
  await Promotion.deleteMany({});

  // Seed some test data
  await Promotion.create([
    {
      id: uuidv4(),
      title: 'Active Summer Sale',
      shortDescription: 'Great summer deals!',
      promoCode: 'SUMMERFUN',
      isActive: true,
      validFrom: new Date(Date.now() - 86400000 * 1), // Started yesterday
      validUntil: new Date(Date.now() + 86400000 * 7), // Ends in 7 days
      type: 'Percentage Discount',
      value: 15,
    },
    {
      id: uuidv4(),
      title: 'Expired Winter Sale',
      shortDescription: 'Old winter deals',
      promoCode: 'WINTEROLD',
      isActive: true,
      validFrom: new Date(Date.now() - 86400000 * 60), // Started 60 days ago
      validUntil: new Date(Date.now() - 86400000 * 30), // Expired 30 days ago
      type: 'Fixed Amount',
      value: 500,
    },
    {
      id: uuidv4(),
      title: 'Inactive Promo',
      shortDescription: 'Not active yet',
      promoCode: 'NOTYET',
      isActive: false, // Inactive
      validFrom: new Date(Date.now() - 86400000 * 1),
      validUntil: new Date(Date.now() + 86400000 * 7),
      type: 'Percentage Discount',
      value: 10,
    },
    { // Another active promo for testing multiple results
      id: uuidv4(),
      title: 'Flash Friday Deal',
      shortDescription: 'Weekend special!',
      promoCode: 'FRIDAYFLASH',
      isActive: true,
      validFrom: new Date(Date.now() - 86400000 * 2), // Started 2 days ago
      validUntil: new Date(Date.now() + 86400000 * 1), // Ends tomorrow
      type: 'Fixed Amount',
      value: 1000, // e.g., 10 NGN if in kobo
    }
  ]);
});

// --- Test Suite ---
describe('Promotion API Endpoints (/api/v1/promotions)', () => {
  describe('GET /active', () => {
    it('should return a list of currently active and valid promotions', async () => {
      const response = await request(app)
        .get('/api/v1/promotions/active')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      // Based on seed data: SUMMERFUN and FRIDAYFLASH should be active
      expect(response.body.length).toBe(2); 
      const promoCodes = response.body.map(p => p.promoCode);
      expect(promoCodes).toContain('SUMMERFUN');
      expect(promoCodes).toContain('FRIDAYFLASH');
      response.body.forEach(promo => {
        expect(promo.isActive).toBe(true);
        expect(new Date(promo.validFrom) <= new Date()).toBe(true);
        expect(new Date(promo.validUntil) >= new Date()).toBe(true);
      });
    });

    it('should return an empty array if no promotions are currently active and valid', async () => {
      await Promotion.deleteMany({}); // Clear all promotions
      const response = await request(app)
        .get('/api/v1/promotions/active')
        .expect(200);
      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(0);
    });
  });

  // --- Admin Routes Tests (Example for GET / - Requires admin auth) ---
  // To test admin routes, you'd need to generate a valid admin token
  // and include it in the Authorization header.
  // For now, I'll add a placeholder, assuming you might implement token generation for tests.
  // const adminToken = generateAdminToken(); // You'd define this helper

  describe('GET / (Admin - Get All Promotions)', () => {
    // This test will fail if you don't provide a valid admin token
    // and if your authMiddleware is effective.
    it('should return 401 if no admin token is provided', async () => {
      await request(app)
        .get('/api/v1/promotions')
        .expect(401); // Expecting unauthorized if authMiddleware is on this route
    });

    // Example of how you might test with a token (requires setup)
    /*
    it('should return all promotions for an admin', async () => {
      const adminUser = await User.create({ id: 'admin-test', name: 'Test Admin', email: 'admin@test.com', password: 'password', role: 'admin' });
      const adminToken = jwt.sign({ id: adminUser.id, role: adminUser.role }, globalConfig.jwt.secret, { expiresIn: '1h' });

      const response = await request(app)
        .get('/api/v1/promotions')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect('Content-Type', /json/);

      expect(response.body.promotions).toBeInstanceOf(Array);
      expect(response.body.totalPromotions).toBe(4); // All seeded promotions
      expect(response.body.currentPage).toBe(1);
    });
    */
  });
  
  // Add more describe blocks for POST, PUT, GET /:promoId (admin routes)
  // ensuring you handle authentication (providing an admin JWT) and request body validation.
});
