// File: src/models/order.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const postingSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['UNPOSTED', 'QUEUED', 'POSTED', 'FAILED', 'SKIPPED', 'REVERSED'],
      default: 'UNPOSTED',
      index: true,
    },
    glEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'GeneralLedgerEntry', default: null },
    glEntryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GeneralLedgerEntry' }],
    postedAt: { type: Date, default: null },
    postedBy: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
    version: { type: Number, default: 1 },
  },
  { _id: false }
);

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
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: [true, 'Status in history is required.'] },
    timestamp: { type: Date, required: true, default: Date.now },
    notes: { type: String, trim: true },
    updatedBy: { type: String },
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
    runId: { type: String, ref: 'Run', index: true, sparse: true },

    // =================================================================
    // SAFE: Type Field with Default
    // =================================================================
    type: {
      type: String,
      enum: ['GAS', 'DELIVERY', 'POWER'],
      default: 'GAS',
      required: true,
      index: true,
    },

    /**
     * ✅ GL-FIRST: branch dimension (optional; non-breaking)
     * These fields allow your posting service to resolve a branchKey.
     * Your system may store branch as ObjectId in some collections, string in others.
     */
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', index: true, required: false },
    serviceZoneId: { type: String, index: true, required: false },
    zoneId: { type: String, index: true, required: false },
    plantId: { type: String, index: true, required: false },

    /**
     * ✅ GL-FIRST: optional channel marker
     * - Do NOT make required (migration-safe)
     * - Posting logic can treat missing as DELIVERY (legacy)
     */
    channel: {
      type: String,
      enum: ['DELIVERY', 'POS', 'POWER', 'OTHER'],
      required: false,
      default: undefined,
      index: true,
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
        'Vending Failed',
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
      enum: ['card', 'wallet', 'stripe', 'paystack', 'payOnPickup'],
      default: 'paystack',
    },

    paymentGateway: { type: String, enum: ['stripe', 'paystack', 'wallet', null], sparse: true },
    paymentIntentId: { type: String, trim: true, index: true, sparse: true },
    paymentGatewayReference: { type: String, trim: true, index: true, sparse: true },
    paymentTransactionId: { type: String, trim: true },

    deliveryLatitude: { type: Number, min: -90, max: 90 },
    deliveryLongitude: { type: Number, min: -180, max: 180 },

    estimatedDeliveryTime: { type: Date },
    actualDeliveryTime: { type: Date },

    placedAt: { type: Date },
    paymentVerificationStartedAt: { type: Date },
    paymentVerifiedAt: { type: Date },
    driverAssignedAt: { type: Date },
    pickedAt: { type: Date },
    outForDeliveryAt: { type: Date },
    firstAttemptAt: { type: Date },
    deliveredAt: { type: Date },
    canceledAt: { type: Date },

    paymentVerificationDelayed: { type: Boolean, default: false, index: true },
    paymentLastCheckAt: { type: Date },

    metadata: {
      type: Map,
      of: String,
      default: {},
    },

    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
    adminNotes: [adminNoteSchema],

    /**
     * ✅ GL-FIRST business date
     * Posting uses orderDate first, fallback createdAt if missing.
     */
    orderDate: { type: Date, required: true, default: Date.now, index: true },

    /**
     * ✅ GL-FIRST posting metadata (non-breaking)
     */
    posting: { type: postingSchema, default: () => ({}) },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* -------------------- Virtual Populations -------------------- */
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

/* -------------------- UI/DTO-friendly Virtuals -------------------- */
orderSchema.virtual('shortId').get(function () {
  const s = this.id || '';
  return s.length > 6 ? s.slice(-6) : s;
});

orderSchema.virtual('displayAddress').get(function () {
  const snap = this.deliveryAddressSnapshot || {};
  if (snap.fullAddress) return snap.fullAddress;
  const parts = [snap.street, snap.city, snap.state, snap.country].filter(Boolean);
  return parts.join(', ');
});

orderSchema.virtual('addressSnippet').get(function () {
  const d = this.displayAddress || '';
  return d.length > 90 ? `${d.slice(0, 87)}…` : d;
});

orderSchema.virtual('deliveryLocation').get(function () {
  const snap = this.deliveryAddressSnapshot || {};
  const lat = snap.latitude ?? this.deliveryLatitude;
  const lng = snap.longitude ?? this.deliveryLongitude;
  if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
  return null;
});

/* -------------------- Indexes -------------------- */
orderSchema.index({ status: 1, orderDate: -1 });
orderSchema.index({ driverId: 1, status: 1, orderDate: -1 }, { sparse: true });
orderSchema.index({ customerId: 1, orderDate: -1 });
orderSchema.index({ branchId: 1, orderDate: -1, status: 1 });
orderSchema.index({ serviceZoneId: 1, orderDate: -1, status: 1 });

// Helpful for posting queue views
orderSchema.index({ 'posting.status': 1, orderDate: -1 });

/* -------------------- Minimal pre-save hook -------------------- */
orderSchema.pre('save', function (next) {
  try {
    if (this.isNew) {
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