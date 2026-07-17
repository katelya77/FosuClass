const assert = require("assert");
const path = require("path");

function clearConfigModules() {
  for (const key of Object.keys(require.cache)) {
    const norm = key.replace(/\\/g, "/");
    if (
      norm.includes("/server/src/config") ||
      norm.includes("/server/src/services/configValidation") ||
      norm.includes("/server/src/services/serviceTokenService")
    ) {
      delete require.cache[key];
    }
  }
}

function withEnv(patch, fn) {
  const prev = { ...process.env };
  // Apply patch (allow empty string for ADMIN_API_TOKEN)
  Object.keys(patch).forEach((k) => {
    if (patch[k] === undefined) delete process.env[k];
    else process.env[k] = patch[k];
  });
  clearConfigModules();
  try {
    return fn();
  } finally {
    process.env = prev;
    clearConfigModules();
  }
}

// Case 1: production + derived token + hard fail off → ok with warning
withEnv(
  {
    NODE_ENV: "production",
    ADMIN_PASSWORD: "prod-password-value",
    ADMIN_API_TOKEN: "", // force empty so config derives (dotenv will not override existing empty)
    ADMIN_TOKEN: "",
    FOSU_CONFIG_HARD_FAIL: "false",
    ADMIN_SERVICE_TOKENS: undefined,
  },
  () => {
    const config = require("../server/src/config");
    assert.strictEqual(config.ADMIN_API_LEGACY_DERIVED, true, "expected derived token mode");
    const { validateStartupConfig } = require("../server/src/services/configValidation");
    const result = validateStartupConfig({ hardFail: false });
    assert.strictEqual(result.ok, true, `soft mode should pass: ${result.errors.join("; ")}`);
    assert.ok(
      result.warnings.some((w) => /derived|ADMIN_API_TOKEN/i.test(w)),
      "should warn about derived token"
    );
    assert.ok(!JSON.stringify(result).includes("prod-password-value"), "must not leak password/token");
  }
);

// Case 2: production + derived + hard fail true → fails
withEnv(
  {
    NODE_ENV: "production",
    ADMIN_PASSWORD: "prod-password-value",
    ADMIN_API_TOKEN: "",
    ADMIN_TOKEN: "",
    FOSU_CONFIG_HARD_FAIL: "true",
  },
  () => {
    const config = require("../server/src/config");
    assert.strictEqual(config.ADMIN_API_LEGACY_DERIVED, true);
    const { validateStartupConfig } = require("../server/src/services/configValidation");
    let threw = false;
    try {
      validateStartupConfig({ hardFail: true });
    } catch (e) {
      threw = true;
      assert.strictEqual(e.code, "CONFIG_VALIDATION_FAILED");
    }
    assert.strictEqual(threw, true, "hard fail should throw");
  }
);

// Case 3: production + explicit token → pass
withEnv(
  {
    NODE_ENV: "production",
    ADMIN_PASSWORD: "prod-password-value",
    ADMIN_API_TOKEN: "explicit-independent-token-value",
    FOSU_CONFIG_HARD_FAIL: "true",
  },
  () => {
    const config = require("../server/src/config");
    assert.strictEqual(config.ADMIN_API_LEGACY_DERIVED, false);
    const { validateStartupConfig } = require("../server/src/services/configValidation");
    const result = validateStartupConfig({ hardFail: true });
    assert.strictEqual(result.ok, true, result.errors.join("; "));
    assert.ok(!JSON.stringify(result).includes("explicit-independent-token-value"), "no token leak");
  }
);

console.log("Config migration-safe tests passed.");
