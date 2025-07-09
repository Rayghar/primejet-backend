// src/utils/metrics.js
const client = require('prom-client');
const { logger } = require('../config/logger.config.js'); // Assuming logger config path
const HttpError = require('./HttpError'); // Assuming HttpError path

const setupMetrics = (app) => {
  try {
    const collectDefaultMetrics = client.collectDefaultMetrics;
    // Probe every 5th second.
    collectDefaultMetrics({ timeout: 5000 });
    logger.info('[METRICS] Default Prometheus metrics collection started.');

    const httpRequestDurationMicroseconds = new client.Histogram({
      name: 'http_request_duration_seconds', // Standard name in seconds
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], // More granular buckets
    });

    // Middleware to record HTTP request duration
    app.use((req, res, next) => {
      // Small optimization: don't record metrics for the /metrics endpoint itself
      if (req.path === '/metrics') {
        return next();
      }
      const end = httpRequestDurationMicroseconds.startTimer();
      res.on('finish', () => {
        const route = req.route && req.route.path ? req.route.path : req.path;
        end({ method: req.method, route, status_code: res.statusCode });
      });
      next();
    });

    app.get('/metrics', async (req, res, next) => {
      try {
        res.set('Content-Type', client.register.contentType);
        res.end(await client.register.metrics());
      } catch (ex) {
        logger.error('[METRICS] Error serving metrics endpoint:', ex);
        next(new HttpError(500, 'Could not serve metrics.'));
      }
    });
    logger.info('[METRICS] /metrics endpoint configured on the main app.');

  } catch (error) {
    logger.error('[METRICS] Failed to setup Prometheus metrics:', error);
    // Depending on criticality, you might want to re-throw or handle
  }
};

// Export client only if you need to define custom metrics elsewhere
module.exports = { setupMetrics /* , client */ };
