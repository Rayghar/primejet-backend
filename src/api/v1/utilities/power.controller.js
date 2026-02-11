// File: src/api/v1/utilities/power.controller.js
const powerService = require('./power.service');

/**
 * Monnify Billers return codes like: biller-ekedc-pre / biller-ekedc-post.
 * Our backend historically used internal provider codes (e.g. eko_electric_prepaid).
 * We keep resolveProviderCode for backwards compatibility, but:
 * ✅ If the incoming code is already a Monnify biller code (startsWith "biller-"),
 *    we pass it through directly so power.service can use billerCode correctly.
 */
const resolveProviderCode = (providerCode) => {
  if (!providerCode) return providerCode;
  const c = providerCode.toString().trim().toLowerCase();
  if (!c.startsWith('biller-')) return providerCode;

  const isPostpaid = c.endsWith('-post');
  const typeSuffix = isPostpaid ? 'postpaid' : 'prepaid';

  let base = null;
  if (c.includes('ekedc')) base = 'eko_electric';
  else if (c.includes('ikedc')) base = 'ikeja_electric';
  else if (c.includes('ibedc')) base = 'ibadan_electric';
  else if (c.includes('phedc')) base = 'portharcourt_electric';
  else if (c.includes('aedc')) base = 'abuja_electric';
  else if (c.includes('eedc')) base = 'enugu_electric';
  else if (c.includes('jedc')) base = 'jos_electric';
  else if (c.includes('kedc') || c.includes('kedco')) base = 'kano_electric';

  if (!base) return providerCode;
  return `${base}_${typeSuffix}`;
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

    // ✅ IMPORTANT:
    // If discoCode is already a Monnify billerCode (biller-ekedc-pre/post), pass through.
    // Else, keep legacy normalization.
    const isMonnifyBillerCode = discoCode.toString().trim().toLowerCase().startsWith('biller-');
    const codeToUse = isMonnifyBillerCode ? discoCode : resolveProviderCode(discoCode);

    const result = await powerService.validateMeter(meterNumber, codeToUse, meterType);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('[Power Controller] Validate meter error:', error.message);
    return res.status(400).json({ error: `Validation Failed: ${error.message}` });
  }
};

const createOrder = async (req, res) => {
  try {
    const { meterNumber, discoCode, amount, phone, meterName, meterType } = req.body;

    if (!meterNumber || !discoCode || !amount || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // ✅ Keep existing behavior:
    // - If biller-... is sent, keep it (so metadata has billerCode).
    // - Also keep legacy normalized provider code by passing the original input to service.
    //   (service will store billerCode/providerCode properly)
    const result = await powerService.createPendingOrder({
      meterNumber,
      discoCode, // pass raw; power.service handles biller- or legacy
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
