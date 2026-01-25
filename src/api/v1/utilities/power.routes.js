// File: src/api/v1/utilities/power.routes.js

const express = require("express");
const router = express.Router();

const authMiddleware = require("../../../middleware/auth.middleware");
const powerController = require("./power.controller");

// ✅ Legacy endpoints (keep them so existing clients won't break)
router.post("/validate", authMiddleware, powerController.validateMeter);
router.post("/order", authMiddleware, powerController.createPowerOrder);

// ✅ NEW VTpass endpoints (these are what your app should use now)
router.post("/vtpass/verify", authMiddleware, powerController.vtpassVerifyMeter);
router.post("/vtpass/purchase", authMiddleware, powerController.vtpassPurchase);
router.get(
  "/vtpass/status/:requestId",
  authMiddleware,
  powerController.vtpassRequeryStatus
);

// ✅ Admin utility (already exists in your dart ApiService)
router.post("/retry", authMiddleware, powerController.retryVending);

module.exports = router;