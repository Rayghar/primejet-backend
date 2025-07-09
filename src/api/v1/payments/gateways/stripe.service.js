// File: src/api/v1/payments/gateways/stripe.service.js
const Stripe = require('stripe');
const User = require('../../../../models/user.model');
const PaymentMethod = require('../../../../models/paymentMethod.model');
const HttpError = require('../../../../utils/HttpError');
const { logger } = require('../../../../config/logger.config');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// This helper function finds an existing Stripe Customer ID or creates a new one.
const getOrCreateCustomer = async (userId) => {
    const user = await User.findOne({ id: userId });
    if (!user) throw new HttpError(404, 'User not found.');

    if (user.gatewayCustomerId && user.gatewayCustomerId.startsWith('cus_')) {
        return user.gatewayCustomerId;
    }

    logger.info(`[STRIPE_SERVICE] No Stripe customer found for user ${userId}. Creating new one.`);
    const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { internal_user_id: user.id },
    });

    user.gatewayCustomerId = customer.id;
    await user.save();
    logger.info(`[STRIPE_SERVICE] Created Stripe Customer ${customer.id} for user ${userId}.`);
    return customer.id;
};

// This function now ensures it has the latest customer ID before creating the intent.
const createSetupIntent = async (userId) => {
    // This call ensures that if a user didn't have a Stripe ID before,
    // they will have one created and saved to the DB *before* we create the intent.
    const stripeCustomerId = await getOrCreateCustomer(userId);
    
    const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        usage: 'off_session',
    });
    return { clientSecret: setupIntent.client_secret };
};
// ===============================================================

const attachMethod = async ({ userId, paymentMethodId }) => {
    // This call ensures we are comparing against the correct, potentially newly-created customer ID.
    const stripeCustomerId = await getOrCreateCustomer(userId);

    const existingMethodInDb = await PaymentMethod.findOne({ gatewayPaymentMethodId: paymentMethodId });
    if (existingMethodInDb) {
        return existingMethodInDb;
    }
    
    try {
        const stripeMethodDetails = await stripe.paymentMethods.retrieve(paymentMethodId);
        
        if (stripeMethodDetails.customer !== stripeCustomerId) {
            throw new HttpError(403, 'Payment method does not belong to the authenticated user.');
        }

        const { card } = stripeMethodDetails;
        if (!card) throw new HttpError(400, 'The provided payment method is not a card.');

        const newMethod = new PaymentMethod({
            userId,
            gateway: 'stripe',
            gatewayCustomerId: stripeCustomerId,
            gatewayPaymentMethodId: paymentMethodId,
            brand: card.brand,
            last4: card.last4,
            expMonth: card.exp_month,
            expYear: card.exp_year,
        });

        await newMethod.save();
        return newMethod;

    } catch (error) {
        logger.error(`[STRIPE_SERVICE] Error saving payment method ${paymentMethodId}:`, error);
        throw new HttpError(500, `Could not save payment method: ${error.message}`);
    }
};

const setDefaultMethod = async (stripeCustomerId, stripePaymentMethodId) => {
    await stripe.customers.update(stripeCustomerId, {
        invoice_settings: {
            default_payment_method: stripePaymentMethodId,
        },
    });
};

const deleteMethod = async (stripePaymentMethodId) => {
    // This is idempotent. It won't fail if the method is already detached.
    await stripe.paymentMethods.detach(stripePaymentMethodId);
};

module.exports = {
  createSetupIntent,
  attachMethod,
  setDefaultMethod,
  deleteMethod,
};