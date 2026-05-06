// src/models/plantSafetyCheck.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const plantSafetyCheckSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, default: () => uuidv4(), index: true },
    plantId: { type: String, required: true, index: true },
    checkDate: { type: Date, required: true, default: Date.now, index: true },
    checklistName: { type: String, default: 'Daily Safety Inspection', trim: true },
    performedBy: { type: String, default: null },
    status: { type: String, enum: ['PASS', 'FAIL', 'PARTIAL', 'REQUIRES_ACTION'], default: 'PASS', index: true },
    findings: { type: String, default: '' },
    correctiveAction: { type: String, default: '' },
    dueDate: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

plantSafetyCheckSchema.index({ plantId: 1, checkDate: -1 });
module.exports = mongoose.model('PlantSafetyCheck', plantSafetyCheckSchema);
