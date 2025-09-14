// File: src/middleware/validate.middleware.js
const Joi = require('joi');
const HttpError = require('../utils/HttpError');
const pick = require('../utils/pick');

/**
 * A robust validation middleware that intelligently handles both simple and complex schemas.
 * - For a complex schema like { body: userSchema, params: idSchema }, it validates req.body and req.params.
 * - For a simple schema like userSchema, it validates req.body by default (maintaining old functionality).
 * @param {object} schema - The Joi schema object or a plain object containing Joi schemas.
 */
const validate = (schema) => (req, res, next) => {
  // Ensure a schema was actually provided to the middleware in the route.
  if (!schema) {
    return next(new HttpError(500, 'Internal server error: Validation schema not defined.'));
  }

  // Intelligently detect if the schema is complex by checking for 'body', 'params', or 'query' keys.
  const isComplexSchema = ['body', 'params', 'query'].some((key) =>
    Object.prototype.hasOwnProperty.call(schema, key)
  );

  if (isComplexSchema) {
    // --- HANDLE COMPLEX SCHEMA ---
    // This is the case for your chat route: validate({ body: someSchema })

    // Combine all parts of the schema into one master Joi object.
    const masterSchema = Joi.object(schema);

    // Pick the corresponding parts from the request object (e.g., req.body, req.params).
    const objectToValidate = pick(req, Object.keys(schema));

    const { value, error } = masterSchema.validate(objectToValidate, {
      abortEarly: false, // Return all validation errors, not just the first one.
      allowUnknown: true, // Allow fields in the request that are not defined in the schema.
      stripUnknown: true, // Remove unknown fields from the validated output.
    });

    if (error) {
      const errorMessage = error.details.map((details) => details.message).join(', ');
      return next(new HttpError(400, `Validation error: ${errorMessage}`, error.details));
    }

    // Assign the validated and cleaned values back to the request object (e.g., req.body, req.params).
    Object.assign(req, value);
    return next();

  } else {
    // --- HANDLE SIMPLE SCHEMA (maintains original functionality) ---
    // This handles cases where you might just pass a schema to validate the request body directly.
    
    const { value, error } = schema.validate(req.body, {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: true,
    });

    if (error) {
      const errorMessage = error.details.map((details) => details.message).join(', ');
      return next(new HttpError(400, `Validation error: ${errorMessage}`, error.details));
    }

    // Assign the validated and cleaned value back to req.body.
    req.body = value;
    return next();
  }
};

module.exports = validate;