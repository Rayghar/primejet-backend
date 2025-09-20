// routes/fcm.routes.js
const express = require('express');
const router = express.Router();
const auth = require('../../../middleware/auth.middleware'); // must set req.user
const { registerToken, unregisterToken } = require('../../v1/fcm/fcm.controller');

router.post('/register', auth, registerToken);
router.post('/unregister', auth, unregisterToken);

module.exports = router;
