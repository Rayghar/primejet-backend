// File: services/webhook.service.js
const axios = require('axios');
const dotenv = require('dotenv');
const logger = require('../utils/logger');
const orderService = require('./order.service'); // To update order status
const AppError = require('../utils/appError'); // For custom errors

dotenv.config();

const MONNIFY_BASE_URL = "https://api.monnify.com/api/v1";
const MONNIFY_API_KEY = process.env.MONNIFY_API_KEY; // Your Monnify Public Key
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY; // Your Monnify Secret Key

if (!MONNIFY_API_KEY || !MONNIFY_SECRET_KEY) {
    logger.error('MONNIFY_API_KEY or MONNIFY_SECRET_KEY environment variables are not set. Monnify API calls will fail.');
    // In a production app, you might want to stop the server or alert here.
}

// Function to get an Access Token for Monnify API calls
async function getMonnifyAuthToken() {
    logger.debug('[Webhook Service] Attempting to get Monnify auth token.');
    try {
        const authString = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`).toString('base64');
        const response = await axios.post(
            `${MONNIFY_BASE_URL}/auth/login`,
            {},
            {
                headers: {
                    'Authorization': `Basic ${authString}`,
                    'Content-Type': 'application/json',
                },
            }
        );
        if (response.data.requestSuccessful && response.data.responseBody?.accessToken) {
            const accessToken = response.data.responseBody.accessToken;
            logger.debug('[Webhook Service] Monnify auth token obtained successfully.');
            return accessToken;
        } else {
            logger.error('[Webhook Service] Monnify auth token response not successful or missing accessToken:', response.data);
            throw new AppError('Failed to get Monnify access token.', 500);
        }
    } catch (error) {
        logger.error('[Webhook Service] Failed to get Monnify auth token due to network/API error:', error.response?.data || error.message);
        throw new AppError('Failed to authenticate with Monnify for API calls', 500);
    }
}

// Function to verify transaction directly with Monnify (Server-to-Server)
async function verifyMonnifyTransaction(transactionReference) {
    logger.info(`[Webhook Service] Verifying Monnify transaction: ${transactionReference} via Monnify API.`);
    try {
        const accessToken = await getMonnifyAuthToken();
        const response = await axios.get(
            `${MONNIFY_BASE_URL}/merchant/transactions/single/${transactionReference}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );
        if (response.data.requestSuccessful) {
            logger.info(`[Webhook Service] Transaction ${transactionReference} verified successfully with Monnify API.`);
            return response.data.responseBody; // Contains comprehensive transaction details and status
        } else {
            logger.error(`[Webhook Service] Monnify API response indicates failure for transaction ${transactionReference}: ${response.data.responseMessage}`);
            throw new AppError(`Monnify API verification failed: ${response.data.responseMessage}`, 500);
        }
    } catch (error) {
        logger.error(`[Webhook Service] Failed to verify Monnify transaction ${transactionReference} due to network/API error:`, error.response?.data || error.message);
        throw new AppError('Failed to verify transaction with Monnify API', 500);
    }
}

// Main handler for Monnify payment webhooks
async function handleMonnifyPaymentWebhook({ orderId, transactionReference, amountPaid, paidOn, currency, webhookStatus }) {
    logger.info(`[Webhook Service] Processing Monnify payment webhook for order ${orderId}, Monnify reference ${transactionReference}, webhook status: ${webhookStatus}`);

    // Step 1: Verify the transaction directly with Monnify (Server-to-Server)
    // This is the authoritative source of truth.
    let verifiedTransaction;
    try {
        verifiedTransaction = await verifyMonnifyTransaction(transactionReference);
    } catch (error) {
        logger.error(`[Webhook Service] Critical: Failed to get authoritative status for transaction ${transactionReference}. Order ${orderId} NOT updated definitively.`, error);
        // Re-throw to inform the webhook route to potentially retry if this is a transient API error
        throw error;
    }

    const monnifyFinalStatus = verifiedTransaction.paymentStatus; // e.g., 'PAID', 'FAILED', 'PENDING', 'OVERPAID'
    const monnifyAmountFromApi = verifiedTransaction.amount; // Amount from Monnify API (in Naira)
    const monnifyPaidOnFromApi = verifiedTransaction.paidOn; // Timestamp from Monnify API

    // Convert Monnify amount (Naira) to Kobo for your internal system,
    // as your `order.totalAmount` is likely in Kobo.
    const monnifyAmountInKobo = monnifyAmountFromApi * 100;

    // Step 2: Determine final order status based on Monnify's authoritative response
    let newOrderStatus;
    if (monnifyFinalStatus === 'PAID' || monnifyFinalStatus === 'OVERPAID') {
        newOrderStatus = 'paid'; // Or 'processing' if further steps are needed before 'completed'
        logger.info(`[Webhook Service] Monnify transaction ${transactionReference} is definitively PAID. Updating order ${orderId} to 'paid'.`);
    } else {
        newOrderStatus = 'failed_payment'; // Set a specific status for failed/unsuccessful payments
        logger.warn(`[Webhook Service] Monnify transaction ${transactionReference} is NOT PAID. Authoritative status: ${monnifyFinalStatus}. Updating order ${orderId} to '${newOrderStatus}'.`);
    }

    // Step 3: Update your order status in the database
    try {
        await orderService.updateOrderStatus({
            orderId,
            status: newOrderStatus,
            paymentDetails: {
                method: 'Monnify', // Generic method, can be more specific if Monnify provides
                transactionId: transactionReference,
                amount: monnifyAmountInKobo, // Store verified amount in Kobo
                paidAt: new Date(monnifyPaidOnFromApi),
                monnifyStatus: monnifyFinalStatus, // Store Monnify's exact status (PAID/FAILED/etc.)
            },
            verifiedAmount: monnifyAmountInKobo, // Pass for internal amount validation in orderService
        });
        logger.info(`[Webhook Service] Order ${orderId} status updated successfully to '${newOrderStatus}'.`);
    } catch (error) {
        logger.error(`[Webhook Service] Failed to update order ${orderId} status in DB:`, error.message, error.stack);
        // Important: If DB update fails, you might have a discrepancy. Log this critically.
        // Consider alerting mechanisms here. Re-throw to inform webhook router for retries.
        throw error;
    }
}

module.exports = {
  handleMonnifyPaymentWebhook,
};