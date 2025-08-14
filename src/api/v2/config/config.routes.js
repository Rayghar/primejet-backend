// src/api/v2/config/config.routes.js
const express = require('express');
const configController = require('./config.controller');
const authMiddleware = require('../../../middleware/auth.middleware'); 

const router = express.Router();

router.route('/')
    // Changing the permission check from 'read_config' to 'admin'
    .get(authMiddleware('admin'), configController.getConfiguration) 
    // Changing the permission check from 'manage_config' to 'admin'
    .put(authMiddleware('admin'), configController.updateConfiguration); 

module.exports = router;