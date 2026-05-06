// File: src/models/whatsappContact.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const whatsappContactSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    waId: { type: String, required: true, unique: true, index: true },
    phone: { type: String, required: true, index: true },
    profileName: { type: String, trim: true },
    linkedCustomerId: { type: String, ref: 'User', index: true, sparse: true },
    linkedCustomerName: { type: String, trim: true },
    lastIntent: { type: String, trim: true },
    lastMessageAt: { type: Date },
    lastReplyAt: { type: Date },
    status: {
      type: String,
      enum: ['ACTIVE', 'WAITING_CUSTOMER', 'HANDOFF_TO_SUPPORT', 'BLOCKED'],
      default: 'ACTIVE',
      index: true,
    },
    optInStatus: {
      type: String,
      enum: ['UNKNOWN', 'OPTED_IN', 'OPTED_OUT'],
      default: 'UNKNOWN',
      index: true,
    },
    tags: { type: [String], default: [] },
    metadata: { type: Map, of: String, default: {} },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

whatsappContactSchema.index({ phone: 1, lastMessageAt: -1 });
whatsappContactSchema.index({ linkedCustomerId: 1, lastMessageAt: -1 });

module.exports = mongoose.model('WhatsAppContact', whatsappContactSchema);
