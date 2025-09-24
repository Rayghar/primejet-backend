// src/api/v1/users/address.controller.js
const addressService = require('./address.service'); // Path to co-located service
const HttpError = require('../../../utils/HttpError'); // Path to global HttpError utility

const getAddresses = async (req, res, next) => {
  try {
    // req.user.id is populated by authMiddleware and assumed to be the customer's ID
    const addresses = await addressService.getAddresses(req.user.id);
    res.status(200).json(addresses);
  } catch (error) {
    next(error); // Pass error to the centralized error handler
  }
};

const createAddress = async (req, res, next) => {
  try {
    // req.user.id is the customer's ID
    // req.body contains the address data (validated by Joi in address.routes.js)
    const address = await addressService.createAddress(req.user.id, req.body);
    res.status(201).json(address);
  } catch (error) {
    next(error);
  }
};

const updateAddress = async (req, res, next) => {
  try {
    const { addressId } = req.params;
    // req.user.id is the customer's ID
    // req.body contains the updated address data (validated by Joi in address.routes.js)
    const updatedAddress = await addressService.updateAddress(req.user.id, addressId, req.body);
    // The service updateAddress in your original code didn't return the updated address,
    // but it's often useful to do so. If it doesn't, a simple success message is fine.
    if (updatedAddress) { // Assuming service might be changed to return the updated document
        res.status(200).json(updatedAddress);
    } else {
        res.status(200).json({ message: 'Address updated successfully' });
    }
  } catch (error) {
    next(error);
  }
};

const deleteAddress = async (req, res, next) => {
  try {
    const { addressId } = req.params;
    const result = await addressService.deleteAddress(req.user.id, addressId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const setDefaultAddress = async (req, res, next) => {
  try {
    const { addressId } = req.params;
    // req.user.id is the customer's ID
    await addressService.setDefaultAddress(req.user.id, addressId);
    res.status(200).json({ message: 'Default address set successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
};