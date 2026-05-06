// src/api/v2/data-entry/reversals/reversal.controller.js
const service = require('./reversal.service');
const userId = (req) => req.user?.id || req.user?._id || 'system';
const list = async (req, res, next) => { try { res.json({ ok: true, items: await service.list(req.query || {}) }); } catch (e) { next(e); } };
const sale = async (req, res, next) => { try { res.status(201).json({ ok: true, reversal: await service.requestSaleReversal({ ...req.body, summaryId: req.params.summaryId, saleId: req.params.saleId }, userId(req)) }); } catch (e) { next(e); } };
const expense = async (req, res, next) => { try { res.status(201).json({ ok: true, reversal: await service.requestExpenseReversal({ ...req.body, summaryId: req.params.summaryId, expenseId: req.params.expenseId }, userId(req)) }); } catch (e) { next(e); } };
module.exports = { list, sale, expense };
