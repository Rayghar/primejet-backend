   // src/utils/catchAsync.js

   /**
    * Wraps an asynchronous route handler or middleware to automatically
    * catch any rejected promises or thrown errors and pass them to Express's
    * next error-handling middleware. This helps avoid repetitive try-catch blocks.
    *
    * @param {Function} fn - The asynchronous function (req, res, next) => Promise<void>
    * @returns {Function} - An Express middleware function (req, res, next) => void
    */
   const catchAsync = (fn) => (req, res, next) => {
     Promise.resolve(fn(req, res, next)).catch((err) => next(err));
   };

   module.exports = catchAsync;
   