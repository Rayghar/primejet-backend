// src/api/v1/chat/chat.validation.js
const Joi = require('joi');
const { objectId } = require('../../../plugins/validate.plugin.js');

const initiateChatSchema = {
  body: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
};

const getChatHistorySchema = {
  params: Joi.object().keys({
    chatId: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  initiateChatSchema,
  getChatHistorySchema,
};