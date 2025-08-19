// File: src/app.js

require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const helmet = require('helmet'); // Security middleware
const cors = require('cors');     // Cross-Origin Resource Sharing middleware
const morgan = require('morgan'); // HTTP request logger middleware

const { logger } = require('./config/logger.config'); // Custom logger
require('./config/firebase.config'); // Initialize Firebase Admin SDK (for mobile app's FCM, etc.)

const { errorHandler } = require('./middleware/error.handler'); // Custom error handler
const { rateLimiter } = require('./middleware/rateLimit.middleware'); // Rate limiting
const { setupMetrics } = require('./utils/metrics'); // Prometheus metrics setup
const HttpError = require('./utils/HttpError'); // Import HttpError for 404 handling

// --- Step 1: Import All v1 Route Handlers ---
// These are the existing routes for the mobile application.
const authRoutesV1 = require('./api/v1/auth/auth.routes');
const adminRoutesV1 = require('./api/v1/admin/admin.routes');
const userRoutesV1 = require('./api/v1/users/user.routes');
const addressRoutesV1 = require('./api/v1/users/address.routes');
const orderRoutesV1 = require('./api/v1/orders/order.routes');
const runRoutesV1 = require('./api/v1/runs/run.routes');
const promotionRoutesV1 = require('./api/v1/promotions/promotion.routes');
const faqRoutesV1 = require('./api/v1/faqs/faq.routes');
const configRoutesV1 = require('./api/v1/config/config.routes');
const reportRoutesV1 = require('./api/v1/reports/report.routes');
const chatRoutesV1 = require('./api/v1/chat/chat.routes');
const paymentRoutesV1 = require('./api/v1/payments/payment.routes');
const walletRoutesV1 = require('./api/v1/wallet/wallet.routes');
const referralRoutesV1 = require('./api/v1/referrals/referral.routes');
const notificationRoutesV1 = require('./api/v1/notifications/notification.routes');
const agentRoutesV1 = require('./api/v1/agents/agent.routes');
const runOrchestrationRoutesV1 = require('./api/v1/run_orchestration/run_orchestration.routes'); // Renamed for clarity
const voiceRoutesV1 = require('./api/v1/voice/voice.routes'); // Renamed for clarity
const dataEntryRoutes = require('./api/v2/data-entry/data-entry.routes'); // The new data-entry routes
const financialsRoutes = require('./api/v2/financials/financials.routes'); // Corrected path for financials routes
const financeRoutes = require('./api/v2/finance/finanace.routes'); // Corrected path for financials routes
const zoneRoutes = require('./api/v1/zones/zone.routes');

// --- Step 2: Import All v2 Route Handlers ---
// These are the new routes specifically for the web application.
const v2ApiRoutes = require('./api/v2/index'); // Consolidated v2 routes

// --- Step 3: Initialize Express App ---
const app = express();

logger.info('[APP] Initializing Express application...');

// --- Step 4: Setup Global Middleware ---
// Order of middleware matters: security, logging, body parsers, rate limiting.
app.use(helmet()); // Apply security headers
app.use(cors());   // Enable CORS for all origins (adjust as needed for production)

// Morgan for HTTP request logging (using custom logger stream)
app.use(morgan('combined', { stream: logger.stream }));

// Apply rate limiting to all requests (adjust limits as needed)
// Applying to '/api' to cover both v1 and v2
app.use('/api', rateLimiter); 

// --- Step 5: Handle Special Routes (like Paystack Webhook) BEFORE general JSON parser ---
// This must come BEFORE express.json() if you need the raw body for signature verification
const paymentController = require('./api/v1/payments/payment.controller'); // Assuming this path
app.post(
  '/api/v1/payments/paystack/webhook', // Specific path for the webhook
  express.raw({ type: 'application/json' }), // Parse as raw body for signature verification
  paymentController.handlePaystackWebhook
);

// --- Step 6: Setup General Body Parsers ---
// These parse JSON and URL-encoded data from incoming requests.
app.use(express.json());       // Parses JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parses URL-encoded request bodies

// --- Step 7: Mount All API Routes ---
logger.info('[APP] Setting up API routes...');

// Mount v1 API routes (for mobile app - untouched)
app.use('/api/v1/auth', authRoutesV1);
app.use('/api/v1/admin', adminRoutesV1);
app.use('/api/v1/users', userRoutesV1);
app.use('/api/v1/addresses', addressRoutesV1);
app.use('/api/v1/orders', orderRoutesV1);
app.use('/api/v1/runs', runRoutesV1);
app.use('/api/v1/promotions', promotionRoutesV1);
app.use('/api/v1/faqs', faqRoutesV1);
app.use('/api/v1/config', configRoutesV1);
app.use('/api/v1/reports', reportRoutesV1);
app.use('/api/v1/chat', chatRoutesV1);
app.use('/api/v1/payments', paymentRoutesV1);
app.use('/api/v1/wallet', walletRoutesV1);
app.use('/api/v1/referrals', referralRoutesV1);
app.use('/api/v1/notifications', notificationRoutesV1);
app.use('/api/v1/agents', agentRoutesV1);
app.use('/api/v1/orchestration', runOrchestrationRoutesV1); // Mount existing orchestration route
app.use('/api/v1/voice', voiceRoutesV1); // Mount existing voice route
app.use('/api/v1/zones', zoneRoutes);
logger.info('[APP] API v1 routes setup complete.');
app.use(require('./middleware/logger_middleware')); // Custom logger middleware for request logging

// Mount v2 API routes (for web app - new)
app.use('/api/v2', v2ApiRoutes);
logger.info('[APP] API v2 routes setup complete.');
app.use('/api/v2/data-entry', dataEntryRoutes);
app.use('/api/v2/financials', financialsRoutes); // Corrected path and prefix
app.use('/api/v2/financials', financialsRoutes); // Corrected path and prefix
app.use('/api/v2/finance', financeRoutes); // Corrected path and prefix
// --- Step 8: Health Check and Metrics ---
// Health check for the root path
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Welcome to PrimeJet Gas Backend API!', status: 'healthy' });
});

// Setup Prometheus metrics endpoint (unconditionally for production)
setupMetrics(app);


// --- Step 9: Handle Unhandled Routes (404) ---
app.use((req, res, next) => {
  next(new HttpError(404, `Not Found - ${req.originalUrl}`));
});

// --- Step 10: Global Error Handler ---
// This must be the last middleware added.
app.use(errorHandler);

logger.info('[APP] Express application initialized successfully.');

module.exports = app;