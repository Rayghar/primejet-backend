// File: src/api/v1/payments/interswitch.service.js
const axios = require('axios');
const crypto = require('crypto'); // For any future signature needs
const Order = require('../../../models/order.model'); // Assuming your Order model
const User = require('../../../models/user.model'); // Assuming User model for customerEmail
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const ISW_MERCHANT_ID = process.env.ISW_MERCHANT_ID;
const ISW_DOMAIN_ID = process.env.ISW_DOMAIN_ID;
const ISW_CLIENT_ID = process.env.ISW_CLIENT_ID;
const ISW_CLIENT_SECRET = process.env.ISW_CLIENT_SECRET;
const ISW_LIVE_MODE = process.env.ISW_LIVE_MODE === 'true'; // Convert to boolean

// Base URLs for Interswitch APIs
const ISW_PASSPORT_BASE_URL = ISW_LIVE_MODE ? 'https://passport.interswitchng.com' : 'https://qa.interswitchng.com';
const ISW_COLLECTIONS_BASE_URL = ISW_LIVE_MODE ? 'https://webpay.interswitchng.com' : 'https://qa.interswitchng.com'; // Adjust if different for collections
// For transaction verification, depending on the endpoint you use.
// Often the same as collections or a specific transaction API.
const ISW_VERIFY_ENDPOINT = '/collections/api/v1/gettransaction.json'; // Example: adjust as per Interswitch docs

// In-memory token cache (for demonstration, use a proper DB cache in production)
let accessTokenCache = null;
let tokenExpiryTime = 0;

/**
 * Gets or refreshes Interswitch access token.
 */
const getAccessToken = async () => {
    if (accessTokenCache && Date.now() < tokenExpiryTime) {
        return accessTokenCache;
    }

    if (!ISW_CLIENT_ID || !ISW_CLIENT_SECRET) {
        logger.error('Interswitch Passport: CLIENT_ID or CLIENT_SECRET missing. Cannot get access token.', {
            context: 'InterswitchAuth', severity: 'CRITICAL_CONFIG'
        });
        throw new HttpError(500, 'Interswitch authentication credentials not configured.');
    }

    const authUrl = `${ISW_PASSPORT_BASE_URL}/passport/oauth/token`;
    const credentials = Buffer.from(`${ISW_CLIENT_ID}:${ISW_CLIENT_SECRET}`).toString('base64');

    try {
        const response = await axios.post(authUrl, 'grant_type=client_credentials', {
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        accessTokenCache = response.data.access_token;
        // Set expiry slightly before actual expiry for buffer
        tokenExpiryTime = Date.now() + (response.data.expires_in * 1000) - (60 * 1000); // 1 minute buffer
        logger.info('Interswitch Passport: Access token obtained successfully.', {
            context: 'InterswitchAuth', expiresIn: response.data.expires_in
        });
        return accessTokenCache;
    } catch (error) {
        logger.error(`Interswitch Passport: Failed to get access token: ${error.message}`, {
            context: 'InterswitchAuth',
            responseStatus: error.response?.status,
            responseData: error.response?.data,
            stack: error.stack,
            severity: 'EXTERNAL_API_ERROR'
        });
        throw new HttpError(error.response?.status || 500, 'Failed to authenticate with Interswitch.');
    }
};

/**
 * Verifies transaction status with Interswitch's API (server-side).
 * This is the definitive check before giving value.
 * @param {string} transactionReference - The unique reference for the transaction (your order ID).
 * @param {number} amount - The amount to verify (from client or webhook, in minor units).
 * @param {string} orderId - Your internal order ID (UUID).
 * @returns {Promise<object>} Verification result.
 */
const verifyTransactionStatus = async ({ transactionReference, amount, orderId }) => {
    logger.info(`Interswitch Verify: Initiating verification for transaction ${transactionReference}, Order ID: ${orderId}.`, {
        context: 'InterswitchVerify',
        transactionReference, amount, orderId
    });

    if (!transactionReference || !amount || !orderId) {
        logger.warn('Interswitch Verify: Missing required parameters for verification.', {
            context: 'InterswitchVerify', transactionReference, amount, orderId, severity: 'CLIENT_ERROR'
        });
        throw new HttpError(400, 'Missing transaction reference, amount, or order ID for verification.');
    }

    try {
        const accessToken = await getAccessToken(); // Get or refresh token
        const verifyUrl = `${ISW_COLLECTIONS_BASE_URL}${ISW_VERIFY_ENDPOINT}`;

        // Parameters for verification request
        const params = {
            merchantCode: ISW_MERCHANT_ID,
            transactionReference: transactionReference,
            amount: amount, // Use amount from your record, as webhook amount might be string/major. This must be minor units.
            // Other parameters like terminalType, terminalId might be required based on your setup.
        };

        const response = await axios.get(verifyUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                // 'User-Agent': 'axios/1.x.x', // Sometimes required
            },
            params: params, // Query parameters
        });

        // Interswitch API response structure needs careful parsing.
        // Assuming a success status field (e.g., 'status', 'responseCode', 'transactionStatus')
        const iswResponseData = response.data;
        const transactionStatus = iswResponseData.ResponseCode || iswResponseData.status; // Example: "00" for success, or "Success"
        const verifiedAmount = parseFloat(iswResponseData.Amount); // Amount in major units from Interswitch
        const verifiedTransactionRef = iswResponseData.TransactionRef; // Interswitch's ref

        // Look for exact success codes in Interswitch docs (e.g., "00" for successful)
        if (transactionStatus === '00' || transactionStatus.toLowerCase() === 'success') {
            const storedOrder = await Order.findOne({ id: orderId });
            if (!storedOrder) {
                logger.error(`Interswitch Verify: Order ${orderId} not found in DB during successful verification.`, {
                    context: 'InterswitchVerify', transactionReference, orderId, iswResponseData, severity: 'APPLICATION_ERROR'
                });
                throw new HttpError(404, 'Order not found in database for successful payment.');
            }

            // Amount validation: Interswitch verification 'amount' is usually in minor units for 'gettransaction.json'
            // but check your exact endpoint. If it's major (e.g., "300.00"), convert stored order amount to major.
            const storedAmountMinor = storedOrder.grandTotal; // Assuming stored in minor
            const verifiedAmountMinor = parseFloat(iswResponseData.Amount); // Interswitch response Amount is already minor from mobpay example.
                                                                           // If Interswitch /gettransaction.json returns Major, convert it.

            if (storedAmountMinor !== verifiedAmountMinor) {
                logger.warn(`SECURITY ALERT: Interswitch amount mismatch for order ${orderId}.`, {
                    context: 'InterswitchVerify', expected: storedAmountMinor, received: verifiedAmountMinor, transactionReference, severity: 'SECURITY_ALERT'
                });
                throw new HttpError(400, 'Amount mismatch during verification.');
            }

            if (storedOrder.paymentStatus === 'Completed') {
                logger.info(`Interswitch Verify: Order ${orderId} already completed. Ignoring duplicate verification.`, {
                    context: 'InterswitchVerify', transactionReference
                });
                return { status: 'completed', message: 'Payment already completed.' };
            }

            // Update order status if all checks pass
            storedOrder.paymentStatus = 'Completed';
            storedOrder.finalAmountPaid = verifiedAmountMinor; // Save in minor units
            storedOrder.paymentTransactionId = iswResponseData.TransactionRef || iswResponseData.RRN || iswResponseData.retrievalReferenceNumber; // Use Interswitch's unique ID
            storedOrder.status = 'Order Placed'; // Or 'Processing', based on your flow
            storedOrder.statusHistory.push({ status: 'Payment Completed', timestamp: new Date(), notes: `Verified by Interswitch API. Ref: ${verifiedTransactionRef}` });
            storedOrder.paymentGateway = 'interswitch';
            storedOrder.paymentGatewayReference = transactionReference; // Your original reference

            await storedOrder.save();
            logger.info(`Interswitch Verify: Payment successfully verified and order ${orderId} updated.`, {
                context: 'InterswitchVerify', transactionReference, orderId, iswResponseData, severity: 'INFO'
            });
            return { status: 'success', message: 'Payment verified and confirmed.', transactionRef: transactionReference };

        } else {
            logger.warn(`Interswitch Verify: Transaction not successful via API for ${orderId}. Status: ${transactionStatus}`, {
                context: 'InterswitchVerify', transactionReference, orderId, iswResponseData, severity: 'APPLICATION_ERROR'
            });
            throw new HttpError(400, `Payment not successful: ${iswResponseData.Message || 'Unknown status from Interswitch.'}`);
        }

    } catch (error) {
        logger.error(`Interswitch Verify: Error calling verification API for ${orderId}: ${error.message}`, {
            context: 'InterswitchVerify', transactionReference, orderId,
            responseStatus: error.response?.status,
            responseData: error.response?.data,
            stack: error.stack,
            severity: 'EXTERNAL_API_ERROR'
        });
        throw new HttpError(error.response?.status || 500, `Failed to verify payment with Interswitch: ${error.response?.data?.Message || error.message}`);
    }
};


module.exports = {
  getAccessToken, // Export if needed for other parts of backend or testing
  verifyTransactionStatus,
};