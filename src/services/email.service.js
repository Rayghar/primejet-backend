// src/services/email.service.js
const sgMail = require('@sendgrid/mail');
const { logger } = require('../config/logger.config');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const sendEmail = async (options) => {
  const msg = {
    to: options.to,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: options.subject,
    text: options.text,
    html: options.html,
  };

  try {
    await sgMail.send(msg);
    logger.info(`[EMAIL_SERVICE] Email sent successfully to ${options.to}`);
  } catch (error) {
    logger.error(`[EMAIL_SERVICE] Error sending email via SendGrid:`, error);
    if (error.response) {
      logger.error('SendGrid Response Body:', error.response.body);
    }
    // ✅ ADD THIS: Re-throw the error so auth.service knows it failed!
    throw error; 
  }
};

module.exports = { sendEmail };