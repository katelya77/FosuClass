const runEvent = require("./src/runEvent");
const platformTrace = require("./src/platformTrace");
const decisionContract = require("./src/decisionContract");
const protocol = require("./src/protocol");

module.exports = Object.freeze({
  RUN_EVENT_TYPES: runEvent.RUN_EVENT_TYPES,
  createRunEvent: runEvent.createRunEvent,
  sanitizePublicValue: runEvent.sanitizePublicValue,
  createPlatformTrace: platformTrace.createPlatformTrace,
  DECISION_SCHEMA_VERSION: decisionContract.DECISION_SCHEMA_VERSION,
  normalizeDecisionContract: decisionContract.normalizeDecisionContract,
  parseDecisionContractJson: decisionContract.parseDecisionContractJson,
  DIRECT_CHAT_COMPAT: protocol.DIRECT_CHAT_COMPAT,
  LEGACY_PROTOCOL_VERSIONS: protocol.LEGACY_PROTOCOL_VERSIONS,
  MIN_COMPATIBLE_VERSION: protocol.MIN_COMPATIBLE_VERSION,
  PROTOCOL_CAPABILITIES: protocol.PROTOCOL_CAPABILITIES,
  PROTOCOL_VERSION: protocol.PROTOCOL_VERSION,
  RUN_ERROR_CLASSES: protocol.RUN_ERROR_CLASSES,
  SUPPORTED_UI_BLOCKS: protocol.SUPPORTED_UI_BLOCKS,
  classifyRunError: protocol.classifyRunError,
  negotiateProtocol: protocol.negotiateProtocol,
});
