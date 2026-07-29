const protocol = require("@xiaofu-agent/agent-protocol");
const { EXECUTION_POLICIES, resolveExecutionPolicy } = require("./src/executionPolicy");
const { createDeadline, createStageSignal } = require("./src/deadline");
const { createMetricsStore, percentile } = require("./src/metrics");
const { createKeepAliveRegistry } = require("./src/keepAliveRegistry");
const { createProviderRuntime } = require("./src/providerRuntime");

module.exports = Object.freeze({
  DECISION_SCHEMA_VERSION: protocol.DECISION_SCHEMA_VERSION,
  EXECUTION_POLICIES,
  createDeadline,
  createKeepAliveRegistry,
  createMetricsStore,
  createProviderRuntime,
  createStageSignal,
  normalizeDecisionContract: protocol.normalizeDecisionContract,
  parseDecisionContractJson: protocol.parseDecisionContractJson,
  percentile,
  resolveExecutionPolicy,
});
