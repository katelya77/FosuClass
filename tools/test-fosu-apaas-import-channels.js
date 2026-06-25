const assert = require("assert");

const {
  normalizeChannelError,
  normalizeImportChannelStrategy,
  resolveImportChannels,
  sanitizeCloudbaseRelayErrorMessage,
  shouldRetryCloudbaseChannel,
  shouldFallbackToOracle,
} = require("../server/src/services/fosuApaasImporter");
const config = require("../server/src/config");

function errorWithCode(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function withConfig(patch, fn) {
  const old = {};
  Object.keys(patch).forEach((key) => {
    old[key] = config[key];
    config[key] = patch[key];
  });
  try {
    fn();
  } finally {
    Object.keys(patch).forEach((key) => {
      config[key] = old[key];
    });
  }
}

function run() {
  assert.strictEqual(normalizeImportChannelStrategy("cloudbase"), "cloudbase");
  assert.strictEqual(normalizeImportChannelStrategy("oracle"), "oracle");
  assert.strictEqual(normalizeImportChannelStrategy("auto"), "auto");
  assert.strictEqual(normalizeImportChannelStrategy("bad-value"), "auto");

  assert.strictEqual(normalizeChannelError(errorWithCode("ECONNABORTED"), "oracle").code, "SCHOOL_SYSTEM_TIMEOUT");
  assert.strictEqual(normalizeChannelError(errorWithCode("ETIMEDOUT"), "cloudbase").code, "NETWORK_TIMEOUT");
  assert.strictEqual(normalizeChannelError(errorWithCode("SCHOOL_SYSTEM_TIMEOUT"), "cloudbase").code, "SCHOOL_SYSTEM_TIMEOUT");
  assert.strictEqual(normalizeChannelError(errorWithCode("UPSTREAM_TIMEOUT"), "cloudbase").code, "UPSTREAM_TIMEOUT");

  withConfig({
    FOSU_IMPORT_CHANNEL: "auto",
    FOSU_CLOUDBASE_IMPORT_ENABLE: "true",
    FOSU_CLOUDBASE_IMPORT_URL: "https://relay.example.test/fosu-preview",
    FOSU_IMPORT_ORACLE_FALLBACK: "true",
  }, () => {
    assert.deepStrictEqual(resolveImportChannels().channels, ["cloudbase", "oracle"]);
  });

  withConfig({
    FOSU_IMPORT_CHANNEL: "auto",
    FOSU_CLOUDBASE_IMPORT_ENABLE: "false",
    FOSU_CLOUDBASE_IMPORT_URL: "",
    FOSU_IMPORT_ORACLE_FALLBACK: "true",
  }, () => {
    const plan = resolveImportChannels();
    assert.deepStrictEqual(plan.channels, ["oracle"]);
    assert.strictEqual(plan.reason, "cloudbase_not_configured");
  });

  withConfig({
    FOSU_IMPORT_CHANNEL: "auto",
    FOSU_CLOUDBASE_IMPORT_ENABLE: "true",
    FOSU_CLOUDBASE_IMPORT_URL: "https://relay.example.test/fosu-preview",
    FOSU_IMPORT_ORACLE_FALLBACK: "false",
  }, () => {
    assert.deepStrictEqual(resolveImportChannels().channels, ["cloudbase"]);
  });

  withConfig({
    FOSU_IMPORT_CHANNEL: "cloudbase",
    FOSU_CLOUDBASE_IMPORT_ENABLE: "true",
    FOSU_CLOUDBASE_IMPORT_URL: "https://relay.example.test/fosu-preview",
    FOSU_IMPORT_ORACLE_FALLBACK: "true",
  }, () => {
    const plan = resolveImportChannels();
    assert.deepStrictEqual(plan.channels, ["cloudbase"]);
    assert.strictEqual(plan.reason, "forced_cloudbase");
  });

  withConfig({
    FOSU_IMPORT_CHANNEL: "cloudbase",
    FOSU_CLOUDBASE_IMPORT_ENABLE: "false",
    FOSU_CLOUDBASE_IMPORT_URL: "",
    FOSU_IMPORT_ORACLE_FALLBACK: "true",
  }, () => {
    const plan = resolveImportChannels();
    assert.deepStrictEqual(plan.channels, ["oracle"]);
    assert.strictEqual(plan.reason, "cloudbase_not_configured_oracle_fallback");
  });

  withConfig({ FOSU_IMPORT_ORACLE_FALLBACK: "true" }, () => {
    assert.strictEqual(shouldFallbackToOracle(errorWithCode("NETWORK_TIMEOUT")), true);
    assert.strictEqual(shouldFallbackToOracle(errorWithCode("SCHOOL_SYSTEM_TIMEOUT")), true);
    assert.strictEqual(shouldFallbackToOracle(errorWithCode("UPSTREAM_TIMEOUT")), true);
    assert.strictEqual(shouldFallbackToOracle(errorWithCode("CLOUDBASE_SERVICE_UNAVAILABLE")), true);
    assert.strictEqual(shouldFallbackToOracle(errorWithCode("CLOUDBASE_IMPORT_FAILED")), true);
    assert.strictEqual(shouldFallbackToOracle(errorWithCode("APAAS_SESSION_UNVERIFIED")), true);
    assert.strictEqual(shouldFallbackToOracle(errorWithCode("INVALID_CREDENTIALS")), false);
    assert.strictEqual(shouldFallbackToOracle(errorWithCode("CAPTCHA_REQUIRED")), false);
    assert.strictEqual(shouldFallbackToOracle(errorWithCode("RISK_CONTROL_REQUIRED")), false);
    assert.strictEqual(shouldFallbackToOracle(errorWithCode("LOGIN_PAGE_CHANGED")), false);
    assert.strictEqual(shouldFallbackToOracle(errorWithCode("APAAS_STRUCTURE_CHANGED")), false);
  });

  withConfig({ FOSU_IMPORT_ORACLE_FALLBACK: "false" }, () => {
    assert.strictEqual(shouldFallbackToOracle(errorWithCode("NETWORK_TIMEOUT")), false);
  });

  withConfig({ FOSU_IMPORT_CHANNEL_TIMEOUT_MS: 25000 }, () => {
    const quickNetworkError = errorWithCode("NETWORK_TIMEOUT");
    quickNetworkError.elapsedMs = 9000;
    assert.strictEqual(shouldRetryCloudbaseChannel(quickNetworkError), true);
    const slowNetworkError = errorWithCode("NETWORK_TIMEOUT");
    slowNetworkError.elapsedMs = 26000;
    assert.strictEqual(shouldRetryCloudbaseChannel(slowNetworkError), false);
    const unverified = errorWithCode("APAAS_SESSION_UNVERIFIED");
    unverified.elapsedMs = 5000;
    assert.strictEqual(shouldRetryCloudbaseChannel(unverified), true);
    assert.strictEqual(shouldRetryCloudbaseChannel(errorWithCode("INVALID_CREDENTIALS")), false);
    assert.strictEqual(shouldRetryCloudbaseChannel(errorWithCode("CAPTCHA_REQUIRED")), false);
  });

  const sanitized = sanitizeCloudbaseRelayErrorMessage("<html><body>password=secret Cookie: JSESSIONID=abc ticket=TICKET</body></html>");
  assert(!/secret|JSESSIONID=abc|TICKET|<html/i.test(sanitized), "relay errors must not expose secrets or HTML");

  console.log("test-fosu-apaas-import-channels passed");
}

run();
