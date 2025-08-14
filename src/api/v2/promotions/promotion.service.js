// src/api/v1/promotions/promotion.service.js
const { v4: uuidv4 } = require('uuid');
const Promotion = require('../../../models/promotion.model'); // Adjusted path to global models
// Assuming redisClient is exported from your database setup file in src/config/
const { redisClient } = require('../../../config/database.config.js');// Or from a dedicated redis.service.js
const HttpError = require('../../../utils/HttpError');   // Adjusted path to global utils
// const { logger } = require('../../../config/logger.config.js'); // Optional: for structured logging

const ACTIVE_PROMOTIONS_CACHE_KEY = 'promotions:active';
const CACHE_EXPIRY_SECONDS = 3600; // 1 hour

const getActivePromotions = async () => {
  try {
    if (redisClient && typeof redisClient.get === 'function') {
      const cachedData = await redisClient.get(ACTIVE_PROMOTIONS_CACHE_KEY);
      if (cachedData) {
        // logger.info('[PROMOTION_SERVICE] Returning active promotions from cache.');
        return JSON.parse(cachedData);
      }
    }

    const promotions = await Promotion.find({
      isActive: true,
      validFrom: { $lte: new Date() }, // Promotion must have started
      validUntil: { $gte: new Date() }, // Promotion must not have expired
    }).sort({ validUntil: 1 }); // Optional: sort by expiry or creation date

    if (redisClient && typeof redisClient.setEx === 'function') {
      await redisClient.setEx(ACTIVE_PROMOTIONS_CACHE_KEY, CACHE_EXPIRY_SECONDS, JSON.stringify(promotions));
      // logger.info('[PROMOTION_SERVICE] Active promotions cached.');
    }
    return promotions.map(promo => promo.toObject());
  } catch (error) {
    // logger.error('[PROMOTION_SERVICE] Error fetching active promotions:', error);
    console.error('Unexpected error in getActivePromotions:', error); // Fallback logging
    // It might be better to return an empty array or log error and not fail the call if cache fails
    // but DB succeeds, or vice-versa depending on desired resilience.
    // For now, if DB fails, it throws.
    throw new HttpError(500, 'Failed to retrieve active promotions.');
  }
};

// Admin service
const getPromotions = async (options) => {
  const { page = 1, limit = 10 } = options;
  try {
    const query = {}; // Add any admin filters if needed, e.g., by status, date range

    const totalPromotions = await Promotion.countDocuments(query);
    const promotions = await Promotion.find(query)
      .sort({ createdAt: -1 }) // Sort by creation date or other relevant field
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      promotions: promotions.map(promo => promo.toObject()),
      currentPage: page,
      totalPages: Math.ceil(totalPromotions / limit),
      totalPromotions,
    };
  } catch (error) {
    // logger.error('[PROMOTION_SERVICE] Error in getPromotions (admin):', error);
    console.error('Unexpected error in getPromotions (admin):', error);
    throw new HttpError(500, 'Failed to retrieve promotions for admin.');
  }
};

// Admin service
const getPromotion = async (promoId) => {
  try {
    const promotion = await Promotion.findOne({ id: promoId }); // Assuming 'id' is your custom UUID field
    if (!promotion) {
      throw new HttpError(404, 'Promotion not found.');
    }
    return promotion.toObject();
  } catch (error) {
    // logger.error(`[PROMOTION_SERVICE] Error fetching promotion ${promoId} (admin):`, error);
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in getPromotion (admin):', error);
    throw new HttpError(500, 'Failed to retrieve promotion details.');
  }
};

// Admin service
const createPromotion = async (promotionData) => {
  // Joi validation at route level handles format/type checks (e.g., validFrom < validUntil).
  // Service can focus on business rules like promoCode uniqueness.
  const { promoCode, ...restOfData } = promotionData;

  try {
    const existingPromo = await Promotion.findOne({ promoCode: promoCode.toUpperCase() });
    if (existingPromo) {
      throw new HttpError(409, `Promo code '${promoCode}' already exists.`);
    }

    const newPromotion = new Promotion({
      id: uuidv4(),
      promoCode: promoCode.toUpperCase(), // Standardize promo code casing
      ...restOfData,
    });

    const savedPromotion = await newPromotion.save();

    // Invalidate active promotions cache
    if (redisClient && typeof redisClient.del === 'function') {
      await redisClient.del(ACTIVE_PROMOTIONS_CACHE_KEY);
      // logger.info('[PROMOTION_SERVICE] Active promotions cache invalidated due to new promotion.');
    }

    return savedPromotion.toObject();
  } catch (error) {
    // logger.error('[PROMOTION_SERVICE] Error creating promotion (admin):', error);
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in createPromotion (admin):', error);
    throw new HttpError(500, `Failed to create promotion: ${error.message}`);
  }
};

// Admin service
const updatePromotion = async (promoId, updateData) => {
  // Joi validation at route level ensures at least one field is provided and fields are valid.
  try {
    const promotion = await Promotion.findOne({ id: promoId });
    if (!promotion) {
      throw new HttpError(404, 'Promotion not found for update.');
    }

    // If promoCode is being updated, check for uniqueness
    if (updateData.promoCode && updateData.promoCode.toUpperCase() !== promotion.promoCode) {
      const existingPromoWithNewCode = await Promotion.findOne({
        promoCode: updateData.promoCode.toUpperCase(),
        id: { $ne: promoId } // Exclude current promotion
      });
      if (existingPromoWithNewCode) {
        throw new HttpError(409, `Promo code '${updateData.promoCode}' is already in use.`);
      }
      updateData.promoCode = updateData.promoCode.toUpperCase(); // Standardize
    }

    // Apply updates
    Object.keys(updateData).forEach(key => {
      // Ensure not to accidentally allow updating 'id' or other immutable fields if any
      if (key !== 'id' && updateData[key] !== undefined) {
        promotion[key] = updateData[key];
      }
    });

    // Ensure validFrom is before validUntil if either is updated
    if ((updateData.validFrom || updateData.validUntil) && promotion.validFrom >= promotion.validUntil) {
        throw new HttpError(400, '"validUntil" date must be after "validFrom" date.');
    }

    const updatedPromotion = await promotion.save();

    // Invalidate active promotions cache
    if (redisClient && typeof redisClient.del === 'function') {
      await redisClient.del(ACTIVE_PROMOTIONS_CACHE_KEY);
      // logger.info(`[PROMOTION_SERVICE] Active promotions cache invalidated due to update on promotion ${promoId}.`);
    }

    return updatedPromotion.toObject();
  } catch (error) {
    // logger.error(`[PROMOTION_SERVICE] Error updating promotion ${promoId} (admin):`, error);
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in updatePromotion (admin):', error);
    throw new HttpError(500, `Failed to update promotion: ${error.message}`);
  }
};

// Optional: Delete Promotion (Admin service)
// const deletePromotion = async (promoId) => {
//   try {
//     const promotion = await Promotion.findOneAndDelete({ id: promoId });
//     if (!promotion) {
//       throw new HttpError(404, 'Promotion not found for deletion.');
//     }
//     if (redisClient && typeof redisClient.del === 'function') {
//       await redisClient.del(ACTIVE_PROMOTIONS_CACHE_KEY);
//     }
//     return { message: 'Promotion deleted successfully.' };
//   } catch (error) {
//     if (error instanceof HttpError) throw error;
//     console.error('Unexpected error in deletePromotion (admin):', error);
//     throw new HttpError(500, 'Failed to delete promotion.');
//   }
// };

module.exports = {
  getActivePromotions,
  getPromotions,
  getPromotion,
  createPromotion,
  updatePromotion,
  // deletePromotion, // Uncomment if implemented
};