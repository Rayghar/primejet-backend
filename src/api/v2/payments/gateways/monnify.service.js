// File: src/api/v1/payments/gateways/monnify.service.js

const axios = require('axios');
const User = require('../../../../models/user.model');
const PaymentMethod = require('../../../../models/paymentMethod.model');
const HttpError = require('../../../../utils/HttpError');
const { logger } = require('../../../../config/logger.config');

const MONNIFY_API_KEY = process.env.MONNIFY_API_KEY;
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const MONNIFY_CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE;
const MONNIFY_BASE_URL = process.env.MONNIFY_BASE_URL;

// Helper to get an authentication token from Monnify
const getAuthToken = async () => {
  try {
    const credentials = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`).toString('base64');
    const response = await axios.post(`${MONNIFY_BASE_URL}/api/v1/auth/login`, {}, {
      headers: { 'Authorization': `Basic ${credentials}` }
    });
    return response.data.responseBody.accessToken;
  } catch (error) {
    logger.error('[MONNIFY_SERVICE] Failed to get auth token:', error.response?.data || error.message);
    throw new HttpError(500, 'Could not authenticate with Monnify.');
  }
};

/**
 * Monnify doesn't have a "SetupIntent" like Stripe. Instead, we prepare the
 * necessary info for the frontend SDK to initialize.
 */
const createSetupIntent = async (userId) => {
  const user = await User.findOne({ id: userId });
  if (!user) throw new HttpError(404, 'User not found.');

  // The frontend SDK will need the API Key and Contract Code to initialize.
  // The "clientSecret" equivalent is this collection of necessary keys.
  return {
    apiKey: MONNIFY_API_KEY,
    contractCode: MONNIFY_CONTRACT_CODE,
    customerEmail: user.email,
    customerName: user.name,
  };
};

/**
 * Monnify's SDK provides a token after successful card entry. We use that
 * token to save the card details.
 */
const attachMethod = async ({ userId, paymentMethodId }) => {
  // For Monnify, 'paymentMethodId' will be the token returned by their SDK.
  const monnifyToken = paymentMethodId;
  const authToken = await getAuthToken();
  
  try {
    // Use the token to get card details from Monnify
    const response = await axios.get(`${MONNIFY_BASE_URL}/api/v2/cards/${monnifyToken}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    });

    const cardDetails = response.data.responseBody;

    const newMethod = new PaymentMethod({
        userId,
        gateway: 'monnify',
        gatewayCustomerId: cardDetails.customer.email, // Monnify uses email as customer identifier
        gatewayPaymentMethodId: cardDetails.id, // This is the permanent card token
        brand: cardDetails.cardBrand,
        last4: cardDetails.last4,
        expMonth: parseInt(cardDetails.expMonth, 10),
        expYear: parseInt(cardDetails.expYear, 10),
    });

    await newMethod.save();
    logger.info(`[MONNIFY_SERVICE] Successfully saved Monnify card for user ${userId}.`);
    return newMethod;

  } catch (error) {
    logger.error('[MONNIFY_SERVICE] Error attaching Monnify card:', error.response?.data || error.message);
    throw new HttpError(500, `Could not save Monnify card: ${error.response?.data?.responseMessage || error.message}`);
  }
};

/**
 * Monnify doesn't have a concept of a "default card" on their customer object.
 * This will be handled entirely within our own database.
 */
const setDefaultMethod = async (monnifyCustomerId, monnifyPaymentMethodId) => {
  // No API call is needed to Monnify. Our main service handles setting the flag in our DB.
  logger.info(`[MONNIFY_SERVICE] Default method set in local DB for card ${monnifyPaymentMethodId}.`);
  return Promise.resolve();
};

/**
 * Deletes a tokenized card from Monnify's system.
 */
const deleteMethod = async (monnifyPaymentMethodId) => {
  const authToken = await getAuthToken();
  try {
    await axios.delete(`${MONNIFY_BASE_URL}/api/v2/cards/${monnifyPaymentMethodId}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    });
    logger.info(`[MONNIFY_SERVICE] Successfully deleted card ${monnifyPaymentMethodId} from Monnify.`);
  } catch (error) {
    logger.error(`[MONNIFY_SERVICE] Error deleting Monnify card ${monnifyPaymentMethodId}:`, error.response?.data || error.message);
    // Don't throw an error if the card is already deleted on their end
    if (error.response?.status !== 404) {
        throw new HttpError(500, 'Failed to delete card from Monnify.');
    }
  }
};

module.exports = {
  createSetupIntent,
  attachMethod,
  setDefaultMethod,
  deleteMethod,
};