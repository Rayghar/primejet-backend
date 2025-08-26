// src/models/order.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const itemSchema = new mongoose.Schema({
  cylinderId: { type: String, required: [true, 'Cylinder ID is required.'] },
  productName: { type: String, required: [true, 'Product name is required.'] },
  quantity: { type: Number, required: [true, 'Item quantity is required.'], min: [1, 'Quantity must be at least 1.'] },
  unitPrice: { type: Number, required: [true, 'Unit price is required.'], min: [0, 'Unit price cannot be negative.'] }, // Price in smallest currency unit
  // subtotal: { type: Number, required: true } // Optionally store item subtotal if needed frequently
}, { _id: false }); // No separate _id for sub-documents if not needed

const statusHistorySchema = new mongoose.Schema({
  status: { type: String, required: [true, 'Status in history is required.'] },
  timestamp: { type: Date, required: true, default: Date.now },
  notes: { type: String, trim: true },
  updatedBy: { type: String }, // Optional: User ID of who made the change (customer, driver, admin)
  updaterRole: { type: String, enum: ['customer', 'driver', 'admin', 'system'] }, // Optional
}, { _id: false });

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
    items: [itemSchema],
    deliveryAddressSnapshot: { 
         fullAddress: { type: String, required: true },
         street: { type: String },
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
    
    itemsSubtotal: { type: Number, required: true, default: 0 },
    discountAmount: { type: Number, default: 0 },
    promoCodeApplied: { type: String, trim: true },
    referralCodeUsed: { type: String, trim: true, uppercase: true },
    referrerId: { type: String, ref: 'User' },
    vatAmount: { type: Number, default: 0 },
    serviceFeeAmount: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    walletAmountUsed: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true, default: 0 },
    finalAmountPaid: { type: Number, default: 0 },

    status: { 
        type: String, 
        required: true, 
        enum: [ // << MODIFIED: Added new status >>
            'Pending Payment', 
            'Order Placed', 
            'Awaiting Payment on Arrival', 
            'Awaiting Driver Arrival', // << NEW: More descriptive status
            'Processing', 
            'Driver Assigned', 
            'Out for Delivery', 
            'Reached Pickup', 
            'Gas Picked Up', 
            'Reached Dropoff', 
            'Delivered', 
            'Canceled by Customer', 
            'Canceled by Admin', 
            'Failed'
        ],
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
    paymentMethod: { 
        type: String,
        enum: ['card', 'wallet', 'stripe', 'paystack', 'payOnPickup'], // << MODIFIED: Added 'payOnPickup'
        default: 'paystack'
    },
    paymentGateway: { type: String, enum: ['stripe', 'paystack', 'wallet', null], sparse:true },
    paymentIntentId: { type: String, trim: true, index: true, sparse:true },
    paymentGatewayReference: { type: String, trim: true, index: true, sparse:true },
    paymentTransactionId: { type: String, trim: true },

    isExpressDelivery: { type: Boolean, default: false },
    deliveryLatitude: { type: Number, min: -90, max: 90 },
    deliveryLongitude: { type: Number, min: -180, max: 180 },
    estimatedDeliveryTime: { type: Date },
    actualDeliveryTime: { type: Date },
    statusHistory: [statusHistorySchema],
    adminNotes: [{ note: String, adminId: String, timestamp: {type: Date, default: Date.now}, _id: false }],
    orderDate: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

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