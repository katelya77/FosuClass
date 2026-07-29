const runEvent = require("./src/runEvent");
const platformTrace = require("./src/platformTrace");
const decisionContract = require("./src/decisionContract");

module.exports = Object.freeze({
  RUN_EVENT_TYPES: runEvent.RUN_EVENT_TYPES,
  createRunEvent: runEvent.createRunEvent,
  sanitizePublicValue: runEvent.sanitizePublicValue,
  createPlatformTrace: platformTrace.createPlatformTrace,
  DECISION_SCHEMA_VERSION: decisionContract.DECISION_SCHEMA_VERSION,
  normalizeDecisionContract: decisionContract.normalizeDecisionContract,
  parseDecisionContractJson: decisionContract.parseDecisionContractJson,
});
