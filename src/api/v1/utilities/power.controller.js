// File: src/api/v1/utilities/power.controller.js
const powerService = require('./power.service');

/**
 * IMPORTANT:
 * Flutter sends Monnify biller codes like: biller-ekedc-pre / biller-ekedc-post
 * Do NOT convert those to legacy internal codes anymore.
 * We will resolve productCode in power.service.js using /biller-products endpoint.
 */
const resolveProviderCode = (providerCode) => {
  if (!providerCode) return providerCode;
  const c = providerCode.toString().trim();

  // ✅ If it is already a Monnify biller code, keep it as-is
  if (c.toLowerCase().startsWith('biller-')) return c;

  // Otherwise, return as-is (legacy/internal codes still supported by service)
  return c;
};

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

const validateMeter = async (req, res) => {
  try {
    const meterNumber = req.body.meterNumber || req.body.meter;
    const discoCode = req.body.discoCode || req.body.disco;
    const meterType = req.body.meterType || req.body.type; // optional

    if (!meterNumber || !discoCode) {
      return res.status(400).json({ error: 'Missing meterNumber or discoCode' });
    }

    const normalizedDisco = resolveProviderCode(discoCode);

    const result = await powerService.validateMeter(meterNumber, normalizedDisco, meterType);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('[Power Controller] Validate meter error:', error.message);
    return res.status(400).json({ error: `Validation Failed: ${error.message}` });
  }
};

const createOrder = async (req, res) => {
  try {
    const { meterNumber, discoCode, amount, phone, meterName, meterType } = req.body;

    const normalizedDisco = resolveProviderCode(discoCode);

    if (!meterNumber || !normalizedDisco || !amount || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await powerService.createPendingOrder({
      meterNumber,
      discoCode: normalizedDisco,
      amount,
      phone,
      meterName,
      meterType: meterType || 'prepaid',
      userId: req.user?.id || null,
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
  resolveProviderCode,
};
