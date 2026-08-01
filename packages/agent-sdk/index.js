const runStateMachine = require("./src/runStateMachine");
const client = require("./src/client");

module.exports = Object.freeze({
  LEGAL_TRANSITIONS: runStateMachine.LEGAL_TRANSITIONS,
  TERMINAL_STATUSES: runStateMachine.TERMINAL_STATUSES,
  createRunState: runStateMachine.createRunState,
  isTerminalStatus: runStateMachine.isTerminalStatus,
  reduceRunEvent: runStateMachine.reduceRunEvent,
  classifyHttpFailure: client.classifyHttpFailure,
  createAgentRunClient: client.createAgentRunClient,
  createMemoryStorage: client.createMemoryStorage,
  createPollingTransport: client.createPollingTransport,
});
