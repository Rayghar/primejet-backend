// File: src/models/referral.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const referralSchema = new mongoose.Schema(
  {
    id: { // Custom ID for the referral record itself
      type: String,
      required: [true, 'Referral record ID is required.'],
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    userId: { // The user to whom this referral code belongs (the referrer)
      type: String, // Assuming this refers to the custom 'id' field in your User model
      required: [true, 'User ID for the referral is required.'],
      ref: 'User',
      unique: true, // Each user should have only one primary referral record/code
      index: true,
    },
    referralCode: {
      type: String,
      required: [true, 'Referral code is required.'],
      unique: true,
      trim: true,
      uppercase: true, // Store codes consistently for case-insensitive matching
      minlength: [6, 'Referral code must be at least 6 characters.'],
      maxlength: [12, 'Referral code cannot exceed 12 characters.'], // Example length
      index: true,
    },
    // These fields describe the referral program terms *associated with this user's code*.
    // If program terms change system-wide, these could represent a snapshot.
    // For simplicity, keeping as per original model.
    programDescription: {
      type: String,
      required: [true, 'Program description is required.'],
      trim: true,
      maxlength: [500, 'Program description cannot exceed 500 characters.'],
    },
    benefitSelf: { // Benefit for the referrer
      type: String,
      required: [true, 'Benefit for self (referrer) is required.'],
      trim: true,
      maxlength: [255, 'Benefit description cannot exceed 255 characters.'],
    },
    benefitFriend: { // Benefit for the referred friend (referee)
      type: String,
      required: [true, 'Benefit for friend (referee) is required.'],
      trim: true,
      maxlength: [255, 'Benefit description cannot exceed 255 characters.'],
    },
    isActive: { // Can this user's referral code be used?
      type: Boolean,
      default: true,
      index: true,
    },
    totalReferredCount: { // How many users signed up using this code
      type: Number,
      default: 0,
      min: 0,
    },
    successfulReferralsCount: { // How many referred users completed a qualifying action (e.g., first order)
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

const Referral = mongoose.model('Referral', referralSchema);

module.exports = Referral;