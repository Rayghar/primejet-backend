// File: src/api/v1/utilities/power.service.js

const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

/**
 * ✅ VTpass Config (Sandbox for now)
 *
 * Add these to your backend .env:
 *   VTPASS_BASE_URL=https://sandbox.vtpass.com/api
 *   VTPASS_API_KEY=your_sandbox_api_key
 *
 * Production later:
 *   VTPASS_BASE_URL=https://vtpass.com/api
 */
const VTPASS_BASE_URL = process.env.VTPASS_BASE_URL || "https://sandbox.vtpass.com/api";
const VTPASS_API_KEY = process.env.VTPASS_API_KEY;

/**
 * ✅ Map your existing UI disco codes to VTpass serviceIDs
 * (keeps frontend stable)
 */
const DISCO_TO_SERVICE_ID = {
  ikeja_electric_prepaid: "ikeja-electric",
  eko_electric_prepaid: "eko-electric",
  abuja_electric_prepaid: "abuja-electric",
  ibadan_electric_prepaid: "ibadan-electric",
  enugu_electric_prepaid: "enugu-electric",
  jos_electric_prepaid: "jos-electric",
};

function requireEnv(value, name) {
  if (!value) throw new Error(`${name} is missing in backend .env`);
}

function vtpassHeaders() {
  requireEnv(VTPASS_API_KEY, "VTPASS_API_KEY");
  return {
    "Content-Type": "application/json",
    "api-key": VTPASS_API_KEY,
  };
}

/**
 * ✅ VTpass: Verify meter (direct)
 * VTpass endpoint: POST /merchant-verify
 */
exports.vtpassVerifyMeterDirect = async ({ meterNumber, serviceId, type }) => {
  if (!meterNumber || meterNumber.length < 10) throw new Error("Invalid meter number");
  if (!serviceId) throw new Error("serviceId is required");
  if (!type) throw new Error("type is required (prepaid/postpaid)");

  const url = `${VTPASS_BASE_URL}/merchant-verify`;

  const payload = {
    serviceID: serviceId,
    billersCode: meterNumber,
    type, // "prepaid" or "postpaid"
  };

  const resp = await axios.post(url, payload, { headers: vtpassHeaders() });
  const body = resp.data;

  if (body?.code !== "000" && body?.response_description !== "000") {
    throw new Error(body?.response_description || body?.content?.error || "Meter verification failed");
  }

  return {
    name: body?.content?.Customer_Name || body?.content?.customer_name || "Customer",
    address: body?.content?.Address || body?.content?.customer_address || "N/A",
    raw: body,
  };
};

/**
 * ✅ Wrapper: Verify meter using existing discoCode from UI
 */
exports.vtpassVerifyMeter = async ({ meterNumber, discoCode, type }) => {
  const serviceId = DISCO_TO_SERVICE_ID[discoCode];
  if (!serviceId) throw new Error(`Unsupported disco code: ${discoCode}`);

  return exports.vtpassVerifyMeterDirect({
    meterNumber,
    serviceId,
    type: type || "prepaid",
  });
};

/**
 * ✅ VTpass: Purchase electricity (direct)
 * VTpass endpoint: POST /pay
 */
exports.vtpassPurchaseDirect = async ({ meterNumber, serviceId, type, amount, phone }) => {
  if (!meterNumber || meterNumber.length < 10) throw new Error("Invalid meter number");
  if (!serviceId) throw new Error("serviceId is required");
  if (!type) throw new Error("type is required (prepaid/postpaid)");
  if (!amount || Number(amount) <= 0) throw new Error("Invalid amount");
  if (!phone) throw new Error("phone is required");

  const url = `${VTPASS_BASE_URL}/pay`;

  const request_id = uuidv4();

  const payload = {
    request_id,
    serviceID: serviceId,
    billersCode: meterNumber,
    variation_code: type, // "prepaid" | "postpaid"
    amount: Number(amount),
    phone,
  };

  const resp = await axios.post(url, payload, { headers: vtpassHeaders() });
  const body = resp.data;

  if (body?.code !== "000" && body?.response_description !== "000") {
    throw new Error(body?.response_description || body?.content?.error || "Purchase failed");
  }

  return {
    orderId: request_id,
    totalAmount: Number(amount),
    token: body?.purchased_code || body?.content?.token || null,
    units: body?.units || body?.content?.units || null,
    raw: body,
  };
};

/**
 * ✅ Wrapper: Purchase using existing discoCode from UI
 */
exports.vtpassPurchaseElectricity = async ({
  meterNumber,
  discoCode,
  type,
  amount,
  phone,
}) => {
  const serviceId = DISCO_TO_SERVICE_ID[discoCode];
  if (!serviceId) throw new Error(`Unsupported disco code: ${discoCode}`);

  return exports.vtpassPurchaseDirect({
    meterNumber,
    serviceId,
    type: type || "prepaid",
    amount,
    phone,
  });
};

/**
 * ✅ VTpass: Requery transaction status
 * VTpass endpoint: GET /requery?request_id=xxxx
 */
exports.vtpassRequeryStatus = async ({ requestId }) => {
  if (!requestId) throw new Error("requestId is required");

  const url = `${VTPASS_BASE_URL}/requery?request_id=${encodeURIComponent(
    requestId
  )}`;

  const resp = await axios.get(url, { headers: vtpassHeaders() });
  const body = resp.data;

  if (!body) throw new Error("Invalid VTpass status response");

  return body;
};

/**
 * ✅ Retry vending (your internal business logic hook)
 * For now, just requery. You can later use this to retry internal fulfillment.
 */
exports.retryVending = async ({ orderId }) => {
  await exports.vtpassRequeryStatus({ requestId: orderId });
  return true;
};