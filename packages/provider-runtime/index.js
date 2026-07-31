const protocol = require("@xiaofu-agent/agent-protocol");
const { EXECUTION_POLICIES, resolveExecutionPolicy } = require("./src/executionPolicy");
const { createDeadline, createStageSignal } = require("./src/deadline");
const { METRIC_LABEL_VALUES, createMetricsStore, percentile } = require("./src/metrics");
const { createKeepAliveRegistry } = require("./src/keepAliveRegistry");
const { createProviderRuntime } = require("./src/providerRuntime");
const { classifyFallbackEligibility, resolveProviderRootCause } = require("./src/fallbackEligibility");

module.exports = Object.freeze({
  DECISION_SCHEMA_VERSION: protocol.DECISION_SCHEMA_VERSION,
  EXECUTION_POLICIES,
  METRIC_LABEL_VALUES,
  classifyFallbackEligibility,
  createDeadline,
  createKeepAliveRegistry,
  createMetricsStore,
  createProviderRuntime,
  createStageSignal,
  normalizeDecisionContract: protocol.normalizeDecisionContract,
  parseDecisionContractJson: protocol.parseDecisionContractJson,
  percentile,
  resolveExecutionPolicy,
  resolveProviderRootCause,
});
