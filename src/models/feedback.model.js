// src/models/feedback.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const feedbackSchema = new mongoose.Schema(
  {
    id: { // Custom ID
      type: String,
      required: [true, 'Feedback ID is required.'],
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    orderId: {
      type: String, // Assuming this refers to the custom 'id' field in your Order model
      required: [true, 'Order ID is required for feedback.'],
      ref: 'Order',
      index: true,
    },
    customerId: {
      type: String, // Assuming this refers to the custom 'id' field in your User model
      required: [true, 'Customer ID is required for feedback.'],
      ref: 'User',
      index: true,
    },
    driverId: { // Optional: If feedback can also be associated with/about the driver
      type: String, // Assuming this refers to the custom 'id' field in your User model
      ref: 'User',
      index: true,
      sparse: true,
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required.'],
      min: [1, 'Rating must be at least 1.'],
      max: [5, 'Rating must be at most 5.'], // Assuming a 1-5 star rating system
    },
    comment: {
      type: String,
      required: [true, 'Comment is required.'],
      trim: true,
      minlength: [5, 'Comment must be at least 5 characters long.'],
      maxlength: [2000, 'Comment cannot exceed 2000 characters.'],
    },
    status: { // Optional: For managing feedback (e.g., by admin)
        type: String,
        enum: ['New', 'Acknowledged', 'Resolved', 'Archived'],
        default: 'New',
        index: true,
    },
    // You could also store a snapshot of user name/driver name here if needed for display
    // and to avoid frequent population, though it leads to data duplication.
    // customerNameSnapshot: { type: String },
    // driverNameSnapshot: { type: String },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Compound index for querying feedback by order and customer
feedbackSchema.index({ orderId: 1, customerId: 1 }, { unique: true }); // Assuming one feedback per customer per order

const Feedback = mongoose.model('Feedback', feedbackSchema);

module.exports = Feedback;