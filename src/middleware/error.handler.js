// File: src/middleware/error.handler.js
const HttpError = require('../utils/HttpError');
const { logger } = require('../config/logger.config'); // Your existing logger

/**
 * Centralized error handling middleware.
 * Catches errors passed via next(error) and sends appropriate responses.
 */
const errorHandler = (err, req, res, next) => {
  // Determine status code
  const statusCode = err.statusCode || 500;

  // Determine error message
  let message = err.message || 'An unexpected error occurred.';
  let errorDetails = {};

  // For HttpError instances, use their specific message and details
  if (err instanceof HttpError) {
    message = err.message;
    errorDetails = err.details || {}; // HttpError can carry extra details
  } else if (err.name === 'ValidationError') { // Example for Joi validation errors
    statusCode = 400;
    message = err.details[0].message || 'Validation error.';
    errorDetails = err.details;
  } else if (err.name === 'MongoServerError' && err.code === 11000) { // Example for MongoDB duplicate key error
    statusCode = 409; // Conflict
    message = 'Duplicate key error: A record with this unique value already exists.';
    errorDetails = { field: err.keyValue };
  }
  // Add more specific error types (e.g., database connection errors, external API errors)

  // Log the error with full stack trace and request context
  // Use logger.error for actual errors
  logger.error(`[ERROR] ${statusCode} - ${message}`, {
    path: req.originalUrl,
    method: req.method,
    ip: req.ip,
    body: req.body, // Log request body (be careful with sensitive data)
    query: req.query,
    params: req.params,
    user: req.user ? { id: req.user.id, role: req.user.role } : 'N/A', // Log authenticated user info
    stack: err.stack, // Full stack trace
    details: errorDetails, // Any specific details from the error object
    rawError: err // Log the raw error object for full inspection
  });

  // Send error response to client
  res.status(statusCode).json({
    status: 'error',
    message: message,
    // In development, you might send stack trace or more details. In production, keep it concise.
    // error: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    details: process.env.NODE_ENV === 'development' ? errorDetails : undefined,
  });
};

module.exports = { errorHandler };