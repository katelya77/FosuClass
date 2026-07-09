#!/usr/bin/env node

const axios = require("axios");
try {
  require("../server/src/config");
} catch (error) {
  // Standalone provider tests can run without the full server config module.
}
const agentService = require("../server/src/services/ai/agentService");
const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");
const cloudbaseOpenaiProvider = require("../server/src/services/ai/providers/cloudbaseOpenaiProvider");

const PROVIDERS = [
  {
    name: "deepseek",
    module: deepseekProvider,
    key: process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY || "",
    baseURL: process.env.AI_BASE_URL || "https://api.deepseek.com",
    model: process.env.AI_MODEL || "deepseek-v4-flash",
    runtimeConfig() {
      return {
        AI_API_KEY: this.key,
        DEEPSEEK_API_KEY: this.key,
        AI_BASE_URL: this.baseURL,
        AI_MODEL: this.model,
        AI_REASONING_MODEL: process.env.AI_REASONING_MODEL || "deepseek-v4-pro",
        AI_PROVIDER_JSON_REPAIR: "true",
        AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS || "15000",
      };
    },
  },
  {
    name: "cloudbase-openai",
    module: cloudbaseOpenaiProvider,
    key: process.env.CLOUDBASE_OPENAI_API_KEY || "",
    baseURL: process.env.CLOUDBASE_OPENAI_BASE_URL || "https://cloud1-d3g17rpe7566d3d5c.api.tcloudbasegateway.com/v1/ai/cloudbase",
    model: process.env.CLOUDBASE_OPENAI_TEXT_MODEL || "hy3-preview",
    runtimeConfig() {
      return {
        CLOUDBASE_OPENAI_ENABLED: "true",
        CLOUDBASE_OPENAI_API_KEY: this.key,
        CLOUDBASE_OPENAI_BASE_URL: this.baseURL,
        CLOUDBASE_OPENAI_TEXT_MODEL: this.model,
        CLOUDBASE_OPENAI_TIMEOUT_MS: process.env.CLOUDBASE_OPENAI_TIMEOUT_MS || "15000",
        CLOUDBASE_OPENAI_MAX_TOKENS: process.env.CLOUDBASE_OPENAI_MAX_TOKENS || "1200",
      };
    },
  },
];

function nowIso() {
  return new Date().toISOString();
}

function snippet(value, limit = 240) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, limit);
}

function summarizeError(error, provider) {
  const response = error && error.response || {};
  const body = response.data || error && error.data || error && error.message || "";
  return {
    status: error && (error.status || response.status) || 0,
    code: error && error.code || "",
    errorBody: snippet(typeof body === "string" ? body : JSON.stringify(body), 500),
    baseURL: provider.baseURL,
    model: provider.model,
  };
}

async function directCompletion(provider, message) {
  const startedAt = Date.now();
  const response = await axios.post(`${provider.baseURL.replace(/\/+$/, "")}/chat/completions`, {
    model: provider.model,
    stream: false,
    temperature: 0,
    max_tokens: 512,
    messages: [{ role: "user", content: message }],
  }, {
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${provider.key}`,
      "Content-Type": "application/json",
    },
  });
  const content = response.data &&
    response.data.choices &&
    response.data.choices[0] &&
    response.data.choices[0].message &&
    response.data.choices[0].message.content || "";
  return {
    provider: provider.name,
    resolvedProvider: provider.name,
    latencyMs: Date.now() - startedAt,
    fallback: false,
    toolCalls: [],
    answerSnippet: snippet(content, 120),
  };
}

async function providerProjectQa(provider) {
  const startedAt = Date.now();
  const generated = await provider.module.generate({
    message: "佛课小表能做什么",
    intent: { name: "project_qa", slots: {} },
    toolResults: [],
    projectKnowledge: "佛课小表可查询全校课表、个人课表摘要、空教室、教学周、校历、天气和校园地图。事实类问题必须由工具核验。",
    providerRuntimeConfig: provider.runtimeConfig(),
  });
  return {
    provider: provider.name,
    resolvedProvider: generated.provider || provider.name,
    latencyMs: Date.now() - startedAt,
    fallback: false,
    toolCalls: [],
    answerSnippet: snippet(generated.answer, 160),
  };
}

function withProviderEnv(provider, fn) {
  const keys = [
    "AI_PROVIDER_ACTIVE_ENV",
    "AI_PROVIDER_ENVIRONMENTS",
    "AI_AGENT_ENABLED",
    "AI_PROVIDER",
    "AI_PROVIDER_POLICY",
    "AI_RUNTIME_MODE",
    "AI_COMPETITION_ALLOW_TRIAL_ENV",
    "AI_API_KEY",
    "DEEPSEEK_API_KEY",
    "AI_BASE_URL",
    "AI_MODEL",
    "AI_REASONING_MODEL",
    "CLOUDBASE_OPENAI_ENABLED",
    "CLOUDBASE_OPENAI_API_KEY",
    "CLOUDBASE_OPENAI_BASE_URL",
    "CLOUDBASE_OPENAI_TEXT_MODEL",
  ];
  const previous = {};
  keys.forEach((key) => {
    previous[key] = process.env[key];
  });
  const runtimeConfig = provider.runtimeConfig();
  const externalProfile = {
    enabled: true,
    provider: provider.name,
    providerPolicy: "auto",
  };
  if (provider.name === "cloudbase-openai") {
    Object.assign(externalProfile, {
      cloudbaseOpenaiEnabled: true,
      cloudbaseOpenaiBaseUrl: runtimeConfig.CLOUDBASE_OPENAI_BASE_URL,
      cloudbaseOpenaiTextModel: runtimeConfig.CLOUDBASE_OPENAI_TEXT_MODEL,
      cloudbaseOpenaiTimeoutMs: runtimeConfig.CLOUDBASE_OPENAI_TIMEOUT_MS,
      cloudbaseOpenaiMaxTokens: runtimeConfig.CLOUDBASE_OPENAI_MAX_TOKENS,
    });
  } else if (provider.name === "deepseek") {
    Object.assign(externalProfile, {
      baseUrl: runtimeConfig.AI_BASE_URL,
      model: runtimeConfig.AI_MODEL,
      reasoningModel: runtimeConfig.AI_REASONING_MODEL,
      timeoutMs: runtimeConfig.AI_TIMEOUT_MS,
      maxTokens: runtimeConfig.AI_MAX_TOKENS,
      jsonRepair: runtimeConfig.AI_PROVIDER_JSON_REPAIR === "true",
    });
  }
  const profiles = {
    public: { environment: "public", enabled: false, provider: "mock", providerPolicy: "tool-only" },
    trial: Object.assign({ environment: "trial" }, externalProfile),
    dev: Object.assign({ environment: "dev" }, externalProfile),
  };
  process.env.AI_PROVIDER_ACTIVE_ENV = "trial";
  process.env.AI_PROVIDER_ENVIRONMENTS = JSON.stringify(profiles);
  process.env.AI_AGENT_ENABLED = "true";
  process.env.AI_PROVIDER = provider.name;
  process.env.AI_PROVIDER_POLICY = "auto";
  process.env.AI_RUNTIME_MODE = "competition";
  process.env.AI_COMPETITION_ALLOW_TRIAL_ENV = "true";
  Object.assign(process.env, runtimeConfig);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      keys.forEach((key) => {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      });
    });
}

async function agentToolDecision(provider, message) {
  const startedAt = Date.now();
  const payload = await withProviderEnv(provider, () => agentService.chat({
    message,
    runtimeMode: "competition",
    serverSession: { adminProviderVerification: true },
    context: {
      envVersion: "trial",
      runtimeMode: "competition",
      currentPage: "tools/test-live-ai-providers",
      clientTime: nowIso(),
      clientLocalTime: nowIso(),
      assistantRuntimeCacheBust: `${Date.now()}-${Math.random()}`,
      assistantRuntimeMaxAgeMs: 5000,
      currentScheduleSummary: { enabled: false, courses: [] },
    },
  }));
  return {
    provider: provider.name,
    resolvedProvider: payload.safety && payload.safety.resolvedProvider || payload.safety && payload.safety.provider || "mock",
    latencyMs: payload.metrics && payload.metrics.latencyMs || Date.now() - startedAt,
    fallback: payload.metrics && payload.metrics.fallback === true || Boolean(payload.safety && payload.safety.fallbackReason),
    toolCalls: (payload.toolCalls || []).map((item) => ({ name: item.name, status: item.status })),
    answerSnippet: snippet(payload.answer, 160),
  };
}

async function agentProjectQaTrial(provider) {
  const startedAt = Date.now();
  const payload = await withProviderEnv(provider, () => agentService.chat({
    message: "佛课小表能做什么",
    runtimeMode: "competition",
    context: {
      envVersion: "trial",
      runtimeMode: "competition",
      currentPage: "tools/test-live-ai-providers",
      clientTime: nowIso(),
      clientLocalTime: nowIso(),
      assistantRuntimeCacheBust: `${Date.now()}-${Math.random()}`,
      assistantRuntimeMaxAgeMs: 5000,
      currentScheduleSummary: { enabled: false, courses: [] },
    },
  }));
  return {
    provider: provider.name,
    resolvedProvider: payload.safety && payload.safety.resolvedProvider || payload.safety && payload.safety.provider || "mock",
    latencyMs: payload.metrics && payload.metrics.latencyMs || Date.now() - startedAt,
    fallback: payload.metrics && payload.metrics.fallback === true || Boolean(payload.safety && payload.safety.fallbackReason),
    toolCalls: (payload.toolCalls || []).map((item) => ({ name: item.name, status: item.status })),
    answerSnippet: snippet(payload.answer, 160),
  };
}

async function runProvider(provider) {
  const results = [];
  if (!provider.key) {
    return {
      provider: provider.name,
      skipped: true,
      reason: `${provider.name} key is not configured in local environment`,
      baseURL: provider.baseURL,
      model: provider.model,
      results,
    };
  }
  const cases = [
    ["basic_connectivity", () => directCompletion(provider, "你好，只回复 OK")],
    ["project_qa", () => providerProjectQa(provider)],
    ["agent_project_qa_trial_env", () => agentProjectQaTrial(provider)],
    ["tool_today_schedule", () => agentToolDecision(provider, "帮我查今天课表")],
    ["tool_empty_room", () => agentToolDecision(provider, "帮我查空教室")],
  ];
  for (const [name, fn] of cases) {
    try {
      const result = await fn();
      const factCase = name.startsWith("tool_");
      const agentExternalCase = name === "agent_project_qa_trial_env";
      const ok = factCase
        ? result.toolCalls.length > 0 && result.resolvedProvider !== provider.name
        : agentExternalCase
          ? result.resolvedProvider === provider.name && Boolean(result.answerSnippet)
          : Boolean(result.answerSnippet);
      results.push(Object.assign({ case: name, ok }, result));
    } catch (error) {
      results.push(Object.assign({
        case: name,
        ok: false,
        provider: provider.name,
        resolvedProvider: "",
        latencyMs: 0,
        fallback: true,
        toolCalls: [],
        answerSnippet: "",
      }, summarizeError(error, provider)));
    }
  }
  return {
    provider: provider.name,
    skipped: false,
    baseURL: provider.baseURL,
    model: provider.model,
    results,
  };
}

async function main() {
  const report = [];
  for (const provider of PROVIDERS) {
    report.push(await runProvider(provider));
  }
  const configured = report.filter((item) => !item.skipped);
  const failures = configured.flatMap((item) => item.results.filter((result) => result.ok !== true).map((result) => `${item.provider}:${result.case}`));
  console.log(JSON.stringify({ success: failures.length === 0, failures, providers: report }, null, 2));
  if (configured.length > 0 && failures.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ success: false, message: error && error.message || String(error) }, null, 2));
    process.exit(1);
  });
}
