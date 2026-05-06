// File: src/middleware/validate.middleware.js
const Joi = require('joi');
const HttpError = require('../utils/HttpError');
const pick = require('../utils/pick');

/**
 * Robust validation middleware.
 *
 * Supported calling styles:
 *   validate(schema)                    -> validates req.body (legacy default)
 *   validate(schema, 'params')          -> validates req.params
 *   validate(schema, 'query')           -> validates req.query
 *   validate({ body, params, query })   -> validates the supplied request segments
 *
 * The second signature is intentionally supported because several existing routes
 * already call validate(userIdParamSchema, 'params') and validate(schema, 'query').
 */
const validate = (schema, source = 'body') => (req, res, next) => {
  if (!schema) {
    return next(new HttpError(500, 'Internal server error: Validation schema not defined.'));
  }

  const isComplexSchema = ['body', 'params', 'query'].some((key) =>
    Object.prototype.hasOwnProperty.call(schema, key)
  );

  if (isComplexSchema) {
    const masterSchema = Joi.object(schema);
    const objectToValidate = pick(req, Object.keys(schema));

    const { value, error } = masterSchema.validate(objectToValidate, {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: true,
    });

    if (error) {
      const errorMessage = error.details.map((details) => details.message).join(', ');
      return next(new HttpError(400, `Validation error: ${errorMessage}`, error.details));
    }

    Object.assign(req, value);
    return next();
  }

  const requestSegment = ['body', 'params', 'query'].includes(source) ? source : 'body';
  const { value, error } = schema.validate(req[requestSegment] || {}, {
    abortEarly: false,
    allowUnknown: true,
    stripUnknown: true,
  });

  if (error) {
    const errorMessage = error.details.map((details) => details.message).join(', ');
    return next(new HttpError(400, `Validation error: ${errorMessage}`, error.details));
  }

  req[requestSegment] = value;
  return next();
};

module.exports = validate;
