// src/api/v1/reports/report.controller.js
const reportService = require('./report.service');
const HttpError = require('../../../utils/HttpError');
// const { logger } = require('../../../config/logger.config');

const getReport = async (req, res, next) => {
  try {
    const { reportType, period, startDate, endDate } = req.query; // Already validated by Joi
    const reportData = await reportService.generateReport({
      reportType,
      period,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
    res.status(200).json(reportData);
  } catch (error) {
    // logger.error('[REPORT_CONTROLLER] Error in getReport:', error);
    next(error);
  }
};

// --- NEW CONTROLLER FOR EXPORT ---
const exportReport = async (req, res, next) => {
  try {
    const { reportType, startDate, endDate, format = 'xlsx' } = req.query; // Validated by Joi

    // Generate the report data and then the file
    const fileBuffer = await reportService.exportReport({
      reportType,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      format,
    });

    const fileName = `${reportType}_report_${new Date().toISOString().split('T')[0]}.${format}`;
    let contentType;
    if (format === 'xlsx') {
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else { // csv
      contentType = 'text/csv';
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.status(200).send(fileBuffer);

  } catch (error) {
    // logger.error('[REPORT_CONTROLLER] Error in exportReport:', error);
    next(error);
  }
};

/**
 * @desc    Get aggregated driver performance stats (deliveries, rating, revenue)
 * @route   GET /api/v1/reports/driver-performance
 * @access  Admin, Manager
 */
const getDriverPerformanceStats = async (req, res, next) => {
  try {
    const { period } = req.query; // e.g. 'weekly', 'monthly'

    logger.info(`[REPORT_CONTROLLER] Fetching driver performance stats for period: ${period || 'monthly'}`);

    // Call the service function (ensure this exists in report.service.js)
    const stats = await reportService.getDriverPerformanceStats(period);

    res.status(200).json(stats);
  } catch (error) {
    logger.error(`[REPORT_CONTROLLER] Error fetching driver performance stats: ${error.message}`);
    next(new HttpError(500, 'Failed to fetch driver performance statistics.'));
  }
};

module.exports = {
  getReport,
  exportReport, // Export the new controller
  getDriverPerformanceStats,
};