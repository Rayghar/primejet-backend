// src/models/customerNote.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const customerNoteSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    customerId: {
      type: String,
      required: [true, 'Customer ID is required.'],
      ref: 'User', // Assuming User model represents customers
      index: true,
    },
    text: {
      type: String,
      required: [true, 'Note text is required.'],
      trim: true,
      maxlength: [1000, 'Note cannot exceed 1000 characters.'],
    },
    authorEmail: { // Email of the user who added the note
      type: String,
      required: [true, 'Author email is required.'],
      trim: true,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

const CustomerNote = mongoose.model('CustomerNote', customerNoteSchema);

module.exports = CustomerNote;