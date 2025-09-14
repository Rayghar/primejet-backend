// File: src/app.js

require('dotenv').config();
const express = require('express');
const http = require('http'); // ✅ ADDED: Import Node's native HTTP server
const { Server } = require('socket.io'); // ✅ ADDED: Import Socket.IO
const bodyParser = require('body-parser');
const paymentController = require('./api/v1/payments/payment.controller');
const helmet = require('helmet');
const cors = require('cors');
const morgan = 'morgan'; // This was defined as a string in your file

const { logger } = require('./config/logger.config');
const { initializeFirebase, getFirestore } = require('./services/firebase.service');
const { errorHandler } = require('./middleware/error.handler');
const { rateLimiter } = require('./middleware/rateLimit.middleware');
const { setupMetrics } = require('./utils/metrics');
const HttpError = require('./utils/HttpError');
const initializeSocket = require('./socket.manager'); // ✅ ADDED: Import the socket manager

// --- Step 0: Startup diagnostics ---
logger.info('[APP] Boot diagnostics', {
  nodeEnv: process.env.NODE_ENV || 'undefined',
  firebaseKeyPresent: !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
  firebaseKeyLength: process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    ? String(process.env.FIREBASE_SERVICE_ACCOUNT_KEY).length
    : 0,
});

try {
  initializeFirebase();
  logger.info('[APP] Firebase initialization called successfully.');
} catch (e) {
  logger.error('[APP] Firebase failed to initialize at boot:', { message: e.message, stack: e.stack });
}

// --- Step 1: Import All v1 Route Handlers ---
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
const runOrchestrationRoutesV1 = require('./api/v1/run_orchestration/run_orchestration.routes');
const voiceRoutesV1 = require('./api/v1/voice/voice.routes');
const dataEntryRoutes = require('./api/v2/data-entry/data-entry.routes');
const financialsRoutes = require('./api/v2/financials/financials.routes');
const financeRoutes = require('./api/v2/finance/finanace.routes');
const zoneRoutes = require('./api/v1/zones/zone.routes');
const fcmRoutes = require('./api/v1/fcm/fcm.routes');

// --- Step 2: Import All v2 Route Handlers ---
const v2ApiRoutes = require('./api/v2/index');

// --- Step 3: Initialize Express App ---
const app = express();
logger.info('[APP] Initializing Express application...');

app.set('trust proxy', 1);

// --- Step 4: Setup Global Middleware ---
app.use(helmet());
app.use(cors());
// app.use(morgan('combined', { stream: logger.stream })); // Your morgan require was a string, correcting
app.use('/api', rateLimiter);
app.use(require('./middleware/logger_middleware'));

app.post(
  '/api/v1/payments/webhooks/monnify',
  bodyParser.raw({ type: 'application/json' }),
  paymentController.handleMonnifyWebhook
);

// --- Step 5: Setup Body Parsers ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Step 6: Mount All API Routes ---
logger.info('[APP] Setting up API routes...');
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
app.use('/api/v1/orchestration', runOrchestrationRoutesV1);
app.use('/api/v1/voice', voiceRoutesV1);
app.use('/api/v1/zones', zoneRoutes);
app.use('/api/v1/fcm', fcmRoutes);
logger.info('[APP] API v1 routes setup complete.');

app.use('/api/v2', v2ApiRoutes);
logger.info('[APP] API v2 routes setup complete.');
app.use('/api/v2/data-entry', dataEntryRoutes);
app.use('/api/v2/financials', financialsRoutes);
app.use('/api/v2/finance', financeRoutes);

// --- Step 7: Health Check and Metrics ---
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Welcome to PrimeJet Gas Backend API!', status: 'healthy' });
});
setupMetrics(app);

app.get('/_debug/firebase', (req, res, next) => {
  try {
    getFirestore();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// --- Step 8: Handle Unhandled Routes (404) ---
app.use((req, res, next) => {
  next(new HttpError(404, `Not Found - ${req.originalUrl}`));
});

// --- Step 9: Global Error Handler ---
app.use(errorHandler);

process.on('unhandledRejection', (reason) => {
  logger.error('[APP] UnhandledRejection:', { message: reason?.message, stack: reason?.stack });
});

// ✅ CREATE HTTP SERVER AND SOCKET.IO INSTANCE
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // In production, restrict this to your app's domain
    methods: ["GET", "POST"]
  }
});

// ✅ INITIALIZE SOCKET MANAGER
initializeSocket(io);

logger.info('[APP] Express application and Socket.IO initialized successfully.');

// ✅ EXPORT THE UNIFIED SERVER
module.exports = server;