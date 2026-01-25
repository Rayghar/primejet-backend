// File: src/api/v1/utilities/power.controller.js

const powerService = require("./power.service");

/**
 * ✅ Legacy endpoints (kept)
 * These now internally call the VTpass service methods
 * to ensure backward compatibility.
 */
exports.validateMeter = async (req, res) => {
  try {
    const { meterNumber, discoCode } = req.body;

    const data = await powerService.vtpassVerifyMeter({
      meterNumber,
      discoCode,
      type: "prepaid",
    });

    return res.status(200).json({
      success: true,
      message: "Meter verified successfully",
      data,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Meter verification failed",
    });
  }
};

exports.createPowerOrder = async (req, res) => {
  try {
    const { meterNumber, discoCode, amount, phone, meterName } = req.body;

    const data = await powerService.vtpassPurchaseElectricity({
      meterNumber,
      discoCode,
      type: "prepaid",
      amount,
      phone,
      meterName,
    });

    return res.status(201).json({
      success: true,
      message: "Power order created successfully",
      data,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Power order failed",
    });
  }
};

/**
 * ✅ NEW VTpass endpoints
 */
exports.vtpassVerifyMeter = async (req, res) => {
  try {
    const { meterNumber, serviceId, type } = req.body;

    const data = await powerService.vtpassVerifyMeterDirect({
      meterNumber,
      serviceId,
      type,
    });

    return res.status(200).json({
      success: true,
      message: "Meter verified successfully",
      data,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Meter verification failed",
    });
  }
};

exports.vtpassPurchase = async (req, res) => {
  try {
    const { meterNumber, serviceId, type, amount, phone } = req.body;

    const data = await powerService.vtpassPurchaseDirect({
      meterNumber,
      serviceId,
      type,
      amount,
      phone,
    });

    return res.status(201).json({
      success: true,
      message: "Electricity purchase successful",
      data,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Electricity purchase failed",
    });
  }
};

exports.vtpassRequeryStatus = async (req, res) => {
  try {
    const { requestId } = req.params;

    const data = await powerService.vtpassRequeryStatus({ requestId });

    return res.status(200).json({
      success: true,
      message: "Status query successful",
      data,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Status query failed",
    });
  }
};

exports.retryVending = async (req, res) => {
  try {
    const { orderId } = req.body;

    await powerService.retryVending({ orderId });

    return res.status(200).json({
      success: true,
      message: "Retry triggered successfully",
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Retry failed",
    });
  }
};