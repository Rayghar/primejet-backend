// src/api/v2/auth/auth.routes.js
const express = require('express');
const authController = require('./auth.controller');
const validate = require('../../../middleware/validate.middleware'); // Assuming validate middleware is available
const { loginSchema } = require('./auth.validation'); // Assuming auth.validation.js exists for v2

const router = express.Router();

/**
 * @route POST /api/v2/auth/login
 * @desc Authenticate user and return JWT token for web clients.
 * @access Public
 */
router.post('/login', validate(loginSchema), authController.login);

module.exports = router;