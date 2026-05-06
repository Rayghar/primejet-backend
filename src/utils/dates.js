// utils/dates.js
// Small date helpers used across GL-first screens.

export const toISODate = (d) => {
  const x = d ? new Date(d) : null;
  return x && !Number.isNaN(x.getTime()) ? x : null;
};

export const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

export const isoYmd = (d) => {
  const x = toISODate(d);
  return x ? x.toISOString().slice(0, 10) : "";
};
