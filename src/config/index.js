// File: src/config/index.js
// ADVISORY: This file has been updated to a more robust synchronous export pattern.

const path = require('path');
const dotenv = require('dotenv');

// Load .env file for local development. In production, environment variables will override these.
dotenv.config({ path: path.resolve(__dirname, '../../.env') }); 

const config = {
  env: process.env.NODE_ENV || 'development', 
  port: parseInt(process.env.PORT, 10) || 3000,
  mongo: {
    uri: process.env.MONGO_URI, 
  },
  jwt: {
    secret: process.env.JWT_SECRET, 
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },
  // ... include all other config properties from your original file here
  // For example:
  // redis: { ... },
  // firebase: { ... },
  // sentry: { ... },
};

if (!config.jwt.secret) {
  console.error("[CONFIG_ERROR] FATAL: JWT_SECRET is not defined in environment variables. Application cannot start securely.");
  // In a real production environment, you might want to exit the process
  // process.exit(1); 
}

// Export the fully loaded configuration object directly.
module.exports = {
  config,
  // You can keep other exports if they are still needed elsewhere
};