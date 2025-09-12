// src/utils/HttpError.js
class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details; // Optional field for more detailed validation errors, etc.
    this.name = this.constructor.name; // Sets name to 'HttpError'
    Error.captureStackTrace(this, this.constructor); // Maintains a clean stack trace
  }
}

module.exports = HttpError;
