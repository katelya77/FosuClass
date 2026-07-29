const runEvent = require("./src/runEvent");
const platformTrace = require("./src/platformTrace");

module.exports = Object.freeze({
  RUN_EVENT_TYPES: runEvent.RUN_EVENT_TYPES,
  createRunEvent: runEvent.createRunEvent,
  sanitizePublicValue: runEvent.sanitizePublicValue,
  createPlatformTrace: platformTrace.createPlatformTrace,
});
