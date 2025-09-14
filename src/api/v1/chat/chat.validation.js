const Joi = require('joi');

// v4 UUID format
const uuid = Joi.string().guid({ version: 'uuidv4' });

const initiateChatSchema = {
  body: Joi.object({
    orderId: uuid.required(),
  }),
};

const getChatHistorySchema = {
  params: Joi.object({
    chatId: uuid.required(),
  }),
  query: Joi.object({
    before: Joi.date().iso().optional(),
    limit: Joi.number().integer().min(1).max(200).default(50),
  }).optional()
};

module.exports = {
  initiateChatSchema,
  getChatHistorySchema,
};
