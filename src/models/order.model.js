// File: src/models/order.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const itemSchema = new mongoose.Schema(
  {
    cylinderId: { type: String, required: [true, 'Cylinder ID is required.'] },
    productName: { type: String, required: [true, 'Product name is required.'] },
    quantity: {
      type: Number,
      required: [true, 'Item quantity is required.'],
      min: [1, 'Quantity must be at least 1.'],
    },
    unitPrice: {
      type: Number,
      required: [true, 'Unit price is required.'],
      min: [0, 'Unit price cannot be negative.'],
    },
    // Optionally store subtotal if you frequently need it
    // subtotal: { type: Number, required: true }
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: [true, 'Status in history is required.'] },
    timestamp: { type: Date, required: true, default: Date.now },
    notes: { type: String, trim: true },
    updatedBy: { type: String }, // User ID (customer/driver/admin/system)
    updaterRole: { type: String, enum: ['customer', 'driver', 'admin', 'system'] },
  },
  { _id: false }
);

const adminNoteSchema = new mongoose.Schema(
  {
    note: { type: String, required: [true, 'Admin note content is required.'], trim: true },
    adminId: { type: String, required: [true, 'Admin ID is required.'] },
    timestamp: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },

    customerId: { type: String, required: true, ref: 'User', index: true },
    driverId: { type: String, ref: 'User', index: true, sparse: true },

    // =================================================================
    // 🛡️ SAFE UPDATE: Type Field with Default
    // Why this is safe: Mongoose applies 'GAS' to any doc missing this field
    // BEFORE validation runs. Old orders automatically become 'GAS'.
    // =================================================================
    type: {
      type: String,
      enum: ['GAS', 'DELIVERY', 'POWER'],
      default: 'GAS', 
      required: true,
      index: true 
    },

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
      enum: [
        // Kept your existing values; these align with admin flows
        'Pending Payment',
        'Awaiting Driver Arrival',
        'Verifying Payment',
        'Order Placed',
        'Driver Assigned',
        'Processing',
        'Out for Delivery',
        'Delivered',
        'Canceled',
        'Customer Unavailable',
        'Failed',
        // --- NEW STATUS ADDED: Safe to append to Enum ---
        'Vending Failed', 
        // (optional) you can add 'Payment Verification Delayed' later in services without changing UI flows
      ],
      default: 'Pending Payment',
      index: true,
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
      enum: ['card', 'wallet', 'stripe', 'paystack', 'payOnPickup'], // includes payOnPickup
      default: 'paystack',
    },

    paymentGateway: { type: String, enum: ['stripe', 'paystack', 'wallet', null], sparse: true },
    paymentIntentId: { type: String, trim: true, index: true, sparse: true },
    paymentGatewayReference: { type: String, trim: true, index: true, sparse: true },
    paymentTransactionId: { type: String, trim: true },

    // Map-friendly fields (redundant but useful for fast geo queries if needed)
    deliveryLatitude: { type: Number, min: -90, max: 90 },
    deliveryLongitude: { type: Number, min: -180, max: 180 },

    // ETA and actual times
    estimatedDeliveryTime: { type: Date },
    actualDeliveryTime: { type: Date },

    // --- Enhancement-friendly (optional) operational timestamps ---
    // These are non-breaking and allow SLA/metrics without changing existing flows
    placedAt: { type: Date }, // when customer pressed "place order" successfully
    paymentVerificationStartedAt: { type: Date },
    paymentVerifiedAt: { type: Date },
    driverAssignedAt: { type: Date },
    pickedAt: { type: Date }, // when driver picks up stock/starts route
    outForDeliveryAt: { type: Date },
    firstAttemptAt: { type: Date },
    deliveredAt: { type: Date },
    canceledAt: { type: Date },

    // Soft signal for monitoring delayed verification (service will set/unset)
    paymentVerificationDelayed: { type: Boolean, default: false, index: true },
    paymentLastCheckAt: { type: Date },

    // =================================================================
    // 🛡️ SAFE UPDATE: Metadata
    // Using a Map is safe because if empty/undefined, it defaults to {}
    // It does not enforce schema structure, preventing validation errors
    // =================================================================
    metadata: {
      type: Map,
      of: String,
      default: {}
    },

    // History & notes
    statusHistory: {
      type: [statusHistorySchema],
      default: [], // keep your new default
    },
    adminNotes: [adminNoteSchema],

    orderDate: { type: Date, required: true, default: Date.now, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* -------------------- Virtual Populations (customer/driver) -------------------- */
// The User model’s primary key is 'id' (UUID) — match on foreignField 'id'
orderSchema.virtual('customer', {
  ref: 'User',
  localField: 'customerId',
  foreignField: 'id',
  justOne: true,
});

orderSchema.virtual('driver', {
  ref: 'User',
  localField: 'driverId',
  foreignField: 'id',
  justOne: true,
});

/* -------------------- UI/DTO-friendly Virtuals (safe, read-only) -------------------- */
// Short ID for display in admin/cards
orderSchema.virtual('shortId').get(function () {
  const s = this.id || '';
  return s.length > 6 ? s.slice(-6) : s;
});

// Prefer snapshot.fullAddress; fallback to concatenated bits
orderSchema.virtual('displayAddress').get(function () {
  const snap = this.deliveryAddressSnapshot || {};
  if (snap.fullAddress) return snap.fullAddress;
  const parts = [snap.street, snap.city, snap.state, snap.country].filter(Boolean);
  return parts.join(', ');
});

// Single-line snippet (used in lists)
orderSchema.virtual('addressSnippet').get(function () {
  const d = this.displayAddress || '';
  return d.length > 90 ? `${d.slice(0, 87)}…` : d;
});

// Compact location object for frontends that expect { lat, lng }
orderSchema.virtual('deliveryLocation').get(function () {
  const snap = this.deliveryAddressSnapshot || {};
  const lat = snap.latitude ?? this.deliveryLatitude;
  const lng = snap.longitude ?? this.deliveryLongitude;
  if (typeof lat === 'number' && typeof lng === 'number') {
    return { lat, lng };
  }
  return null;
});

/* -------------------- Indexes (non-breaking, help dashboards/reports) -------------------- */
orderSchema.index({ status: 1, orderDate: -1 });
orderSchema.index({ driverId: 1, status: 1, orderDate: -1 }, { sparse: true });
orderSchema.index({ customerId: 1, orderDate: -1 });

/* -------------------- Minimal pre-save: append status to history when it changes -------------------- */
// This hook appends to statusHistory only when 'status' changes.
// It will NOT override services that explicitly push history entries.
orderSchema.pre('save', function (next) {
  try {
    if (this.isNew) {
      // If no history provided, seed with initial status
      if (!Array.isArray(this.statusHistory) || this.statusHistory.length === 0) {
        this.statusHistory = [
          {
            status: this.status,
            timestamp: this.createdAt || new Date(),
            updatedBy: this.customerId || undefined,
            updaterRole: 'system',
          },
        ];
      }
      // seed placedAt for fresh orders if missing
      if (!this.placedAt) this.placedAt = this.createdAt || new Date();
      return next();
    }

    if (this.isModified('status')) {
      this.statusHistory = this.statusHistory || [];
      this.statusHistory.push({
        status: this.status,
        timestamp: new Date(),
        updaterRole: 'system',
      });

      // convenience time stamps for metrics (optional; services can set more precisely)
      switch (this.status) {
        case 'Verifying Payment':
          if (!this.paymentVerificationStartedAt) this.paymentVerificationStartedAt = new Date();
          break;
        case 'Driver Assigned':
          if (!this.driverAssignedAt) this.driverAssignedAt = new Date();
          break;
        case 'Out for Delivery':
          if (!this.outForDeliveryAt) this.outForDeliveryAt = new Date();
          break;
        case 'Delivered':
          if (!this.deliveredAt) this.deliveredAt = new Date();
          if (!this.actualDeliveryTime) this.actualDeliveryTime = this.deliveredAt;
          break;
        case 'Canceled':
          if (!this.canceledAt) this.canceledAt = new Date();
          break;
        default:
          break;
      }
    }

    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('Order', orderSchema);