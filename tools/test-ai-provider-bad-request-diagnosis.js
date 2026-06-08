const assert = require("assert");

process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "deepseek";
process.env.AI_PROVIDER_POLICY = "auto";
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";
process.env.AI_API_KEY = "unit-test-provider-key-not-real";

const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");
const agentService = require("../server/src/services/ai/agentService");

function axiosError(data, code = "ERR_BAD_REQUEST", status = 400) {
  return { code, response: { status, data } };
}

async function run() {
  assert.strictEqual(
    deepseekProvider.classifyHttpError(axiosError({ error: { message: "model not found" } })),
    "invalid_model"
  );
  assert.strictEqual(
    deepseekProvider.classifyHttpError(axiosError({ error: { message: "response_format json_object unsupported" } })),
    "invalid_payload"
  );
  assert.strictEqual(
    deepseekProvider.classifyHttpError(axiosError({ error: { message: "bad request" } })),
    "provider_bad_request"
  );
  assert.strictEqual(
    deepseekProvider.classifyHttpError({ code: "ECONNABORTED", message: "timeout of 1000ms exceeded" }),
    "provider_timeout"
  );

  const originalGenerate = deepseekProvider.generate;
  deepseekProvider.generate = async () => {
    const error = new Error("upstream rejected request");
    error.code = "ERR_BAD_REQUEST";
    error.response = { status: 400, data: { error: { message: "thinking parameter is invalid" } } };
    throw error;
  };
  try {
    const response = await agentService.chat({
      message: "FosuClass 是什么？",
      context: { timezone: "Asia/Shanghai" },
    });
    assert.strictEqual(response.success, true);
    assert.strictEqual(response.safety.externalProviderUsed, false);
    assert.strictEqual(response.safety.fallbackReason, "invalid_payload");
    const text = JSON.stringify(response);
    assert(!text.includes(process.env.AI_API_KEY), "response must not leak provider key");
    assert(!/thinking parameter is invalid/.test(text), "response must not expose upstream error detail");
  } finally {
    deepseekProvider.generate = originalGenerate;
  }

  console.log("test-ai-provider-bad-request-diagnosis passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
