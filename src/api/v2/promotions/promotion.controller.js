// src/api/v1/promotions/promotion.controller.js
const promotionService = require('./promotion.service'); // Path to co-located service
const HttpError = require('../../../utils/HttpError'); // Path to global HttpError utility
// const { logger } = require('../../../config/logger.config.js'); // Optional: for structured logging

// Public access
const getActivePromotions = async (req, res, next) => {
  try {
    const promotions = await promotionService.getActivePromotions();
    res.status(200).json(promotions);
  } catch (error) {
    // logger.error('[PROMOTION_CONTROLLER] Error in getActivePromotions:', error);
    next(error);
  }
};

// Admin access required for the following operations
const getPromotions = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const result = await promotionService.getPromotions({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
    res.status(200).json(result);
  } catch (error) {
    // logger.error('[PROMOTION_CONTROLLER] Error in getPromotions (admin):', error);
    next(error);
  }
};

const getPromotion = async (req, res, next) => {
  try {
    const { promoId } = req.params;
    const promotion = await promotionService.getPromotion(promoId);
    res.status(200).json(promotion);
  } catch (error) {
    // logger.error(`[PROMOTION_CONTROLLER] Error in getPromotion for promoId ${req.params.promoId} (admin):`, error);
    next(error);
  }
};

const createPromotion = async (req, res, next) => {
  try {
    // req.body is validated by Joi schema in promotion.routes.js
    const newPromotion = await promotionService.createPromotion(req.body);
    // Consistent with original: returns the ID of the created promotion.
    // Could also return the full newPromotion object.
    res.status(201).json({ promoId: newPromotion.id, message: 'Promotion created successfully.' });
  } catch (error) {
    // logger.error('[PROMOTION_CONTROLLER] Error in createPromotion (admin):', error);
    next(error);
  }
};

const updatePromotion = async (req, res, next) => {
  try {
    const { promoId } = req.params;
    // req.body is validated by Joi schema in promotion.routes.js
    const updatedPromotion = await promotionService.updatePromotion(promoId, req.body);
    // It's often useful to return the updated resource.
    // If promotionService.updatePromotion doesn't return it, a success message is fine.
    if (updatedPromotion) { // Assuming service might be changed to return the updated document
        res.status(200).json({ message: 'Promotion updated successfully.', promotion: updatedPromotion });
    } else {
        res.status(200).json({ message: 'Promotion updated successfully.' });
    }
  } catch (error) {
    // logger.error(`[PROMOTION_CONTROLLER] Error in updatePromotion for promoId ${req.params.promoId} (admin):`, error);
    next(error);
  }
};

// Optional: Add a deletePromotion controller if you implement the route and service
// const deletePromotion = async (req, res, next) => {
//   try {
//     const { promoId } = req.params;
//     await promotionService.deletePromotion(promoId);
//     res.status(200).json({ message: 'Promotion deleted successfully.' });
//   } catch (error) {
//     next(error);
//   }
// };

module.exports = {
  getActivePromotions,
  getPromotions,
  getPromotion,
  createPromotion,
  updatePromotion,
  // deletePromotion, // Uncomment if added
};