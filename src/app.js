// File: src/app.js

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const { logger } = require('./config/logger.config');
require('./config/firebase.config'); // Initialize Firebase

const { errorHandler } = require('./middleware/error.handler');
const { rateLimiter } = require('./middleware/rateLimit.middleware');
const { setupMetrics } = require('./utils/metrics');

// --- Step 1: Import All v1 Route Handlers ---
const authRoutes = require('./api/v1/auth/auth.routes');
const adminRoutes = require('./api/v1/admin/admin.routes');
const userRoutes = require('./api/v1/users/user.routes');
const addressRoutes = require('./api/v1/users/address.routes');
const orderRoutes = require('./api/v1/orders/order.routes');
const runRoutes = require('./api/v1/runs/run.routes');
const promotionRoutes = require('./api/v1/promotions/promotion.routes');
const faqRoutes = require('./api/v1/faqs/faq.routes');
const configRoutes = require('./api/v1/config/config.routes');
const reportRoutes = require('./api/v1/reports/report.routes');
const chatRoutes = require('./api/v1/chat/chat.routes');
const walletRoutes = require('./api/v1/wallet/wallet.routes');
const referralRoutes = require('./api/v1/referrals/referral.routes');
const runOrchestrationRoutes = require('./api/v1/run_orchestration/run_orchestration.routes');
const notificationRoutes = require('./api/v1/notifications/notification.routes');
const voiceRoutes = require('./api/v1/voice/voice.routes');
const agentRoutes = require('./api/v1/agents/agent.routes'); // <<< ADDED: Import agent routes [cite: user_prompt]
const paymentController = require('./api/v1/payments/payment.controller'); // Import controller for webhook

const app = express();

logger.info('[APP] Initializing Express application...');

// --- Step 2: Setup Global Middleware ---
app.use(helmet());
app.use(cors({ origin: '*' })); // Loosened for dev, can be tightened
app.use(morgan('combined', { stream: logger.stream }));
app.use('/api', rateLimiter);
app.use('/api/v1/orchestration', runOrchestrationRoutes);
app.use('/api/v1/voice', voiceRoutes); // Ensure this is before express.json if voice needs raw body


// --- Step 4: Setup General Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// --- Step 5: Mount All API v1 Routes ---
logger.info('[APP] Setting up API v1 routes...');
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/addresses', addressRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/runs', runRoutes);
app.use('/api/v1/promotions', promotionRoutes);
app.use('/api/v1/faqs', faqRoutes);
app.use('/api/v1/config', configRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/referrals', referralRoutes);
app.use('/api/v1/notifications', notificationRoutes);

app.use('/api/v1/agents', agentRoutes); // <<< ADDED: Mount agent routes [cite: user_prompt]
logger.info('[APP] API v1 routes setup complete.');


// --- Step 6: Health Check and Metrics ---
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Welcome to Gas2Door Backend API!', status: 'healthy' });
});
if (process.env.NODE_ENV !== 'test') {
  setupMetrics(app);
}

// --- Step 7: Centralized Error Handler (must be last) ---
app.use(errorHandler);

logger.info('[APP] Express application initialized successfully.');

module.exports = app;