const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-ai-provider-bad-request-"));
const deepseekProfiles = JSON.stringify({
  public: { environment: "public", enabled: false, provider: "mock", providerPolicy: "tool-only" },
  trial: { environment: "trial", enabled: true, provider: "deepseek", providerPolicy: "auto" },
  dev: { environment: "dev", enabled: true, provider: "deepseek", providerPolicy: "auto" },
});

process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "deepseek";
process.env.AI_PROVIDER_POLICY = "auto";
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";
process.env.FOSU_AI_PROVIDER_CONFIG_PATH = path.join(tempRoot, "ai-provider-config.json");
process.env.AI_API_KEY = "unit-test-provider-key-not-real";
process.env.AI_RUNTIME_MODE = "competition";
process.env.AI_PROVIDER_ACTIVE_ENV = process.env.AI_PROVIDER_ACTIVE_ENV || "trial";
process.env.AI_COMPETITION_ALLOW_ALL_SESSIONS = "true";
process.env.AI_PROVIDER_CHAIN = "deepseek,mock";
process.env.NODE_ENV = "development";
process.env.AI_PROVIDER_ENVIRONMENTS = deepseekProfiles;

const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");
const agentService = require("../server/src/services/ai/agentService");
process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "deepseek";
process.env.AI_PROVIDER_POLICY = "auto";
process.env.AI_API_KEY = "unit-test-provider-key-not-real";
process.env.AI_RUNTIME_MODE = "competition";
process.env.AI_PROVIDER_ACTIVE_ENV = process.env.AI_PROVIDER_ACTIVE_ENV || "trial";
process.env.AI_COMPETITION_ALLOW_ALL_SESSIONS = "true";
process.env.AI_PROVIDER_CHAIN = "deepseek,mock";
process.env.NODE_ENV = "development";
process.env.AI_PROVIDER_ENVIRONMENTS = deepseekProfiles;

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
  const originalGenerateStructured = deepseekProvider.generateStructured;
  deepseekProvider.generateStructured = async (input) => ({
    provider: "deepseek",
    content: JSON.stringify(input.purpose === "understanding" ? {
      goal: "project_qa",
      entityType: "none",
      entity: "",
      normalizedEntity: "",
      constraints: {},
      followUpMode: "new_goal",
      confidence: 0.99,
      needsClarification: false,
    } : {
      goal: "回答 FosuClass 项目问题",
      intent: "project_qa",
      confidence: 0.99,
      slots: {},
      needsClarification: false,
      clarification: null,
      steps: [{ toolName: "rag_search", args: { q: "FosuClass" }, reasonCode: "NEED_KNOWLEDGE" }],
      stopCondition: "all_steps_done",
    }),
  });
  deepseekProvider.generate = async () => {
    const error = new Error("upstream rejected request");
    error.code = "ERR_BAD_REQUEST";
    error.response = { status: 400, data: { error: { message: "thinking parameter is invalid" } } };
    throw error;
  };
  try {
    const response = await agentService.chat({
      message: "FosuClass 是什么？",
      context: { timezone: "Asia/Shanghai", envVersion: "develop" },
      runtimeMode: "competition",
      serverSession: { openidHash: "unit-test-openid" },
    });
    assert.strictEqual(response.success, true);
    assert.strictEqual(response.safety.externalProviderUsed, true, "the run-level truth must include model-first Provider attempts");
    assert.strictEqual(response.providerStages.response.attempted, true, "the response Provider was attempted before deterministic fallback");
    assert.strictEqual(response.providerStages.response.completed, false);
    assert.strictEqual(response.providerStages.response.fallback, true);
    const fallbackReasons = String(response.providerStages.response.reasonCode || "")
      .replace(/^provider_chain_fallback:/, "")
      .split(",")
      .filter(Boolean);
    assert(
      response.safety.fallbackReason === "" || fallbackReasons.some((item) => ["invalid_payload", "bad_request"].includes(item)),
      `unexpected fallback diagnosis: ${response.safety.fallbackReason}`
    );
    const text = JSON.stringify(response);
    assert(!text.includes(process.env.AI_API_KEY), "response must not leak provider key");
    assert(!/thinking parameter is invalid/.test(text), "response must not expose upstream error detail");
  } finally {
    deepseekProvider.generate = originalGenerate;
    deepseekProvider.generateStructured = originalGenerateStructured;
  }

  console.log("test-ai-provider-bad-request-diagnosis passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
