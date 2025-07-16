// src/api/v1/orders/order.service.js
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose'); // Required for database sessions (transactions)
const Order = require('../../../models/order.model');
const User = require('../../../models/user.model');
const Run = require('../../../models/run.model');
const Config = require('../../../models/config.model');
const Promotion = require('../../../models/promotion.model');
const Address = require('../../../models/address.model'); // Ensure Address model is imported
const HttpError = require('../../../utils/HttpError'); // Renamed from AppError to HttpError for consistency
const { firestore, admin, isFirebaseInitialized } = require('../../../config/firebase.config.js');
const { logger } = require('../../../config/logger.config.js'); // Assuming logger is set up
const referralService = require('../referrals/referral.service'); // For referral logic

// This service no longer needs to interact with a payment service during order creation.

const getOrders = async (options) => {
  const { status, customerId, driverId, page, limit, userId, role, sortBy } = options;
  try {
    const query = {};
     if (status) {
        // Handle comma-separated statuses for $in query
        if (status.includes(',')) {
            query.status = { $in: status.split(',').map(s => s.trim()).filter(s => s.length > 0) };
        } else if (status.trim().length > 0) { // Ensure status is not an empty string
            query.status = status.trim();
        }
    }

    if (role === 'customer') {
      query.customerId = userId;
      if (customerId && customerId !== userId) {
        throw new HttpError(403, 'Customers can only access their own orders.');
      }
    } else if (role === 'driver') {
      query.driverId = userId;
      if (driverId && driverId !== userId) {
        throw new HttpError(403, 'Drivers can only access their assigned orders.');
      }
    } else if (role === 'admin') {
      if (customerId) query.customerId = customerId;
      if (driverId) query.driverId = driverId;
    } else {
        // This case should ideally be prevented by authMiddleware if role is always present
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
          path: 'customerId',
          select: 'id name email phone',
          model: 'User',
          foreignField: 'id'
      })
      .populate({
          path: 'driverId',
          select: 'id name phone vehicleType licensePlate',
          model: 'User',
          foreignField: 'id'
      });
    return {
      orders: orders.map(order => order.toObject()),
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
        return order.toObject();
    }

    if (requestingUser.role === 'customer' && order.customerId !== requestingUser.id) {
      logger.warn(`[ORDER_SERVICE] Unauthorized customer access: User ${requestingUser.id} attempted to access order ${orderId} belonging to ${order.customerId}`);
      throw new HttpError(403, 'You are not authorized to view this order.');
    }

    if (requestingUser.role === 'driver' && order.driverId !== requestingUser.id) {
      logger.warn(`[ORDER_SERVICE] Unauthorized driver access: Driver ${requestingUser.id} attempted to access order ${orderId} assigned to ${order.driverId}`);
      throw new HttpError(403, 'You are not authorized to view this order.');
    }

    return order.toObject();

  } catch (error) {
    logger.error(`[ORDER_SERVICE] Get order ${orderId} error:`, { error: error.message, stack: error.stack });
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to retrieve order due to an internal data issue.');
  }
};

// Function to create a new order (initial state: pending_payment)
async function createOrder(orderData) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findOne({ id: orderData.customerId }).select('name phone walletBalance defaultAddressId role referredBy').session(session);
    if (!user) {
      throw new HttpError(404, 'User placing order not found.');
    }
    if (user.role !== 'customer') {
      throw new HttpError(403, 'Only customers can place orders.');
    }

    const {
      deliveryAddressId, items, recipientName, recipientPhone, isExpress,
      useWalletBalance, promoCodeApplied, referralCode
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

    const deliveryAddress = await Address.findOne({ id: deliveryAddressId, userId: orderData.customerId }).session(session);
    if (!deliveryAddress) {
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
      throw new HttpError(500, 'System configuration for fees not found or incomplete.');
    }

    let itemsSubtotal = 0;
    const orderItems = [];

    for (const item of items) {
        // Assume item.productId is actually item.cylinderId from frontend
        const product = await Product.findOne({ id: item.cylinderId }).session(session);
        if (!product) {
            throw new HttpError(404, `Product with ID ${item.cylinderId} not found.`);
        }
        // Basic stock check
        if (product.stock < item.quantity) {
            throw new HttpError(400, `Not enough stock for ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}`);
        }

        const itemPrice = product.price * item.quantity; // Assuming product.price is in Kobo
        itemsSubtotal += itemPrice;

        orderItems.push({
            productId: product.id, // Store product's own ID
            productName: product.name,
            quantity: item.quantity,
            unitPrice: product.price, // Store individual product price in Kobo
        });
    }

    let discountAmount = 0.0;
    let referrerId = null;

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
      customerId: orderData.customerId,
      deliveryAddressId,
      deliveryAddressSnapshot,
      items: orderItems, // Use the validated and enriched orderItems
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
      logger.info(`[ORDER_SERVICE] Wallet balance ${walletAmountUsed} deducted for user ${orderData.customerId}, order ${newOrder.id}. New balance: ${user.walletBalance}`);
    }

    const savedOrder = await newOrder.save({ session });

    await session.commitTransaction();
    logger.info(`[ORDER_SERVICE] Order ${savedOrder.id} placed successfully. PaymentNeeded: ${grandTotalToPayByGateway > 0}`);

    return {
      order: savedOrder.toObject(),
      paymentNeeded: grandTotalToPayByGateway > 0,
      grandTotalToPay: grandTotalToPayByGateway,
      message: 'Order created successfully.'
    };
  } catch (error) {
    await session.abortTransaction();
    logger.error(`[ORDER_SERVICE] Place order error for customer ${orderData.customerId}:`, {error: error.message, stack: error.stack, inputOrderData: orderData});
    if (error instanceof HttpError) throw error;
    console.error('Full error object in placeOrder service:', error);
    throw new HttpError(500, `Failed to place order due to an unexpected error: ${error.message}`);
  } finally {
    session.endSession();
  }
}

// NEW: Function to update order status securely, called ONLY by the webhook service
async function updateOrderStatus({ orderId, status, paymentDetails, verifiedAmount }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    logger.info(`[Order Service] Attempting to update order ${orderId} to status '${status}'.`);
    const order = await Order.findOne({ id: orderId }).session(session);
    if (!order) {
        logger.error(`[Order Service] Order not found for status update: ${orderId}`);
        throw new HttpError('Order not found', 404);
    }

    // Idempotency: Prevent re-processing if order is already in a final paid/failed state
    if (order.paymentStatus === 'Completed' || order.status === 'Cancelled' || order.status === 'Delivered') {
        logger.warn(`[Order Service] Order ${orderId} already in a final state (${order.status}). Avoiding re-update.`);
        await session.abortTransaction(); // Abort the transaction as no changes are needed
        return order.toObject(); // Successfully handled, no error.
    }

    // Crucial validation: Ensure the verified amount from Monnify API matches the order's expected total.
    // Both `verifiedAmount` and `order.grandTotal` should be in kobo for direct comparison.
    if (status === 'paid' && verifiedAmount !== order.grandTotal) {
        logger.error(`[Order Service] Amount mismatch for order ${orderId} during payment confirmation. Expected: ${order.grandTotal}, Verified: ${verifiedAmount}`);
        order.status = 'Payment Discrepancy'; // Set a specific status for manual review
        order.paymentStatus = 'Failed'; // Mark payment as failed due to discrepancy
        order.paymentTransactionId = paymentDetails.transactionId; // Store transaction ID
        order.paymentGateway = paymentDetails.method; // Store payment method
        order.statusHistory.push({ status: 'Payment Discrepancy', timestamp: new Date(), notes: `Amount mismatch. Expected: ${order.grandTotal}, Verified: ${verifiedAmount}.` });
        await order.save({ session });
        await session.commitTransaction();
        throw new HttpError('Verified payment amount does not match order total.', 400);
    }

    // Update order status and payment details
    order.status = (status === 'paid' ? 'Order Placed' : status); // If paid, set to 'Order Placed'
    order.paymentStatus = (status === 'paid' ? 'Completed' : 'Failed'); // Set payment status based on webhook
    order.paymentTransactionId = paymentDetails.transactionId;
    order.paymentGateway = paymentDetails.method;
    order.finalAmountPaid = paymentDetails.amount; // Store the amount from the webhook

    order.statusHistory.push({ status: order.status, timestamp: new Date(), notes: `Payment confirmed via webhook. Ref: ${paymentDetails.transactionId}` });
    await order.save({ session });

    logger.info(`[Order Service] Order ${orderId} successfully updated to status '${order.status}'. Payment Status: '${order.paymentStatus}'.`);

    // Optionally, if status is 'paid', decrement product stock here and trigger fulfillment
    if (status === 'paid') {
        for (const item of order.items) {
            // Find the product by its stored productId (which is the actual product ID)
            const product = await Product.findOne({ id: item.productId }).session(session);
            if (product) {
                await Product.findOneAndUpdate({ id: item.productId }, { $inc: { stock: -item.quantity } }, { session });
                logger.info(`[Order Service] Decremented stock for product ${item.productId} by ${item.quantity}.`);
            } else {
                logger.warn(`[Order Service] Product ${item.productId} not found for stock decrement during order ${orderId} fulfillment.`);
            }
        }
        // Further actions like notifying fulfillment team, sending confirmation emails, etc., go here
    }

    await session.commitTransaction();
    return order.toObject();
  } catch (error) {
    await session.abortTransaction();
    logger.error(`[Order Service] Error updating order status for ${orderId}:`, { error: error.message, stack: error.stack });
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, `Failed to update order status: ${error.message}`);
  } finally {
    session.endSession();
  }
}

// Function to get an order by ID (used by frontend for polling)
async function getOrderById(orderId) {
  logger.info(`[ORDER_SERVICE] Fetching order by ID: ${orderId}`);
  try {
    const order = await Order.findOne({ id: orderId })
      .populate({
          path: 'customer',
          select: 'id name email phone',
          model: 'User',
          foreignField: 'id'
      })
      .populate({
          path: 'driver',
          select: 'id name phone vehicleType licensePlate',
          model: 'User',
          foreignField: 'id'
      });

    if (!order) {
        throw new HttpError(404, 'Order not found.');
    }
    return order.toObject();
  } catch (error) {
    logger.error(`[ORDER_SERVICE] Get order by ID ${orderId} error:`, { error: error.message, stack: error.stack });
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to retrieve order by ID due to an internal data issue.');
  }
}

// Function to get all orders for a specific customer
async function getOrdersByCustomerId(customerId) {
  logger.info(`[ORDER_SERVICE] Fetching orders for customer: ${customerId}`);
  try {
    const orders = await Order.find({ customerId }).sort({ orderDate: -1 }); // Changed from createdAt to orderDate for consistency
    return orders.map(order => order.toObject());
  } catch (error) {
    logger.error(`[ORDER_SERVICE] Get orders by customer ID ${customerId} error:`, { error: error.message, stack: error.stack });
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to retrieve customer orders due to an internal data issue.');
  }
}

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
    order.paymentGateway = 'flutterwave'; // Updated to 'flutterwave'
    order.statusHistory.push({ status: 'Payment Completed', timestamp: new Date(), notes: `Confirmed by client app. Ref: ${paymentData.transactionId}` });

    await order.save({ session });

    // Your referral logic can remain here
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
    const historySnapshot = firestore.collection('driver_locations').where('orderId', '==', orderId).orderBy('timestamp', 'desc').get();
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
        path: 'customerId',
        select: 'id name email phone',
        model: 'User',
        foreignField: 'id'
      })
      .populate({
        path: 'driverId',
        select: 'id name email phone',
        model: 'User',
        foreignField: 'id'
      });
    return {
      orders: orders.map(order => order.toObject()),
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

        // Assuming getOrder needs a requesting user object for auth, simplified for this context.
        // If getOrder needs the full user, you'd fetch it here.
        const populatedOrder = await Order.findOne({ id: orderId })
            .populate('customerId', 'id name email phone')
            .populate('driverId', 'id name phone vehicleType licensePlate')
            .session(session); // Use the session for consistency

        return { message: `Driver ${driver.name} assigned to order ${orderId}.`, order: populatedOrder.toObject() };

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
    .limit(2)
    .select('orderDate status');

    return orders.map(order => order.toObject());
  } catch (error) {
    logger.error(`[ORDER_SERVICE] Error fetching consumption data for customer ${customerId}:`, error);
    throw new HttpError(500, 'Failed to retrieve order data for gas level calculation.');
  }
};

module.exports = {
  getOrders,
  getOrder,
  processPayment,
  submitFeedback,
  getLocationHistory,
  driverUpdateOrderStatus,
  adminGetOrders,
  adminUpdateOrderStatus,
  adminAssignDriver,
  cancelOrder,
  getCustomerConsumptionData,
};


