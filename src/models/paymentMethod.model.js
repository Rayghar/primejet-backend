// File: src/models/paymentMethod.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const paymentMethodSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    userId: { type: String, required: true, ref: 'User', index: true },
    // The 'gateway' field is removed.
    gatewayCustomerId: { type: String, required: true, index: true }, // Monnify Customer Identifier (e.g., email)
    gatewayPaymentMethodId: { type: String, required: true, unique: true, index: true }, // Monnify Card Token
    brand: String,
    last4: String,
    expMonth: Number,
    expYear: Number,
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const PaymentMethod = mongoose.model('PaymentMethod', paymentMethodSchema);
module.exports = PaymentMethod;