// src/models/address.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
addressSchema.index({ latitude: 1 });   // ✨ ADD THIS INDEX
addressSchema.index({ longitude: 1 });  // ✨ ADD THIS INDEX


const addressSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: [true, 'Address ID is required.'],
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    userId: {
      type: String, // Assuming this refers to the custom 'id' field in your User model
      required: [true, 'User ID is required.'],
      ref: 'User', // Links to the User model
      index: true,
    },
    label: { // e.g., 'Home', 'Work', 'Other'
      type: String,
      required: [true, 'Address label is required.'],
      trim: true,
      minlength: [2, 'Label must be at least 2 characters.'],
      maxlength: [50, 'Label cannot exceed 50 characters.'],
    },
    fullAddress: { // Often captured from a geocoding service or as a single line input
      type: String,
      required: [true, 'Full address is required.'],
      trim: true,
      minlength: [5, 'Full address must be at least 5 characters.'],
      maxlength: [255, 'Full address cannot exceed 255 characters.'],
    },
    street: {
      type: String,
      required: [true, 'Street address is required.'],
      trim: true,
      minlength: [3, 'Street must be at least 3 characters.'],
      maxlength: [100, 'Street cannot exceed 100 characters.'],
    },
    city: {
      type: String,
      required: [true, 'City is required.'],
      trim: true,
      minlength: [2, 'City must be at least 2 characters.'],
      maxlength: [50, 'City cannot exceed 50 characters.'],
    },
    state: { // Or province/region
      type: String,
      required: [true, 'State/Province is required.'],
      trim: true,
      minlength: [2, 'State/Province must be at least 2 characters.'],
      maxlength: [50, 'State/Province cannot exceed 50 characters.'],
    },
    country: {
      type: String,
      required: [true, 'Country is required.'],
      trim: true,
      default: 'Nigeria', // Assuming a default
      minlength: [2, 'Country must be at least 2 characters.'],
      maxlength: [50, 'Country cannot exceed 50 characters.'],
    },
    postalCode: { // Optional
      type: String,
      trim: true,
      maxlength: [20, 'Postal code cannot exceed 20 characters.'],
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    latitude: {
      type: Number,
      min: -90,
      max: 90,
      optional: true, // Or required if you always need coordinates
    },
    longitude: {
      type: Number,
      min: -180,
      max: 180,
      optional: true, // Or required
    },
    // Optional: additional instructions for the driver
    deliveryInstructions: {
        type: String,
        trim: true,
        maxlength: [255, 'Delivery instructions cannot exceed 255 characters.'],
    }
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Compound index for user and label could be useful if labels should be unique per user
// addressSchema.index({ userId: 1, label: 1 }, { unique: true });

addressSchema.index({ latitude: 1 });   // ✨ ADD THIS INDEX
addressSchema.index({ longitude: 1 });  // ✨ ADD THIS INDEX


const Address = mongoose.model('Address', addressSchema);

module.exports = Address;