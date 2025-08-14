// src/api/v1/faqs/faq.service.js
const { v4: uuidv4 } = require('uuid');
const FAQ = require('../../../models/faq.model');          // Adjusted path to global models
// Assuming redisClient is exported from your database setup file in src/config/
const { redisClient } = require('../../../config/database.config.js'); // Or from a dedicated redis.service.js
const HttpError = require('../../../utils/HttpError');      // Adjusted path to global utils
// const { logger } = require('../../../config/logger.config.js'); // Optional: for structured logging

const PUBLIC_FAQS_CACHE_PREFIX = 'faqs:public:';
const CACHE_EXPIRY_SECONDS = 3600; // 1 hour

// Helper to clear relevant public FAQ caches
const clearPublicFAQCaches = async () => {
  if (redisClient && typeof redisClient.keys === 'function' && typeof redisClient.del === 'function') {
    try {
      const keys = await redisClient.keys(`${PUBLIC_FAQS_CACHE_PREFIX}*`);
      if (keys.length > 0) {
        await redisClient.del(keys);
        // logger.info('[FAQ_SERVICE] Public FAQ caches invalidated.');
        console.log(`[FAQ_SERVICE] Cleared ${keys.length} public FAQ cache keys.`);
      }
    } catch (cacheError) {
      // logger.error('[FAQ_SERVICE] Error clearing public FAQ caches:', cacheError);
      console.error('[FAQ_SERVICE] Error clearing public FAQ caches:', cacheError);
      // Decide if this error should be re-thrown or just logged
    }
  }
};

const getPublicFAQs = async (filters) => {
  const { category, role } = filters;
  const cacheKey = `${PUBLIC_FAQS_CACHE_PREFIX}${category || 'all'}:${role || 'all'}`;

  try {
    if (redisClient && typeof redisClient.get === 'function') {
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        // logger.info(`[FAQ_SERVICE] Returning public FAQs from cache for key: ${cacheKey}`);
        return JSON.parse(cachedData);
      }
    }

    const query = { isActive: true };
    if (category) query.category = category;
    if (role && role !== 'all') query.role = role; // 'all' means don't filter by a specific role

    const faqs = await FAQ.find(query).sort({ category: 1, question: 1 }); // Optional sort

    if (redisClient && typeof redisClient.setEx === 'function') {
      await redisClient.setEx(cacheKey, CACHE_EXPIRY_SECONDS, JSON.stringify(faqs.map(faq => faq.toObject())));
      // logger.info(`[FAQ_SERVICE] Public FAQs cached for key: ${cacheKey}`);
    }
    return faqs.map(faq => faq.toObject());
  } catch (error) {
    // logger.error('[FAQ_SERVICE] Error fetching public FAQs:', error);
    console.error('Unexpected error in getPublicFAQs:', error);
    throw new HttpError(500, 'Failed to retrieve public FAQs.');
  }
};

// Admin service
const getFAQs = async (options) => {
  const { page = 1, limit = 10 } = options;
  try {
    const query = {}; // Add any admin filters if needed

    const totalFAQs = await FAQ.countDocuments(query);
    const faqs = await FAQ.find(query)
      .sort({ createdAt: -1 }) // Or by category, question
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      faqs: faqs.map(faq => faq.toObject()),
      currentPage: page,
      totalPages: Math.ceil(totalFAQs / limit),
      totalFAQs,
    };
  } catch (error) {
    // logger.error('[FAQ_SERVICE] Error in getFAQs (admin):', error);
    console.error('Unexpected error in getFAQs (admin):', error);
    throw new HttpError(500, 'Failed to retrieve FAQs for admin.');
  }
};

// Admin service
const getFAQ = async (faqId) => {
  try {
    const faq = await FAQ.findOne({ id: faqId }); // Assuming 'id' is your custom UUID field
    if (!faq) {
      throw new HttpError(404, 'FAQ not found.');
    }
    return faq.toObject();
  } catch (error) {
    // logger.error(`[FAQ_SERVICE] Error fetching FAQ ${faqId} (admin):`, error);
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in getFAQ (admin):', error);
    throw new HttpError(500, 'Failed to retrieve FAQ details.');
  }
};

// Admin service
const createFAQ = async (faqData) => {
  // Joi validation at route level handles format/type checks.
  // Service can add business logic like checking for duplicate questions if needed.
  const { question, answer, category, role, isActive } = faqData;

  try {
    // Optional: Check for duplicate question if questions should be unique
    // const existingFAQ = await FAQ.findOne({ question });
    // if (existingFAQ) {
    //   throw new HttpError(409, 'An FAQ with this question already exists.');
    // }

    const newFAQ = new FAQ({
      id: uuidv4(),
      question,
      answer,
      category: category || null, // Ensure null if empty, not undefined
      role: role || 'all',
      isActive: typeof isActive === 'boolean' ? isActive : true,
    });

    const savedFAQ = await newFAQ.save();
    await clearPublicFAQCaches(); // Invalidate relevant caches

    return savedFAQ.toObject();
  } catch (error) {
    // logger.error('[FAQ_SERVICE] Error creating FAQ (admin):', error);
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in createFAQ (admin):', error);
    throw new HttpError(500, `Failed to create FAQ: ${error.message}`);
  }
};

// Admin service
const updateFAQ = async (faqId, updateData) => {
  // Joi validation at route level ensures at least one field is provided and fields are valid.
  try {
    const faq = await FAQ.findOne({ id: faqId });
    if (!faq) {
      throw new HttpError(404, 'FAQ not found for update.');
    }

    // Optional: If question is updated, check for duplicates excluding the current FAQ
    // if (updateData.question && updateData.question !== faq.question) {
    //   const existingFAQ = await FAQ.findOne({ question: updateData.question, id: { $ne: faqId } });
    //   if (existingFAQ) {
    //     throw new HttpError(409, 'Another FAQ with this question already exists.');
    //   }
    // }

    // Apply updates
    Object.keys(updateData).forEach(key => {
      if (key !== 'id' && updateData[key] !== undefined) { // Prevent updating 'id'
        faq[key] = updateData[key];
      }
    });

    const updatedFAQ = await faq.save();
    await clearPublicFAQCaches(); // Invalidate relevant caches

    return updatedFAQ.toObject(); // Return the updated FAQ object
  } catch (error) {
    // logger.error(`[FAQ_SERVICE] Error updating FAQ ${faqId} (admin):`, error);
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in updateFAQ (admin):', error);
    throw new HttpError(500, `Failed to update FAQ: ${error.message}`);
  }
};

// Optional: Delete FAQ (Admin service)
// const deleteFAQ = async (faqId) => {
//   try {
//     const faq = await FAQ.findOneAndDelete({ id: faqId });
//     if (!faq) {
//       throw new HttpError(404, 'FAQ not found for deletion.');
//     }
//     await clearPublicFAQCaches(); // Invalidate relevant caches
//     return { message: 'FAQ deleted successfully.' };
//   } catch (error) {
//     if (error instanceof HttpError) throw error;
//     console.error('Unexpected error in deleteFAQ (admin):', error);
//     throw new HttpError(500, 'Failed to delete FAQ.');
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