"use strict";

const fs = require("fs");
const path = require("path");

const TERM_RE = /^(\d{4})-(\d{4})-([12])$/;

function termConfigDirectory(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  return path.join(root, "config", "terms");
}

function resolvePreferredTerm(options = {}) {
  const directory = termConfigDirectory(options);
  const preferred = fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const source = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
      return source && source.preferred === true ? String(source.term || "").trim() : "";
    })
    .filter(Boolean);
  if (preferred.length !== 1) {
    const error = new Error(`PREFERRED_TERM_CONFIG_${preferred.length ? "AMBIGUOUS" : "MISSING"}`);
    error.code = preferred.length ? "PREFERRED_TERM_CONFIG_AMBIGUOUS" : "PREFERRED_TERM_CONFIG_MISSING";
    error.terms = preferred;
    throw error;
  }
  return assertTerm(preferred[0]);
}

const DEFAULT_CURRENT_TERM = resolvePreferredTerm();

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

function loadTermConfig(term, options = {}) {
  const id = assertTerm(term || resolvePreferredTerm(options));
  const filePath = path.join(termConfigDirectory(options), `${id}.json`);
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
  resolvePreferredTerm,
};
