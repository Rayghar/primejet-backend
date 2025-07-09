// File: src/models/agent.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

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
      sparse: true, // Allows nulls to be non-unique, but actual emails must be unique
      match: [/\S+@\S+\.\S+/, 'Please use a valid email address.'],
    },
    phone: {
      type: String,
      required: [true, 'Agent phone number is required.'],
      trim: true,
      unique: true,
      match: [/^\+?\d{10,15}$/, 'Please use a valid phone number (e.g., +23480...).'],
    },
    agentCode: { // A unique, human-readable code for the agent
      type: String,
      required: [true, 'Agent code is required.'],
      unique: true,
      trim: true,
      uppercase: true,
      minlength: [4, 'Agent code must be at least 4 characters.'],
      maxlength: [12, 'Agent code cannot exceed 12 characters.'],
      index: true,
    },
    referralLink: { // The full deep link URL the agent shares
      type: String,
      required: [true, 'Referral link is required.'],
      unique: true,
      trim: true,
    },
    totalCustomersReferred: { // Count of customers who successfully onboarded via this agent
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: { // Whether the agent's code/link is currently active
      type: Boolean,
      default: true,
    },
    // Optional: Add more fields like address, bank details for payouts, etc.
  },
  {
    timestamps: true, // Adds createdAt and updatedAt fields
  }
);

const Agent = mongoose.model('Agent', agentSchema);

module.exports = Agent;