// src/models/walletTransaction.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const walletTransactionSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => uuidv4(), // Generate UUID on creation
      unique: true,
      required: true,
    },
    userId: {
      type: String, // References the User's custom 'id' field
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['DEPOSIT', 'ORDER_PAYMENT', 'REFUND', 'WITHDRAWAL', 'ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT'],
      required: true,
    },
    amount: { // Amount of the transaction in the smallest currency unit (e.g., kobo, cents)
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      required: true,
      default: 'NGN', // Or your system's default currency
    },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERSED'],
      required: true,
      default: 'PENDING',
    },
    description: {
      type: String,
      trim: true,
      maxlength: 255,
    },
    paymentGateway: { // e.g., 'STRIPE', 'PAYSTACK', 'FLUTTERWAVE', 'SYSTEM'
      type: String,
      trim: true,
    },
    gatewayTransactionId: { // ID from the payment gateway for the specific transaction (if applicable)
      type: String,
      trim: true,
      index: true, // If you often query by this
    },
    internalPaymentIntentId: { // If your system generates an intent ID for the payment gateway
      type: String,
      trim: true,
    },
    orderId: { // If the transaction is related to an order
      type: String, // References Order's custom 'id' field
      ref: 'Order',
      index: true,
      optional: true,
    },
    metadata: { // For any other relevant information
      type: mongoose.Schema.Types.Mixed,
    },
    balanceBefore: { // User's wallet balance before this transaction (for auditing)
      type: Number,
      // required: true, // Consider if this is strictly required or can be added post-operation
    },
    balanceAfter: { // User's wallet balance after this transaction (for auditing)
      type: Number,
      // required: true, // Consider if this is strictly required or can be added post-operation
    }
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Ensure compound index if you often query by userId and status or type
walletTransactionSchema.index({ userId: 1, status: 1 });
walletTransactionSchema.index({ userId: 1, type: 1 });

const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);

module.exports = WalletTransaction;