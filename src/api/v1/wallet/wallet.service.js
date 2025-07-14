// src/api/v1/wallet/wallet.service.js
const User = require('../../../models/user.model');
const WalletTransaction = require('../../../models/walletTransaction.model'); // New model
// Assuming paymentService for creating payment intents for top-ups
const paymentService = require('../payments/interswitch.service');
const HttpError = require('../../../utils/HttpError');
const { v4: uuidv4 } = require('uuid'); // For internal transaction IDs if needed before saving model
const mongoose = require('mongoose'); // Required for database sessions (transactions)
// const { logger } = require('../../../config/logger.config.js');

const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || 'NGN';

const getWallet = async (userId) => {
  try {
    const user = await User.findOne({ id: userId }).select('id name email walletBalance');
    if (!user) {
      throw new HttpError(404, 'User not found.');
    }
    // Optionally, fetch recent transactions
    const recentTransactions = await WalletTransaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10) // Get last 10 transactions
      .select('id type amount currency status createdAt description');

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      walletBalance: user.walletBalance || 0, // Ensure 0 if undefined/null
      recentTransactions: recentTransactions.map(t => t.toObject()),
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in getWallet:', error);
    throw new HttpError(500, 'Failed to retrieve wallet details.');
  }
};

const initializeTopUp = async (userId, amountInMinorUnit) => {
  // Joi validation ensures amount is positive and meets min requirements.
  const user = await User.findOne({ id: userId });
  if (!user) {
    throw new HttpError(404, 'User not found for wallet top-up.');
  }

  let pendingTransaction;
  try {
    // Create a PENDING wallet transaction record
    pendingTransaction = new WalletTransaction({
      userId,
      type: 'DEPOSIT',
      amount: amountInMinorUnit,
      currency: DEFAULT_CURRENCY,
      status: 'PENDING',
      description: `Wallet top-up initiated for ${amountInMinorUnit / 100} ${DEFAULT_CURRENCY}.`, // Assuming amount is in kobo/cents
      balanceBefore: user.walletBalance, // Record balance before attempting top-up
    });
    await pendingTransaction.save();

    // Now, create a payment intent with the payment gateway for this top-up amount.
    // We use the internal pendingTransaction.id as a reference for this payment.
    const paymentIntentResult = await paymentService.createPaymentIntentForOrder(
      pendingTransaction.id, // Using internal transaction ID as the 'orderId' for payment service
      amountInMinorUnit,
      DEFAULT_CURRENCY,
      userId
      // Potentially pass a specific paymentMethodId if user selected one
    );
    
    // Store the payment intent ID from the gateway on our pending transaction for later reference
    pendingTransaction.internalPaymentIntentId = paymentIntentResult.paymentIntentId; // e.g., pi_xxxx from Stripe
    pendingTransaction.paymentGateway = 'STRIPE'; // Or your configured gateway name
    await pendingTransaction.save();


    return {
      message: 'Top-up initialized. Please complete payment.',
      internalTransactionId: pendingTransaction.id, // For client to send back on confirmation
      clientSecret: paymentIntentResult.clientSecret, // For client-side SDK (e.g., Stripe elements)
      paymentIntentId: paymentIntentResult.paymentIntentId, // Gateway's payment intent ID
      amount: amountInMinorUnit,
      currency: DEFAULT_CURRENCY,
    };
  } catch (error) {
    // If payment intent creation fails, mark internal transaction as FAILED
    if (pendingTransaction && pendingTransaction.id) {
      try {
        await WalletTransaction.updateOne({ id: pendingTransaction.id }, { $set: { status: 'FAILED', description: `Initialization failed: ${error.message}` }});
      } catch (updateError) {
        console.error('Failed to update pending transaction to FAILED status:', updateError);
      }
    }
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in initializeTopUp:', error);
    throw new HttpError(500, `Failed to initialize wallet top-up: ${error.message}`);
  }
};

const confirmTopUp = async (userId, internalTransactionId, paymentGatewayReference) => {
  // Joi validation ensures internalTransactionId and paymentGatewayReference are provided.

  const session = await mongoose.startSession(); // For atomicity
  session.startTransaction();

  try {
    const user = await User.findOne({ id: userId }).session(session);
    if (!user) {
      throw new HttpError(404, 'User not found.');
    }

    const walletTransaction = await WalletTransaction.findOne({
      id: internalTransactionId,
      userId,
      status: 'PENDING', // Only confirm pending transactions
    }).session(session);

    if (!walletTransaction) {
      throw new HttpError(404, 'Pending top-up transaction not found or already processed.');
    }

    // **CRUCIAL STEP: Verify payment with the payment gateway**
    // This logic is highly dependent on your chosen gateway (Stripe, Paystack, etc.)
    // You would use `paymentGatewayReference` (e.g., Stripe's payment_intent_id) to query the gateway.
    // For example, with Stripe:
    // const paymentIntent = await stripe.paymentIntents.retrieve(paymentGatewayReference);
    // if (paymentIntent.status !== 'succeeded' || paymentIntent.amount !== walletTransaction.amount) {
    //   walletTransaction.status = 'FAILED';
    //   walletTransaction.description = `Payment gateway verification failed. Status: ${paymentIntent.status}`;
    //   await walletTransaction.save({ session });
    //   await session.commitTransaction();
    //   throw new HttpError(400, 'Payment verification failed with gateway.');
    // }
    // logger.info(`[WALLET_SERVICE] Payment gateway verification successful for ${paymentGatewayReference}`);
    // For this placeholder, we'll assume verification is successful if we reach here.
    console.log(`[WALLET_SERVICE_PLACEHOLDER] Assuming payment gateway verification for reference '${paymentGatewayReference}' is successful.`);


    // Update wallet balance
    const newBalance = (user.walletBalance || 0) + walletTransaction.amount;
    user.walletBalance = newBalance;
    await user.save({ session });

    // Update wallet transaction status
    walletTransaction.status = 'COMPLETED';
    walletTransaction.paymentGatewayReference = paymentGatewayReference; // Store the final gateway reference
    walletTransaction.balanceAfter = newBalance; // Record balance after successful top-up
    walletTransaction.description = `Wallet topped up successfully with ${walletTransaction.amount / 100} ${walletTransaction.currency}. Gateway Ref: ${paymentGatewayReference}.`;
    await walletTransaction.save({ session });

    await session.commitTransaction();

    return {
      message: 'Wallet top-up confirmed successfully.',
      newBalance: newBalance / 100, // Return in major unit
      currency: walletTransaction.currency,
      transactionDetails: walletTransaction.toObject(),
    };
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in confirmTopUp:', error);
    // Potentially update the transaction to FAILED here if it's still PENDING and error wasn't a HttpError
    if (internalTransactionId) {
        try {
            await WalletTransaction.updateOne({ id: internalTransactionId, status: 'PENDING' }, { $set: { status: 'FAILED', description: `Confirmation failed: ${error.message}` }});
        } catch (finalUpdateError) {
            console.error('Failed to mark transaction as FAILED during confirmTopUp error handling:', finalUpdateError);
        }
    }
    throw new HttpError(500, `Failed to confirm wallet top-up: ${error.message}`);
  } finally {
    session.endSession();
  }
};

// ### NEW SERVICE FOR ADMIN CREDIT ###
const adminCreditWallet = async (creditData) => {
  const { userId, role, amount, description } = creditData;

  if (userId) {
    // Credit a single user
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const user = await User.findOne({ id: userId }).session(session);
      if (!user) throw new HttpError(404, `User with ID ${userId} not found.`);
      
      const balanceBefore = user.walletBalance;
      const balanceAfter = balanceBefore + amount;

      const walletTx = new WalletTransaction({
        userId: user.id,
        type: 'ADMIN_CREDIT',
        amount: amount,
        status: 'COMPLETED',
        description: description,
        balanceBefore: balanceBefore,
        balanceAfter: balanceAfter,
      });
      await walletTx.save({ session });

      user.walletBalance = balanceAfter;
      await user.save({ session });

      await session.commitTransaction();
      return { message: `Successfully credited ${user.name} with ${amount / 100} ${DEFAULT_CURRENCY}.` };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } else if (role) {
    // Credit all users with a specific role
    const usersToCredit = await User.find({ role: role });
    if (usersToCredit.length === 0) {
      return { message: `No users found with the role '${role}'. No wallets were credited.`};
    }
    
    let successCount = 0;
    let errorCount = 0;

    for (const user of usersToCredit) {
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const balanceBefore = user.walletBalance;
        const balanceAfter = balanceBefore + amount;

        const walletTx = new WalletTransaction({
          userId: user.id, type: 'ADMIN_CREDIT', amount: amount, status: 'COMPLETED', description: description, balanceBefore: balanceBefore, balanceAfter: balanceAfter,
        });
        await walletTx.save({ session });

        user.walletBalance = balanceAfter;
        await user.save({ session });

        await session.commitTransaction();
        successCount++;
      } catch (error) {
        await session.abortTransaction();
        errorCount++;
        console.error(`Failed to credit user ${user.id}: ${error.message}`);
      } finally {
        session.endSession();
      }
    }
    return { message: `Wallet credit process completed for role '${role}'. Successful: ${successCount}, Failed: ${errorCount}.` };
  } else {
    // This case should be prevented by Joi validation, but as a fallback
    throw new HttpError(400, 'Invalid request. Must provide either userId or role.');
  }
};

module.exports = {
  getWallet,
  initializeTopUp,
  confirmTopUp,
  adminCreditWallet, // Export the new service
};
