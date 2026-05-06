// File: src/app.js

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const paymentController = require('./api/v1/payments/payment.controller');
const { logger } = require('./config/logger.config');
const { initializeFirebase, getFirestore } = require('./services/firebase.service');
const { errorHandler } = require('./middleware/error.handler');
const { setupMetrics } = require('./utils/metrics');
const HttpError = require('./utils/HttpError');
const initializeSocket = require('./socket.manager');
const mongoose = require('mongoose');
const globalConfig = require('./config');
const { buildCorsOptions } = require('./utils/productionSafety');

// -----------------------------------------------------------------------------
// Boot diagnostics
// -----------------------------------------------------------------------------
logger.info('[APP] Boot diagnostics', { nodeEnv: process.env.NODE_ENV || 'undefined' });

try {
  initializeFirebase();
  logger.info('[APP] Firebase initialization called successfully.');
} catch (error) {
  logger.error('[APP] Firebase failed to initialize at boot:', {
    message: error.message,
    stack: error.stack,
  });
}

// -----------------------------------------------------------------------------
// v1 Routes
// -----------------------------------------------------------------------------
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
const zoneRoutesV1 = require('./api/v1/zones/zone.routes');
const fcmRoutesV1 = require('./api/v1/fcm/fcm.routes');
const powerRoutesV1 = require('./api/v1/utilities/power.routes');

// -----------------------------------------------------------------------------
// v2 Routes
// -----------------------------------------------------------------------------
const operationsRoutes = require('./api/v2/operations/operations.routes');
const dataEntryRoutes = require('./api/v2/data-entry/data-entry.routes');
const financialsRoutes = require('./api/v2/financials/financials.routes');
const financeRoutes = require('./api/v2/finance/finanace.routes'); // filename kept as-is
const logsRoutes = require('./api/v2/logs/logs.routes');
const supportRoutes = require('./api/v2/support/support.routes');
const glRoutes = require('./api/v2/gl/gl.routes');
const migrationRoutes = require('./api/v2/migration/historicalMigration.routes');

// Optional v2 index aggregator
const v2ApiRoutes = require('./api/v2/index');

// -----------------------------------------------------------------------------
// Express app setup
// -----------------------------------------------------------------------------
const app = express();

logger.info('[APP] Initializing Express application...');

app.set('trust proxy', 1);

// -----------------------------------------------------------------------------
// Global middleware
// -----------------------------------------------------------------------------
app.use(helmet());

const corsOptions = buildCorsOptions();
app.use(cors(corsOptions));
app.options(/(.*)/, cors(corsOptions));

app.use(morgan('combined', { stream: logger.stream }));
app.use(require('./middleware/logger_middleware'));

// -----------------------------------------------------------------------------
// Monnify webhook MUST stay before express.json()
// -----------------------------------------------------------------------------
app.post(
  '/api/v1/payments/webhooks/monnify',
  bodyParser.raw({ type: 'application/json' }),
  paymentController.handleMonnifyWebhook
);

// -----------------------------------------------------------------------------
// Body parsers
// -----------------------------------------------------------------------------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// -----------------------------------------------------------------------------
// Lightweight request metadata
// -----------------------------------------------------------------------------
app.use((req, res, next) => {
  const requestId = req.headers['x-correlation-id'] || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  req.correlationId = requestId;
  res.setHeader('X-Correlation-Id', requestId);
  if (req.path.startsWith('/api/v1')) res.setHeader('X-API-Version', 'v1');
  if (req.path.startsWith('/api/v2')) res.setHeader('X-API-Version', 'v2');
  next();
});


// -----------------------------------------------------------------------------
// Route mounting
// -----------------------------------------------------------------------------
logger.info('[APP] Setting up API routes...');

// v1 routes
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
app.use('/api/v1/zones', zoneRoutesV1);
app.use('/api/v1/fcm', fcmRoutesV1);
app.use('/api/v1/power', powerRoutesV1);

logger.info('[APP] API v1 routes setup complete.');

// v2 routes
app.use('/api/v2/operations', operationsRoutes);
app.use('/api/v2/data-entry', dataEntryRoutes);
app.use('/api/v2/financials', financialsRoutes);
app.use('/api/v2/finance', financeRoutes);
app.use('/api/v2/logs', logsRoutes);
app.use('/api/v2/support', supportRoutes);
app.use('/api/v2/gl', glRoutes);
app.use('/api/v2/migration', migrationRoutes);

// Keep optional aggregator last so explicit routes above are not shadowed
app.use('/api/v2', v2ApiRoutes);

logger.info('[APP] API v2 routes setup complete.');

// -----------------------------------------------------------------------------
// Health checks and diagnostics
// -----------------------------------------------------------------------------

app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'primejet-bma-api', env: globalConfig.env, time: new Date().toISOString() });
});

app.get('/readyz', (_req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  res.status(mongoReady ? 200 : 503).json({
    status: mongoReady ? 'ready' : 'not_ready',
    mongo: { ready: mongoReady, readyState: mongoose.connection.readyState },
    time: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Welcome to PrimeJet Gas Backend API!',
    status: 'healthy',
  });
});

setupMetrics(app);

if (globalConfig.env !== 'production') {
  app.get('/_debug/firebase', (req, res, next) => {
    try {
      getFirestore();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
}

// -----------------------------------------------------------------------------
// 404 handler
// -----------------------------------------------------------------------------
app.use((req, res, next) => {
  next(new HttpError(404, `Not Found - ${req.originalUrl}`));
});

// -----------------------------------------------------------------------------
// Global error handler
// -----------------------------------------------------------------------------
app.use(errorHandler);

// -----------------------------------------------------------------------------
// Socket server
// -----------------------------------------------------------------------------
const server = http.createServer(app);

const io = new Server(server, {
  cors: corsOptions,
  path: globalConfig.socket?.path || '/socket.io',
  pingInterval: globalConfig.socket?.pingInterval || 10000,
  pingTimeout: globalConfig.socket?.pingTimeout || 5000,
});

initializeSocket(io);

logger.info('[APP] Express application and Socket.IO initialized successfully.');

module.exports = server;