// Example: payment.validation.js (on your backend)

const crypto = require('crypto');
const axios = require('axios'); // Assuming you use axios for HTTP requests

// Your Flutterwave Secret Hash from your .env or config
const FLUTTERWAVE_SECRET_HASH = process.env.FLUTTERWAVE_SECRET_HASH;
const FLUTTERWAVE_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY; // For transaction verification

async function validateFlutterwaveWebhook(req, res, next) {
    const signature = req.headers['verif-hash'];

    if (!signature) {
        return res.status(401).json({ status: 'error', message: 'No webhook signature found' });
    }

    // Verify the webhook signature
    const hash = crypto.createHmac('sha256', FLUTTERWAVE_SECRET_HASH)
                       .update(JSON.stringify(req.body))
                       .digest('hex');

    if (hash !== signature) {
        return res.status(401).json({ status: 'error', message: 'Invalid webhook signature' });
    }

    // Webhook is valid, now process the payload
    const payload = req.body;

    if (payload.event === 'charge.completed' && payload.data) {
        const transactionId = payload.data.id; // Or payload.data.transaction_id, payload.data.flw_ref depending on event
        const transactionReference = payload.data.tx_ref; // Your internal reference

        if (!transactionId) {
            console.error('Webhook payload missing transaction ID:', payload);
            return res.status(400).json({ status: 'error', message: 'Missing transaction ID in webhook payload' });
        }

        try {
            // Verify the transaction with Flutterwave (server-to-server)
            const verificationUrl = `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`;
            const verificationResponse = await axios.get(verificationUrl, {
                headers: {
                    'Authorization': `Bearer ${FLUTTERWAVE_SECRET_KEY}`
                }
            });

            const transactionStatus = verificationResponse.data.data.status;
            const transactionAmount = verificationResponse.data.data.amount;
            const currency = verificationResponse.data.data.currency;
            const orderId = verificationResponse.data.data.meta ? verificationResponse.data.data.meta.order_id : null; // If you pass orderId in meta

            // IMPORTANT:
            // 1. Compare the transactionAmount with the expected order amount.
            // 2. Ensure the currency is correct.
            // 3. Check transactionStatus ('successful', 'failed', etc.).
            // 4. Use the orderId to update your database.
            // 5. Handle cases where the same webhook might be received multiple times (idempotency).

            if (transactionStatus === 'successful' && currency === 'NGN') {
                // Assuming you have an Order model/service
                // await OrderService.updateOrderStatus(orderId, 'completed', transactionAmount, transactionReference);
                console.log(`Payment for order ${orderId} with transaction ID ${transactionId} was successful.`);
                // Return 200 OK to Flutterwave to acknowledge receipt
                return res.status(200).send('Webhook received and processed');
            } else {
                // Payment was not successful or other conditions not met
                // await OrderService.updateOrderStatus(orderId, 'failed', transactionAmount, transactionReference);
                console.warn(`Payment for order ${orderId} with transaction ID ${transactionId} failed or has wrong status/currency.`);
                return res.status(200).send('Webhook received, but payment not successful');
            }
        } catch (error) {
            console.error('Error verifying transaction with Flutterwave:', error.response ? error.response.data : error.message);
            return res.status(500).json({ status: 'error', message: 'Internal server error during transaction verification' });
        }
    } else {
        // Handle other webhook events if necessary, or ignore
        console.log('Unhandled webhook event:', payload.event);
        return res.status(200).send('Webhook event not handled');
    }
}

module.exports = { validateFlutterwaveWebhook };