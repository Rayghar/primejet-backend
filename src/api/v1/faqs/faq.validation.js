// src/api/v1/faqs/faq.validation.js
const Joi = require('joi');

const faqBaseSchema = {
  question: Joi.string().min(5).max(500),
  answer: Joi.string().min(10).max(5000),
  category: Joi.string().trim().min(2).max(50).allow('', null).optional(),
  role: Joi.string().valid('customer', 'driver', 'all').default('all'),
  isActive: Joi.boolean().default(true),
};

const createFAQSchema = Joi.object({
  ...faqBaseSchema,
  question: faqBaseSchema.question.required().messages({
    'any.required': 'FAQ question is required.',
    'string.empty': 'FAQ question cannot be empty.',
    'string.min': 'FAQ question must be at least 5 characters long.',
    'string.max': 'FAQ question cannot exceed 500 characters.',
  }),
  answer: faqBaseSchema.answer.required().messages({
    'any.required': 'FAQ answer is required.',
    'string.empty': 'FAQ answer cannot be empty.',
    'string.min': 'FAQ answer must be at least 10 characters long.',
    'string.max': 'FAQ answer cannot exceed 5000 characters.',
  }),
  // category, role, isActive will use defaults or provided values
});

const updateFAQSchema = Joi.object({
  ...faqBaseSchema,
  // All fields are optional for update
}).min(1).messages({ // Requires at least one field to be provided for an update
    'object.min': 'At least one field must be provided to update the FAQ.'
});

// Schema for query parameters when fetching public FAQs
const getPublicFAQsSchema = Joi.object({
  category: Joi.string().trim().min(2).max(50).optional(),
  role: Joi.string().valid('customer', 'driver', 'all').optional(),
});

// Schema for route parameters like faqId (optional, for consistency)
const faqIdParamSchema = Joi.object({
  faqId: Joi.string().required().messages({ // Or Joi.string().uuid() if your IDs are UUIDs
    'any.required': 'FAQ ID parameter is required.',
  }),
});

module.exports = {
  createFAQSchema,
  updateFAQSchema,
  getPublicFAQsSchema, // For query parameter validation
  faqIdParamSchema,
};