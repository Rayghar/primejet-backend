// src/api/v2/utils/branchIdentity.js
// Resolves branch/plant references consistently across legacy branch codes and Mongo ObjectIds.
// This is needed because some operational tables store Plant._id while stock/price tables
// often store the business branch code, e.g. AJAH-01.

const mongoose = require('mongoose');
const Plant = require('../../../models/plant.model');

const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const objectIdOf = (v) => new mongoose.Types.ObjectId(String(v));

const uniqueStrings = (values = []) => [...new Set(values.filter(hasVal).map((v) => String(v).trim()))];

const resolveBranchIdentity = async (branchKey) => {
  if (!hasVal(branchKey)) {
    return { input: null, plant: null, aliases: [], objectIds: [], objectIdStrings: [], code: null, displayName: null };
  }

  const input = String(branchKey).trim();
  let plant = null;

  const ors = [{ id: input }, { name: input }];
  if (isObjectId(input)) ors.push({ _id: objectIdOf(input) });

  try {
    plant = await Plant.findOne({ $or: ors }).lean();
  } catch (_) {
    plant = null;
  }

  const objectIds = [];
  if (isObjectId(input)) objectIds.push(objectIdOf(input));
  if (plant?._id && isObjectId(plant._id)) objectIds.push(objectIdOf(plant._id));

  const objectIdStrings = uniqueStrings(objectIds.map((x) => String(x)));
  const aliases = uniqueStrings([
    input,
    ...objectIdStrings,
    plant?.id,
    plant?.name,
    plant?.branchCode,
    plant?.code,
  ]);

  return {
    input,
    plant,
    aliases,
    objectIds: [...new Map(objectIds.map((x) => [String(x), x])).values()],
    objectIdStrings,
    code: plant?.id || input,
    displayName: plant?.name || plant?.id || input,
  };
};

const buildObjectIdMatch = async (field, branchKey) => {
  if (!hasVal(branchKey)) return {};
  const identity = await resolveBranchIdentity(branchKey);
  if (!identity.objectIds.length) return { _id: { $exists: false } };
  return { [field]: { $in: identity.objectIds } };
};

const buildStringMatch = async (field, branchKey) => {
  if (!hasVal(branchKey)) return {};
  const identity = await resolveBranchIdentity(branchKey);
  if (!identity.aliases.length) return { _id: { $exists: false } };
  return { [field]: { $in: identity.aliases } };
};

const buildStringOrMatch = async (fields = [], branchKey) => {
  if (!hasVal(branchKey)) return {};
  const identity = await resolveBranchIdentity(branchKey);
  if (!identity.aliases.length) return { _id: { $exists: false } };
  return { $or: fields.map((field) => ({ [field]: { $in: identity.aliases } })) };
};

module.exports = {
  hasVal,
  isObjectId,
  objectIdOf,
  uniqueStrings,
  resolveBranchIdentity,
  buildObjectIdMatch,
  buildStringMatch,
  buildStringOrMatch,
};
