"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_CURRENT_TERM = "2026-2027-1";
const TERM_RE = /^(\d{4})-(\d{4})-([12])$/;

function assertTerm(term) {
  const value = String(term || "").trim();
  const match = value.match(TERM_RE);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    const error = new Error("TERM_ID_INVALID");
    error.code = "TERM_ID_INVALID";
    throw error;
  }
  return value;
}

function loadTermConfig(term = DEFAULT_CURRENT_TERM, options = {}) {
  const id = assertTerm(term);
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const filePath = path.join(root, "config", "terms", `${id}.json`);
  if (!fs.existsSync(filePath)) {
    const error = new Error(`TERM_CONFIG_NOT_FOUND:${id}`);
    error.code = "TERM_CONFIG_NOT_FOUND";
    throw error;
  }
  const source = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const totalWeeks = Number(source.totalWeeks);
  if (source.term !== id || !/^\d{4}-\d{2}-\d{2}$/.test(String(source.termStartDate || "")) ||
      !Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 30 ||
      !["monday", "sunday"].includes(source.weekStart)) {
    const error = new Error(`TERM_CONFIG_INVALID:${id}`);
    error.code = "TERM_CONFIG_INVALID";
    throw error;
  }
  return Object.assign({}, source, { totalWeeks, filePath });
}

module.exports = {
  DEFAULT_CURRENT_TERM,
  assertTerm,
  loadTermConfig,
};
