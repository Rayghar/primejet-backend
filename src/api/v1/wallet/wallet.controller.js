// src/api/v1/wallet/wallet.controller.js
const walletService = require('./wallet.service');
const HttpError = require('../../../utils/HttpError');

// ... getWallet, initializeTopUp, confirmTopUp controllers remain the same ...
const getWallet = async (req, res, next) => {
  try {
    const walletDetails = await walletService.getWallet(req.user.id);
    res.status(200).json(walletDetails);
  } catch (error) {
    next(error);
  }
};

const initializeTopUp = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const result = await walletService.initializeTopUp(req.user.id, amount);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const confirmTopUp = async (req, res, next) => {
  try {
    const { transactionId, paymentGatewayReference } = req.body;
    const updatedWalletDetails = await walletService.confirmTopUp(
      req.user.id,
      transactionId,
      paymentGatewayReference
    );
    res.status(200).json(updatedWalletDetails);
  } catch (error) {
    next(error);
  }
};


// ### NEW CONTROLLER FOR ADMIN CREDIT ###
const adminCreditWallet = async (req, res, next) => {
  try {
    const result = await walletService.adminCreditWallet(req.body);
    res.status(200).json(result);
  } catch(error) {
    next(error);
  }
};

module.exports = {
  getWallet,
  initializeTopUp,
  confirmTopUp,
  adminCreditWallet, // Export the new controller
};