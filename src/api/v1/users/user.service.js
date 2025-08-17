// src/api/v1/users/user.service.js
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const Order = require('../../../models/order.model');
const Address = require('../../../models/address.model');
// Import `firestore` and `isFirebaseInitialized` from firebase.config.js
const { firestore, isFirebaseInitialized } = require('../../../config/firebase.config');
const { logger } = require('../../../config/logger.config');
const agentService = require('../../v1/agents/agent.service'); // Import agent service
const referralService = require('../../v1/referrals/referral.service'); // Import referral service

const getProfile = async (userId) => {
  try {
    const user = await User.findOne({ id: userId }).select('-password');
    if (!user) {
      throw new HttpError(404, 'User profile not found.');
    }

    // << MODIFIED: Check for any previous completed orders >>
    const pastOrderCount = await Order.countDocuments({
      customerId: userId,
      status: { $in: ['Delivered', 'Processing', 'Driver Assigned', 'Out for Delivery', 'Completed'] }
    });

    const userObject = user.toObject();
    userObject.isFirstTimeCustomer = pastOrderCount === 0; // Add the new flag

    return userObject;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in getProfile:', error);
    throw new HttpError(500, 'Failed to retrieve profile due to an unexpected error.');
  }
};

const registerUser = async (userData, options = {}) => {
  const { email, role, referredByCode, agentCode } = userData; // Includes agentCode

  let existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new HttpError(409, 'User with this email already exists.');
  }

  if (role === 'admin' && !options.allowFirstAdmin) {
    const adminCount = await User.countDocuments({ role: 'admin' });
    if (adminCount > 0) {
      throw new HttpError(403, 'Admin accounts can only be created by an existing admin.');
    }
  }

  // Handle customer-to-customer referral code if provided for a new customer
  if (role === 'customer' && referredByCode) {
    const referrerReferral = await referralService.getReferralByCode(referredByCode); // Call referralService
    if (referrerReferral && referrerReferral.isActive) {
      userData.referredBy = referrerReferral.userId;
      referrerReferral.totalReferredCount = (referrerReferral.totalReferredCount || 0) + 1;
      await referrerReferral.save();
    } else {
      logger.warn(`[USER_SERVICE] Invalid or inactive customer referral code: ${referredByCode}. User not marked as referred.`);
    }
  }

  // Handle agent referral code if provided for a new customer
  if (role === 'customer' && agentCode) {
    const agent = await agentService.trackAgentLinkClick(agentCode, {
      // Metadata (e.g., IP, user agent) would typically come from req.ip, req.headers['user-agent'] in the controller
    });
    if (agent && agent.isActive) {
      userData.referredByAgentId = agent.id; // Link customer to agent
    } else {
      logger.warn(`[USER_SERVICE] Invalid or inactive agent code: ${agentCode}. Customer not attributed to agent.`);
    }
  }

  const newUser = new User(userData);
  await newUser.save();

  // Mark customer as registered by agent after user is saved
  if (role === 'customer' && agentCode && newUser.referredByAgentId) {
    await agentService.markCustomerRegisteredByAgent(agentCode, newUser.id);
  }

  return newUser.toObject();
};

const updateProfile = async (userId, updateData) => {
  try {
    const { name, phone, password } = updateData;
    const updates = {};

    if (name) updates.name = name;
    if (phone) updates.phone = phone;
    if (password) {
      updates.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updates).length === 0) {
      throw new HttpError(400, 'No valid fields provided for update.');
    }

    const updatedUser = await User.findOneAndUpdate({ id: userId }, { $set: updates }, {
      new: true,
      runValidators: true,
    }).select('-password');

    if (!updatedUser) {
      throw new HttpError(404, 'User not found for update.');
    }
    return { message: 'Profile updated successfully.', user: updatedUser };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in updateProfile:', error);
    throw new HttpError(500, 'Failed to update profile due to an unexpected error.');
  }
};



const getNotificationPreferences = async (userId) => {
  try {
    const user = await User.findOne({ id: userId }).select('notificationPreferences id');
    if (!user) {
      throw new HttpError(404, 'User not found when fetching notification preferences.');
    }
    return user.notificationPreferences || { orderUpdates: true, promotions: true };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in getNotificationPreferences:', error);
    throw new HttpError(500, 'Failed to retrieve notification preferences.');
  }
};

const updateNotificationPreferences = async (userId, preferencesData) => {
  try {
    const { orderUpdates, promotions } = preferencesData;
    const updates = {};

    if (typeof orderUpdates === 'boolean') {
      updates['notificationPreferences.orderUpdates'] = orderUpdates;
    }
    if (typeof promotions === 'boolean') {
      updates['notificationPreferences.promotions'] = promotions;
    }

    if (Object.keys(updates).length === 0) {
      throw new HttpError(400, 'No valid notification preferences provided for update.');
    }

    const user = await User.findOneAndUpdate({ id: userId }, { $set: updates }, {
      new: true,
      runValidators: true,
    }).select('notificationPreferences id');

    if (!user) {
      throw new HttpError(404, 'User not found for updating notification preferences.');
    }
    return { message: 'Notification preferences updated successfully.', preferences: user.notificationPreferences };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in updateNotificationPreferences:', error);
    throw new HttpError(500, 'Failed to update notification preferences.');
  }
};

// --- Admin Specific Services ---

const adminGetUsers = async (options) => {
  const { role, search, page = 1, limit = 10 } = options;
  try {
    const query = {};
    if (role) query.role = role;
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    const totalUsers = await User.countDocuments(query);

    return {
      users,
      currentPage: page,
      totalPages: Math.ceil(totalUsers / limit),
      totalUsers,
    };
  } catch (error) {
    console.error('Unexpected error in adminGetUsers:', error);
    throw new HttpError(500, 'Failed to retrieve users.');
  }
};

const adminGetUser = async (userId) => {
  try {
    const user = await User.findOne({ id: userId }).select('-password');
    if (!user) {
      throw new HttpError(404, 'User not found by admin.');
    }

    let userObject = user.toObject();

    if (user.defaultAddressId) {
        const defaultAddress = await Address.findOne({ id: user.defaultAddressId });
        if (defaultAddress) {
            userObject.defaultAddress = defaultAddress.toObject();
        }
    }

    if (user.role === 'customer') {
      const customerOrders = await Order.find({ customerId: userId });
      const totalSpent = customerOrders.reduce((sum, order) => sum + (order.finalAmountPaid || 0), 0);

      userObject.totalOrders = customerOrders.length;
      userObject.totalSpent = totalSpent;
      userObject.lastOrderDate = customerOrders.length > 0 ? customerOrders.sort((a, b) => b.orderDate - a.orderDate)[0].orderDate : null;
      userObject.recentOrders = customerOrders.slice(0, 5);
    }

    if (user.role === 'driver') {
      const driverOrders = await Order.find({ driverId: userId, status: 'Delivered' }).sort({ orderDate: -1 });
      const totalEarnings = driverOrders.reduce((sum, order) => sum + (order.deliveryFee || 0), 0);

      let averageRating = 0; // Default value if Firebase fails

      // ========================== FIX IS HERE (Added try-catch for Firebase) ==========================
      if (isFirebaseInitialized && firestore) { // Check if Firebase is initialized and firestore object is available
        try {
          const feedbackSnapshot = await firestore.collection('feedback').where('driverId', '==', userId).get();
          if (!feedbackSnapshot.empty) {
            let totalRating = 0;
            feedbackSnapshot.forEach(doc => {
                totalRating += doc.data().rating;
            });
            averageRating = parseFloat((totalRating / feedbackSnapshot.size).toFixed(2));
          }
        } catch (firebaseError) {
          logger.error(`[USER_SERVICE] Error fetching driver feedback from Firestore for driver ${userId}:`, firebaseError.message);
          // The averageRating will remain its default value (0)
        }
      } else {
        logger.warn(`[USER_SERVICE] Firebase/Firestore not fully initialized. Skipping driver feedback query for driver ${userId}.`);
      }
      // ==============================================================================================

      userObject.totalDeliveriesCompleted = driverOrders.length;
      userObject.totalEarnings = totalEarnings;
      userObject.averageRating = averageRating;
      userObject.lastDeliveryDate = driverOrders.length > 0 ? driverOrders[0].orderDate : null;
      userObject.recentDeliveries = driverOrders.slice(0, 5).map(o => o.toObject());
    }

    return userObject;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    logger.error('Unexpected error in adminGetUser:', { error: error.message, stack: error.stack });
    throw new HttpError(500, 'Failed to retrieve user by admin.');
  }
};

const adminCreateUser = async (userData) => {
  const { name, email, phone, password, role } = userData;

  try {
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      throw new HttpError(409, 'Email already exists for admin user creation.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      id: uuidv4(),
      name,
      email: email.toLowerCase(),
      phone,
      password: hashedPassword,
      role,
    });

    await newUser.save();
    const { password: _, ...userWithoutPassword } = newUser.toObject();
    return userWithoutPassword;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in adminCreateUser:', error);
    throw new HttpError(500, 'Failed to create user by admin.');
  }
};

const adminUpdateUser = async (userId, updateData) => {
  const { name, email, phone, password, role, walletBalance, status, isAvailableOnline, bankDetails } = updateData;
  const updates = {};

  if (name) updates.name = name;
  if (phone) updates.phone = phone;
  if (password) updates.password = await bcrypt.hash(password, 10);
  if (role) updates.role = role;
  if (typeof walletBalance === 'number') updates.walletBalance = walletBalance;
  if (status) updates.status = status;
  if (typeof isAvailableOnline === 'boolean') updates.isAvailableOnline = isAvailableOnline;
  if (bankDetails) updates.bankDetails = bankDetails;

  if (email) {
    const existingUserWithEmail = await User.findOne({ email: email.toLowerCase(), id: { $ne: userId } });
    if (existingUserWithEmail) {
      throw new HttpError(409, 'Email address is already in use by another account.');
    }
    updates.email = email.toLowerCase();
  }


  if (Object.keys(updates).length === 0) {
    throw new HttpError(400, 'No valid fields provided for admin update.');
  }

  try {
    const updatedUser = await User.findOneAndUpdate({ id: userId }, { $set: updates }, {
      new: true,
      runValidators: true,
    }).select('-password');

    if (!updatedUser) {
      throw new HttpError(404, 'User not found for admin update.');
    }
    return { message: 'User updated successfully by admin.', user: updatedUser };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in adminUpdateUser:', error);
    throw new HttpError(500, 'Failed to update user by admin.');
  }
};

const adminUpdateUserStatus = async (userId, status) => {
  try {
    const user = await User.findOneAndUpdate(
      { id: userId },
      { $set: { status } },
      { new: true, runValidators: true }
    ).select('-password status');

    if (!user) {
      throw new HttpError(404, 'User not found for status update by admin.');
    }
    return { message: `User status updated to ${status}.`, user };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in adminUpdateUserStatus:', error);
    throw new HttpError(500, 'Failed to update user status by admin.');
  }
};

const deleteUserById = async (userIdToDelete) => {
  try {
    const user = await User.findOneAndDelete({ id: userIdToDelete });
    if (!user) {
      throw new HttpError(404, 'User not found for deletion.');
    }
    return { message: `User with ID ${userIdToDelete} deleted successfully.` };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in deleteUserById:', error);
    throw new HttpError(500, 'Failed to delete user.');
  }
};

// --- Driver Specific Services ---

const updateDriverAvailability = async (driverId, isAvailableOnline) => {
  try {
    const driver = await User.findOneAndUpdate(
      { id: driverId, role: 'driver' },
      { $set: { isAvailableOnline } },
      { new: true, runValidators: true }
    ).select('id name isAvailableOnline');

    if (!driver) {
      throw new HttpError(404, 'Driver not found or user is not a driver.');
    }
    return { message: `Driver availability updated to ${isAvailableOnline}.`, driver };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in updateDriverAvailability:', error);
    throw new HttpError(500, 'Failed to update driver availability.');
  }
};

const getStartDateForPeriod = (period) => {
  const now = new Date();
  if (period === 'weekly') {
    return new Date(now.setDate(now.getDate() - 7));
  }
  if (period === 'monthly') {
    return new Date(now.setMonth(now.getMonth() - 1));
  }
  return null;
};

const getDriverStats = async (driverId, period = 'allTime') => {
  try {
    const startDate = getStartDateForPeriod(period);
    const dateQuery = startDate ? { orderDate: { $gte: startDate } } : {};

    const totalOrdersExecuted = await Order.countDocuments({
      driverId: driverId,
      status: 'Delivered',
      ...dateQuery
    });

    const totalOrdersCancelled = await Order.countDocuments({
      driverId: driverId,
      status: { $in: ['Cancelled', 'Pickup Failed', 'Delivery Failed'] },
       ...dateQuery
    });

    const deliveredOrders = await Order.find({
      driverId: driverId,
      status: 'Delivered',
      ...dateQuery
    }).select('deliveryFee');
    const totalRevenueMade = deliveredOrders.reduce((sum, order) => sum + (order.deliveryFee || 0), 0);

    const averageRating = 4.7; // Placeholder value

    const acceptanceRate = 0.92; // Placeholder value

    const averageDeliveryTimeMinutes = 35.5; // Placeholder value

    return {
      totalOrdersExecuted,
      totalRevenueMade,
      totalOrdersCancelled,
      averageRating,
      acceptanceRate,
      averageDeliveryTimeMinutes,
    };

  } catch (error) {
    console.error(`Error in getDriverStats for driver ${driverId}:`, error);
    throw new HttpError(500, 'Failed to retrieve driver statistics.');
  }
};

/**
 * Finds a user by email and validates their password.
 * This function is crucial for the login process.
 * @param {string} email - The user's email.
 * @param {string} password - The plain-text password provided by the user.
 * @returns {Promise<User|null>} The user object if credentials are valid, otherwise null.
 */
const findUserByCredentials = async (email, password) => {
    try {
        // Use .select('+password') to explicitly include the password field, as it's set to select: false in schema
        const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
        if (!user) {
            return null; // User not found
        }

        // Compare the provided password with the hashed password in the database
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return null; // Passwords do not match
        }

        // Return the user object, but remove the password before sending it back
        const userObject = user.toObject();
        delete userObject.password;
        return userObject;
    } catch (error) {
        logger.error(`Error in findUserByCredentials for email ${email}:`, error);
        throw new HttpError(500, 'Authentication failed due to server error.');
    }
};




module.exports = {
  getProfile,
  updateProfile,
  getNotificationPreferences,
  updateNotificationPreferences,
  adminGetUsers,
  adminGetUser,
  adminCreateUser: registerUser,
  adminUpdateUser,
  adminUpdateUserStatus,
  deleteUser: deleteUserById,
  updateDriverAvailability,
  getDriverStats,
  registerUser,
  findUserByCredentials,
};