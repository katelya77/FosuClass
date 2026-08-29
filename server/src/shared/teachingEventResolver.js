"use strict";

const ALLOWED_TYPES = new Set(["holiday", "makeup", "no-class", "special-teaching"]);

function parseDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function normalizeSpecialDate(item) {
  const source = item && typeof item === "object" ? item : {};
  if (!parseDate(source.date) || !ALLOWED_TYPES.has(source.type)) return null;
  if (source.type === "makeup" && !parseDate(source.scheduleSourceDate)) return null;
  return {
    date: source.date,
    type: source.type,
    scheduleSourceDate: source.type === "makeup" ? source.scheduleSourceDate : "",
    note: String(source.note || "").trim(),
    audience: String(source.audience || "all").trim(),
  };
}

module.exports = { ALLOWED_TYPES, normalizeSpecialDate };
