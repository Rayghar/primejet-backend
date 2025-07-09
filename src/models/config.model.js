// File: src/models/config.model.js
const mongoose = require('mongoose');

// --- Define constants BEFORE they are used in the schema ---
const DEFAULT_PROGRAM_DESCRIPTION = "Share your code with friends! They get a discount, and you get rewards.";
const DEFAULT_BENEFIT_SELF = "Get N500 off your next order for every successful referral.";
const DEFAULT_BENEFIT_FRIEND = "Get 10% off their first order.";
// --- End Constants ---

const cylinderSettingSchema = new mongoose.Schema({
  id: {
    type: String,
    required: [true, 'Cylinder setting ID is required.'],
    trim: true,
  },
  name: {
    type: String,
    required: [true, 'Cylinder name is required.'],
    trim: true,
  },
  price: {
    type: Number,
    required: [true, 'Cylinder price is required.'],
    min: [0, 'Price cannot be negative.'],
  },
  // Add isActive and weightKg from Flutter model if they aren't already here implicitly
  weightKg: {
    type: Number,
    min: [0, 'Weight cannot be negative.'],
    optional: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, { _id: false }); // Changed to false as 'id' is explicitly defined.

const feeSettingsSchema = new mongoose.Schema({
  vatPercentage: {
    type: Number,
    required: [true, 'VAT percentage is required.'],
    min: [0, 'VAT percentage cannot be less than 0.'],
    max: [100, 'VAT percentage cannot exceed 100.'],
  },
  serviceFeePercentage: {
    type: Number,
    required: [true, 'Service fee percentage is required.'],
    min: [0, 'Service fee percentage cannot be less than 0.'],
    max: [100, 'Service fee percentage cannot exceed 100.'],
  },
  baseDeliveryFee: {
    type: Number,
    required: [true, 'Base delivery fee is required.'],
    min: [0, 'Base delivery fee cannot be less than 0.'],
  },
  expressDeliverySurcharge: {
    type: Number,
    required: [true, 'Express delivery surcharge is required.'],
    min: [0, 'Express delivery surcharge cannot be less than 0.'],
  },
}, { _id: false });

// --- NEW SCHEMA: Routing Settings ---
const routingSettingsSchema = new mongoose.Schema({
  maxPickupWindowMinutes: {
    type: Number,
    min: [0, 'Max pickup window cannot be negative.'],
    required: [true, 'Max pickup window minutes is required.'],
  },
  maxBatchWeightKg: {
    type: Number,
    min: [0, 'Max batch weight cannot be negative.'],
    required: [true, 'Max batch weight in KG is required.'],
  },
}, { _id: false });

// <<< START MODIFICATION >>>
const referralProgramSchema = new mongoose.Schema({
    isActive: { type: Boolean, default: false },
    programDescription: { type: String, default: DEFAULT_PROGRAM_DESCRIPTION },
    benefitSelf: { type: String, default: DEFAULT_BENEFIT_SELF },
    benefitFriend: { type: String, default: DEFAULT_BENEFIT_FRIEND },
    // New configurable fields
    rewardAmountKobo: { type: Number, default: 50000, min: 0 }, // e.g., 50000 kobo for N500
    minRefereePurchaseAmountKobo: { type: Number, default: 0, min: 0 }, // Referee's first purchase minimum
    referrerMinSuccessfulReferrals: { type: Number, default: 1, min: 1 }, // e.g., referrer needs 1 successful referral to start earning
}, { _id: false });
// <<< END MODIFICATION >>>


const configSchema = new mongoose.Schema(
  {
    systemName: {
      type: String,
      default: 'PrimeJet Gas Delivery Configuration',
    },
    cylinderSettings: {
      type: [cylinderSettingSchema],
      default: [],
    },
    feeSettings: {
      type: feeSettingsSchema,
      required: true,
    },
    routingSettings: { // <<< ADDED: Corresponding to Flutter model
      type: routingSettingsSchema,
      required: true, // Assuming this is a required part of config
    },
    referralProgram: { // Existing in your provided file
        isActive: { type: Boolean, default: false },
        programDescription: { type: String, default: DEFAULT_PROGRAM_DESCRIPTION },
        benefitSelf: { type: String, default: DEFAULT_BENEFIT_SELF },
        benefitFriend: { type: String, default: DEFAULT_BENEFIT_FRIEND },
        // <<< START MODIFICATION: Add new configurable fields >>>
        rewardAmountKobo: { type: Number, default: 50000, min: 0 }, // E.g., 50000 kobo for N500
        minRefereePurchaseAmountKobo: { type: Number, default: 0, min: 0 }, // Referee's first purchase minimum
        referrerMinSuccessfulReferrals: { type: Number, default: 1, min: 1 }, // E.g., referrer needs 1 successful referral
        // <<< END MODIFICATION >>>
    },
  },
  {
    timestamps: true,
  }
);

const Config = mongoose.model('Config', configSchema);

module.exports = Config;