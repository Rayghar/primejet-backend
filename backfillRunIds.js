// backfillRunIds.js - One-time script to backfill `runId` in Order documents

// IMPORTANT: Adjust these paths to your project's structure
require('dotenv').config({ path: './.env' }); // Load environment variables
const mongoose = require('mongoose');
const Order = require('./src/models/order.model'); // Path to your Order model
const Run = require('./src/models/run.model');   // Path to your Run model
const User = require('./src/models/user.model'); // Path to your User model (if needed for context, though not directly used in this backfill logic)

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://chukwuneme:gWEcHdWqXqK6mEiO@cluster0.hefxifh.mongodb.net/primejet?retryWrites=true&w=majority&appName=Cluster0'; // REPLACE WITH YOUR ACTUAL DB URI

async function backfillRunIds() {
  console.log('Starting MongoDB connection for backfill...');
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB connected successfully for backfill.');

    console.log('Fetching all runs...');
    const runs = await Run.find({
        overallStatus: { $in: ['Assigned', 'In Progress', 'Completed', 'Partially Completed'] }
    }).lean(); // Use .lean() for faster reads as we're not modifying Run documents directly

    if (runs.length === 0) {
      console.log('No runs found to process. Exiting.');
      await mongoose.disconnect();
      return;
    }

    let updatedOrdersCount = 0;
    let totalOrdersProcessed = 0;

    for (const run of runs) {
      // console.log(`Processing Run: ${run.id}, Driver: ${run.driverId}, Status: ${run.overallStatus}`);
      for (const stop of run.stops) {
        totalOrdersProcessed++;
        // Find the order that this stop refers to
        const order = await Order.findOne({ id: stop.orderId });

        if (order) {
          // Check if the order's runId is missing or doesn't match this run
          // And also confirm the driverId matches, to ensure this is the correct linkage
          if (!order.runId || order.runId !== run.id || order.driverId !== run.driverId) {
            console.log(`Updating order ${order.id}: runId from '${order.runId}' to '${run.id}' and driverId from '${order.driverId}' to '${run.driverId}'`);
            order.runId = run.id;
            order.driverId = run.driverId; // Ensure driverId is also consistent, though this script's primary focus is runId
            await order.save();
            updatedOrdersCount++;
          } else {
            // console.log(`Order ${order.id} already has correct runId and driverId.`);
          }
        } else {
          console.warn(`WARNING: Order ${stop.orderId} (referenced in run ${run.id}) not found in the 'orders' collection. Skipping.`);
        }
      }
    }

    console.log(`Backfill complete. Total runs processed: ${runs.length}`);
    console.log(`Total order documents checked: ${totalOrdersProcessed}`);
    console.log(`Total order documents updated with correct runId: ${updatedOrdersCount}`);

  } catch (error) {
    console.error('An error occurred during backfill:', error);
  } finally {
    console.log('Disconnecting from MongoDB.');
    await mongoose.disconnect();
  }
}

backfillRunIds();
