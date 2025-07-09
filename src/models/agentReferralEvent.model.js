// File: src/models/agentReferralEvent.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const agentReferralEventSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: [true, 'Event ID is required.'],
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    agentId: { // The ID of the agent whose link was used
      type: String,
      required: [true, 'Agent ID is required for the referral event.'],
      ref: 'Agent', // Reference to the Agent model
      index: true,
    },
    customerId: { // The ID of the customer who was potentially acquired (null if just a click)
      type: String,
      ref: 'User', // Reference to the User model
      optional: true,
      sparse: true, // Allows multiple nulls
      index: true,
    },
    eventType: { // e.g., 'LINK_CLICK', 'APP_INSTALL', 'CUSTOMER_REGISTERED'
      type: String,
      required: [true, 'Event type is required.'],
      enum: ['LINK_CLICK', 'CUSTOMER_REGISTERED', 'APP_INSTALL'], // Define specific event types
      index: true,
    },
    metadata: { // Store additional data like IP, user agent, device info, etc.
      type: mongoose.Schema.Types.Mixed, // Flexible field for various data
      optional: true,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt fields
  }
);

const AgentReferralEvent = mongoose.model('AgentReferralEvent', agentReferralEventSchema);

module.exports = AgentReferralEvent;