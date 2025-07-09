// src/models/faq.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const faqSchema = new mongoose.Schema(
  {
    id: { // Custom ID
      type: String,
      required: [true, 'FAQ ID is required.'],
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    question: {
      type: String,
      required: [true, 'FAQ question is required.'],
      trim: true,
      minlength: [10, 'Question must be at least 10 characters long.'],
      maxlength: [500, 'Question cannot exceed 500 characters.'],
      // Consider adding a unique index if questions must be globally unique,
      // or unique within a category/role combination.
      // unique: true, // If globally unique
    },
    answer: {
      type: String,
      required: [true, 'FAQ answer is required.'],
      trim: true,
      minlength: [10, 'Answer must be at least 10 characters long.'],
      maxlength: [5000, 'Answer cannot exceed 5000 characters.'],
    },
    category: {
      type: String,
      trim: true,
      index: true, // Index if you frequently filter or group by category
      maxlength: [50, 'Category cannot exceed 50 characters.'],
      default: 'General', // Example default category
    },
    role: { // Target audience for the FAQ
      type: String,
      enum: ['customer', 'driver', 'all'],
      default: 'all',
      index: true,
    },
    isActive: { // To control visibility
      type: Boolean,
      default: true,
      index: true,
    },
    displayOrder: { // Optional: for manual sorting within a category/role
      type: Number,
      default: 0, // Lower numbers could appear first
    },
    tags: [{ type: String, trim: true, lowercase: true }], // Optional: for better searchability
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Example of a compound index if questions should be unique per category and role
// faqSchema.index({ question: 1, category: 1, role: 1 }, { unique: true });

const FAQ = mongoose.model('FAQ', faqSchema);

module.exports = FAQ;