// src/api/v1/faqs/faq.controller.js
const faqService = require('./faq.service'); // Path to co-located service
const HttpError = require('../../../utils/HttpError'); // Path to global HttpError utility
// const { logger } = require('../../../config/logger.config.js'); // Optional: for structured logging

// Public access
const getPublicFAQs = async (req, res, next) => {
  try {
    // req.query is validated by Joi schema in faq.routes.js
    const { category, role } = req.query;
    const faqs = await faqService.getPublicFAQs({ category, role });
    res.status(200).json(faqs);
  } catch (error) {
    // logger.error('[FAQ_CONTROLLER] Error in getPublicFAQs:', error);
    next(error);
  }
};

// Admin access required for the following operations
const getFAQs = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query; // Default values for pagination
    const result = await faqService.getFAQs({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
    res.status(200).json(result);
  } catch (error) {
    // logger.error('[FAQ_CONTROLLER] Error in getFAQs (admin):', error);
    next(error);
  }
};

const getFAQ = async (req, res, next) => {
  try {
    const { faqId } = req.params;
    const faq = await faqService.getFAQ(faqId);
    res.status(200).json(faq);
  } catch (error) {
    // logger.error(`[FAQ_CONTROLLER] Error in getFAQ for faqId ${req.params.faqId} (admin):`, error);
    next(error);
  }
};

const createFAQ = async (req, res, next) => {
  try {
    // req.body is validated by Joi schema in faq.routes.js
    const newFAQ = await faqService.createFAQ(req.body);
    // Original returned { faqId: faq.id }. Including a message is also good practice.
    res.status(201).json({ message: 'FAQ created successfully.', faqId: newFAQ.id, faq: newFAQ });
  } catch (error) {
    // logger.error('[FAQ_CONTROLLER] Error in createFAQ (admin):', error);
    next(error);
  }
};

const updateFAQ = async (req, res, next) => {
  try {
    const { faqId } = req.params;
    // req.body is validated by Joi schema in faq.routes.js
    const updatedFAQ = await faqService.updateFAQ(faqId, req.body);
    // It's often useful to return the updated resource.
    // If faqService.updateFAQ doesn't return it, a success message is fine.
    if (updatedFAQ) { // Assuming service might be changed to return the updated document
        res.status(200).json({ message: 'FAQ updated successfully.', faq: updatedFAQ });
    } else { // Fallback to original response style if service doesn't return the updated FAQ
        res.status(200).json({ message: 'FAQ updated successfully.' });
    }
  } catch (error) {
    // logger.error(`[FAQ_CONTROLLER] Error in updateFAQ for faqId ${req.params.faqId} (admin):`, error);
    next(error);
  }
};

// Optional: Add a deleteFAQ controller if you implement the route and service
// const deleteFAQ = async (req, res, next) => {
//   try {
//     const { faqId } = req.params;
//     await faqService.deleteFAQ(faqId);
//     res.status(200).json({ message: 'FAQ deleted successfully.' }); // Or 204 No Content
//   } catch (error) {
//     next(error);
//   }
// };

module.exports = {
  getPublicFAQs,
  getFAQs,
  getFAQ,
  createFAQ,
  updateFAQ,
  // deleteFAQ, // Uncomment if implemented
};