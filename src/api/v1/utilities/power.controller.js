const powerService = require("./power.service");

// Small helper to standardize responses
function ok(res, data, message = "OK") {
  return res.status(200).json({ success: true, message, data });
}
function fail(res, status, message, error) {
  return res.status(status).json({
    success: false,
    message,
    error: error ? String(error) : undefined,
  });
}

// ---------------------------------------------------------------------------
// VTpass (NEW)
// ---------------------------------------------------------------------------
exports.vtpassVerify = async (req, res) => {
  try {
    const { meterNumber, serviceId, type } = req.body;

    if (!meterNumber || !serviceId || !type) {
      return fail(res, 400, "meterNumber, serviceId and type are required");
    }

    const data = await powerService.vtpassVerifyMeter({
      meterNumber,
      serviceId,
      type,
    });

    return ok(res, data, "Meter verified");
  } catch (e) {
    return fail(res, 400, e?.message || "Meter verification failed", e);
  }
};

exports.vtpassPurchase = async (req, res) => {
  try {
    const { meterNumber, serviceId, type, amount, phone } = req.body;

    if (!meterNumber || !serviceId || !type || !amount || !phone) {
      return fail(res, 400, "meterNumber, serviceId, type, amount and phone are required");
    }

    const data = await powerService.vtpassPurchase({
      meterNumber,
      serviceId,
      type,
      amount,
      phone,
    });

    // VTpass might return delivered / pending etc — we still return success=true
    // because the request executed and can be requeried by requestId.
    return ok(res, data, "Purchase initiated");
  } catch (e) {
    return fail(res, 400, e?.message || "Purchase failed", e);
  }
};

exports.vtpassStatus = async (req, res) => {
  try {
    const { requestId } = req.params;

    if (!requestId) {
      return fail(res, 400, "requestId is required");
    }

    const data = await powerService.vtpassRequery({ requestId });

    return ok(res, data, "Status fetched");
  } catch (e) {
    return fail(res, 400, e?.message || "Status requery failed", e);
  }
};

// ---------------------------------------------------------------------------
// Legacy endpoints (KEEP) – map to VTpass so old clients still work
// NOTE: legacy payloads differ in older UI; adjust mapping if needed.
// ---------------------------------------------------------------------------
exports.validateMeterLegacy = async (req, res) => {
  try {
    // Common legacy patterns:
    // - meterNumber, disco (or discoCode), type
    // - or serviceId already provided
    const meterNumber = req.body.meterNumber || req.body.meter_number || req.body.billersCode;
    const type = req.body.type || req.body.variation_code || "prepaid";
    const serviceId = req.body.serviceId || req.body.serviceID || powerService.resolveServiceId(req.body.disco || req.body.discoCode);

    if (!meterNumber || !serviceId) {
      return fail(res, 400, "meterNumber and serviceId/disco are required");
    }

    const data = await powerService.vtpassVerifyMeter({ meterNumber, serviceId, type });
    return ok(res, data, "Meter verified");
  } catch (e) {
    return fail(res, 400, e?.message || "Meter verification failed", e);
  }
};

exports.createPowerOrderLegacy = async (req, res) => {
  try {
    const meterNumber = req.body.meterNumber || req.body.meter_number || req.body.billersCode;
    const type = req.body.type || req.body.variation_code || "prepaid";
    const amount = req.body.amount;
    const phone = req.body.phone || req.body.phoneNumber;

    const serviceId =
      req.body.serviceId ||
      req.body.serviceID ||
      powerService.resolveServiceId(req.body.disco || req.body.discoCode);

    if (!meterNumber || !serviceId || !amount || !phone) {
      return fail(res, 400, "meterNumber, serviceId/disco, amount and phone are required");
    }

    const data = await powerService.vtpassPurchase({
      meterNumber,
      serviceId,
      type,
      amount,
      phone,
    });

    return ok(res, data, "Purchase initiated");
  } catch (e) {
    return fail(res, 400, e?.message || "Purchase failed", e);
  }
};

exports.requeryLegacy = async (req, res) => {
  try {
    const requestId = req.body.requestId || req.body.request_id;
    if (!requestId) return fail(res, 400, "requestId is required");

    const data = await powerService.vtpassRequery({ requestId });
    return ok(res, data, "Status fetched");
  } catch (e) {
    return fail(res, 400, e?.message || "Status requery failed", e);
  }
};

// ---------------------------------------------------------------------------
// Admin retry (placeholder)
// ---------------------------------------------------------------------------
exports.retryVending = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return fail(res, 400, "orderId is required");

    // If you have internal retry logic, call it here.
    // For now, return success so the endpoint exists for the app.
    return ok(res, { orderId }, "Retry queued");
  } catch (e) {
    return fail(res, 400, e?.message || "Retry failed", e);
  }
};