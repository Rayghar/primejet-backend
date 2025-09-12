// File: src/api/v1/chat/chat.routes.js

const express = require('express');
const Joi = require('joi');

const router = express.Router();

const chatController = require('./chat.controller');
const auth = require('../../../middleware/auth.middleware');            // default export
const validate = require('../../../middleware/validate.middleware');    // default export

// Body schema for POST /initiate
const initiateSchema = Joi.object({
  orderId: Joi.string().required(),
  recipientId: Joi.string().required(),
});

// (Optional) lightweight trace – safe even if req.logger is missing
const trace = (req, _res, next) => {
  try {
    req.logger?.info?.('[CHAT_ROUTE] /initiate hit', {
      hasAuth: Boolean(req.headers.authorization),
      bodyKeys: Object.keys(req.body || {}),
      contentType: req.headers['content-type'],
    });
  } catch (_) {}
  next();
};

router.post(
  '/initiate',
  trace,
  auth(),                             // require authenticated user
  validate(initiateSchema, 'body'),   // ✅ use the exported validate() fn
  chatController.initiateChat
);

router.get(
  '/threads/me',
  auth(),
  chatController.getMyThreads
);

router.post('/firebase-token', auth(), chatController.createFirebaseToken);


module.exports = router;
