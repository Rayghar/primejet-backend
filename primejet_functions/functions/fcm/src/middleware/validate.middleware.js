// File: src/middleware/validate.middleware.js
const Joi = require('joi');
const HttpError = require('../utils/HttpError');
const pick = require('../utils/pick');

const validate = (schema, dataSourceToValidate = 'body') => (req, res, next) => {
  // Debug: Log the schema to confirm it's defined
  console.log(`[VALIDATE_MIDDLEWARE] Schema for ${dataSourceToValidate}:`, schema);

  // Check if schema is undefined
  if (!schema) {
    console.error(`[VALIDATE_MIDDLEWARE] Error: Validation schema is undefined for ${dataSourceToValidate}`);
    return next(new HttpError(500, 'Internal server error: Validation schema is undefined'));
  }

  let objectToValidate;

  switch (dataSourceToValidate) {
    case 'query':
      objectToValidate = req.query;
      break;
    case 'params':
      objectToValidate = req.params;
      break;
    case 'body':
    default:
      objectToValidate = req.body;
      break;
  }

  // Check if schema is a Joi schema by verifying it has describe method
  if (typeof schema.describe !== 'function') {
    console.error(`[VALIDATE_MIDDLEWARE] Error: Invalid schema type for ${dataSourceToValidate}`, schema);
    return next(new HttpError(500, 'Internal server error: Invalid validation schema'));
  }

  const keysToPickFromSchema = Object.keys(schema.describe().keys || {});
  const isComplexSchema = ['params', 'query', 'body'].some(key => keysToPickFromSchema.includes(key));

  if (isComplexSchema) {
    const objectForValidation = pick(req, Object.keys(schema.describe().keys));
    const { error, value } = schema.validate(objectForValidation, {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: { body: true, query: true },
    });

    if (error) {
      const errorMessage = error.details.map((details) => details.message).join(', ');
      return next(new HttpError(400, `Validation error: ${errorMessage}`, error.details));
    }
    Object.assign(req, value);
    return next();
  } else {
    const { error, value } = schema.validate(objectToValidate, {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: true,
    });

    if (error) {
      const errorMessage = error.details.map((details) => details.message).join(', ');
      return next(new HttpError(400, `Validation error: ${errorMessage}`, error.details));
    }

    if (dataSourceToValidate === 'body') req.body = value;
    else if (dataSourceToValidate === 'query') req.query = value;
    else if (dataSourceToValidate === 'params') req.params = value;

    return next();
  }
};

module.exports = validate;