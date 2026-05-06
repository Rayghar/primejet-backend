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

// Wave 22C: WhatsApp Cloud API/admin configuration.
// Secrets are stored here for runtime use but must be masked by the API before sending to the frontend.
const whatsappTeamRoutingSchema = new mongoose.Schema({
  GENERAL_MENU: { type: String, default: 'BOT' },
  ORDER_STATUS: { type: String, default: 'BOT' },
  NEW_ORDER: { type: String, default: 'SALES' },
  ORDER_DRAFT: { type: String, default: 'SALES' },
  ORDER_DRAFT_CONFIRMED: { type: String, default: 'SALES' },
  PAYMENT_HELP: { type: String, default: 'FINANCE' },
  COMPLAINT: { type: String, default: 'SUPPORT' },
  SPEAK_TO_AGENT: { type: String, default: 'SUPPORT' },
  UNKNOWN: { type: String, default: 'SUPPORT' },
}, { _id: false });

const whatsappTemplateSchema = new mongoose.Schema({
  orderConfirmation: { type: String, default: '' },
  paymentReminder: { type: String, default: '' },
  deliveryUpdate: { type: String, default: '' },
  complaintAcknowledgement: { type: String, default: '' },
  languageCode: { type: String, default: 'en' },
}, { _id: false });

const whatsappSettingsSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  mode: { type: String, enum: ['DISABLED', 'DRY_RUN', 'LIVE'], default: 'DRY_RUN' },
  graphVersion: { type: String, default: 'v20.0' },
  businessAccountId: { type: String, default: '' },
  phoneNumberId: { type: String, default: '' },
  displayPhoneNumber: { type: String, default: '' },
  webhookVerifyToken: { type: String, default: '' },
  webhookCallbackUrl: { type: String, default: '' },
  accessToken: { type: String, default: '' },
  appSecret: { type: String, default: '' },
  defaultCountryCode: { type: String, default: '234' },
  signatureValidationRequired: { type: Boolean, default: false },

  welcomeMessage: { type: String, default: 'Welcome to PrimeJet Gas 👋' },
  mainMenuText: {
    type: String,
    default: 'Welcome to PrimeJet Gas 👋\n\nReply with a number:\n1. Check my order status\n2. Start a new gas order / refill request\n3. Payment or wallet help\n4. Report a complaint\n5. Speak to support\n\nYou can also type: menu, status, order, refill, complaint, support.',
  },
  fallbackMessage: {
    type: String,
    default: 'Thank you. I did not fully understand that yet. Reply 1 for order status, 2 for refill, 3 for payment help, 4 for complaint, or 5 for support.',
  },
  businessHoursMessage: { type: String, default: '' },
  afterHoursMessage: { type: String, default: 'We are currently outside business hours. Your request has been received and our team will follow up.' },
  orderStatusKeywords: { type: [String], default: ['1', 'status', 'order status', 'track', 'track order'] },
  refillKeywords: { type: [String], default: ['2', 'order', 'new order', 'refill', 'gas', 'buy gas', 'reorder'] },
  paymentKeywords: { type: [String], default: ['3', 'payment', 'wallet', 'pay', 'refund'] },
  complaintKeywords: { type: [String], default: ['4', 'complaint', 'issue', 'problem', 'report'] },
  supportKeywords: { type: [String], default: ['5', 'support', 'agent', 'human', 'representative'] },

  requireAdminReview: { type: Boolean, default: true },
  autoCreateCustomer: { type: Boolean, default: true },
  defaultPaymentMethod: { type: String, default: 'TRANSFER' },
  defaultCity: { type: String, default: 'Lagos' },
  defaultState: { type: String, default: 'Lagos' },
  allowedCylinderSizes: { type: [Number], default: [3, 5, 6, 12.5, 25, 50] },
  minimumOrderFields: { type: [String], default: ['cylinderSizeKg', 'quantity', 'addressText', 'customerPhone', 'paymentPreference'] },
  teamRouting: { type: whatsappTeamRoutingSchema, default: () => ({}) },
  templates: { type: whatsappTemplateSchema, default: () => ({}) },

  lastHealthCheckAt: { type: Date },
  lastWebhookReceivedAt: { type: Date },
  lastInboundPhone: { type: String, default: '' },
  lastWebhookStatus: { type: String, default: '' },
  lastError: { type: String, default: '' },
  updatedBy: { type: String, default: '' },
}, { _id: false });



const financialSettingsSchema = new mongoose.Schema({
  vatPercentage: {
    type: Number,
    default: 7.5,
    min: [0, 'VAT percentage cannot be less than 0.'],
    max: [100, 'VAT percentage cannot exceed 100.'],
  },
  companyIncomeTaxPercentage: {
    type: Number,
    default: 30,
    min: [0, 'Company income tax percentage cannot be less than 0.'],
    max: [100, 'Company income tax percentage cannot exceed 100.'],
  },
  withholdingTaxPercentage: {
    type: Number,
    default: 0,
    min: [0, 'Withholding tax percentage cannot be less than 0.'],
    max: [100, 'Withholding tax percentage cannot exceed 100.'],
  },
  applyCompanyIncomeTaxProvision: {
    type: Boolean,
    default: true,
  },
  showDscrWhenNoDebt: {
    type: Boolean,
    default: false,
  },
}, { _id: false });

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
    whatsappSettings: {
      type: whatsappSettingsSchema,
      default: () => ({}),
    },
    financialSettings: {
      type: financialSettingsSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

const Config = mongoose.model('Config', configSchema);

module.exports = Config;