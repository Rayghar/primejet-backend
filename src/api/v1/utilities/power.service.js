const axios = require("axios");
const crypto = require("crypto");

const VTPASS_BASE_URL = process.env.VTPASS_BASE_URL || "https://sandbox.vtpass.com";
const VTPASS_API_KEY = process.env.VTPASS_API_KEY;
const VTPASS_SECRET_KEY = process.env.VTPASS_SECRET_KEY;

function assertVtpassEnv() {
  if (!VTPASS_API_KEY || !VTPASS_SECRET_KEY) {
    throw new Error("VTpass credentials missing: set VTPASS_API_KEY and VTPASS_SECRET_KEY");
  }
}

function vtpassHeaders() {
  assertVtpassEnv();
  return {
    "Content-Type": "application/json",
    "api-key": VTPASS_API_KEY,
    "secret-key": VTPASS_SECRET_KEY,
  };
}

// Minimal mapping helper (adjust to your disco codes if different)
const DISCO_TO_SERVICE_ID = {
  ikeja: "ikeja-electric",
  ekedc: "eko-electric",
  eko: "eko-electric",
  aedc: "abuja-electric",
  abuja: "abuja-electric",
  ibedc: "ibadan-electric",
  ibadan: "ibadan-electric",
  eedc: "enugu-electric",
  enugu: "enugu-electric",
  jed: "jos-electric",
  jos: "jos-electric",
  kedco: "kano-electric",
  kano: "kano-electric",
  phed: "portharcourt-electric",
  portharcourt: "portharcourt-electric",
  bedc: "benin-electric",
  benin: "benin-electric",
  kaedco: "kaduna-electric",
  kaduna: "kaduna-electric",
  aba: "aba-electric",
  yedc: "yola-electric",
  yola: "yola-electric",
};

exports.resolveServiceId = (discoOrCode) => {
  if (!discoOrCode) return null;
  const key = String(discoOrCode).toLowerCase().trim();
  return DISCO_TO_SERVICE_ID[key] || null;
};

function genRequestId() {
  // VTpass requires a unique request_id
  // Keep it numeric-ish and unique enough
  const ts = Date.now().toString();
  const rand = crypto.randomBytes(4).toString("hex");
  return `${ts}${rand}`; // e.g. 170... + 8 hex chars
}

// ---------------------------------------------------------------------------
// VTpass: Verify Meter
// Docs: POST {base}/api/merchant-verify with billersCode, serviceID, type
// ---------------------------------------------------------------------------
exports.vtpassVerifyMeter = async ({ meterNumber, serviceId, type }) => {
  const url = `${VTPASS_BASE_URL}/api/merchant-verify`;

  const payload = {
    billersCode: String(meterNumber),
    serviceID: String(serviceId),
    type: String(type), // prepaid | postpaid
  };

  const resp = await axios.post(url, payload, { headers: vtpassHeaders(), timeout: 30000 });

  const data = resp?.data;
  if (!data) throw new Error("No response from VTpass");

  if (data.code !== "000") {
    throw new Error(data?.response_description || data?.content?.error || "VTpass verification failed");
  }

  // Return only the content (matches your Flutter expectation: body.data is a map)
  return data.content || data;
};

// ---------------------------------------------------------------------------
// VTpass: Purchase
// Docs: POST {base}/api/pay with request_id, serviceID, billersCode, variation_code, amount, phone
// ---------------------------------------------------------------------------
exports.vtpassPurchase = async ({ meterNumber, serviceId, type, amount, phone }) => {
  const url = `${VTPASS_BASE_URL}/api/pay`;

  const request_id = genRequestId();

  const payload = {
    request_id,
    serviceID: String(serviceId),
    billersCode: String(meterNumber),
    variation_code: String(type), // prepaid | postpaid
    amount: Number(amount),
    phone: String(phone),
  };

  const resp = await axios.post(url, payload, { headers: vtpassHeaders(), timeout: 45000 });

  const data = resp?.data;
  if (!data) throw new Error("No response from VTpass");

  // Even if not "000", bubble a meaningful message
  if (data.code !== "000") {
    throw new Error(data?.response_description || "VTpass purchase failed");
  }

  // Return full VTpass response — contains requestId/token/units/etc
  return data;
};

// ---------------------------------------------------------------------------
// VTpass: Requery
// Docs: POST {base}/api/requery with request_id
// ---------------------------------------------------------------------------
exports.vtpassRequery = async ({ requestId }) => {
  const url = `${VTPASS_BASE_URL}/api/requery`;

  const payload = { request_id: String(requestId) };

  const resp = await axios.post(url, payload, { headers: vtpassHeaders(), timeout: 30000 });

  const data = resp?.data;
  if (!data) throw new Error("No response from VTpass");

  return data;
};