// File: src/api/v1/users/address.service.js

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const Address = require('../../../models/address.model');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');

// Util to fetch geolocation and metadata from Google Geocoding API
async function geocodeAddressFromGoogle(addressText) {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressText)}&key=${apiKey}`;
    const res = await axios.get(url);
    const data = res.data;

    if (data.status === 'OK' && data.results.length > 0) {
      const result = data.results[0];
      return {
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        components: result.address_components,
      };
    }
  } catch (err) {
    console.error('Google Geocoding API failed:', err.message);
  }
  return null;
}

function extractComponent(components, type) {
  const match = components.find(c => c.types.includes(type));
  return match ? match.long_name : '';
}

const getAddresses = async (userId) => {
  try {
    return await Address.find({ userId }).sort({ createdAt: -1 });
  } catch (error) {
    console.error('Unexpected error in getAddresses:', error);
    throw new HttpError(500, 'Failed to retrieve addresses due to an unexpected error.');
  }
};

const createAddress = async (userId, addressData) => {
  const { label, fullAddress, street, city, state, country, isDefault = false, latitude, longitude } = addressData;

  let finalLat = latitude;
  let finalLng = longitude;
  let enrichedComponents = null;

  if ((!latitude || !longitude) && fullAddress) {
    const geocoded = await geocodeAddressFromGoogle(fullAddress);
    if (geocoded) {
      finalLat = geocoded.lat;
      finalLng = geocoded.lng;
      enrichedComponents = geocoded.components;
    }
  }

  if (!finalLat || !finalLng) {
    throw new HttpError(400, 'Address could not be resolved. Please select a valid address.');
  }

  const newAddress = new Address({
    id: uuidv4(),
    userId,
    label,
    fullAddress,
    street,
    city: city || extractComponent(enrichedComponents, 'locality'),
    state: state || extractComponent(enrichedComponents, 'administrative_area_level_1'),
    country: country || extractComponent(enrichedComponents, 'country'),
    postalCode: addressData.postalCode || extractComponent(enrichedComponents, 'postal_code'),
    latitude: finalLat,
    longitude: finalLng,
    isDefault,
    deliveryInstructions: addressData.deliveryInstructions,
  });

  try {
    await newAddress.save();

    if (isDefault) {
      await Address.updateMany({ userId, id: { $ne: newAddress.id } }, { $set: { isDefault: false } });
      await User.updateOne({ id: userId }, { $set: { defaultAddressId: newAddress.id } });
    }

    return newAddress.toObject();
  } catch (error) {
    console.error('Unexpected error in createAddress:', error);
    throw new HttpError(500, 'Failed to create address due to an unexpected error.');
  }
};

const updateAddress = async (userId, addressId, addressData) => {
  const { isDefault, ...updateFields } = addressData;

  try {
    const address = await Address.findOne({ id: addressId, userId });
    if (!address) throw new HttpError(404, 'Address not found or unauthorized.');

    Object.keys(updateFields).forEach(key => {
      if (updateFields[key] !== undefined) {
        address[key] = updateFields[key];
      }
    });

    if (typeof isDefault === 'boolean' && address.isDefault !== isDefault) {
      address.isDefault = isDefault;
      if (isDefault) {
        await Address.updateMany({ userId, id: { $ne: addressId } }, { $set: { isDefault: false } });
        await User.updateOne({ id: userId }, { $set: { defaultAddressId: addressId } });
      } else {
        const user = await User.findOne({ id: userId });
        if (user && user.defaultAddressId === addressId) {
          await User.updateOne({ id: userId }, { $set: { defaultAddressId: null } });
        }
      }
    }

    await address.save();
    return address.toObject();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in updateAddress:', error);
    throw new HttpError(500, 'Failed to update address due to an unexpected error.');
  }
};

const setDefaultAddress = async (userId, addressIdToSetAsDefault) => {
  try {
    const addressToSet = await Address.findOne({ id: addressIdToSetAsDefault, userId });
    if (!addressToSet) throw new HttpError(404, 'Address not found or unauthorized.');

    if (!addressToSet.isDefault) {
      await Address.updateMany(
        { userId, id: { $ne: addressIdToSetAsDefault }, isDefault: true },
        { $set: { isDefault: false } }
      );

      addressToSet.isDefault = true;
      await addressToSet.save();
      await User.updateOne({ id: userId }, { $set: { defaultAddressId: addressIdToSetAsDefault } });
    }

    return { message: 'Default address set successfully.', address: addressToSet.toObject() };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in setDefaultAddress:', error);
    throw new HttpError(500, 'Failed to set default address.');
  }
};

const deleteAddress = async (userId, addressIdToDelete) => {
  try {
    const address = await Address.findOne({ id: addressIdToDelete, userId });
    if (!address) throw new HttpError(404, 'Address not found or unauthorized.');

    await Address.deleteOne({ id: addressIdToDelete, userId });

    const user = await User.findOne({ id: userId });
    if (user && user.defaultAddressId === addressIdToDelete) {
      await User.updateOne({ id: userId }, { $set: { defaultAddressId: null } });
    }

    return { message: 'Address deleted successfully.' };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Unexpected error in deleteAddress:', error);
    throw new HttpError(500, 'Failed to delete address.');
  }
};

module.exports = {
  getAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
};
