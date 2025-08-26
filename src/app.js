// File: src/app.js

module.exports = (config, logger) => {
  const express = require('express');
  const bodyParser = require('body-parser'); 
  const paymentController = require('./api/v1/payments/payment.controller'); 

  const helmet = require('helmet');
  const cors = require('cors');
  const morgan = require('morgan');

  const { errorHandler } = require('./middleware/error.handler'); 
  const { rateLimiter } = require('./middleware/rateLimit.middleware'); 
  const { setupMetrics } = require('./utils/metrics'); 

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
  const paymentRoutes = require('./api/v1/payments/payment.routes');
  const walletRoutes = require('./api/v1/wallet/wallet.routes');
  const referralRoutes = require('./api/v1/referrals/referral.routes');
  const runOrchestrationRoutes = require('./api/v1/run_orchestration/run_orchestration.routes');
  const notificationRoutes = require('./api/v1/notifications/notification.routes');
  const voiceRoutes = require('./api/v1/voice/voice.routes');
  const agentRoutes = require('./api/v1/agents/agent.routes');

  const app = express();
  app.set('trust proxy', 1); 

  logger.info('[APP] Initializing Express application...');

  app.use(helmet());
  app.use(cors({ origin: '*' })); 
  app.use(morgan('combined', { stream: logger.stream }));
  app.use('/api', rateLimiter); 
  app.use('/api/v1/orchestration', runOrchestrationRoutes);
  app.use('/api/v1/voice', voiceRoutes); 

  app.post('/api/v1/webhooks/monnify', bodyParser.raw({ type: 'application/json' }), paymentController.handleMonnifyWebhook);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

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
  app.use('/api/v1/payments', paymentRoutes);
  app.use('/api/v1/wallet', walletRoutes);
  app.use('/api/v1/referrals', referralRoutes);
  app.use('/api/v1/notifications', notificationRoutes);
  app.use('/api/v1/agents', agentRoutes); 
  logger.info('[APP] API v1 routes setup complete.');

  app.get('/', (req, res) => {
    res.status(200).json({ message: 'Welcome to Gas2Door Backend API!', status: 'healthy' });
  });
  if (config.env !== 'test') { 
    setupMetrics(app); 
  }

  app.use(errorHandler(config)); 

  logger.info('[APP] Express application initialized successfully.');

  return app; 
};