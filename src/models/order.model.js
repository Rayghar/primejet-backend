// File: src/models/order.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const itemSchema = new mongoose.Schema({
  cylinderId: { type: String, required: true },
  productName: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
}, { _id: false });

const statusHistorySchema = new mongoose.Schema({
  status: { type: String, required: true },
  timestamp: { type: Date, required: true, default: Date.now },
  notes: { type: String, trim: true },
  updatedBy: { type: String },
  updaterRole: { type: String, enum: ['customer', 'driver', 'admin', 'system'] },
}, { _id: false });

const orderSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    customerId: { type: String, required: true, ref: 'User', index: true },
    driverId: { type: String, ref: 'User', index: true, sparse: true },
    items: [itemSchema],
    deliveryAddressSnapshot: {
         fullAddress: { type: String, required: true },
         street: { type: String },
         city: { type: String },
         state: { type: String },
         country: { type: String },
    },
    recipientName: { type: String, required: true },
    recipientPhone: { type: String, required: true },
    
    itemsSubtotal: { type: Number, required: true, default: 0 },
    discountAmount: { type: Number, default: 0 },
    promoCodeApplied: { type: String, trim: true },
    vatAmount: { type: Number, default: 0 },
    serviceFeeAmount: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    walletAmountUsed: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true, default: 0 },
    finalAmountPaid: { type: Number, default: 0 },

    // ADDED: Currency field for better record keeping on transactions.
    currency: { type: String, default: 'NGN' },

    status: { 
        type: String, 
        required: true, 
        enum: ['Pending Payment', 'Order Placed', 'Processing', 'Driver Assigned', 'Out for Delivery', 'Delivered', 'Canceled by Customer', 'Canceled by Admin', 'Failed'],
        default: 'Pending Payment',
        index: true 
    },
    paymentStatus: {
      type: String,
      required: true,
      enum: ['Pending', 'Completed', 'Failed', 'Refunded'],
      default: 'Pending',
      index: true,
    },
    paymentGateway: { type: String, enum: ['flutterwave', 'wallet', null], sparse:true },
    paymentTransactionId: { type: String, trim: true },

    isExpressDelivery: { type: Boolean, default: false },
    orderDate: { type: Date, required: true, default: Date.now, index: true },
    statusHistory: [statusHistorySchema],
  },
  { timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

orderSchema.virtual('customer', { /* ... */ });
orderSchema.virtual('driver', { /* ... */ });

module.exports = mongoose.model('Order', orderSchema);