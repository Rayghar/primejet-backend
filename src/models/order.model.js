// src/models/order.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Define the new orderItemSchema
const orderItemSchema = new mongoose.Schema({
    productId: { type: String, required: true, ref: 'Product' }, // Changed to String to match frontend model's 'id'
    productName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true }, // Price per unit in kobo
}, { _id: false }); // Do not create a separate _id for subdocument

// Define the new paymentDetailsSchema
const paymentDetailsSchema = new mongoose.Schema({
    method: { type: String, required: true }, // e.g., 'Monnify Card', 'Monnify Transfer', 'Flutterwave Card'
    transactionId: { type: String, required: true }, // Removed unique: true here to avoid duplicate index warning
    amount: { type: Number, required: true }, // Amount in kobo as verified by Monnify/Flutterwave API
    paidAt: { type: Date, required: true },
    monnifyStatus: { type: String }, // Store Monnify's exact paymentStatus (e.g., 'PAID', 'FAILED', 'PENDING')
    // Could add flutterwaveStatus here too if needed, or generalize 'gatewaySpecificStatus'
}, { _id: false }); // Do not create a separate _id for subdocument

// Existing statusHistorySchema (kept as is)
const statusHistorySchema = new mongoose.Schema({
  status: { type: String, required: [true, 'Status in history is required.'] },
  timestamp: { type: Date, required: true, default: Date.now },
  notes: { type: String, trim: true },
  updatedBy: { type: String }, // Optional: User ID of who made the change (customer, driver, admin)
  updaterRole: { type: String, enum: ['customer', 'driver', 'admin', 'system'] }, // Optional
}, { _id: false });

// Existing adminNoteSchema (kept as is)
const adminNoteSchema = new mongoose.Schema({
  note: { type: String, required: [true, 'Admin note content is required.'], trim: true },
  adminId: { type: String, required: [true, 'Admin ID is required.'] /* ref: 'User' // if 'id' is User's primary key */ },
  timestamp: { type: Date, required: true, default: Date.now },
}, { _id: false });

const orderSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    customerId: { type: String, required: true, ref: 'User', index: true },
    driverId: { type: String, ref: 'User', index: true, sparse: true },
    items: [orderItemSchema], // Use the new orderItemSchema
    deliveryAddressSnapshot: { /* ... your existing address snapshot schema ... */
         fullAddress: { type: String, required: true }, // Full address as a string
         street: { type: String }, // Add other fields as needed
         city: { type: String },
         state: { type: String },
         country: { type: String },
         postalCode: { type: String },
         latitude: { type: Number },
         longitude: { type: Number },
         deliveryInstructions: { type: String },
    },
    recipientName: { type: String, required: true },
    recipientPhone: { type: String, required: true },

    itemsSubtotal: { type: Number, required: true, default: 0 }, // Smallest currency unit
    discountAmount: { type: Number, default: 0 },
    promoCodeApplied: { type: String, trim: true },
    referralCodeUsed: { type: String, trim: true, uppercase: true },
    referrerId: { type: String, ref: 'User' },
    vatAmount: { type: Number, default: 0 },
    serviceFeeAmount: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    walletAmountUsed: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true, default: 0 }, // Smallest currency unit, total before any external payment
    finalAmountPaid: { type: Number, default: 0 }, // Actual amount paid via gateway

    status: {
        type: String,
        required: true,
        enum: ['Pending Payment', 'Order Placed', 'Processing', 'Driver Assigned', 'Out for Delivery', 'Reached Pickup', 'Gas Picked Up', 'Reached Dropoff', 'Delivered', 'Canceled by Customer', 'Canceled by Admin', 'Failed', 'Payment Discrepancy'], // Added 'Payment Discrepancy'
        default: 'Pending Payment',
        index: true
    },
    paymentStatus: {
      type: String,
      required: [true, 'Payment status is required.'],
      enum: ['Pending', 'Processing (Gateway)', 'Completed', 'Failed', 'Refunded', 'Partially Refunded'],
      default: 'Pending',
      index: true,
    },
    // Removed paymentMethod, paymentGateway, paymentIntentId, paymentGatewayReference, paymentTransactionId
    // These are now encapsulated within paymentDetails
    paymentDetails: { type: paymentDetailsSchema, required: false }, // Optional, will be set upon successful webhook verification

    isExpressDelivery: { type: Boolean, default: false },
    deliveryLatitude: { type: Number, min: -90, max: 90 },
    deliveryLongitude: { type: Number, min: -180, max: 180 },
    estimatedDeliveryTime: { type: Date },
    actualDeliveryTime: { type: Date },
    statusHistory: [statusHistorySchema], // Ensure statusHistorySchema is defined
    adminNotes: [adminNoteSchema], // Changed to use adminNoteSchema subdocument
    orderDate: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Add an index for faster lookup by Monnify's transactionReference, ensuring uniqueness
// This index is now on 'paymentDetails.transactionId'
orderSchema.index({ 'paymentDetails.transactionId': 1 }, { unique: true, sparse: true }); // sparse for optional field

// --- FIX START: Define Virtual Properties for Population ---

// Virtual for the customer
orderSchema.virtual('customer', {
  ref: 'User',             // The model to use
  localField: 'customerId',  // Find in this schema where localField
  foreignField: 'id',        // is equal to foreignField in the 'User' model
  justOne: true              // We only expect one User
});

// Virtual for the driver
orderSchema.virtual('driver', {
  ref: 'User',
  localField: 'driverId',
  foreignField: 'id',
  justOne: true
});

// --- FIX END ---

module.exports = mongoose.model('Order', orderSchema);
