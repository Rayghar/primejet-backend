// src/api/v2/operations/operations.validation.js
const Joi = require('joi');

// Schema for adding a new plant
const addPlantSchema = Joi.object({
  name: Joi.string().min(3).max(100).required().description('Name of the plant.'),
  capacity: Joi.number().min(0).required().description('LPG storage capacity in KG.'),
  status: Joi.string().valid('Operational', 'Maintenance', 'Offline', 'Warning').default('Operational').description('Current operational status of the plant.'),
  uptime: Joi.number().min(0).max(100).default(100).description('Percentage uptime of the plant.'),
  outputToday: Joi.number().min(0).default(0).description('Total KG processed today.'),
  monthlyOpex: Joi.number().min(0).default(0).description('Monthly operational expenses.'),
  location: Joi.object({
    latitude: Joi.number().min(-90).max(90).optional().description('Latitude of the plant location.'),
    longitude: Joi.number().min(-180).max(180).optional().description('Longitude of the plant location.'),
    address: Joi.string().max(255).optional().description('Physical address of the plant.'),
  }).optional().description('Geographical location details of the plant.'),
  targetDailyOutputKg: Joi.number().min(0).optional().description('Target daily output in KG.'),
  lastMaintenanceDate: Joi.date().iso().optional().allow(null).description('Date of the last maintenance.'),
  nextMaintenanceDate: Joi.date().iso().optional().allow(null).description('Date of the next scheduled maintenance.'),
});

// Schema for plant ID parameter (reusable)
const plantIdParamSchema = Joi.object({
  plantId: Joi.string().uuid({ version: 'uuidv4' }).required().description('UUID of the plant.'),
});

// NEW: Schema for adding a maintenance log
const addMaintenanceLogSchema = Joi.object({
  type: Joi.string().valid('Routine', 'Emergency', 'Repair', 'Upgrade', 'Inspection', 'Other').required().description('Type of maintenance.'),
  description: Joi.string().min(5).max(500).required().description('Description of the maintenance performed.'),
  startDate: Joi.date().iso().required().description('Start date of the maintenance.'),
  endDate: Joi.date().iso().optional().allow(null).description('End date of the maintenance.'),
  cost: Joi.number().min(0).default(0).description('Cost of the maintenance.'),
  performedBy: Joi.string().max(100).optional().description('Person or team who performed the maintenance.'),
  status: Joi.string().valid('Scheduled', 'In Progress', 'Completed', 'Canceled').default('Scheduled').description('Status of the maintenance.'),
});


module.exports = {
  addPlantSchema,
  plantIdParamSchema,
  addMaintenanceLogSchema, // Export new schema
};