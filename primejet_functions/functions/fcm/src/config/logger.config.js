/**
 * A simple logger that uses the standard console.
 * It mimics the structure of winston with .info(), .warn(), and .error() methods,
 * so no other parts of the application need to be changed.
 * Cloud Functions automatically captures console output, making this approach
 * simple and effective.
 */
const logger = {
  info: (...args) => {
    console.log(...args);
  },
  warn: (...args) => {
    console.warn(...args);
  },
  error: (...args) => {
    console.error(...args);
  },
};

module.exports = { logger };
