// src/middleware/logger_middleware.js
const { logger } = require('../config/logger.config');

module.exports = (req, res, next) => {
  const start = Date.now();
  const { method, url, body, params, query, user } = req;
  const userId = user ? user.id : 'unauth';
  logger.info(`[REQ_START] ${method} ${url} - User: ${userId} - Body: ${JSON.stringify(body)} - Params: ${JSON.stringify(params)} - Query: ${JSON.stringify(query)}`);

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.debug(`[REQ_END] ${method} ${url} - Status: ${res.statusCode} - Duration: ${duration}ms`);
  });

  next();
};