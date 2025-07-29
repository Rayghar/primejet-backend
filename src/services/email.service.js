// File: src/services/email.service.js
const sgMail = require('@sendgrid/mail');
const { logger } = require('../config/logger.config');
const HttpError = require('../utils/HttpError'); // Added for error propagation

// Validate and set the API key from environment variables
if (!process.env.SENDGRID_API_KEY) {
  logger.error('[EMAIL_SERVICE] SENDGRID_API_KEY is not set in environment variables.');
  throw new Error('SENDGRID_API_KEY must be configured in .env');
}
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Validate and set the from email from environment variables
if (!process.env.SENDGRID_FROM_EMAIL) {
  logger.error('[EMAIL_SERVICE] SENDGRID_FROM_EMAIL is not set in environment variables.');
  throw new Error('SENDGRID_FROM_EMAIL must be configured in .env and verified in SendGrid');
}

/**
 * Sends an email using SendGrid with enhanced logging and error handling.
 * @param {object} options - The email options.
 * @param {string} options.to - The recipient's email address.
 * @param {string} options.subject - The subject of the email.
 * @param {string} options.text - The plain text content of the email.
 * @param {string} options.html - The HTML content of the email.
 * @throws {HttpError} If email sending fails, with a 500 status.
 */
const sendEmail = async (options) => {
  if (!options.to || !options.subject || (!options.text && !options.html)) {
    logger.error('[EMAIL_SERVICE] Invalid email options:', options);
    throw new HttpError(400, 'Invalid email options: to, subject, and text or html are required.');
  }

  const msg = {
    to: options.to,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: options.subject,
    text: options.text,
    html: options.html,
  };

  try {
    const response = await sgMail.send(msg);
    logger.info(`[EMAIL_SERVICE] Email sent successfully to ${options.to}. Response: ${JSON.stringify(response[0])}`);
    return response[0]; // Return the response for potential further use
  } catch (error) {
    logger.error(`[EMAIL_SERVICE] Failed to send email to ${options.to}:`, error);
    if (error.response) {
      logger.error('SendGrid Response Body:', error.response.body);
      const errorDetails = error.response.body.errors?.[0] || { message: 'Unknown SendGrid error' };
      throw new HttpError(500, `Failed to send email: ${errorDetails.message}. Status: ${error.response.statusCode}`);
    } else {
      throw new HttpError(500, `Failed to send email: ${error.message}`);
    }
  }
};

module.exports = { sendEmail };