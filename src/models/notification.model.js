// src/models/notification.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const notificationSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: [true, 'Notification ID is required.'],
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    userId: {
      type: String, // References the User's custom 'id' field
      required: [true, 'User ID for the notification is required.'],
      ref: 'User',
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Notification title is required.'],
      trim: true,
      maxlength: [150, 'Title cannot exceed 150 characters.'],
    },
    body: {
      type: String,
      required: [true, 'Notification body is required.'],
      trim: true,
      maxlength: [500, 'Body cannot exceed 500 characters.'],
    },
    type: {
      type: String,
      enum: [
        'ORDER_UPDATE',
        'PAYMENT_SUCCESS',
        'PROMOTION',
        'SYSTEM_ALERT',
        'ADMIN_BROADCAST', // For admin-sent messages
        'NEW_RUN_ASSIGNED',
        'WALLET_CREDIT',
      ],
      default: 'SYSTEM_ALERT',
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    data: { // For storing extra payload data, e.g., an orderId for navigation
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: { // Overrides the default `createdAt` from timestamps for more control
        type: Date,
        default: Date.now,
        required: true,
    }
  },
  {
    timestamps: true, // Adds createdAt and updatedAt, useful for auditing
  }
);

// Compound index for efficient querying of a user's notifications, sorted by time
notificationSchema.index({ userId: 1, timestamp: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
