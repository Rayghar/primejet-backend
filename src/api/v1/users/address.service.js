// src/api/v1/users/address.service.js
const { v4: uuidv4 } = require('uuid');
const Address = require('../../../models/address.model'); // Adjusted path to global models
const User = require('../../../models/user.model');    // Adjusted path to global models
const HttpError = require('../../../utils/HttpError');  // Adjusted path to global utils
// const { logger } = require('../../../config/logger.config'); // Optional: For structured logging

const getAddresses = async (userId) => {
  try {
    const addresses = await Address.find({ userId }).sort({ createdAt: -1 }); // Optional: sort by creation date
    return addresses;
  } catch (error) {
    // logger.error(`Error fetching addresses for userId ${userId}:`, error);
    console.error('Unexpected error in getAddresses:', error); // Fallback logging
    throw new HttpError(500, 'Failed to retrieve addresses due to an unexpected error.');
  }
};

const createAddress = async (userId, addressData) => {
  // Input validation (required fields, formats) is assumed to be handled by Joi
  // in address.validation.js at the route level.
  const { label, fullAddress, street, city, state, country, isDefault = false, latitude, longitude } = addressData;

  try {
    const newAddress = new Address({
      id: uuidv4(),
      userId,
      label,
      fullAddress,
      street,
      city,
      state,
      country,
      isDefault,
      latitude,
      longitude,
    });

    await newAddress.save();

    if (isDefault) {
      // If this new address is set as default, update other addresses for the user
      await Address.updateMany({ userId, id: { $ne: newAddress.id } }, { $set: { isDefault: false } });
      // Update the defaultAddressId on the User model
      await User.updateOne({ id: userId }, { $set: { defaultAddressId: newAddress.id } });
    }

    return newAddress.toObject(); // Return the plain JS object
  } catch (error) {
    // logger.error(`Error creating address for userId ${userId}:`, error);
    console.error('Unexpected error in createAddress:', error);
    throw new HttpError(500, 'Failed to create address due to an unexpected error.');
  }
};

const updateAddress = async (userId, addressId, addressData) => {
  // Input validation for addressData fields is primarily handled by Joi at the route level.
  // Service ensures address belongs to the user and updates.
  const { isDefault, ...updateFields } = addressData;

  try {
    const address = await Address.findOne({ id: addressId, userId });
    if (!address) {
      throw new HttpError(404, 'Address not found or you do not have permission to update it.');
    }

    // Update specific fields
    Object.keys(updateFields).forEach(key => {
      if (updateFields[key] !== undefined) { // Only update fields that are actually provided
        address[key] = updateFields[key];
      }
    });

    // Handle isDefault separately due to interactions with other addresses and User model
    if (typeof isDefault === 'boolean' && address.isDefault !== isDefault) {
      address.isDefault = isDefault;
      if (isDefault) {
        // Set this address as default
        await Address.updateMany({ userId, id: { $ne: addressId } }, { $set: { isDefault: false } });
        await User.updateOne({ id: userId }, { $set: { defaultAddressId: addressId } });
      } else {
        // If this address is being unset as default, check if it was the default
        // and potentially clear defaultAddressId on User if no other address is default.
        // Or, the application might require another address to be explicitly set as default.
        // For simplicity, if unsetting, we'll just update this address.
        // The User.defaultAddressId might become stale if this was the default,
        // requiring logic to pick a new default or clear it.
        // For now, we just unset it on the address. If it was the default on User model,
        // it might need explicit clearing or re-assignment logic here or in setDefaultAddress.
        const user = await User.findOne({ id: userId });
        if (user && user.defaultAddressId === addressId) {
            await User.updateOne({ id: userId }, { $set: { defaultAddressId: null } }); // Or set to another address
        }
      }
    }

    await address.save();
    return address.toObject(); // Return the updated address
  } catch (error) {
    // logger.error(`Error updating address ${addressId} for userId ${userId}:`, error);
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in updateAddress:', error);
    throw new HttpError(500, 'Failed to update address due to an unexpected error.');
  }
};

const setDefaultAddress = async (userId, addressIdToSetAsDefault) => {
  try {
    const addressToSet = await Address.findOne({ id: addressIdToSetAsDefault, userId });
    if (!addressToSet) {
      throw new HttpError(404, 'Address not found or you do not have permission to set it as default.');
    }

    if (addressToSet.isDefault) {
      return { message: 'Address is already the default.', address: addressToSet.toObject() };
    }

    // Start a transaction if your DB supports it for atomicity, or handle carefully.
    // For Mongoose without explicit transactions here, ensure operations are idempotent or handle potential partial failures.

    // Unset other default addresses for the user
    await Address.updateMany(
      { userId, id: { $ne: addressIdToSetAsDefault }, isDefault: true },
      { $set: { isDefault: false } }
    );

    // Set the new address as default
    addressToSet.isDefault = true;
    await addressToSet.save();

    // Update the defaultAddressId on the User model
    await User.updateOne({ id: userId }, { $set: { defaultAddressId: addressIdToSetAsDefault } });

    return { message: 'Default address set successfully.', address: addressToSet.toObject() };
  } catch (error) {
    // logger.error(`Error setting default address ${addressIdToSetAsDefault} for userId ${userId}:`, error);
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in setDefaultAddress:', error);
    throw new HttpError(500, 'Failed to set default address due to an unexpected error.');
  }
};

// It seems deleteAddress was not in your original controller/routes, but it's a common function.
// If needed, it would look something like this:
const deleteAddress = async (userId, addressIdToDelete) => {
  try {
    const address = await Address.findOne({ id: addressIdToDelete, userId });
    if (!address) {
      throw new HttpError(404, 'Address not found or you do not have permission to delete it.');
    }

    await Address.deleteOne({ id: addressIdToDelete, userId });

    // If the deleted address was the default, clear the defaultAddressId on the User model
    // Or, implement logic to set another address as default.
    const user = await User.findOne({ id: userId });
    if (user && user.defaultAddressId === addressIdToDelete) {
      await User.updateOne({ id: userId }, { $set: { defaultAddressId: null } });
    }

    return { message: 'Address deleted successfully.' };
  } catch (error) {
    // logger.error(`Error deleting address ${addressIdToDelete} for userId ${userId}:`, error);
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in deleteAddress:', error);
    throw new HttpError(500, 'Failed to delete address due to an unexpected error.');
  }
};


module.exports = {
  getAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress, // Added for completeness, ensure you add route and controller if used
};