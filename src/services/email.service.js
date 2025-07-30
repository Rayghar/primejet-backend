// File: src/services/email.service.js
const sgMail = require('@sendgrid/mail');
const { logger } = require('../config/logger.config');

// Set the API key from your environment variables
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Sends an email using SendGrid.
 * @param {object} options - The email options.
 * @param {string} options.to - The recipient's email address.
 * @param {string} options.subject - The subject of the email.
 * @param {string} options.text - The plain text content of the email.
 * @param {string} options.html - The HTML content of the email.
 */
const sendEmail = async (options) => {
  // The 'from' email MUST be the one you verified in your SendGrid account.
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
      // Log detailed error from SendGrid's API
      logger.error('SendGrid Response Body:', error.response.body);
    }
  }
};

module.exports = { sendEmail };
