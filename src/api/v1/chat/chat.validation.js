// api/v1/chat/chat.validation.js
const Joi = require('joi');

exports.getChatHistorySchema = {
  params: Joi.object({
    chatId: Joi.string().required(),
  }),
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(200).optional(),
  }),
  body: Joi.object({}),
};

exports.postMessageSchema = {
  params: Joi.object({
    chatId: Joi.string().required(),
  }),
  body: Joi.object({
    text: Joi.string().trim().min(1).max(2000).required(),
  }),
};

exports.getThreadsSchema = {
  query: Joi.object({
    limit: Joi.number().integer().min(1).max(200).optional(),
  }),
};
