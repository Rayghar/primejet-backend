// src/api/v2/pricing/priceOverride.controller.js
const service = require('./priceOverride.service');
const userId = (req) => req.user?.id || req.user?._id || 'system';
const list = async (req, res, next) => { try { res.json({ ok: true, items: await service.list(req.query || {}) }); } catch (e) { next(e); } };
const request = async (req, res, next) => { try { res.status(201).json({ ok: true, override: await service.request(req.body || {}, userId(req)) }); } catch (e) { next(e); } };
const approve = async (req, res, next) => { try { res.json({ ok: true, override: await service.approve(req.params.overrideId, req.body || {}, userId(req)) }); } catch (e) { next(e); } };
const reject = async (req, res, next) => { try { res.json({ ok: true, override: await service.reject(req.params.overrideId, req.body || {}, userId(req)) }); } catch (e) { next(e); } };
module.exports = { list, request, approve, reject };
