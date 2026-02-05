// File: src/api/v1/utilities/power.controller.js
const powerService = require('./power.service');

/**
 * Monnify Billers return codes like: biller-ekedc-pre / biller-ekedc-post.
 * Our backend validate/order flow expects internal provider codes
 * (e.g. eko_electric_prepaid), so we normalize here.
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

const validateMeter = async (req, res) => {
  try {
    const meterNumber = req.body.meter;
    const discoCode = resolveProviderCode(req.body.disco);

    if (!meterNumber || !discoCode) {
      return res.status(400).json({ error: 'Missing meter or disco' });
    }

    const result = await powerService.validateMeter(meterNumber, discoCode);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({ error: `Validation Failed: ${error.message}` });
  }
};

const createOrder = async (req, res) => {
  try {
    const { meterNumber, discoCode, amount, phone, meterName } = req.body;

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
      userId: req.user?.id || null,
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({ error: `Order Failed: ${error.message}` });
  }
};

const retryVending = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    const result = await powerService.retryVending(orderId);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({ error: `Retry Failed: ${error.message}` });
  }
};

module.exports = { validateMeter, createOrder, retryVending, resolveProviderCode };
