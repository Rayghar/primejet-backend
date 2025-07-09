// src/models/promotion.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const promotionSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: [true, 'Promotion ID is required.'],
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Promotion title is required.'],
      trim: true,
      minlength: [3, 'Title must be at least 3 characters.'],
      maxlength: [100, 'Title cannot exceed 100 characters.'],
    },
    shortDescription: {
      type: String,
      required: [true, 'Short description is required.'],
      trim: true,
      maxlength: [255, 'Short description cannot exceed 255 characters.'],
    },
    longDescription: { // Optional: for more details if needed
        type: String,
        trim: true,
        maxlength: [1000, 'Long description cannot exceed 1000 characters.'],
    },
    promoCode: {
      type: String,
      required: [true, 'Promo code is required.'],
      unique: true,
      trim: true,
      uppercase: true, // Store promo codes consistently
      minlength: [3, 'Promo code must be at least 3 characters.'],
      maxlength: [20, 'Promo code cannot exceed 20 characters.'],
      index: true,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },
    validFrom: {
      type: Date,
      required: [true, 'Valid from date is required.'],
      index: true,
    },
    validUntil: {
      type: Date,
      required: [true, 'Valid until date is required.'],
      index: true,
      validate: [
        function (value) { // Ensure validUntil is after validFrom
          return this.validFrom <= value;
        },
        'Valid until date must be after or the same as valid from date.'
      ],
    },
    type: {
      type: String,
      enum: ['Percentage Discount', 'Fixed Amount', 'Free Delivery', 'Item Discount'], // Added 'Free Delivery' and updated 'Fixed Amount'
      required: [true, 'Promotion type is required.'],
    },
    value: { // Value of the discount (percentage or fixed amount in smallest currency unit)
      type: Number,
      required: [true, 'Promotion value is required.'],
      min: [0, 'Promotion value must be non-negative.'], // Changed to 0 to allow for Free Delivery (value 0)
    },
    // Optional: Usage limits
    maxUses: { // Total number of times this promo can be used
      type: Number,
      min: 1,
      optional: true,
    },
    usesPerUser: { // How many times a single user can use this promo
      type: Number,
      min: 1,
      default: 1, // Default to one use per user
      optional: true,
    },
    currentUses: { // To track how many times it has been used (for maxUses)
        type: Number,
        default: 0,
        min: 0,
    },
    // Optional: Conditions for applicability
    minOrderAmount: { // Minimum order subtotal (before discount) for promo to apply (in smallest currency unit)
      type: Number,
      min: 0,
      optional: true,
    },
    minOrderWeightKg: { // New field: Minimum total weight of cylinders for promo to apply
      type: Number,
      min: 0,
      optional: true,
    },
    // applicableTo: { // More complex logic for what items/categories/users it applies to
    //   type: String, // e.g., 'all_products', 'specific_category_id', 'new_users_only'
    //   items: [String] // e.g., array of product IDs or category IDs
    // },
  },
  {
    timestamps: true,
  }
);

// Ensure promo codes are unique and case-insensitive (though uppercase helps)
// Mongoose unique index is case-sensitive by default. A custom pre-save hook
// or ensuring promo codes are always stored in one case (e.g., uppercase) is good practice.
// The `uppercase: true` in the schema helps with this.

const Promotion = mongoose.model('Promotion', promotionSchema);

module.exports = Promotion;