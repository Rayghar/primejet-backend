// File: src/api/v2/runs/run.service.js
// v2 reuses the hardened v1 run service implementation to avoid divergent dispatch behavior.

const runService = require('../../v1/runs/run.service');

module.exports = runService;
