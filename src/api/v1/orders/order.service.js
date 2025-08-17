// src/api/v1/orders/order.service.js
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose'); // Required for database sessions (transactions)
const Order = require('../../../models/order.model');
const User = require('../../../models/user.model');
const Run = require('../../../models/run.model'); // <<< THIS LINE IS THE FIX
const Config = require('../../../models/config.model');
const Promotion = require('../../../models/promotion.model');
const Address = require('../../../models/address.model'); // Ensure Address model is imported
const HttpError = require('../../../utils/HttpError');
const { firestore, admin, isFirebaseInitialized } = require('../../../config/firebase.config.js');
const { logger } = require('../../../config/logger.config.js'); // Assuming logger is set up
const referralService = require('../referrals/referral.service'); // For referral logic // MODIFIED: Changed import path to match the service
const paymentService = require('../payments/payment.service'); // Used for Paystack


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

const getOrder = async (orderId, requestingUser) => { // expecting the full user object from middleware
  try {
    const order = await Order.findOne({ id: orderId })
        .populate('customer')
        .populate('driver');

    if (!order) {
      throw new HttpError(404, 'Order not found.');
    }

    // --- AUTHORIZATION LOGIC ---
    // The `requestingUser` object is attached to `req` by the authMiddleware
    if (!requestingUser) {
        throw new HttpError(401, 'Authentication details are missing.');
    }

    // Admins can access any order.
    if (requestingUser.role === 'admin') {
        return order.toObject();
    }

    // Customers can only access their own orders.
    // FIX: Compare the requesting user's ID directly with the order's customerId field.
    if (requestingUser.role === 'customer' && order.customerId !== requestingUser.id) {
      logger.warn(`[ORDER_SERVICE] Unauthorized customer access: User ${requestingUser.id} attempted to access order ${orderId} belonging to ${order.customerId}`);
      throw new HttpError(403, 'You are not authorized to view this order.');
    }

    // Drivers can only access orders they are assigned to.
    if (requestingUser.role === 'driver' && order.driverId !== requestingUser.id) {
      logger.warn(`[ORDER_SERVICE] Unauthorized driver access: Driver ${requestingUser.id} attempted to access order ${orderId} assigned to ${order.driverId}`);
      throw new HttpError(403, 'You are not authorized to view this order.');
    }

    // If none of the above checks failed, the user is authorized.
    return order.toObject();

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
    const {
      deliveryAddressId, items, recipientName, recipientPhone, isExpress,
      useWalletBalance, promoCodeApplied, paymentMethod
    } = orderData;
    
    // << NEW: Service Zone Validation Block >>
    if (!deliveryAddressId) {
        throw new HttpError(400, 'Delivery address ID is required.');
    }
    const deliveryAddress = await Address.findOne({ id: deliveryAddressId, userId: customerId }).session(session);
    if (!deliveryAddress || typeof deliveryAddress.longitude !== 'number' || typeof deliveryAddress.latitude !== 'number') {
      throw new HttpError(400, 'Delivery address is invalid or missing location coordinates.');
    }
    const deliveryPoint = { type: 'Point', coordinates: [deliveryAddress.longitude, deliveryAddress.latitude] };
    const coveringZone = await ServiceZone.findOne({ area: { $geoIntersects: { $geometry: deliveryPoint } }, isActive: true }).session(session);
    if (!coveringZone) {
      const config = await Config.findOne().session(session);
      const message = config?.outOfZoneDefaultMessage || 'Sorry, we do not currently service this address.';
      throw new HttpError(400, message);
    }

    const user = await User.findOne({ id: customerId }).select('name phone walletBalance defaultAddressId role referredBy').session(session);
    if (!user) {
      throw new HttpError(404, 'User placing order not found.');
    }
    if (user.role !== 'customer') {
      throw new HttpError(403, 'Only customers can place orders.');
    }
    if (!items || items.length === 0 || items.some(item => !item.cylinderId || !item.quantity || item.unitPrice == null || !item.productName)) {
      throw new HttpError(400, 'Invalid or missing order items.');
    }
    const effectiveRecipientName = recipientName || user.name;
    const effectiveRecipientPhone = recipientPhone || user.phone;
    if (!effectiveRecipientName || !effectiveRecipientPhone) {
        throw new HttpError(400, 'Recipient name and phone are required.');
    }

    const deliveryAddressSnapshot = {
      fullAddress: deliveryAddress.fullAddress, street: deliveryAddress.street, city: deliveryAddress.city,
      state: deliveryAddress.state, country: deliveryAddress.country, postalCode: deliveryAddress.postalCode,
      latitude: deliveryAddress.latitude, longitude: deliveryAddress.longitude, deliveryInstructions: deliveryAddress.deliveryInstructions,
    };

    const config = await Config.findOne().session(session);
    if (!config || !config.feeSettings) {
      throw new HttpError(500, 'System configuration for fees is not available.');
    }

    let orderStatus = 'Pending Payment';
    let paymentStatusCurrent = 'Pending';
    let isPayOnPickup = false;

    // << NEW: Conditional logic for Pay on Arrival feature >>
    if (paymentMethod === 'payOnPickup') {
      const pastOrderCount = await Order.countDocuments({ customerId: customerId, status: 'Delivered' }).session(session);
      if (pastOrderCount > 0) {
        throw new HttpError(403, 'Pay on Arrival is only available for your first order.');
      }
      orderStatus = 'Awaiting Payment on Arrival';
      paymentStatusCurrent = 'Pending';
      isPayOnPickup = true;
    }

    const itemsSubtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    let discountAmount = 0.0;
    if (promoCodeApplied) {
      const promotion = await Promotion.findOne({ promoCode: promoCodeApplied.toUpperCase(), isActive: true, validFrom: { $lte: new Date() }, validUntil: { $gte: new Date() } }).session(session);
      if (promotion) {
          if (promotion.minOrderAmount != null && itemsSubtotal < promotion.minOrderAmount) {
              logger.info(`[ORDER_SERVICE] Promo ${promoCodeApplied} not applied for order: Subtotal ${itemsSubtotal} is less than minimum ${promotion.minOrderAmount}`);
          } else {
            if (promotion.type === 'Percentage Discount') discountAmount = itemsSubtotal * (promotion.value / 100);
            else if (promotion.type === 'Fixed Amount') discountAmount = promotion.value;
            discountAmount = Math.min(discountAmount, itemsSubtotal);
          }
      } else {
        throw new HttpError(400, 'Invalid or expired promo code.');
      }
    }
    
    const subtotalAfterDiscount = itemsSubtotal - discountAmount;
    const vatAmount = subtotalAfterDiscount * (config.feeSettings.vatPercentage / 100);
    const serviceFeeAmount = subtotalAfterDiscount * (config.feeSettings.serviceFeePercentage / 100);
    const deliveryFee = (isExpress ? config.feeSettings.baseDeliveryFee + config.feeSettings.expressDeliverySurcharge : config.feeSettings.baseDeliveryFee);
    const overallGrandTotal = subtotalAfterDiscount + vatAmount + serviceFeeAmount + deliveryFee;
    let totalBeforeWallet = overallGrandTotal;
    let walletAmountUsed = 0;
    if (useWalletBalance && user.walletBalance > 0) {
      walletAmountUsed = Math.min(user.walletBalance, totalBeforeWallet);
      totalBeforeWallet -= walletAmountUsed;
    }

    const grandTotalToPayByGateway = isPayOnPickup ? 0 : Math.max(0, totalBeforeWallet);
    if (grandTotalToPayByGateway > 0) {
        orderStatus = 'Pending Payment';
    } else if (!isPayOnPickup) {
        orderStatus = 'Order Placed';
        paymentStatusCurrent = 'Completed';
    }

    const newOrder = new Order({
      id: uuidv4(), customerId, deliveryAddressId, deliveryAddressSnapshot, items,
      recipientName: effectiveRecipientName, recipientPhone: effectiveRecipientPhone,
      isExpressDelivery: isExpress || false, itemsSubtotal, discountAmount,
      referrerId: user.referredBy || null,
      promoCodeApplied: discountAmount > 0 ? (promoCodeApplied ? promoCodeApplied.toUpperCase() : null) : null,
      vatAmount, serviceFeeAmount, deliveryFee, walletAmountUsed,
      grandTotal: overallGrandTotal,
      finalAmountPaid: (paymentStatusCurrent === 'Completed') ? (overallGrandTotal - walletAmountUsed) : 0,
      status: orderStatus,
      paymentStatus: paymentStatusCurrent,
      paymentMethod: isPayOnPickup ? 'payOnPickup' : (orderData.paymentMethod || 'paystack'),
      statusHistory: [{ status: orderStatus, timestamp: new Date(), notes: 'Order created.' }],
      deliveryLatitude: deliveryAddress.latitude,
      deliveryLongitude: deliveryAddress.longitude,
      orderDate: new Date(),
    });

    if (walletAmountUsed > 0) {
      user.walletBalance -= walletAmountUsed;
      await user.save({ session });
    }
    const savedOrder = await newOrder.save({ session });
    let accessCode = null;
    if (grandTotalToPayByGateway > 0 && !isPayOnPickup) {
      try {
        const paymentResult = await paymentService.initializePayment({ orderId: savedOrder.id, userId: customerId, session: session });
        accessCode = paymentResult.accessCode;
      } catch (error) {
        logger.error(`Failed to initialize payment for new order ${savedOrder.id}:`, error);
        throw new HttpError(500, 'Order was created, but payment could not be initialized.');
      }
    }

    await session.commitTransaction();
    logger.info(`[ORDER_SERVICE] Order ${savedOrder.id} placed. PaymentNeeded: ${grandTotalToPayByGateway > 0 && !isPayOnPickup}`);
    return {
      order: savedOrder.toObject(),
      accessCode: accessCode,
      paymentNeeded: grandTotalToPayByGateway > 0 && !isPayOnPickup,
      grandTotalToPay: grandTotalToPayByGateway,
      message: 'Order placed successfully.'
    };
  } catch (error) {
    await session.abortTransaction();
    logger.error(`[ORDER_SERVICE] Place order error for customer ${customerId}:`, {error: error.message, stack: error.stack, inputOrderData: orderData});
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, `Failed to place order: ${error.message}`);
  } finally {
    session.endSession();
  }
};

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
      throw new HttpError(400, 'Payment for this order has already been completed.');
    }

    order.status = 'Order Placed';
    order.paymentStatus = 'Completed';
    order.finalAmountPaid = (order.finalAmountPaid || 0) + paymentData.amount;
    order.paymentTransactionId = paymentData.transactionId;
    order.statusHistory.push({ status: 'Order Placed', timestamp: new Date(), notes: `Payment confirmed with transaction ID: ${paymentData.transactionId}` });
    if(!order.statusHistory.find(h => h.status === 'Payment Completed')) {
        order.statusHistory.push({ status: 'Payment Completed', timestamp: new Date(), notes: `Ref: ${paymentData.transactionId}` });
    }

    await order.save({ session });

    // <<< START MODIFICATION: First Purchase Check and Referrer Credit >>>
    if (user.referredBy) { // Check if this customer was referred
      const completedOrdersCount = await Order.countDocuments({
        customerId: user.id,
        status: { $in: ['Delivered', 'Completed'] },
      }).session(session);

      // We check for count === 0 BEFORE saving the new status. 
      // After this order is marked completed, the count will be 1.
      // So, if the count is currently 0, this is their first one.
      if (completedOrdersCount === 0) {
        console.log(`[ORDER_SERVICE] Referee ${user.id}'s first purchase (${order.id}). Triggering credit for referrer ${user.referredBy}.`);
        order.referrerId = user.referredBy; // Pass referrer info to the service
        await referralService.creditReferrerForSuccessfulReferral(order, session); // Pass session for transaction
      }
    }
    // <<< END MODIFICATION >>>

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
const submitFeedback = async (orderId, feedbackData, customerId, customerRole) => { /* ... as previously provided ... */   try {
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
const getLocationHistory = async (orderId, requestingUserId, requestingUserRole) => { /* ... as previously provided ... */   try {
    const order = await Order.findOne({ id: orderId });
    if (!order) throw new HttpError(404, 'Order not found for location history.');
    if (requestingUserRole === 'customer' && order.customerId !== requestingUserId) { // Assuming customerId on order is a string ID
      throw new HttpError(403, 'You are not authorized to view location history for this order.');
    }
    if (requestingUserRole === 'driver' && order.driverId !== requestingUserId) { // Assuming driverId on order is a string ID
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
const driverUpdateOrderStatus = async (orderId, newStatus, notes, driverId, driverRole) => { /* ... as previously provided ... */   const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (driverRole !== 'driver') throw new HttpError(403, 'Only drivers can update order status via this method.');
    const order = await Order.findOne({ id: orderId, driverId }).session(session);
    if (!order) throw new HttpError(404, 'Order not found or not assigned to this driver.');
    order.status = newStatus;
    order.statusHistory.push({ status: newStatus, timestamp: new Date(), notes: notes || `Status updated by driver ${driverId}`, updatedBy: driverId, updaterRole: 'driver' });
    if (newStatus === 'Delivered') order.actualDeliveryTime = new Date();
    await order.save({ session });
    await session.commitTransaction();
    // TODO: Notify customer
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
const adminGetOrders = async (options) => { /* ... as previously provided ... */   const { status, search, dateRangeStart, dateRangeEnd, page = 1, limit = 10, sortBy } = options; // Added sortBy
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
const adminUpdateOrderStatus = async (orderId, newStatus, notes, adminId, adminRole) => { /* ... as previously provided ... */   const session = await mongoose.startSession();
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
    // TODO: Notify customer/driver
    return { message: `Order ${orderId} status updated to ${newStatus} by admin.`, order: order.toObject() };
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

        // 1. Update Order
        order.driverId = driverIdToAssign;
        order.status = 'Driver Assigned';
        const note = `Driver ${driver.name} (ID: ${driverIdToAssign}) assigned by admin ${adminId}.`;
        order.statusHistory.push({ status: 'Driver Assigned', timestamp: new Date(), notes: note, updatedBy: adminId, updaterRole: 'admin' });
        await order.save({ session });

        // 2. Create a new Run document
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

        const populatedOrder = await getOrder(orderId, adminId, 'admin');
        return { message: `Driver ${driver.name} assigned to order ${orderId}.`, order: populatedOrder };

    } catch (error) {
          await session.abortTransaction();
        logger.error('Unexpected error in adminAssignDriver:', { error: error.message, stack: error.stack, orderId });
        if (error instanceof HttpError) throw error;
        // --- MODIFIED: Pass the actual Mongoose validation error message to the client ---
        if (error.name === 'ValidationError') {
            throw new HttpError(400, error.message);
        }
        throw new HttpError(500, 'Failed to assign driver by admin.');
    } finally {
        session.endSession();
    }
};

const cancelOrder = async (orderId, customerId, customerRole) => { /* ... as previously provided ... */   const session = await mongoose.startSession();
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
            // TODO: Create wallet transaction log for this refund
            await user.save({ session }); // MODIFIED: Moved save inside if (user) block to prevent potential errors
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

/**
 * Retrieves the last two delivered orders for a customer to calculate consumption rate.
 * @param {string} customerId - The ID of the customer.
 * @returns {Promise<Array<object>>} An array containing the last two delivered orders.
 */
const getCustomerConsumptionData = async (customerId) => {
  try {
    const orders = await Order.find({
      customerId: customerId,
      status: 'Delivered'
    })
    .sort({ orderDate: -1 }) // Sort by most recent first
    .limit(2) // Limit to only the last two
    .select('orderDate status'); // Select only the fields we need

    return orders.map(order => order.toObject());
  } catch (error) {
    logger.error(`[ORDER_SERVICE] Error fetching consumption data for customer ${customerId}:`, error);
    throw new HttpError(500, 'Failed to retrieve order data for gas level calculation.');
  }
};

module.exports = {
  getOrders,
  getOrder,
  placeOrder,
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