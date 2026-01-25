const express = require("express");
const router = express.Router();

const powerController = require("./power.controller");

// Use your existing auth middleware path (based on your backend structure)
const authMiddleware = require("../../../middleware/auth.middleware");

// All power routes require auth (Flutter sends Bearer token)
router.use(authMiddleware);

// ---------------------------------------------------------------------------
// Legacy endpoints (keep for backward compatibility)
// ---------------------------------------------------------------------------
router.post("/validate", powerController.validateMeterLegacy);
router.post("/order", powerController.createPowerOrderLegacy);
router.post("/requery", powerController.requeryLegacy);

// ---------------------------------------------------------------------------
// VTpass endpoints (NEW)
// ---------------------------------------------------------------------------
router.post("/vtpass/verify", powerController.vtpassVerify);
router.post("/vtpass/purchase", powerController.vtpassPurchase);
router.get("/vtpass/status/:requestId", powerController.vtpassStatus);

// ---------------------------------------------------------------------------
// Admin / Ops
// ---------------------------------------------------------------------------
router.post("/retry", powerController.retryVending);

module.exports = router;