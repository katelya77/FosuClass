const providerFactory = require("../providerFactory");
const generatedPayloadContract = require("../generatedPayloadContract");

function nowIso() {
  return new Date().toISOString();
}

function stableAction(action) {
  return generatedPayloadContract.stableAction(action);
}

function stableCard(card) {
  return generatedPayloadContract.stableCard(card);
}

function stableGeneratedPayload(payload, options = {}) {
  return generatedPayloadContract.stableGeneratedPayload(payload, options);
}

function isPublicRuntime(runtimeMode) {
  return (runtimeMode || providerFactory.getRuntimeMode && providerFactory.getRuntimeMode()) === "public";
}

function configValue(runtimeConfig, key, fallback = "") {
  const source = runtimeConfig || {};
  if (Object.prototype.hasOwnProperty.call(source, key)) {
    const value = source[key];
    return value === undefined || value === null || value === "" ? fallback : value;
  }
  return process.env[key] || fallback;
}

function getProviderPolicy(runtimeConfig) {
  const value = String(configValue(runtimeConfig, "AI_PROVIDER_POLICY", "auto")).trim().toLowerCase();
  return ["auto", "always", "tool-only"].includes(value) ? value : "auto";
}

module.exports = {
  nowIso,
  configValue,
  getProviderPolicy,
  isPublicRuntime,
  stableAction,
  stableCard,
  stableGeneratedPayload,
};
