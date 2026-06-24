const assert = require("assert");

const {
  normalizeChannelError,
  normalizeImportChannelStrategy,
  shouldFallbackToOracle,
} = require("../server/src/services/fosuApaasImporter");

function errorWithCode(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function run() {
  assert.strictEqual(normalizeImportChannelStrategy("cloudbase"), "cloudbase");
  assert.strictEqual(normalizeImportChannelStrategy("oracle"), "oracle");
  assert.strictEqual(normalizeImportChannelStrategy("auto"), "auto");
  assert.strictEqual(normalizeImportChannelStrategy("bad-value"), "auto");

  assert.strictEqual(normalizeChannelError(errorWithCode("ECONNABORTED"), "oracle").code, "SCHOOL_SYSTEM_TIMEOUT");
  assert.strictEqual(normalizeChannelError(errorWithCode("ETIMEDOUT"), "cloudbase").code, "NETWORK_TIMEOUT");
  assert.strictEqual(normalizeChannelError(errorWithCode("SCHOOL_SYSTEM_TIMEOUT"), "cloudbase").code, "SCHOOL_SYSTEM_TIMEOUT");

  assert.strictEqual(shouldFallbackToOracle(errorWithCode("NETWORK_TIMEOUT")), true);
  assert.strictEqual(shouldFallbackToOracle(errorWithCode("CLOUDBASE_IMPORT_FAILED")), true);
  assert.strictEqual(shouldFallbackToOracle(errorWithCode("INVALID_CREDENTIALS")), false);
  assert.strictEqual(shouldFallbackToOracle(errorWithCode("CAPTCHA_REQUIRED")), false);
  assert.strictEqual(shouldFallbackToOracle(errorWithCode("RISK_CONTROL_REQUIRED")), false);

  console.log("test-fosu-apaas-import-channels passed");
}

run();
