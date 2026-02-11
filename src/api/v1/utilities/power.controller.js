// File: src/api/v1/utilities/power.controller.js
const powerService = require('./power.service');

/**
 * Get Electricity Billers
 */
const getBillers = async (req, res) => {
  try {
    const category = req.query.category || 'ELECTRICITY';
    const billers = await powerService.getElectricityBillers(category);

    return res.status(200).json({
      success: true,
      billers,
    });
  } catch (error) {
    console.error('[Power Controller] Get billers error:', error.message);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Validate Meter
 * NOTE:
 * - discoCode MUST be Monnify billerCode (e.g. biller-ekedc-pre)
 * - productCode is derived internally (PREPAID_ELECTRICITY / POSTPAID_ELECTRICITY)
 */
const validateMeter = async (req, res) => {
  try {
    const meterNumber = req.body.meterNumber || req.body.meter;
    const billerCode = req.body.discoCode || req.body.disco;
    const meterType = req.body.meterType || 'prepaid';

    if (!meterNumber || !billerCode) {
      return res.status(400).json({ error: 'Missing meterNumber or billerCode' });
    }

    const result = await powerService.validateMeter(
      meterNumber,
      billerCode,
      meterType
    );

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('[Power Controller] Validate meter error:', error.message);
    return res.status(400).json({ error: `Validation Failed: ${error.message}` });
  }
};

/**
 * Create Power Order
 */
const createOrder = async (req, res) => {
  try {
    const { meterNumber, discoCode, amount, phone, meterName, meterType } = req.body;

    if (!meterNumber || !discoCode || !amount || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await powerService.createPendingOrder({
      meterNumber,
      billerCode: discoCode,
      amount,
      phone,
      meterName,
      meterType: meterType || 'prepaid',
      userId: req.user?.id,
    });

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('[Power Controller] Create order error:', error.message);
    return res.status(400).json({ error: `Order Failed: ${error.message}` });
  }
};

const retryVending = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    const result = await powerService.retryVending(orderId);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({ error: `Retry Failed: ${error.message}` });
  }
};

module.exports = {
  getBillers,
  validateMeter,
  createOrder,
  retryVending,
};
