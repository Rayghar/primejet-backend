// File: src/models/user.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const userSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    googleId: { 
      type: String, 
      sparse: true, 
      unique: true, 
      select: false 
    },
    name: {
      type: String,
      required: [true, 'User name is required.'],
      trim: true,
      minlength: [2, 'User name must be at least 2 characters long.'],
      maxlength: [50, 'User name cannot exceed 50 characters.'],
    },
    email: {
      type: String,
      required: [true, 'Email address is required.'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/\S+@\S+\.\S+/, 'Please use a valid email address.'],
      index: true,
    },
    phone: {
      type: String,
      required: [
        function() { return !this.googleId; }, // Required only if not a Google sign-up
        'Phone number is required for email/password registration.'
      ],
      trim: true,
    },
    password: {
      type: String,
      required: [
        function() { return !this.googleId; },
        'Password is required for email/password registration.'
      ],
      minlength: [6, 'Password must be at least 6 characters long.'],
      select: false,
    },
    role: {
      type: String,
      enum: ['customer', 'driver', 'admin'],
      required: [true, 'User role is required.'],
      default: 'customer',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended', 'pending_verification'],
      default: 'active',
      index: true,
    },
    isVerified: {
      type: Boolean,
      default: true,
      select: false,
    },
    otp: {
      type: String,
      select: false,
    },
    otpExpires: {
      type: Date,
      select: false,
    },
    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    notificationPreferences: {
      orderUpdates: { type: Boolean, default: true },
      promotions: { type: Boolean, default: true },
    },
    bankDetails: {
      bankCode: String,
      accountNumber: String,
      accountName: String,
    },
    isAvailableOnline: {
      type: Boolean,
      default: false,
    },
    driverProfile: {
        averageRating: { type: Number, default: 0 },
        ratingCount: { type: Number, default: 0 },
        vehicleType: { type: String, trim: true },
        licensePlate: { type: String, trim: true },
    },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    passwordResetToken: { type: String, select: false, },
    passwordResetExpires: { type: Date, select: false, },
    // << UPDATED >> Enabled the fcmTokens field for push notifications
    fcmTokens: {
      type: [String],
      default: [],
      select: false,
    },
    gatewayCustomerId: { type: String, trim: true, sparse: true, unique: true, select: false },
    referredByCode: { type: String, trim: true, sparse: true }, // Customer-to-customer referral code used
    referredByUserId: { // <-- ADD THIS FIELD
      type: String,
      ref: 'User',
      sparse: true,
      index: true,
    },
    referralBenefitApplied: { type: Boolean, default: false },
    defaultAddressId: { type: String },
    referredByAgentId: { // New field: ID of the agent who referred this user
      type: String,
      ref: 'Agent', // Reference to the Agent model
      optional: true,
      index: true,
      sparse: true, // Allows multiple nulls
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt fields
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret.__v;
        delete ret._id; // Exclude _id from returned objects if 'id' is used instead
        delete ret.password; // Ensure password is never returned even if somehow selected
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret.__v;
        delete ret._id;
        delete ret.password;
        return ret;
      },
    },
  }
);

// Mongoose hooks for password hashing (pre-save middleware)
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const bcrypt = require('bcryptjs'); // Moved inside to prevent circular dependency issues if imported globally
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
  const bcrypt = require('bcryptjs');
  return await bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

module.exports = User;