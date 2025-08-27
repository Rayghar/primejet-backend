// File: src/models/run.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const statusHistorySchema = new mongoose.Schema({
  status: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  notes: String,
  updatedBy: String,
  updaterRole: String,
}, { _id: false });

const stopSchema = new mongoose.Schema(
  {
    stopId: {
      type: String,
      default: () => uuidv4(),
    },
    orderId: {
      type: String,
      required: [true, 'Order ID for stop is required.'],
    },
    sequence: {
      type: Number,
      required: [true, 'Stop sequence number is required.'],
      min: 1,
    },
    status: {
      type: String,
      required: [true, 'Stop status is required.'],
      enum: [
        'Pending',
        'DRIVER_ENROUTE_PICKUP',
        'PICKED_UP_ENROUTE_STATION',
        'CYLINDER_REFILLING',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'CUSTOMER_UNAVAILABLE'
      ],
      default: 'Pending',
    },
    estimatedArrivalTime: { type: Date },
    actualArrivalTime: { type: Date },
    departureTime: { type: Date },
    notes: { type: String, trim: true },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    // <<<< NEW CODE: ADDED statusHistory to the stopSchema >>>>
    statusHistory: {
        type: [statusHistorySchema],
        default: []
    }
    // <<<< END NEW CODE >>>>
  },
  { 
    _id: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

stopSchema.virtual('order', {
  ref: 'Order',
  localField: 'orderId',
  foreignField: 'id',
  justOne: true
});

const runSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    runCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    driverId: {
      type: String,
      ref: 'User',
      index: true,
      sparse: true,
    },
    overallStatus: {
      type: String,
      required: [true, 'Overall run status is required.'],
      enum: ['Pending', 'Assigned', 'In Progress', 'Completed', 'Partially Completed', 'Canceled'],
      default: 'Pending',
      index: true,
    },
    statusHistory: {
        type: [statusHistorySchema],
        default: []
    },
    totalStops: {
      type: Number,
      required: [true, 'Total number of stops is required.'],
      min: [0, 'Total stops cannot be negative.'],
    },
    completedStops: { type: Number, default: 0, min: 0 },
    stops: [stopSchema],
    estimatedStartDate: { type: Date },
    actualStartDate: { type: Date },
    estimatedCompletionDate: { type: Date },
    actualCompletionDate: { type: Date },
    notes: { type: String, trim: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

runSchema.virtual('driver', {
  ref: 'User',
  localField: 'driverId',
  foreignField: 'id',
  justOne: true
});

runSchema.index({ driverId: 1, overallStatus: 1 });

runSchema.pre('save', function (next) {
  if (this.isModified('stops') || this.isNew) {
    this.totalStops = this.stops ? this.stops.length : 0;
  }
  next();
});

const Run = mongoose.model('Run', runSchema);

module.exports = Run;