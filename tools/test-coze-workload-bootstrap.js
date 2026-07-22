#!/usr/bin/env node
const assert = require("assert");
const {
  configureCozeWorkload,
  readWorkloadConfig,
} = require("../server/scripts/configure-coze-workload");

async function run() {
  const env = {
    COZE_API_KEY: "never-log-this-token",
    COZE_API_MODE: "workload",
    COZE_WORKLOAD_ENDPOINT: "https://example123.coze.site/stream_run",
    COZE_PROJECT_ID: "7664956206057914406",
  };
  const config = readWorkloadConfig(env);
  assert.strictEqual(config.apiMode, "workload");
  assert.strictEqual(config.projectId, "7664956206057914406");
  assert.throws(() => readWorkloadConfig({ ...env, COZE_WORKLOAD_ENDPOINT: "https://example.com/stream_run" }), /endpoint/i);
  assert.throws(() => readWorkloadConfig({ ...env, COZE_PROJECT_ID: "bad-id" }), /project/i);

  const saves = [];
  const result = await configureCozeWorkload({
    env,
    verify: true,
    configService: {
      saveConfig(payload) {
        saves.push(payload);
        return { activeEnvironment: payload.activeEnvironment };
      },
      getRuntimeConfigForEnvironment(environment) {
        return { environment };
      },
    },
    provider: {
      async testConnection(input) {
        assert.strictEqual(input.providerRuntimeConfig.environment, "trial");
        return { success: true, code: "COZE_CONNECTION_OK", apiMode: "workload", projectIdMasked: "****4406", latencyMs: 12 };
      },
    },
  });
  assert.deepStrictEqual(saves.map((item) => item.environment), ["dev", "trial"]);
  assert.ok(saves.every((item) => item.provider === "coze" && item.cozeApiMode === "workload"));
  assert.ok(saves.every((item) => item.cozeApiKey === env.COZE_API_KEY), "deployment token should enter the encrypted runtime store");
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.projectIdMasked, "****4406");
  assert.ok(!JSON.stringify(result).includes(env.COZE_API_KEY));
  console.log("test-coze-workload-bootstrap: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
