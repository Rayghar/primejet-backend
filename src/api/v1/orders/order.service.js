// src/api/v1/orders/order.service.js
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const Order = require('../../../models/order.model');
const User = require('../../../models/user.model');
const Run = require('../../../models/run.model');
const Config = require('../../../models/config.model');
const Promotion = require('../../../models/promotion.model');
const Address = require('../../../models/address.model');
const HttpError = require('../../../utils/HttpError');
const { firestore, admin, isFirebaseInitialized } = require('../../../config/firebase.config.js');
const { logger } = require('../../../config/logger.config.js');
const referralService = require('../referrals/referral.service');
const { sendOrderStatusUpdate } = require('../../../services/fcm.service'); // Import the new service

// IMPORTANT: This helper function maps granular driver stop statuses (from Run.Stop enum)
// to high-level customer-facing order statuses (from Order enum).
// This function is ALSO defined in run.service.js. Ensure consistency.
const mapDriverStopStatusToOrderStatus = (driverStopStatus) => {
  switch (driverStopStatus) {
    case 'DRIVER_ENROUTE_PICKUP':
      return 'Driver Assigned';
    case 'PICKED_UP_ENROUTE_STATION':
       return 'Processing'; 
    case 'CYLINDER_REFILLING':
      return 'Processing';
    case 'OUT_FOR_DELIVERY':
      return 'Out for delivery';
    case 'DELIVERED':
      return 'Delivered';
    case 'CUSTOMER_UNAVAILABLE':
      return 'Customer Unavailable';
    case 'ISSUE_REPORTED':
      return 'Issue Reported';
    case 'Pending':
    case 'Assigned':
      return 'Processing';
    default:
      logger.warn(`[mapDriverStopStatusToOrderStatus] Unhandled driverStopStatus: ${driverStopStatus}. Defaulting to 'Processing'.`);
      return 'Processing';
  }
};


const getOrders = async (options) => {
  const { status, customerId, driverId, page, limit, userId, role, sortBy } = options;
  try {
    const query = {};
    if (status) {
      if (status.includes(',')) {
        query.status = { $in: status.split(',').map(s => s.trim()).filter(s => s.length > 0) };
      } else if (status.trim().length > 0) {
        query.status = status.trim();
      }
    }

    if (role === 'customer') {
      query.customerId = userId;
      if (customerId && customerId !== userId) {
        logger.warn(`[ORDER_SERVICE] Unauthorized customer access attempt: User ${userId} tried to access orders for customer ${customerId}.`);
        throw new HttpError(403, 'Customers can only access their own orders.');
      }
    } else if (role === 'driver') {
      query.driverId = userId;
      if (driverId && driverId !== userId) {
        logger.warn(`[ORDER_SERVICE] Unauthorized driver access attempt: Driver ${userId} tried to access orders for driver ${driverId}.`);
        throw new HttpError(403, 'Drivers can only access their assigned orders.');
      }
    } else if (role === 'admin') {
      if (customerId) query.customerId = customerId;
      if (driverId) query.driverId = driverId;
    } else {
      logger.warn(`[ORDER_SERVICE] Unauthorized role '${role}' attempted to access orders.`);
      throw new HttpError(403, 'Unauthorized role for accessing orders.');
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    const sortOptions = sortBy ? sortBy.replace(',', ' ') : { orderDate: -1 };

    const totalOrders = await Order.countDocuments(query);

    const orders = await Order.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .populate({
        path: 'customer',
        select: 'id name email phone',
        model: 'User',
      })
      .populate({
        path: 'driver',
        select: 'id name phone vehicleType licensePlate',
        model: 'User',
      });
    return {
      orders: orders.map(order => order.toObject({ virtuals: true })),
      currentPage: pageNum,
      totalPages: Math.ceil(totalOrders / limitNum),
      totalOrders,
    };
  } catch (error) {
    logger.error(`[ORDER_SERVICE] Get orders error:`, { error: error.message, stack: error.stack, options });
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to list orders due to an unexpected error.');
  }
};

const getOrderPaymentStatus = async (orderId, requestingUser) => {
  try {
    const order = await getOrder(orderId, requestingUser);

    if (!order) {
      throw new HttpError(404, 'Order not found.');
    }

    return {
      orderId: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      grandTotal: order.grandTotal,
      finalAmountPaid: order.finalAmountPaid,
      message: 'Payment status retrieved successfully.'
    };
  } catch (error) {
    logger.error(`[ORDER_SERVICE] Error fetching payment status for order ${orderId}:`, { error: error.message, stack: error.stack });
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to retrieve payment status due to an unexpected error.');
  }
};

const getOrder = async (orderId, requestingUser) => {
  try {
    const order = await Order.findOne({ id: orderId })
        .populate('customer')
        .populate('driver');

    if (!order) {
      throw new HttpError(404, 'Order not found.');
    }

    if (!requestingUser) {
        throw new HttpError(401, 'Authentication details are missing.');
    }

    if (requestingUser.role === 'admin') {
        return order.toObject({ virtuals: true });
    }

    if (requestingUser.role === 'customer' && order.customerId !== requestingUser.id) {
      logger.warn(`[ORDER_SERVICE] Unauthorized customer access: User ${requestingUser.id} attempted to access order ${orderId} belonging to ${order.customerId}`);
      throw new HttpError(403, 'You are not authorized to view this order.');
    }

    if (requestingUser.role === 'driver' && order.driverId !== requestingUser.id) {
      logger.warn(`[ORDER_SERVICE] Unauthorized driver access: Driver ${requestingUser.id} attempted to access order ${orderId} assigned to ${order.driverId}`);
      throw new HttpError(403, 'You are not authorized to view this order.');
    }

    return order.toObject({ virtuals: true });

  } catch (error) {
    logger.error(`[ORDER_SERVICE] Get order ${orderId} error:`, { error: error.message, stack: error.stack });
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to retrieve order due to an internal data issue.');
  }
};

const placeOrder = async (customerId, orderData) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findOne({ id: customerId }).select('name phone walletBalance defaultAddressId role referredBy').session(session);
    if (!user) {
      logger.error(`[ORDER_SERVICE] User placing order not found: ${customerId}`);
      throw new HttpError(404, 'User placing order not found.');
    }
    if (user.role !== 'customer') {
      logger.warn(`[ORDER_SERVICE] Non-customer user ${customerId} attempted to place order.`);
      throw new HttpError(403, 'Only customers can place orders.');
    }

    const {
      deliveryAddressId, items, recipientName, recipientPhone, isExpress,
      useWalletBalance, promoCodeApplied,
    } = orderData;

    if (!deliveryAddressId || !items || items.length === 0 ) {
      throw new HttpError(400, 'Missing delivery address or items for the order.');
    }
    if (items.some(item => !item.cylinderId || !item.quantity || item.unitPrice == null || !item.productName)) {
      throw new HttpError(400, 'Invalid item structure: cylinderId, quantity, unitPrice, and productName are required.');
    }

    const effectiveRecipientName = recipientName || user.name;
    const effectiveRecipientPhone = recipientPhone || user.phone;

    if (!effectiveRecipientName || !effectiveRecipientPhone) {
        throw new HttpError(400, 'Recipient name and phone are required.');
    }

    const deliveryAddress = await Address.findOne({ id: deliveryAddressId, userId: customerId }).session(session);
    if (!deliveryAddress) {
      logger.error(`[ORDER_SERVICE] Delivery address ${deliveryAddressId} not found or does not belong to user ${customerId}.`);
      throw new HttpError(404, `Delivery address with ID ${deliveryAddressId} not found or does not belong to user.`);
    }

    if (!deliveryAddress.fullAddress || !deliveryAddress.street || !deliveryAddress.city || !deliveryAddress.state || !deliveryAddress.country) {
        logger.error(`[ORDER_SERVICE] Delivery address ID ${deliveryAddressId} is critically incomplete (missing fullAddress, street, city, state, or country). Cannot create snapshot.`);
        throw new HttpError(400, 'Selected delivery address details are incomplete. Please update your address.');
    }

    const deliveryAddressSnapshot = {
      fullAddress: deliveryAddress.fullAddress,
      street: deliveryAddress.street,
      city: deliveryAddress.city,
      state: deliveryAddress.state,
      country: deliveryAddress.country,
      postalCode: deliveryAddress.postalCode,
      latitude: deliveryAddress.latitude,
      longitude: deliveryAddress.longitude,
      deliveryInstructions: deliveryAddress.deliveryInstructions,
    };

    const config = await Config.findOne().session(session);
    if (!config || !config.feeSettings) {
      logger.error(`[ORDER_SERVICE] System configuration for fees not found or incomplete. Config: ${JSON.stringify(config)}`);
      throw new HttpError(500, 'System configuration for fees not found or incomplete.');
    }

    const itemsSubtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    let discountAmount = 0.0;
    let referrerId = null;
    // Check if the user was referred by another customer
    if (user.referredByCode) {
        const referral = await Referral.findOne({ referralCode: user.referredByCode }).session(session);
        if (referral) {
            // Get the original user ID of the person who referred them.
            referrerId = referral.userId; 
            logger.info(`[ORDER_SERVICE] Order placed by referred user ${customerId}. Referrer ID ${referrerId} will be stamped on the order.`);
        }
    }



    if (promoCodeApplied) {
      const promotion = await Promotion.findOne({
          promoCode: promoCodeApplied.toUpperCase(),
          isActive: true,
          validFrom: { $lte: new Date() },
          validUntil: { $gte: new Date() }
      }).session(session);

      if (promotion) {
          if (promotion.minOrderAmount != null && itemsSubtotal < promotion.minOrderAmount) {
              logger.info(`[ORDER_SERVICE] Promo ${promoCodeApplied} not applied for order: Subtotal ${itemsSubtotal} is less than minimum ${promotion.minOrderAmount}`);
          } else {
            if (promotion.type === 'Percentage Discount') {
              discountAmount = itemsSubtotal * (promotion.value / 100);
            } else if (promotion.type === 'Fixed Amount') {
              discountAmount = promotion.value;
            }
            discountAmount = Math.min(discountAmount, itemsSubtotal);
            logger.info(`[ORDER_SERVICE] Promo ${promoCodeApplied} applied, discount: ${discountAmount}`);
          }
      } else {
        logger.info(`[ORDER_SERVICE] Promo code ${promoCodeApplied} is invalid, expired, or not active.`);
        throw new HttpError(400, 'Invalid or expired promo code.');
      }
    }

    const subtotalAfterDiscount = itemsSubtotal - discountAmount;
    const vatAmount = subtotalAfterDiscount > 0 ? subtotalAfterDiscount * (config.feeSettings.vatPercentage / 100) : 0;
    const serviceFeeAmount = subtotalAfterDiscount > 0 ? subtotalAfterDiscount * (config.feeSettings.serviceFeePercentage / 100) : 0;
    const deliveryFee = (isExpress ? config.feeSettings.baseDeliveryFee + config.feeSettings.expressDeliverySurcharge : config.feeSettings.baseDeliveryFee);

    let totalBeforeWallet = subtotalAfterDiscount + vatAmount + serviceFeeAmount + deliveryFee;
    let walletAmountUsed = 0;

    if (useWalletBalance && user.walletBalance > 0) {
      walletAmountUsed = Math.min(user.walletBalance, totalBeforeWallet);
      totalBeforeWallet -= walletAmountUsed;
    }

    const grandTotalToPayByGateway = Math.max(0, totalBeforeWallet);
    const overallGrandTotal = subtotalAfterDiscount + vatAmount + serviceFeeAmount + deliveryFee;

    const orderStatus = grandTotalToPayByGateway > 0 ? 'Pending Payment' : 'Order Placed';
    const paymentStatusCurrent = grandTotalToPayByGateway > 0 ? 'Pending' : 'Completed';

    if (user.referredBy) {
        referrerId = user.referredBy;
    }

    const newOrder = new Order({
      id: uuidv4(),
      customerId,
      deliveryAddressId,
      deliveryAddressSnapshot,
      items,
      recipientName: effectiveRecipientName,
      recipientPhone: effectiveRecipientPhone,
      isExpressDelivery: isExpress || false,
      itemsSubtotal,
      discountAmount,
      referrerId: referrerId,
      promoCodeApplied: discountAmount > 0 ? (promoCodeApplied ? promoCodeApplied.toUpperCase() : null) : null,
      vatAmount,
      serviceFeeAmount,
      deliveryFee,
      walletAmountUsed,
      grandTotal: overallGrandTotal,
      finalAmountPaid: (paymentStatusCurrent === 'Completed') ? (overallGrandTotal - walletAmountUsed) : 0,
      status: orderStatus,
      paymentStatus: paymentStatusCurrent,
      statusHistory: [{ status: orderStatus, timestamp: new Date(), notes: 'Order created.' }],
      deliveryLatitude: deliveryAddress.latitude,
      deliveryLongitude: deliveryAddress.longitude,
      orderDate: new Date(),
    });

    if (walletAmountUsed > 0) {
      user.walletBalance -= walletAmountUsed;
      await user.save({ session });
      logger.info(`[ORDER_SERVICE] Wallet balance ${walletAmountUsed} deducted for user ${customerId}, order ${newOrder.id}. New balance: ${user.walletBalance}`);
    }

    const savedOrder = await newOrder.save({ session });

    await session.commitTransaction();
    logger.info(`[ORDER_SERVICE] Order ${savedOrder.id} placed successfully. Payment Needed: ${grandTotalToPayByGateway > 0}`);

    return {
      order: savedOrder.toObject(),
      paymentNeeded: grandTotalToPayByGateway > 0,
      grandTotalToPay: grandTotalToPayByGateway,
      message: 'Order created successfully.'
    };
  } catch (error) {
    await session.abortTransaction();
    logger.error(`[ORDER_SERVICE] Place order error for customer ${customerId}:`, {error: error.message, stack: error.stack, inputOrderData: orderData});
    if (error instanceof HttpError) throw error;
    console.error('Full error object in placeOrder service:', error);
    throw new HttpError(500, `Failed to place order due to an unexpected error: ${error.message}`);
  } finally {
    session.endSession();
  }
};

/**
 * Updates an order's status and payment details, typically from a webhook.
 * @param {object} params
 * @param {string} params.orderId - The ID of the order to update.
 * @param {string} params.status - The new *desired* primary status for the order (e.g., 'Order Placed', 'Failed').
 * @param {string} params.paymentStatus - The new *desired* payment status (e.g., 'Completed', 'Failed').
 * @param {object} params.paymentDetails - Details of the payment transaction.
 * @param {number} params.verifiedAmount - The amount paid as verified by the payment gateway (in kobo).
 * @param {string} [params.notes] - Additional notes for the status history.
 * @returns {Promise<object>} The updated order object.
 * @throws {HttpError} If order not found, amount mismatch, or other processing errors.
 */
async function updateOrderStatus({ orderId, status, paymentStatus, paymentDetails, verifiedAmount, notes = '' }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  logger.debug(`[Order Service][updateOrderStatus] Starting transaction for order ${orderId}.`);

  try {
    logger.info(`[Order Service][updateOrderStatus] Initiating DB update for order ${orderId}. Target Status: '${status}', Target Payment Status: '${paymentStatus}'.`);
    logger.debug(`[Order Service][updateOrderStatus] Received paymentDetails: ${JSON.stringify(paymentDetails)}, Verified Amount: ${verifiedAmount}, Notes: '${notes}'.`);

    const order = await Order.findOne({ id: orderId }).session(session);
    if (!order) {
        logger.error(`[Order Service][updateOrderStatus] Order not found for update: ${orderId}. Aborting transaction.`);
        throw new HttpError(404, 'Order not found');
    }

    logger.debug(`[Order Service][updateOrderStatus] Order ${orderId} found. Current DB state: Status='${order.status}', PaymentStatus='${order.paymentStatus}', FinalAmountPaid='${order.finalAmountPaid}', PaymentDetails='${JSON.stringify(order.paymentDetails || {})}'`);

    // Idempotency check: If order is already in a final 'Completed' payment state and
    // the transactionId matches, skip to avoid duplicate processing.
    if (order.paymentStatus === 'Completed' && paymentDetails?.transactionId && order.paymentDetails?.transactionId === paymentDetails.transactionId) {
        logger.warn(`[Order Service][updateOrderStatus] Order ${orderId} already has paymentStatus 'Completed' with matching transaction ID '${paymentDetails.transactionId}'. Skipping re-update. Aborting transaction.`);
        await session.abortTransaction();
        return order.toObject();
    }
    logger.debug(`[Order Service][updateOrderStatus] Idempotency check passed for order ${orderId}.`);


    // Logic for successful payment (Monnify paymentStatus 'PAID' mapping to 'Completed')
    if (paymentStatus === 'Completed') {
        logger.info(`[Order Service][updateOrderStatus] Processing successful payment confirmation for order ${orderId}.`);

        // Crucial validation: Ensure the verified amount from Monnify matches the order's expected total.
        if (verifiedAmount !== order.grandTotal) {
            logger.error(`[Order Service][updateOrderStatus] Amount mismatch for order ${orderId}. Expected: ${order.grandTotal}, Verified: ${verifiedAmount}. Txn Ref: ${paymentDetails.transactionId}. Aborting transaction.`);
            order.status = 'Payment Discrepancy';
            order.paymentStatus = 'Failed';
            order.finalAmountPaid = verifiedAmount;
            order.paymentDetails = {
                ...paymentDetails,
                notes: `Amount mismatch. Expected: ${order.grandTotal}, Verified: ${verifiedAmount}.`,
            };
            order.statusHistory.push({ status: 'Payment Discrepancy', timestamp: new Date(), notes: `Amount mismatch. Expected: ${order.grandTotal}, Verified: ${verifiedAmount}. Txn: ${paymentDetails.transactionId}.` });

            await order.save({ session });
            await session.commitTransaction();
            logger.info(`[Order Service][updateOrderStatus] Order ${orderId} updated to 'Payment Discrepancy' due to amount mismatch.`);
            throw new HttpError(400, 'Verified payment amount does not match order total.');
        }
        logger.debug(`[Order Service][updateOrderStatus] Amount verification passed for order ${orderId}.`);

        // Apply wallet refund logic here if needed based on your business rules (e.g., if wallet was used but now gateway covered everything)
        // Ensure this logic is sound and doesn't double-charge or double-refund.

        order.finalAmountPaid = verifiedAmount;
        order.status = 'Order Placed';
        order.paymentStatus = 'Completed';
        order.paymentDetails = paymentDetails;

        const statusNotes = notes || `Payment confirmed successfully via webhook. Txn Ref: ${paymentDetails.transactionId}.`;
        order.statusHistory.push({ status: order.status, timestamp: new Date(), notes: statusNotes });
        logger.info(`[Order Service][updateOrderStatus] Order ${orderId} successfully transitioned to Status: '${order.status}', Payment Status: '${order.paymentStatus}'.`);

    } else if (paymentStatus === 'Failed' || paymentStatus === 'Canceled') {
        logger.debug(`[Order Service][updateOrderStatus] Processing FAILED or CANCELLED payment status for order ${orderId}.`);
        if (order.paymentStatus !== 'Completed') {
            order.status = 'Payment Failed';
            order.paymentStatus = 'Failed';
            order.paymentDetails = paymentDetails;
            const statusNotes = notes || `Payment failed via webhook. Txn Ref: ${paymentDetails.transactionId}. Monnify Status: ${paymentDetails.monnifyStatus}.`;
            order.statusHistory.push({ status: 'Payment Failed', timestamp: new Date(), notes: statusNotes });
            logger.warn(`[Order Service][updateOrderStatus] Order ${orderId} payment explicitly failed via webhook. Status: '${order.status}', Payment Status: '${order.paymentStatus}'.`);

            if (order.walletAmountUsed > 0) {
                const user = await User.findOne({ id: order.customerId }).session(session);
                if (user) {
                    user.walletBalance += order.walletAmountUsed;
                    await user.save({ session });
                    logger.info(`[ORDER_SERVICE] Refunded ${order.walletAmountUsed} to user ${user.id}'s wallet for failed order ${orderId}. New balance: ${user.walletBalance}.`);
                } else {
                    logger.error(`[ORDER_SERVICE][updateOrderStatus] Critical: User ${order.customerId} not found to refund wallet for failed order ${orderId}. Throwing HttpError 500.`);
                    throw new HttpError(500, "Error processing cancellation refund: User not found.");
                }
            }
        } else {
            logger.info(`[ORDER_SERVICE][updateOrderStatus] Received a failed/canceled webhook for order ${orderId}, but payment is already Completed. Skipping update. Aborting transaction.`);
            await session.abortTransaction();
            return order.toObject();
        }
    } else {
        logger.info(`[ORDER_SERVICE][updateOrderStatus] Received unhandled (or non-terminal) paymentStatus '${paymentStatus}' for order ${orderId}. No DB update performed by this block. Aborting transaction.`);
        await session.abortTransaction();
        return order.toObject();
    }

    logger.debug(`[Order Service][updateOrderStatus] Attempting to save order ${orderId} document to DB.`);
    await order.save({ session });
    logger.debug(`[Order Service][updateOrderStatus] Order ${orderId} document saved. Attempting to commit transaction.`);
    await session.commitTransaction();
    logger.info(`[Order Service][updateOrderStatus] Transaction committed for order ${orderId}. Final DB state: Status='${order.status}', Payment Status: '${order.paymentStatus}'.`);

    // Referral logic. Moved outside main transaction for robustness, ensure its own transaction/idempotency
    if (order.referrerId && paymentStatus === 'Completed') {
        logger.debug(`[Order Service][updateOrderStatus] Checking referral for order ${orderId} (referrerId: ${order.referrerId}) after webhook confirmation.`);
        try {
            // Check if this is the referee's FIRST completed order.
            const completedOrdersCount = await Order.countDocuments({
                customerId: order.customerId,
                paymentStatus: 'Completed',
                status: { $nin: ['Canceled', 'Canceled by Customer', 'Payment Failed'] }
            });

            if (completedOrdersCount === 1) {
                logger.info(`[ORDER_SERVICE][updateOrderStatus] Referee ${order.customerId}'s first completed purchase (${order.id}). Triggering referral credit for referrer ${order.referrerId}.`);
                // This function will handle the reward logic.
                await referralService.creditReferrerForSuccessfulReferral(order);
            } else {
                logger.debug(`[ORDER_SERVICE][updateOrderStatus] Referee ${order.customerId} has more than one completed order (${completedOrdersCount}). Not crediting referrer for this order.`);
            }
        } catch (referralError) {
            logger.error(`[ORDER_SERVICE][updateOrderStatus] Error processing referral for order ${orderId}: ${referralError.message}`, { stack: referralError.stack });
            // We don't throw an error here because the main order update was successful.
        }
    }

    return order.toObject();
  } catch (error) {
    // This catch block handles errors occurring within the transaction.
    await session.abortTransaction();
    logger.error(`[Order Service][updateOrderStatus] Transaction aborted for order ${orderId} due to error. Original error: ${error.message}`, { stack: error.stack, errorObject: error });

    // Ensure HttpError is re-thrown with a valid integer status code.
    if (error instanceof HttpError) {
        const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
        logger.error(`[Order Service][updateOrderStatus] Propagating HttpError: ${statusCode} - ${error.message}.`);
        throw new HttpError(statusCode, error.message);
    } else {
        // For unexpected non-HttpError errors, wrap and re-throw as HttpError 500.
        logger.error(`[Order Service][updateOrderStatus] Propagating unexpected non-HttpError as HttpError 500: ${error.message}.`);
        throw new HttpError(500, `Failed to update order status due to an unexpected error: ${error.message}`);
    }
  } finally {
    // Ensure the session is always ended, regardless of success or failure.
    if (session.inTransaction()) { // Check if session is still active (e.g., if commit/abort failed for some reason)
        logger.warn(`[Order Service][updateOrderStatus] Session still active in finally block for order ${orderId}. Attempting to end session.`);
        try {
            await session.endSession();
        } catch (e) {
            logger.error(`[Order Service][updateOrderStatus] Error ending session for order ${orderId}: ${e.message}`);
        }
    } else {
        logger.debug(`[Order Service][updateOrderStatus] Session ended successfully for order ${orderId}.`);
    }
  }
}

// --- REMOVE THE OLD updateOrderPaymentStatus AND processPayment FUNCTIONS ---
// Based on the new structure, these are no longer used for core payment processing via webhook.
// If 'processPayment' had other purposes (e.g. wallet top-ups), it should be renamed and moved.

/*
// REMOVED: This function is replaced by updateOrderStatus for webhook processing
const updateOrderPaymentStatus = async (orderId, paymentStatus, paymentDetails, verifiedAmount, paymentGatewayReference) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findById(orderId).session(session);
    if (!order) {
      logger.warn(`[ORDER_SERVICE] Order ${orderId} not found for updateOrderPaymentStatus.`);
      throw new HttpError(404, 'Order not found');
    }

    if (order.paymentStatus === 'Completed') {
      logger.warn(`[ORDER_SERVICE] Order ${orderId} is already marked as paid. Skipping update.`);
      await session.commitTransaction();
      return { message: 'Order already paid.', order: order.toObject() };
    }

    order.paymentStatus = paymentStatus;
    order.finalAmountPaid = verifiedAmount;
    order.paymentGatewayReference = paymentGatewayReference; // Set the reference
    order.paymentTransactionId = paymentDetails.transactionReference; // Assuming this from Monnify payload
    order.paymentHistory.push({
      status: paymentStatus,
      timestamp: new Date(),
      notes: `Payment updated via webhook. Gateway reference: ${paymentGatewayReference}`,
      paymentDetails: paymentDetails, // Store full payment details for audit
    });

    if (paymentStatus === 'paid') {
      order.status = 'Payment Confirmed'; // Or 'Processing'
      order.statusHistory.push({
        status: order.status,
        timestamp: new Date(),
        notes: 'Payment successfully confirmed via gateway webhook.',
        updaterRole: 'system',
      });
    }

    await order.save({ session });
    await session.commitTransaction();
    logger.info(`[ORDER_SERVICE] Order ${orderId} payment status updated to '${paymentStatus}'.`);
    return { message: 'Order payment status updated successfully.', order: order.toObject() };
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof HttpError) throw error;
    if (error.code === 11000 && error.keyPattern && error.keyPattern.paymentGatewayReference) {
      logger.warn(`[ORDER_SERVICE] Attempted to update order ${orderId} with duplicate paymentGatewayReference: ${paymentGatewayReference}. Skipping.`);
      throw new HttpError(409, 'Payment for this order has already been processed with this transaction ID.');
    }
    logger.error('Unexpected error in updateOrderPaymentStatus:', { error: error.message, stack: error.stack, orderId });
    throw new HttpError(500, 'Failed to update order payment status due to an unexpected error.');
  } finally {
    session.endSession();
  }
};
*/

/*
// REMOVED: This function is replaced by webhook-driven processing
const processPayment = async (orderId, paymentData, customerId, customerRole) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findOne({ id: customerId }).session(session);
    if (!user) throw new HttpError(404, 'User not found for payment processing.');
    if (customerRole !== 'customer' || user.role !== 'customer') {
      throw new HttpError(403, 'Insufficient permissions to process this payment.');
    }

    const order = await Order.findOne({ id: orderId, customerId }).session(session);
    if (!order) throw new HttpError(404, 'Order not found or does not belong to this user.');
    if (order.paymentStatus === 'Completed') {
      return { message: 'Payment for this order has already been completed.' };
    }

    order.status = 'Order Placed';
    order.paymentStatus = 'Completed';
    order.finalAmountPaid = paymentData.amount;
    order.paymentTransactionId = paymentData.transactionId;
    order.paymentGateway = 'flutterwave'; // This was hardcoded to flutterwave
    order.statusHistory.push({ status: 'Payment Completed', timestamp: new Date(), notes: `Confirmed by client app. Ref: ${paymentData.transactionId}` });

    await order.save({ session });

    if (user.referredBy) {
      const completedOrdersCount = await Order.countDocuments({
        customerId: user.id,
        status: { $in: ['Delivered', 'Completed'] },
      }).session(session);

      if (completedOrdersCount === 0) {
        console.log(`[ORDER_SERVICE] Referee ${user.id}'s first purchase (${order.id}). Triggering credit for referrer ${user.referredBy}.`);
        order.referrerId = user.referredBy;
        await referralService.creditReferrerForSuccessfulReferral(order, session);
      }
    }

    await session.commitTransaction();
    return { transactionId: paymentData.transactionId, message: 'Payment processed successfully.' };
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof HttpError) throw error;
    logger.error('Unexpected error in processPayment:', { error: error.message, stack: error.stack, orderId });
    throw new HttpError(500, 'Failed to process payment due to an unexpected error.');
  } finally {
    session.endSession();
  }
};
*/

// --- Existing Functions (submitFeedback, getLocationHistory, driverUpdateOrderStatus,
// adminGetOrders, adminUpdateOrderStatus, adminAssignDriver, cancelOrder, getCustomerConsumptionData) ---

const submitFeedback = async (orderId, feedbackData, customerId, customerRole) => {
  try {
    const user = await User.findOne({ id: customerId });
    if (!user) throw new HttpError(404, 'User not found for submitting feedback.');
    if (customerRole !== 'customer' || user.role !== 'customer') {
      throw new HttpError(403, 'Insufficient permissions to submit feedback.');
    }
    const order = await Order.findOne({ id: orderId, customerId });
    if (!order) throw new HttpError(404, 'Order not found or does not belong to this user.');
    if (order.status !== 'Delivered') {
      throw new HttpError(400, 'Feedback can only be submitted for delivered orders.');
    }
    const feedbackRef = firestore.collection('feedback').doc(`${orderId}_${customerId}`);
    await feedbackRef.set({
      orderId, customerId, driverId: order.driverId || null,
      rating: feedbackData.rating, comment: feedbackData.comment,
      createdAt: new Date(), userName: user.name,
    });
    return { message: 'Feedback submitted successfully.' };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    logger.error('Unexpected error in submitFeedback:', { error: error.message, stack: error.stack, orderId});
    if (error.code) { throw new HttpError(500, `Failed to submit feedback (Firebase error: ${error.code})`);}
    throw new HttpError(500, `Failed to submit feedback: ${error.message || 'An unexpected error occurred.'}`);
  }
};

const getLocationHistory = async (orderId, requestingUserId, requestingUserRole) => {
  try {
    const order = await Order.findOne({ id: orderId });
    if (!order) throw new HttpError(404, 'Order not found for location history.');
    if (requestingUserRole === 'customer' && order.customerId !== requestingUserId) {
      throw new HttpError(403, 'You are not authorized to view location history for this order.');
    }
    if (requestingUserRole === 'driver' && order.driverId !== requestingUserId) {
      throw new HttpError(403, 'You are not authorized to view location history for this order as a driver.');
    }
    const historySnapshot = await firestore.collection('driver_locations').where('orderId', '==', orderId).orderBy('timestamp', 'desc').get();
    if (historySnapshot.empty) return [];
    return historySnapshot.docs.map(doc => doc.data());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    logger.error('Unexpected error in getLocationHistory:', { error: error.message, stack: error.stack, orderId });
    if (error.code) { throw new HttpError(500, `Failed to retrieve location history (Firebase error: ${error.code})`);}
    throw new HttpError(500, `Failed to retrieve location history: ${error.message || 'An unexpected error occurred.'}`);
  }
};

const driverUpdateOrderStatus = async (orderId, newStatus, notes, driverId, driverRole) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (driverRole !== 'driver') throw new HttpError(403, 'Only drivers can update order status via this method.');
    const order = await Order.findOne({ id: orderId, driverId }).session(session);
    if (!order) throw new HttpError(404, 'Order not found or not assigned to this driver.');
    const oldStatus = order.status;
    order.status = newStatus;
    const statusNote = notes || `Status changed from ${oldStatus} to ${newStatus} by driver ${driverId}.`;
    order.statusHistory.push({ status: newStatus, timestamp: new Date(), notes: statusNote, updatedBy: driverId, updaterRole: 'driver' });
    if (newStatus === 'Delivered') order.actualDeliveryTime = new Date();
    await order.save({ session });
    await session.commitTransaction();
    if (oldStatus !== newStatus) {
      sendOrderStatusUpdate(order.customerId, order.id, newStatus);
    }
    return { message: `Order status updated to ${newStatus}.`, order: order.toObject() };
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof HttpError) throw error;
    logger.error('Unexpected error in driverUpdateOrderStatus:', { error: error.message, stack: error.stack, orderId });
    throw new HttpError(500, 'Failed to update order status by driver.');
  } finally {
    session.endSession();
  }
};

const adminGetOrders = async (options) => {
  const { status, search, dateRangeStart, dateRangeEnd, page = 1, limit = 10, sortBy } = options;
  try {
    const query = {};
    if (status) {
      if (status.includes(',')) {
        query.status = { $in: status.split(',').map(s => s.trim()).filter(s => s.length > 0) };
      } else if (status.trim().length > 0) {
        query.status = status.trim();
      }
    }
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [ { id: searchRegex }, { customerId: searchRegex }, { driverId: searchRegex }, { recipientName: searchRegex }, { recipientPhone: searchRegex } ];
    }
    if (dateRangeStart) query.orderDate = { ...query.orderDate, $gte: new Date(dateRangeStart) };
    if (dateRangeEnd) {
      const endDate = new Date(dateRangeEnd);
      endDate.setHours(23, 59, 59, 999);
      query.orderDate = { ...query.orderDate, $lte: endDate };
    }
    const sortOptions = sortBy ? sortBy.replace(',', ' ') : { orderDate: -1 };

    const totalOrders = await Order.countDocuments(query);
    const orders = await Order.find(query)
      .sort(sortOptions)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({
        path: 'customer', // FIX: Corrected from customerId to customer virtual
        select: 'id name email phone',
        model: 'User',
      })
      .populate({
        path: 'driver', // FIX: Corrected from driverId to driver virtual
        select: 'id name email phone',
        model: 'User',
      });
    return {
      orders: orders.map(order => order.toObject({ virtuals: true })),
      currentPage: page,
      totalPages: Math.ceil(totalOrders / limit),
      totalOrders,
    };
  } catch (error) {
    logger.error('Unexpected error in adminGetOrders:', { error: error.message, stack: error.stack });
    throw new HttpError(500, 'Failed to retrieve orders for admin.');
  }
};

const adminUpdateOrderStatus = async (orderId, newStatus, notes, adminId, adminRole) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (adminRole !== 'admin') throw new HttpError(403, 'Only admins can update order status via this method.');
    const order = await Order.findOne({ id: orderId }).session(session);
    if (!order) throw new HttpError(404, 'Order not found for admin update.');
    const oldStatus = order.status;
    order.status = newStatus;
    const statusNote = notes || `Status changed from ${oldStatus} to ${newStatus} by admin ${adminId}.`;
    order.statusHistory.push({ status: newStatus, timestamp: new Date(), notes: statusNote, updatedBy: adminId, updaterRole: 'admin' });
    order.adminNotes.push({ note: statusNote, adminId, timestamp: new Date() });
    if (newStatus === 'Delivered' && !order.actualDeliveryTime) order.actualDeliveryTime = new Date();
    await order.save({ session });
    await session.commitTransaction();
    if (oldStatus !== newStatus) {
      sendOrderStatusUpdate(order.customerId, order.id, newStatus);
    }
    return { message: `Order ${orderId} status updated to ${newStatus}.`, order: order.toObject() };
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof HttpError) throw error;
    logger.error('Unexpected error in adminUpdateOrderStatus:', { error: error.message, stack: error.stack, orderId });
    throw new HttpError(500, 'Failed to update order status by admin.');
  } finally {
    session.endSession();
  }
};

const adminAssignDriver = async (orderId, driverIdToAssign, adminId, adminRole) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        if (adminRole !== 'admin') throw new HttpError(403, 'Only admins can assign drivers.');

        const order = await Order.findOne({ id: orderId }).session(session);
        if (!order) throw new HttpError(404, 'Order not found for driver assignment.');

        const driver = await User.findOne({ id: driverIdToAssign, role: 'driver' }).session(session);
        if (!driver) throw new HttpError(404, `Driver with ID ${driverIdToAssign} not found or is not a driver.`);

        order.driverId = driverIdToAssign;
        order.status = 'Driver Assigned';
        const note = `Driver ${driver.name} (ID: ${driverIdToAssign}) assigned by admin ${adminId}.`;
        order.statusHistory.push({ status: 'Driver Assigned', timestamp: new Date(), notes: note, updatedBy: adminId, updaterRole: 'admin' });
        await order.save({ session });

        const newRun = new Run({
            id: uuidv4(),
            driverId: driverIdToAssign,
            overallStatus: 'Assigned',
            stops: [{
                stopId: uuidv4(),
                orderId: order.id,
                sequence: 1,
                status: 'Pending',
                latitude: order.deliveryLatitude,
                longitude: order.deliveryLongitude,
            }],
            totalStops: 1,
            notes: `Run created for Order #${order.id.substring(0, 8)}.`
        });
        await newRun.save({ session });

        await session.commitTransaction();
        logger.info(`Run ${newRun.id} created and driver ${driver.name} assigned to order ${orderId}.`);

        const populatedOrder = await Order.findOne({ id: orderId })
            .populate('customer', 'id name email phone')
            .populate('driver', 'id name phone vehicleType licensePlate')
            .session(session);

        return { message: `Driver ${driver.name} assigned to order ${orderId}.`, order: populatedOrder.toObject({ virtuals: true }) };

    } catch (error) {
            await session.abortTransaction();
        logger.error('Unexpected error in adminAssignDriver:', { error: error.message, stack: error.stack, orderId });
        if (error instanceof HttpError) throw error;
        if (error.name === 'ValidationError') {
            throw new HttpError(400, error.message);
        }
        throw new HttpError(500, 'Failed to assign driver by admin.');
    } finally {
        session.endSession();
    }
};

const cancelOrder = async (orderId, customerId, customerRole) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (customerRole !== 'customer') throw new HttpError(403, 'Only customers can cancel orders via this method.');
    const order = await Order.findOne({ id: orderId }).session(session);
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.customerId !== customerId) throw new HttpError(403, 'You are not authorized to cancel this order.');
    if (order.paymentStatus !== 'Pending' || order.status !== 'Pending Payment') {
      throw new HttpError(400, `Order in status '${order.status}' with payment status '${order.paymentStatus}' cannot be canceled by the customer.`);
    }
    if (order.walletAmountUsed && order.walletAmountUsed > 0) {
        const user = await User.findOne({ id: customerId }).session(session);
        if (user) {
            user.walletBalance += order.walletAmountUsed;
            await user.save({ session });
        } else {
            logger.error(`Critical: User ${customerId} not found to refund wallet for canceled order ${orderId}.`);
            throw new HttpError(500, "Error processing cancellation refund: User not found.");
        }
    }
    order.status = 'Canceled by Customer';
    order.statusHistory.push({ status: order.status, timestamp: new Date(), notes: 'Order canceled by customer.', updatedBy: customerId, updaterRole: 'customer' });
    await order.save({ session });
    await session.commitTransaction();
    return { message: 'Order canceled successfully.' };
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof HttpError) throw error;
    logger.error('Unexpected error in cancelOrder:', { error: error.message, stack: error.stack, orderId });
    throw new HttpError(500, 'Failed to cancel order due to an unexpected error.');
  } finally {
    session.endSession();
  }
};

const getCustomerConsumptionData = async (customerId) => {
  try {
    const orders = await Order.find({
      customerId: customerId,
      status: 'Delivered'
    })
    .sort({ orderDate: -1 })
    // We need items and orderDate for calculation, so select them
    .select('orderDate items'); // FIX: Select 'items' to calculate total gas

    let totalGasKg = 0;
    let totalOrders = orders.length;
    let averageDaysBetweenOrders = 0;

    // Calculate total gas in kg
    for (const order of orders) {
      for (const item of order.items) {
        const match = item.productName.match(/(\d+(\.\d+)?)\s*KG/i); // Assuming format like "XX KG Cylinder"
        if (match && match[1]) {
          totalGasKg += (parseFloat(match[1]) * item.quantity);
        }
      }
    }

    // Calculate average days between orders
    if (orders.length > 1) {
      let totalDaysDiff = 0;
      for (let i = 0; i < orders.length - 1; i++) {
        const date1 = orders[i].orderDate;
        const date2 = orders[i+1].orderDate;
        totalDaysDiff += Math.abs(date1.getTime() - date2.getTime()) / (1000 * 60 * 60 * 24); // Difference in days
      }
      averageDaysBetweenOrders = totalDaysDiff / (orders.length - 1);
    }
    
    // FIX: Return an object with aggregated stats, not the raw orders array
    return {
      totalOrders: totalOrders,
      totalGasKg: parseFloat(totalGasKg.toFixed(1)), // Format for consistency
      averageDaysBetweenOrders: parseFloat(averageDaysBetweenOrders.toFixed(1)), // Format for consistency
      // Optionally, you can also include the recent orders if the frontend still needs them separately:
      // recentDeliveredOrders: orders.map(order => order.toObject())
    };

  } catch (error) {
    logger.error(`[ORDER_SERVICE] Error fetching consumption data for customer ${customerId}:`, error);
    throw new HttpError(500, 'Failed to retrieve order data for gas level calculation.');
  }
};

module.exports = {
  getOrders,
  getOrder,
  placeOrder,
  submitFeedback,
  getLocationHistory,
  driverUpdateOrderStatus,
  adminGetOrders,
  adminUpdateOrderStatus,
  adminAssignDriver,
  cancelOrder,
  getCustomerConsumptionData,
  updateOrderStatus,
  getOrderPaymentStatus,
};