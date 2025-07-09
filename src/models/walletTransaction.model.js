// src/models/walletTransaction.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const walletTransactionSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: [true, 'Wallet transaction ID is required.'],
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    userId: {
      type: String, // Assuming this refers to the custom 'id' field in your User model
      required: [true, 'User ID for the transaction is required.'],
      ref: 'User',
      index: true,
    },
    type: {
      type: String,
      required: [true, 'Transaction type is required.'],
      enum: [
        'DEPOSIT',          // Money added to wallet (e.g., top-up)
        'ORDER_PAYMENT',    // Money spent from wallet for an order
        'REFUND_TO_WALLET', // Order refund credited to wallet
        'WITHDRAWAL',       // Money taken out of wallet (if you implement payouts from wallet)
        'REFERRAL_BONUS',   // Bonus credited from referral system
        'ADMIN_CREDIT',     // Manual credit by admin
        'ADMIN_DEBIT',      // Manual debit by admin
        'FEE',              // Service fee deducted from wallet (if applicable)
      ],
      index: true,
    },
    amount: { // Amount of the transaction in the smallest currency unit (e.g., kobo, cents)
              // This is always a positive value; 'type' determines if it's a credit or debit to the balance.
      type: Number,
      required: [true, 'Transaction amount is required.'],
      min: [1, 'Transaction amount must be at least 1 smallest currency unit.'], // Smallest possible transaction
    },
    currency: {
      type: String,
      required: [true, 'Currency code is required.'],
      default: 'NGN', // Set your application's default currency
      uppercase: true,
      trim: true,
    },
    status: {
      type: String,
      required: [true, 'Transaction status is required.'],
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERSED'],
      default: 'PENDING',
      index: true,
    },
    description: { // User-friendly description or reason for the transaction
      type: String,
      trim: true,
      maxlength: [255, 'Description cannot exceed 255 characters.'],
    },
    balanceBefore: { // User's wallet balance before this transaction was applied
      type: Number,
      required: [true, 'Balance before transaction is required for auditing.'],
    },
    balanceAfter: { // User's wallet balance after this transaction was successfully applied
      type: Number,
      // Required only if status is 'COMPLETED'
      required: function() { return this.status === 'COMPLETED'; },
    },
    // --- References to other entities ---
    orderId: { // If this transaction is related to a specific order
      type: String, // Assuming this refers to the custom 'id' field in your Order model
      ref: 'Order',
      optional: true,
      index: true,
      sparse: true,
    },
    paymentGateway: { // Name of the payment gateway used, if applicable (e.g., 'STRIPE', 'PAYSTACK')
      type: String,
      trim: true,
      optional: true,
    },
    gatewayTransactionId: { // ID from the payment gateway for this transaction (e.g., Stripe charge ID or Paystack ref)
      type: String,
      trim: true,
      index: true,
      sparse: true, // Not all transactions will have a gateway ID (e.g., internal adjustments)
    },
    internalPaymentIntentId: { // If your payment service creates an intent ID for gateway operations
      type: String,
      trim: true,
      index: true,
      sparse: true,
    },
    relatedTransactionId: { // For linking transactions, e.g., a refund to its original payment
        type: String,
        ref: 'WalletTransaction',
        optional: true,
        sparse: true,
    },
    metadata: { // For any additional, flexible data associated with the transaction
      type: mongoose.Schema.Types.Mixed,
    }
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Compound index for user and status/type for common queries
walletTransactionSchema.index({ userId: 1, status: 1 });
walletTransactionSchema.index({ userId: 1, type: 1 });

const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);

module.exports = WalletTransaction;