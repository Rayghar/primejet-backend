// File: src/api/v1/users/address.service.js
// (Works even if your actual folder is src/api/v1/addresses — logic is the same)

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const Address = require('../../../models/address.model');
const User = require('../../../models/user.model');
const ServiceZone = require('../../../models/serviceZone.model'); // <-- required for zone checks
const HttpError = require('../../../utils/HttpError');

const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

function isValidNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function isValidLatLng(lat, lng) {
  if (!isValidNumber(lat) || !isValidNumber(lng)) return false;
  // block the common fallback
  if (lat === 0 && lng === 0) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

// Util to fetch geolocation and metadata from Google Geocoding API
async function geocodeAddressFromGoogle(addressText) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, 'Server configuration error: GOOGLE_MAPS_API_KEY is not set.');
  }

  try {
    const url = `${GOOGLE_GEOCODE_URL}?address=${encodeURIComponent(addressText)}&key=${apiKey}`;
    const res = await axios.get(url, { timeout: 15000 });
    const data = res.data;

    if (data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
      const result = data.results[0];
      const lat = result?.geometry?.location?.lat;
      const lng = result?.geometry?.location?.lng;

      return {
        lat,
        lng,
        formattedAddress: result.formatted_address,
        components: result.address_components || [],
        placeId: result.place_id || null,
      };
    }

    // Common helpful messages
    if (data.status === 'ZERO_RESULTS') return null;

    // Any other Google status -> treat as upstream failure (but not leak details)
    throw new HttpError(502, `Google Geocoding failed (${data.status}).`);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // Axios errors
    throw new HttpError(502, `Google Geocoding API request failed: ${err.message}`);
  }
}

function extractComponent(components, type) {
  if (!Array.isArray(components)) return '';
  const match = components.find((c) => Array.isArray(c.types) && c.types.includes(type));
  return match ? match.long_name : '';
}

/**
 * Find the active service zone for a given coordinate.
 * Returns null if outside all zones.
 */
async function findServiceZoneByPoint(lat, lng) {
  // GeoJSON Point is [lng, lat]
  const point = { type: 'Point', coordinates: [lng, lat] };

  // Assumes ServiceZone.area is a Polygon (2dsphere index recommended)
  return ServiceZone.findOne({
    isActive: true,
    area: { $geoIntersects: { $geometry: point } },
  }).lean();
}

/**
 * Resolve an address string (or provided lat/lng) to:
 * - coordinates
 * - normalized fields
 * - service zone (in-zone / out-of-zone)
 *
 * This is what the web checkout should call BEFORE creating the address/order.
 */
const resolveAddress = async (payload = {}) => {
  const {
    addressText,       // e.g. "plot 1..., Ajah, Lagos, Nigeria"
    fullAddress,       // alias
    latitude,
    longitude,
  } = payload;

  let lat = typeof latitude === 'string' ? Number(latitude) : latitude;
  let lng = typeof longitude === 'string' ? Number(longitude) : longitude;
  let enrichedComponents = null;
  let normalizedAddress = fullAddress || addressText || '';

  // 1) If lat/lng are missing/invalid, geocode
  if (!isValidLatLng(lat, lng)) {
    const text = (addressText || fullAddress || '').trim();
    if (!text) {
      throw new HttpError(400, 'Address text is required to resolve location.');
    }

    const geocoded = await geocodeAddressFromGoogle(text);
    if (!geocoded) {
      throw new HttpError(400, 'Address could not be resolved. Please select a valid address.');
    }

    lat = geocoded.lat;
    lng = geocoded.lng;
    enrichedComponents = geocoded.components;
    normalizedAddress = geocoded.formattedAddress || text;
  }

  if (!isValidLatLng(lat, lng)) {
    throw new HttpError(400, 'Address could not be resolved. Please select a valid address.');
  }

  // 2) Zone check
  const zone = await findServiceZoneByPoint(lat, lng);
  const inZone = !!zone;

  return {
    latitude: lat,
    longitude: lng,
    fullAddress: normalizedAddress,
    city: extractComponent(enrichedComponents, 'locality') || extractComponent(enrichedComponents, 'administrative_area_level_2') || '',
    state: extractComponent(enrichedComponents, 'administrative_area_level_1') || '',
    country: extractComponent(enrichedComponents, 'country') || '',
    postalCode: extractComponent(enrichedComponents, 'postal_code') || '',
    inZone,
    serviceZone: zone
      ? {
          id: zone.id,
          name: zone.name,
          state: zone.state,
          deliveryFee: zone.deliveryFee,
          expressSurcharge: zone.expressSurcharge,
          outOfZoneMessage: zone.outOfZoneMessage,
        }
      : null,
    outOfZoneMessage: zone ? null : 'Dear Esteemed Customer, thank you for choosing us. We will get to your service zone soon.',
  };
};

const getAddresses = async (userId) => {
  try {
    return await Address.find({ userId }).sort({ createdAt: -1 });
  } catch (error) {
    throw new HttpError(500, 'Failed to retrieve addresses due to an unexpected error.');
  }
};

const createAddress = async (userId, addressData) => {
  const {
    label,
    fullAddress,
    street,
    city,
    state,
    country,
    isDefault = false,
    latitude,
    longitude,
    deliveryInstructions,
    postalCode,
  } = addressData;

  // Resolve if lat/lng missing or invalid
  const resolved = await resolveAddress({
    addressText: fullAddress,
    latitude: typeof latitude === 'string' ? Number(latitude) : latitude,
    longitude: typeof longitude === 'string' ? Number(longitude) : longitude,
  });

  // OPTIONAL: If you want to hard-block out-of-zone addresses, uncomment:
  // if (!resolved.inZone) {
  //   throw new HttpError(400, resolved.outOfZoneMessage || 'Address is outside our service zones.');
  // }

  const newAddress = new Address({
    id: uuidv4(),
    userId,
    label: label || 'address',
    fullAddress: fullAddress || resolved.fullAddress,
    street: street || '',
    city: city || resolved.city || '',
    state: state || resolved.state || '',
    country: country || resolved.country || 'Nigeria',
    postalCode: postalCode || resolved.postalCode || '',
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    isDefault: Boolean(isDefault),
    deliveryInstructions: deliveryInstructions || '',
  });

  try {
    await newAddress.save();

    if (isDefault) {
      await Address.updateMany({ userId, id: { $ne: newAddress.id } }, { $set: { isDefault: false } });
      await User.updateOne({ id: userId }, { $set: { defaultAddressId: newAddress.id } });
    }

    return newAddress.toObject();
  } catch (error) {
    throw new HttpError(500, 'Failed to create address due to an unexpected error.');
  }
};

const updateAddress = async (userId, addressId, addressData) => {
  const { isDefault, ...updateFields } = addressData;

  try {
    const address = await Address.findOne({ id: addressId, userId });
    if (!address) throw new HttpError(404, 'Address not found or unauthorized.');

    // If user updates fullAddress or lat/lng, re-resolve
    const wantsResolve =
      typeof updateFields.fullAddress === 'string' ||
      updateFields.latitude !== undefined ||
      updateFields.longitude !== undefined;

    if (wantsResolve) {
      const resolved = await resolveAddress({
        addressText: updateFields.fullAddress || address.fullAddress,
        latitude:
          updateFields.latitude !== undefined
            ? (typeof updateFields.latitude === 'string' ? Number(updateFields.latitude) : updateFields.latitude)
            : address.latitude,
        longitude:
          updateFields.longitude !== undefined
            ? (typeof updateFields.longitude === 'string' ? Number(updateFields.longitude) : updateFields.longitude)
            : address.longitude,
      });

      address.fullAddress = updateFields.fullAddress || resolved.fullAddress || address.fullAddress;
      address.latitude = resolved.latitude;
      address.longitude = resolved.longitude;
    }

    // Apply other fields
    Object.keys(updateFields).forEach((key) => {
      if (updateFields[key] !== undefined && !['latitude', 'longitude'].includes(key)) {
        address[key] = updateFields[key];
      }
    });

    // Default logic
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
    throw new HttpError(500, 'Failed to delete address.');
  }
};

const GOOGLE_PLACES_AUTOCOMPLETE =
  'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const GOOGLE_PLACES_DETAILS =
  'https://maps.googleapis.com/maps/api/place/details/json';

const placesAutocomplete = async (input) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;

  const res = await axios.get(GOOGLE_PLACES_AUTOCOMPLETE, {
    params: {
      input,
      key,
      components: 'country:ng',
    },
  });

  return res.data;
};

const placeDetails = async (placeId) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;

  const res = await axios.get(GOOGLE_PLACES_DETAILS, {
    params: {
      place_id: placeId,
      key,
    },
  });

  const result = res.data.result;

  return {
    fullAddress: result.formatted_address,
    latitude: result.geometry.location.lat,
    longitude: result.geometry.location.lng,
  };
};

module.exports = {
  // existing
  getAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,

  // new (for web checkout + parity with mobile)
  resolveAddress,
  placesAutocomplete,
  placeDetails,
};
