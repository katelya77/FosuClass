"use strict";

const MAIN = "main";
const CHILDREN = Object.freeze(["schedule", "risk", "insight"]);
const NEW_TURN_SOURCES = Object.freeze(["keyboard", "sys.chat"]);
const ALLOWED_TRANSFERS = Object.freeze([
  "main->schedule",
  "main->risk",
  "main->insight",
  "schedule->main",
  "risk->main",
  "insight->main",
]);
const ALLOWED_SET = new Set(ALLOWED_TRANSFERS);

function newTurnStart(source) {
  return NEW_TURN_SOURCES.includes(source) ? MAIN : null;
}

function allowedTransfer(from, to) {
  return ALLOWED_SET.has(`${from}->${to}`);
}

function uniqueDomains(domains) {
  if (!Array.isArray(domains)) return [];
  return [...new Set(domains.filter((domain) => CHILDREN.includes(domain)))];
}

function decideChildReturn({ domain, requiredDomains, completedDomains } = {}) {
  if (!CHILDREN.includes(domain)) {
    return { action: "blocked", remainingDomains: [] };
  }
  const required = uniqueDomains(requiredDomains);
  const completed = new Set(uniqueDomains(completedDomains));
  const remainingDomains = required.filter((requiredDomain) => !completed.has(requiredDomain));
  return {
    action: remainingDomains.length ? "return_main" : "complete",
    remainingDomains,
  };
}

module.exports = {
  MAIN,
  CHILDREN,
  NEW_TURN_SOURCES,
  ALLOWED_TRANSFERS,
  newTurnStart,
  allowedTransfer,
  decideChildReturn,
};
