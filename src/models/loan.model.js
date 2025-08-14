// src/models/loan.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const loanSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Loan name is required.'],
      trim: true,
      minlength: [3, 'Loan name must be at least 3 characters.'],
      maxlength: [100, 'Loan name cannot exceed 100 characters.'],
    },
    principal: {
      type: Number,
      required: [true, 'Loan principal is required.'],
      min: [0, 'Principal cannot be negative.'],
    },
    interestRate: { // Annual interest rate (e.g., 0.10 for 10%)
      type: Number,
      required: [true, 'Interest rate is required.'],
      min: [0, 'Interest rate cannot be negative.'],
      max: [100, 'Interest rate cannot exceed 100.'],
    },
    term: { // Loan term in years
      type: Number,
      required: [true, 'Loan term is required.'],
      min: [1, 'Term must be at least 1 year.'],
    },
    disbursementDate: {
      type: Date,
      default: Date.now,
    },
    // Optional: lender, repayment schedule, outstanding balance, etc.
  },
  {
    timestamps: true,
  }
);

const Loan = mongoose.model('Loan', loanSchema);

module.exports = Loan;