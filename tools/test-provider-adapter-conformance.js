#!/usr/bin/env node
const assert = require("assert");
const axios = require("../server/node_modules/axios");

const { createProviderRuntime, normalizeDecisionContract } = require("../packages/provider-runtime");
const { createProviderAdapters } = require("../server/src/services/ai/providerRuntimeComposition");

const decision = {
  schemaVersion: "decision.v2",
  goal: { name: "get_teaching_week", confidence: 0.99, requiresClarification: false },
  entities: [],
  constraints: {},
  skillCandidates: [{ skillId: "teaching_week", confidence: 0.98 }],
  plan: { steps: [{ id: "read-week", skillId: "teaching_week", purpose: "Read teaching week" }] },
  responseMode: "deterministic",
};

const validationOptions = {
  allowedSkillIds: ["teaching_week"],
  allowedGoalIds: ["get_teaching_week"],
  skillGoalMap: { teaching_week: ["get_teaching_week"] },
};

async function runAdapter(provider, providerRuntimeConfig) {
  const adapters = createProviderAdapters();
  const adapter = adapters.find((item) => item.id === provider);
  assert.ok(adapter, `${provider} adapter must be registered`);
  const runtime = createProviderRuntime({ adapters: [adapter] });
  return runtime.generateStructured({
    runtimeMode: "trial",
    executionPolicy: "strict_model_first",
    stage: "decision",
    intendedProvider: provider,
    request: {
      purpose: "decision",
      messages: [
        { role: "system", content: "Return DecisionContract V2 JSON." },
        { role: "user", content: "teaching week" },
      ],
      providerRuntimeConfig,
    },
    validate: (value) => normalizeDecisionContract(value, validationOptions),
    timeoutMs: 1000,
    stageCapMs: 900,
    finishReserveMs: 0,
  });
}

async function run() {
  const originalPost = axios.post;
  const calls = [];
  axios.post = async (url, body, options) => {
    calls.push({ url: String(url), body, options });
    if (/\/messages$/.test(String(url))) {
      return {
        data: {
          content: [{ type: "text", text: JSON.stringify(decision) }],
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      };
    }
    return {
      data: {
        choices: [{ message: { content: JSON.stringify(decision) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      },
    };
  };

  try {
    const deepseek = await runAdapter("deepseek", {
      DEEPSEEK_API_KEY: "mock-not-real",
      AI_BASE_URL: "https://deepseek.mock/v1",
      AI_DECISION_MODEL: "decision-model",
    });
    assert.strictEqual(deepseek.provider, "deepseek");

    const cloudbase = await runAdapter("cloudbase-openai", {
      CLOUDBASE_OPENAI_ENABLED: "true",
      CLOUDBASE_OPENAI_API_KEY: "mock-not-real",
      CLOUDBASE_OPENAI_BASE_URL: "https://cloudbase.mock/v1",
      AI_DECISION_MODEL: "decision-model",
    });
    assert.strictEqual(cloudbase.provider, "cloudbase-openai");

    const anthropic = await runAdapter("custom-anthropic", {
      AI_CUSTOM_ACTIVE_ID: "anthropic-mock",
      AI_CUSTOM_PROVIDERS: JSON.stringify([{
        id: "anthropic-mock",
        label: "Anthropic mock",
        protocol: "anthropic",
        baseUrl: "https://anthropic.mock/v1",
        apiKey: "mock-not-real",
        model: "decision-model",
        enabled: true,
      }]),
      AI_DECISION_MODEL: "decision-model",
    });
    assert.strictEqual(anthropic.provider, "custom-anthropic");

    assert.strictEqual(calls.length, 3);
    assert.ok(calls[0].body.response_format && calls[0].body.response_format.type === "json_object");
    assert.ok(calls[1].body.response_format && calls[1].body.response_format.type === "json_object");
    assert.ok(/DecisionContract V2/.test(calls[2].body.system));
    calls.forEach((call) => {
      assert.ok(call.options.timeout <= 900, "adapter must receive the Provider Runtime lease");
      assert.ok(!JSON.stringify(call).includes("real-secret"));
    });
    console.log("test-provider-adapter-conformance: PASS (DeepSeek, OpenAI-compatible, Anthropic-compatible)");
  } finally {
    axios.post = originalPost;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
