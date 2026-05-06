// src/api/v2/opening-balances/openingBalance.controller.js
const service = require('./openingBalance.service');
const getUserId = (req) => req.user?.id || req.user?._id || 'system';

const list = async (req, res, next) => { try { res.json({ ok: true, items: await service.listOpeningBalances(req.query || {}) }); } catch (e) { next(e); } };
const readiness = async (req, res, next) => { try { res.json(await service.getReadiness(req.query || {})); } catch (e) { next(e); } };
const draft = async (req, res, next) => { try { res.status(201).json({ ok: true, openingBalance: await service.saveDraft(req.body || {}, getUserId(req)) }); } catch (e) { next(e); } };
const submit = async (req, res, next) => { try { res.json({ ok: true, openingBalance: await service.submit(req.params.id, getUserId(req)) }); } catch (e) { next(e); } };
const post = async (req, res, next) => { try { res.json({ ok: true, openingBalance: await service.post(req.params.id, getUserId(req)) }); } catch (e) { next(e); } };

module.exports = { list, readiness, draft, submit, post };
