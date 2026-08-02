const protocol = require("@xiaofu-agent/agent-protocol");
const { EXECUTION_POLICIES, resolveExecutionPolicy } = require("./src/executionPolicy");
const { createDeadline, createStageSignal, deriveProviderStageLease } = require("./src/deadline");
const { METRIC_LABEL_VALUES, createMetricsStore, percentile } = require("./src/metrics");
const { createKeepAliveRegistry } = require("./src/keepAliveRegistry");
const { createProviderRuntime } = require("./src/providerRuntime");
const { classifyFallbackEligibility, resolveProviderRootCause } = require("./src/fallbackEligibility");
const { createProviderPublicationAdapter, overlayToRuntimeConfig } = require("./src/providerPublicationAdapter");

module.exports = Object.freeze({
  DECISION_SCHEMA_VERSION: protocol.DECISION_SCHEMA_VERSION,
  EXECUTION_POLICIES,
  METRIC_LABEL_VALUES,
  classifyFallbackEligibility,
  createDeadline,
  deriveProviderStageLease,
  createKeepAliveRegistry,
  createMetricsStore,
  createProviderPublicationAdapter,
  createProviderRuntime,
  createStageSignal,
  normalizeDecisionContract: protocol.normalizeDecisionContract,
  overlayToRuntimeConfig,
  parseDecisionContractJson: protocol.parseDecisionContractJson,
  percentile,
  resolveExecutionPolicy,
  resolveProviderRootCause,
});
