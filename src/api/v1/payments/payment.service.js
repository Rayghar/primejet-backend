// File: src/api/v1/payments/payment.service.js
const crypto = require('crypto'); // Keep crypto for potential future webhook verification
const Order = require('../../../models/order.model'); // Keep Order model import if needed elsewhere
const HttpError = require('../../../utils/HttpError'); // Adjust path as needed
const { logger } = require('../../../config/logger.config'); // Assuming a logger utility
const axios = require('axios'); // Added axios for HTTP requests
const dotenv = require('dotenv');

dotenv.config();

const MONNIFY_BASE_URL = "https://sandbox.monnify.com";
// Use process.env directly for keys
const MONNIFY_API_KEY = process.env.MONNIFY_API_KEY; // Public Key
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY; // Secret Key
const MONNIFY_CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE; // Contract Code

// This function can be used to create Monnify payments initiated from your backend
// (e.g., if you process payments on your server instead of directly from Flutter SDK)
async function createMonnifyPayment(
  amount, // in Naira (major unit)
  customerName,
  customerEmail,
  paymentReference,
  paymentDescription,
  redirectUrl
) {
  try {
    // First, obtain an access token using Basic Auth for your API Key and Secret Key
    const authString = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`).toString(
      "base64"
    );
    const authResponse = await axios.post(
      `${MONNIFY_BASE_URL}/auth/login`,
      {},
      { headers: { Authorization: `Basic ${authString}` } }
    );
    const accessToken = authResponse.data.responseBody.accessToken;

    // Then, use the Bearer token for the init-transaction call
    const response = await axios.post(
      `${MONNIFY_BASE_URL}/merchant/transactions/init-transaction`,
      {
        amount: amount,
        customerName: customerName,
        customerEmail: customerEmail,
        paymentReference: paymentReference,
        paymentDescription: paymentDescription,
        currencyCode: "NGN",
        contractCode: MONNIFY_CONTRACT_CODE, // Use from env
        redirectUrl: redirectUrl,
        // paymentMethods: ["CARD", "ACCOUNT_TRANSFER"], // You can specify preferred methods
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`, // Use Bearer token
          "Content-Type": "application/json",
        },
      }
    );
    logger.info(`[Payment Service] Monnify payment initiation successful for ref: ${paymentReference}`);
    return response.data;
  } catch (error) {
    logger.error("Monnify init payment error:", error.response?.data || error.message);
    throw new HttpError(500, "Failed to initialize Monnify payment"); // Use HttpError for consistency
  }
}

// The processMonnifyWebhook function from the original file is removed as per the update instruction.
// If it's still needed, it would need to be re-added and potentially modified to use the new Order model structure.

module.exports = {
  createMonnifyPayment,
  // If processMonnifyWebhook is still needed, it should be re-added here.
};
