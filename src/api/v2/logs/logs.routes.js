// src/api/v2/logs/logs.routes.js
const express = require('express');
const router = express.Router();
const logsController = require('./logs.controller');
const authMiddleware = require('../../../middleware/auth.middleware');

// Route: GET /api/v2/logs/audit
// Full URL will be: http://localhost:3000/api/v2/logs/audit
router.get(
    '/audit', 
    authMiddleware(['admin']), // ✅ specific role check
    logsController.getSystemLogs
);

module.exports = router;