// File: src/models/agent.model.js (Updated)
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs'); // <-- ADD THIS IMPORT

const agentSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: [true, 'Agent ID is required.'],
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Agent name is required.'],
      trim: true,
      minlength: [3, 'Agent name must be at least 3 characters.'],
      maxlength: [100, 'Agent name cannot exceed 100 characters.'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
      match: [/\S+@\S+\.\S+/, 'Please use a valid email address.'],
    },
    phone: {
      type: String,
      required: [true, 'Agent phone number is required.'],
      trim: true,
      unique: true,
      match: [/^\+?\d{10,15}$/, 'Please use a valid phone number (e.g., +23480...).'],
    },
    // ================== ADD THIS FIELD ==================
    password: {
      type: String,
      required: [true, 'Password is required for agent login.'],
      select: false // This ensures the password hash isn't sent in API responses by default
    },
    // ====================================================
    agentCode: {
      type: String,
      required: [true, 'Agent code is required.'],
      unique: true,
      trim: true,
      uppercase: true,
      minlength: [4, 'Agent code must be at least 4 characters.'],
      maxlength: [12, 'Agent code cannot exceed 12 characters.'],
      index: true,
    },
    referralLink: {
      type: String,
      required: [true, 'Referral link is required.'],
      unique: true,
      trim: true,
    },
    totalCustomersReferred: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// ================== ADD THIS PASSWORD HASHING LOGIC ==================
// Mongoose pre-save hook to hash the password before saving
agentSchema.pre('save', async function (next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();

  // Hash the password with a salt round of 10
  this.password = await bcrypt.hash(this.password, 10);
  next();
});
// ====================================================================

const Agent = mongoose.model('Agent', agentSchema);

module.exports = Agent;