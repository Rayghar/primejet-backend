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
const firebaseService = require('../../../services/firebase.service');
const notificationService = require('../notifications/notification.service');
const paymentService = require('../payments/payment.service'); 
const ServiceZone = require('../../../models/serviceZone.model');
const dotenv = require('dotenv');
const { sha512 } = require('js-sha512');
const { sendNotificationToUser } = require('../../../utils/notification.util');
dotenv.config();

const FCM_FUNCTION_URL = process.env.FCM_FUNCTION_URL;
const FUNCTIONS_SECRET_KEY = process.env.FUNCTIONS_SECRET_KEY;

const initializePayment = async ({ orderId, userId, session }) => {
  logger.info(`[Order Service][initializePayment] Initializing payment for order ${orderId} and user ${userId}.`);
  try {
    const order = await getOrder(orderId, { id: userId, role: 'customer' }, session); 
    const user = await User.findOne({ id: userId }).session(session);
    if (!order || !user) {
      throw new HttpError(404, 'Order or user not found for payment initialization.');
    }
    const dummyAccessCode = 'dummy-auth-url-' + uuidv4();
    logger.info(`[Order Service][initializePayment] Successfully initialized dummy payment for order ${orderId}.`);

    return { accessCode: dummyAccessCode };
  } catch (error) {
    logger.error(`[Order Service][initializePayment] Failed to initialize payment for order ${orderId}: ${error.message}`, { stack: error.stack });
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Payment initialization failed.');
  }
};

const getOrder = async (orderId, requestingUser, session) => {
  try {
    const order = await Order.findOne({ id: orderId })
        .session(session)
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


const placeOrder = async (customerId, orderData) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    logger.info(`[ORDER_PLACE_START] Customer: ${customerId}, Data: ${JSON.stringify(orderData)}`);
    const {
      deliveryAddressId, items, recipientName, recipientPhone, isExpress,
      useWalletBalance, promoCodeApplied, paymentMethod
    } = orderData;
    
    if (!deliveryAddressId) {
      throw new HttpError(400, 'Delivery address ID is required.');
    }
    const deliveryAddress = await Address.findOne({ id: deliveryAddressId, userId: customerId }).session(session);
    if (!deliveryAddress || typeof deliveryAddress.longitude !== 'number' || typeof deliveryAddress.latitude !== 'number') {
      throw new HttpError(400, 'Delivery address is invalid or missing location coordinates.');
    }
    
    const deliveryPoint = {
      type: 'Point',
      coordinates: [deliveryAddress.longitude, deliveryAddress.latitude],
    };

    const coveringZone = await ServiceZone.findOne({
      isActive: true,
      area: { $geoIntersects: { $geometry: deliveryPoint } },
    }).session(session);

    if (!coveringZone) {
      const cfg = await Config.findOne().session(session);
      const message =
        cfg?.outOfZoneDefaultMessage || 'Sorry, we do not currently service this address.';
      throw new HttpError(400, message);
    }
    
    if (typeof coveringZone.deliveryFee !== 'number' || typeof coveringZone.expressSurcharge !== 'number') {
        throw new HttpError(500, 'Service area pricing is not configured correctly. Please contact support.');
    }
    
    const user = await User.findOne({ id: customerId }).select('name phone walletBalance defaultAddressId role referredBy referredByUserId').session(session);
    if (!user) {
      throw new HttpError(404, 'User placing order not found.');
    }
    
    // ... (other validations for user, items, recipient info remain the same) ...

    const config = await Config.findOne().session(session);
    if (!config || !config.feeSettings) {
      throw new HttpError(500, 'System configuration for fees is not available.');
    }

    const priceOverrideMap = new Map(
      (coveringZone.priceOverrides || []).map(override => [override.cylinderId, override.newPrice])
    );
    
    const itemsSubtotal = items.reduce((sum, item) => {
      const effectivePrice = priceOverrideMap.get(item.cylinderId) ?? item.unitPrice;
      return sum + (item.quantity * effectivePrice);
    }, 0);
    
    let discountAmount = 0.0;
    if (promoCodeApplied) {
      const promotion = await Promotion.findOne({ promoCode: promoCodeApplied.toUpperCase(), isActive: true, validFrom: { $lte: new Date() }, validUntil: { $gte: new Date() } }).session(session);
      if (promotion) {
          if (promotion.minOrderAmount != null && itemsSubtotal < promotion.minOrderAmount) {
              logger.info(`[PROMO_NOT_APPLIED] Subtotal ${itemsSubtotal} < min ${promotion.minOrderAmount}`);
          } else {
            if (promotion.type === 'Percentage Discount') discountAmount = itemsSubtotal * (promotion.value / 100);
            else if (promotion.type === 'Fixed Amount') discountAmount = promotion.value;
            discountAmount = Math.min(discountAmount, itemsSubtotal);
          }
      } else {
        logger.warn('[PROMO_INVALID] Code: ' + promoCodeApplied);
        throw new HttpError(400, 'Invalid or expired promo code.');
      }
    }
    
    const subtotalAfterDiscount = itemsSubtotal - discountAmount;
    const vatAmount = subtotalAfterDiscount > 0 ? subtotalAfterDiscount * (config.feeSettings.vatPercentage / 100) : 0;
    const serviceFeeAmount = subtotalAfterDiscount > 0 ? subtotalAfterDiscount * (config.feeSettings.serviceFeePercentage / 100) : 0;
    let deliveryFee = isExpress
        ? coveringZone.deliveryFee + coveringZone.expressSurcharge
        : coveringZone.deliveryFee;
      // 1. Calculate the total quantity of all cylinders in the order.
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

    // 2. If there's more than one cylinder, calculate and add the surcharge.
    if (totalQuantity > 1) {
      // Define the surcharge percentage. 0.50 means 50%.
      // You could make this configurable in the future.
      const surchargePercentage = 0.50;

      // Calculate the surcharge based on the ZONE'S BASE delivery fee (not the express fee).
      const surchargePerItem = coveringZone.deliveryFee * surchargePercentage;

      // Add the total surcharge for all *additional* cylinders.
      deliveryFee += (totalQuantity - 1) * surchargePerItem;
    }

    const overallGrandTotal = subtotalAfterDiscount + vatAmount + serviceFeeAmount + deliveryFee;
    
    let totalBeforeWallet = overallGrandTotal;
    let walletAmountUsed = 0;
    if (useWalletBalance && user.walletBalance > 0) {
      walletAmountUsed = Math.min(user.walletBalance, totalBeforeWallet);
      totalBeforeWallet -= walletAmountUsed;
    }

    let orderStatus = 'Pending Payment';
    let paymentStatusCurrent = 'Pending';
    let isPayOnPickup = false;
    if (paymentMethod === 'payOnPickup') {
      const pastOrderCount = await Order.countDocuments({ customerId: customerId, status: 'Delivered' }).session(session);
      if (pastOrderCount > 0) {
        logger.warn('[PAY_ON_PICKUP_FAIL] Not first order');
        throw new HttpError(403, 'Pay on Arrival is only available for your first order.');
      }
      orderStatus = 'Awaiting Driver Arrival';
      paymentStatusCurrent = 'Pending';
      isPayOnPickup = true;
    }

    const grandTotalToPayByGateway = isPayOnPickup ? 0 : Math.max(0, totalBeforeWallet);
    if (grandTotalToPayByGateway > 0) {
      orderStatus = 'Pending Payment';
    } else if (!isPayOnPickup) {
      orderStatus = 'Order Placed';
      paymentStatusCurrent = 'Completed';
    }
    
    const deliveryAddressSnapshot = {
      fullAddress: deliveryAddress.fullAddress, street: deliveryAddress.street, city: deliveryAddress.city,
      state: deliveryAddress.state, country: deliveryAddress.country, postalCode: deliveryAddress.postalCode,
      latitude: deliveryAddress.latitude, longitude: deliveryAddress.longitude, deliveryInstructions: deliveryAddress.deliveryInstructions,
    };
    
    const newOrder = new Order({
      id: uuidv4(), customerId, deliveryAddressId, deliveryAddressSnapshot, items,
      recipientName: recipientName || user.name, recipientPhone: recipientPhone || user.phone,
      isExpressDelivery: isExpress || false, itemsSubtotal, discountAmount,
      referrerId: user.referredByUserId || null,
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
        const paymentResult = await initializePayment({ orderId: savedOrder.id, userId: customerId, session: session });
        accessCode = paymentResult.accessCode;
      } catch (error) {
        logger.error('[PAYMENT_INIT_FAIL] Order: ' + savedOrder.id + ' Error: ' + error.message);
        throw new HttpError(500, 'Order was created, but payment could not be initialized.');
      }
    }

    await session.commitTransaction();
    logger.info(`[ORDER_PLACE_SUCCESS] ID: ${savedOrder.id} PaymentNeeded: ${grandTotalToPayByGateway > 0 && !isPayOnPickup}`);
    return {
      order: savedOrder.toObject(),
      accessCode: accessCode,
      paymentNeeded: grandTotalToPayByGateway > 0 && !isPayOnPickup,
      grandTotalToPay: grandTotalToPayByGateway,
      message: 'Order placed successfully.'
    };

    
  } catch (error) {
    await session.abortTransaction();
    logger.error(`[ORDER_PLACE_FAIL] Customer ${customerId}: ${error.message}`, { stack: error.stack, inputData: orderData });
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, `Failed to place order: ${error.message}`);
  } finally {
    session.endSession();
  }
};

const driverArrivedForPickup = async (orderId, driverId) => {
  const order = await Order.findOne({ id: orderId, driverId: driverId });
  if (!order) {
    throw new HttpError(404, 'Order not found or not assigned to this driver.');
  }
  if (order.status !== 'Awaiting Driver Arrival') {
    throw new HttpError(400, `Order is not awaiting arrival. Current status: ${order.status}`);
  }

  order.status = 'Pending Payment';
  order.statusHistory.push({
    status: 'Pending Payment',
    timestamp: new Date(),
    notes: 'Driver has arrived. Awaiting customer payment.',
    updatedBy: driverId,
    updaterRole: 'driver'
  });
  await order.save();

  notificationService.createAndSendNotification({
    userId: order.customerId,
    title: "Your Driver Has Arrived!",
    body: "Please complete your payment in the app to proceed with your order.",
    type: 'ORDER_UPDATE',
    data: { orderId: order.id, screen: 'order_details' }
  });

  return order.toObject();
};

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

    if (order.paymentStatus === 'Completed' && paymentDetails?.transactionId && order.paymentDetails?.transactionId === paymentDetails.transactionId) {
        logger.warn(`[Order Service][updateOrderStatus] Order ${orderId} already has paymentStatus 'Completed' with matching transaction ID '${paymentDetails.transactionId}'. Skipping re-update. Aborting transaction.`);
        await session.abortTransaction();
        return order.toObject();
    }
    logger.debug(`[Order Service][updateOrderStatus] Idempotency check passed for order ${orderId}.`);

    if (paymentStatus === 'Completed') {
        logger.info(`[Order Service][updateOrderStatus] Processing successful payment confirmation for order ${orderId}.`);

        const roundedVerifiedAmount = Math.round(verifiedAmount);
        const roundedOrderTotal = Math.round(order.grandTotal);
        if (roundedVerifiedAmount !== roundedOrderTotal) {
            logger.error(`[Order Service][updateOrderStatus] Amount mismatch for order ${orderId}. Expected: ${roundedOrderTotal}, Verified: ${roundedVerifiedAmount}. Txn Ref: ${paymentDetails.transactionId}. Aborting transaction.`);
            order.status = 'Payment Discrepancy';
            order.paymentStatus = 'Failed';
            order.finalAmountPaid = verifiedAmount;
            order.paymentDetails = {
                ...paymentDetails,
                notes: `Amount mismatch. Expected: ${roundedOrderTotal}, Verified: ${roundedVerifiedAmount}. Txn: ${paymentDetails.transactionId}.`,
            };
            order.statusHistory.push({ status: 'Payment Discrepancy', timestamp: new Date(), notes: `Amount mismatch. Expected: ${roundedOrderTotal}, Verified: ${roundedVerifiedAmount}. Txn: ${paymentDetails.transactionId}.` });

            await order.save({ session });
            await session.commitTransaction();
            logger.info(`[Order Service][updateOrderStatus] Order ${orderId} updated to 'Payment Discrepancy' due to amount mismatch.`);
            throw new HttpError(400, 'Verified payment amount does not match order total.');
        }
        logger.debug(`[Order Service][updateOrderStatus] Amount verification passed for order ${orderId}.`);

        if (paymentStatus === 'Completed') {
            const referee = await User.findOne({ id: order.customerId });
            if (referee && referee.referredByAgentId) {
                const completedOrdersCount = await Order.countDocuments({
                    customerId: order.customerId,
                    paymentStatus: 'Completed',
                });
                
                if (completedOrdersCount === 1) {
                    console.log(`[ORDER_SERVICE] Triggering agent's first purchase event for agent ${referee.referredByAgentId}.`);
                    await agentService.recordFirstPurchase(referee.referredByAgentId, referee.id, order);
                }
            }
        }

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
            logger.warn(`[ORDER_SERVICE] Order ${orderId} payment explicitly failed via webhook. Status: '${order.status}', Payment Status: '${order.paymentStatus}'.`);

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

    if (order.referrerId && paymentStatus === 'Completed') {
        logger.debug(`[Order Service][updateOrderStatus] Checking referral for order ${orderId} (referrerId: ${order.referrerId}) after webhook confirmation.`);
        try {
            const completedOrdersCount = await Order.countDocuments({
                customerId: order.customerId,
                paymentStatus: 'Completed',
                status: { $nin: ['Canceled', 'Canceled by Customer', 'Payment Failed'] }
            });

            if (completedOrdersCount === 1) {
                logger.info(`[ORDER_SERVICE][updateOrderStatus] Referee ${order.customerId}'s first completed purchase (${order.id}). Triggering referral credit for referrer ${order.referrerId}.`);
                await referralService.creditReferrerForSuccessfulReferral(order);
            } else {
                logger.debug(`[ORDER_SERVICE][updateOrderStatus] Referee ${order.customerId} has more than one completed order (${completedOrdersCount}). Not crediting referrer for this order.`);
            }
        } catch (referralError) {
            logger.error(`[ORDER_SERVICE][updateOrderStatus] Error processing referral for order ${orderId}: ${referralError.message}`, { stack: referralError.stack });
        }
    }
    return order.toObject();
  } catch (error) {
    await session.abortTransaction();
    logger.error(`[Order Service][updateOrderStatus] Transaction aborted for order ${orderId} due to error. Original error: ${error.message}`, { stack: error.stack, errorObject: error });

    if (error instanceof HttpError) {
        const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
        logger.error(`[Order Service][updateOrderStatus] Propagating HttpError: ${statusCode} - ${error.message}.`);
        throw new HttpError(statusCode, error.message);
    } else {
        logger.error(`[Order Service][updateOrderStatus] Propagating unexpected non-HttpError as HttpError 500: ${error.message}.`);
        throw new HttpError(500, `Failed to update order status due to an unexpected error: ${error.message}`);
    }
  } finally {
    if (session.inTransaction()) {
        logger.warn(`[Order Service][updateOrderStatus] Session still active in finally block for order ${orderId}. Attempting to end session.`);
        try {
            await session.endSession();
        } catch (e) {
            logger.error(`[ORDER_SERVICE] Error ending session for order ${orderId}: ${e.message}`);
        }
    } else {
        logger.debug(`[ORDER_SERVICE] Session ended successfully for order ${orderId}.`);
    }
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

    if (user.referredBy) {
      const completedOrdersCount = await Order.countDocuments({
        customerId: user.id,
        status: { $in: ['Delivered', 'Completed'] },
      }).session(session);

      if (completedOrdersCount === 0) {
        console.log(`[ORDER_SERVICE] Referee ${user.id}'s first completed purchase (${order.id}). Triggering credit for referrer ${user.referredBy}.`);
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

const submitFeedback = async (orderId, feedbackData, userId) => {
  const firestore = firebaseService.getFirestore();
  const session = await Order.startSession();
  session.startTransaction();
  try {
    const order = await Order.findOne({ id: orderId, customerId: userId }).session(session);
    if (!order) {
      throw new HttpError(404, 'Order not found or you are not authorized to submit feedback.');
    }
    if (order.feedback) {
      throw new HttpError(400, 'Feedback has already been submitted for this order.');
    }
    if (order.status !== 'Delivered') {
        throw new HttpError(400, 'Feedback can only be submitted for delivered orders.');
    }
    order.feedback = {
      rating: feedbackData.rating,
      comment: feedbackData.comment,
      date: new Date(),
    };
    await order.save({ session });

    if (order.driverId) {
      const driver = await User.findOne({ id: order.driverId }).session(session);
      if (driver) {
        const currentTotalRating = driver.driverProfile.averageRating * driver.driverProfile.ratingCount;
        const newRatingCount = driver.driverProfile.ratingCount + 1;
        const newAverageRating = (currentTotalRating + feedbackData.rating) / newRatingCount;

        driver.driverProfile.averageRating = parseFloat(newAverageRating.toFixed(2));
        driver.driverProfile.ratingCount = newRatingCount;
        await driver.save({ session });
      }
    }

    await firestore.collection('feedback').add({
      orderId: order.id,
      customerId: userId,
      driverId: order.driverId,
      rating: feedbackData.rating,
      comment: feedbackData.comment,
      createdAt: new Date(),
    });

    await session.commitTransaction();
    session.endSession();
    logger.info(`Feedback submitted successfully for order ${orderId} by user ${userId}.`);
    return order.toObject();

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error(`Error submitting feedback for order ${orderId}:`, error);
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, `Failed to submit feedback: ${error.message}`);
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
        path: 'customer',
        select: 'id name email phone',
        model: 'User',
      })
      .populate({
        path: 'driver',
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

    // The single, correct notification call after a successful commit.
    sendNotificationToUser(
      FCM_FUNCTION_URL, // Pass the FCM URL from env
      FUNCTIONS_SECRET_KEY, // Pass the secret key from env
      order.customerId,
      'Driver Assigned!',
      `Your order #${order.shortOrderId} has been assigned to a driver.`,
      { orderId: orderId, screen: 'order_details' }
    );

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
    order.status = 'Canceled';
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

const markAsVerifyingPayment = async (orderId, customerId) => {
  const order = await Order.findOne({ id: orderId, customerId: customerId });
  if (!order) {
    throw new HttpError(404, 'Order not found or you are not authorized.');
  }
  if (order.status === 'Pending Payment') {
    order.status = 'Verifying Payment';
    order.statusHistory.push({ status: 'Verifying Payment', notes: 'Customer payment initiated, awaiting gateway confirmation.' });
    await order.save();
  }
  return order.toObject();
};

const getCustomerStats = async (customerId) => {
  try {
    const deliveredOrdersQuery = { customerId: customerId, status: 'Delivered' };
    const [totalOrders, lastTwoOrders, totalGasKgResult] = await Promise.all([
      Order.countDocuments(deliveredOrdersQuery),
      Order.find(deliveredOrdersQuery).sort({ orderDate: -1 }).limit(2).select('orderDate items'),
      Order.aggregate([
        { $match: deliveredOrdersQuery },
        { $unwind: '$items' },
        {
          $project: {
            kg: {
              $let: {
                vars: { numericPart: { $regexFind: { input: '$items.productName', regex: /^\d+(\.\d+)?/ } } },
                in: { $toDouble: '$$numericPart.match' }
              }
            },
            quantity: '$items.quantity'
          }
        },
        {
          $group: {
            _id: null,
            totalKg: { $sum: { $multiply: ['$kg', '$quantity'] } }
          }
        }
      ])
    ]);

    let averageDaysBetweenOrders = 0;
    if (lastTwoOrders.length === 2) {
      const latestDate = lastTwoOrders[0].orderDate;
      const previousDate = lastTwoOrders[1].orderDate;
      const diffTime = Math.abs(latestDate - previousDate);
      averageDaysBetweenOrders = diffTime / (1000 * 60 * 60 * 24);
    }

    const totalGasKg = totalGasKgResult.length > 0 ? totalGasKgResult[0].totalKg : 0;
    return {
      totalOrders: totalOrders,
      totalGasKg: totalGasKg.toFixed(1),
      averageDaysBetweenOrders: averageDaysBetweenOrders.toFixed(1)
    };
  } catch (error) {
    logger.error(`[ORDER_SERVICE] Error fetching stats for customer ${customerId}:`, error);
    throw new HttpError(500, 'Failed to retrieve customer statistics.');
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
  getCustomerStats,
  updateOrderStatus,
  getOrderPaymentStatus,
  markAsVerifyingPayment,
  getCustomerStats,
  driverArrivedForPickup,
};