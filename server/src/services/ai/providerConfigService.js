const fs = require("fs");
const path = require("path");
const runtimeStore = require("./providerRuntimeConfigStore");
const runtimeModeService = require("./runtimeModeService");
const customProviderStore = require("./customProviderStore");

const SERVER_ROOT = path.resolve(__dirname, "../../..");
const ENV_PATH = path.join(SERVER_ROOT, ".env");
const ENV_EXAMPLE_PATH = path.join(SERVER_ROOT, ".env.example");
const CLOUDBASE_CLIENT_CONFIG_PATH = path.resolve(SERVER_ROOT, "..", "miniprogram", "config", "cloudbase.js");

const ENVIRONMENTS = ["public", "trial", "dev"];
const EXTERNAL_PROVIDERS = ["openrouter", "cloudbase-openai", "deepseek", "coze", "custom-openai", "custom-anthropic"];
const BUILTIN_PROVIDERS = ["mock", "openrouter", "cloudbase-openai", "deepseek", "coze"];
const REMOVABLE_BUILTIN_PROVIDERS = ["openrouter", "cloudbase-openai", "deepseek", "coze"];

const AI_ENV_KEYS = [
  "AI_AGENT_ENABLED",
  "AI_PROVIDER",
  "AI_PROVIDER_POLICY",
  "AI_PROVIDER_CHAIN",
  "AI_UNDERSTANDING_ENABLED",
  "AI_UNDERSTANDING_MODEL",
  "AI_PLANNER_MODEL",
  "AI_UNDERSTANDING_PROVIDER",
  "AI_PLANNER_PROVIDER",
  "AI_RESPONSE_PROVIDER",
  "AI_STRUCTURED_TIMEOUT_MS",
  "AI_STRUCTURED_MAX_TOKENS",
  "AI_PROVIDER_SHADOW_ENABLED",
  "AI_PROVIDER_SHADOW",
  "AI_PROVIDER_SHADOW_TIMEOUT_MS",
  "AI_MODEL",
  "AI_REASONING_MODEL",
  "AI_BASE_URL",
  "AI_TIMEOUT_MS",
  "AI_MAX_TOKENS",
  "AI_TEMPERATURE",
  "AI_THINKING_ENABLED",
  "AI_REASONING_EFFORT",
  "AI_PROVIDER_JSON_REPAIR",
  "DEEPSEEK_STRICT_JSON_MODE",
  "AI_ALLOW_PERSONAL_CONTEXT",
  "AI_PROVIDER_ACTIVE_ENV",
  "AI_PROVIDER_ENVIRONMENTS",
  "AI_PROVIDER_RUNTIME_VERSION",
  "AI_PROVIDER_RUNTIME_UPDATED_AT",
  "AI_DISABLED_PROVIDERS",
  "AI_API_KEY",
  "DEEPSEEK_API_KEY",
  "COZE_ENABLED",
  "COZE_EXPIRES_AT",
  "COZE_PROVIDER_ROLE",
  "COZE_API_BASE_URL",
  "COZE_API_KEY",
  "COZE_API_MODE",
  "COZE_BOT_ID",
  "COZE_AGENT_ID",
  "COZE_CHAT_ENDPOINT",
  "COZE_WORKLOAD_ENDPOINT",
  "COZE_PROJECT_ID",
  "COZE_TIMEOUT_MS",
  "COZE_POLL_ENABLED",
  "COZE_POLL_INTERVAL_MS",
  "COZE_POLL_MAX_ATTEMPTS",
  "AI_RUNTIME_MODE",
  "AI_COMPETITION_CAPABILITY_EXPIRES_AT",
  "CLOUDBASE_OPENAI_ENABLED",
  "CLOUDBASE_OPENAI_BASE_URL",
  "CLOUDBASE_OPENAI_API_KEY",
  "CLOUDBASE_OPENAI_TEXT_MODEL",
  "CLOUDBASE_OPENAI_TIMEOUT_MS",
  "CLOUDBASE_OPENAI_MAX_TOKENS",
  "OPENROUTER_ENABLED",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODELS",
  "OPENROUTER_TIMEOUT_MS",
  "OPENROUTER_MAX_TOKENS",
  "AI_CUSTOM_PROVIDERS",
  "AI_CUSTOM_ACTIVE_ID",
];

const DEFAULTS = {
  AI_AGENT_ENABLED: "false",
  AI_PROVIDER: "mock",
  AI_PROVIDER_POLICY: "auto",
  AI_PROVIDER_CHAIN: "",
  AI_UNDERSTANDING_ENABLED: "true",
  AI_UNDERSTANDING_MODEL: "",
  AI_PLANNER_MODEL: "",
  AI_UNDERSTANDING_PROVIDER: "",
  AI_PLANNER_PROVIDER: "",
  AI_RESPONSE_PROVIDER: "",
  AI_STRUCTURED_TIMEOUT_MS: "8000",
  AI_STRUCTURED_MAX_TOKENS: "800",
  AI_PROVIDER_SHADOW_ENABLED: "false",
  AI_PROVIDER_SHADOW: "",
  AI_PROVIDER_SHADOW_TIMEOUT_MS: "3000",
  AI_MODEL: "deepseek-v4-flash",
  AI_REASONING_MODEL: "deepseek-v4-pro",
  AI_BASE_URL: "https://api.deepseek.com",
  AI_TIMEOUT_MS: "15000",
  AI_MAX_TOKENS: "1200",
  AI_TEMPERATURE: "0.1",
  AI_THINKING_ENABLED: "false",
  AI_REASONING_EFFORT: "medium",
  AI_PROVIDER_JSON_REPAIR: "true",
  DEEPSEEK_STRICT_JSON_MODE: "false",
  AI_ALLOW_PERSONAL_CONTEXT: "false",
  AI_PROVIDER_ACTIVE_ENV: "public",
  AI_PROVIDER_ENVIRONMENTS: "",
  AI_PROVIDER_RUNTIME_VERSION: "",
  AI_PROVIDER_RUNTIME_UPDATED_AT: "",
  AI_DISABLED_PROVIDERS: "",
  COZE_ENABLED: "false",
  COZE_EXPIRES_AT: "",
  COZE_PROVIDER_ROLE: "temporary",
  COZE_API_BASE_URL: "https://api.coze.cn",
  COZE_API_MODE: "bot",
  COZE_CHAT_ENDPOINT: "/v3/chat",
  COZE_WORKLOAD_ENDPOINT: "",
  COZE_PROJECT_ID: "",
  COZE_TIMEOUT_MS: "15000",
  COZE_POLL_ENABLED: "true",
  COZE_POLL_INTERVAL_MS: "1000",
  COZE_POLL_MAX_ATTEMPTS: "12",
  AI_RUNTIME_MODE: "public",
  CLOUDBASE_OPENAI_ENABLED: "false",
  CLOUDBASE_OPENAI_BASE_URL: "https://cloud1-d3g17rpe7566d3d5c.api.tcloudbasegateway.com/v1/ai/cloudbase",
  CLOUDBASE_OPENAI_TEXT_MODEL: "hy3-preview",
  CLOUDBASE_OPENAI_TIMEOUT_MS: "15000",
  CLOUDBASE_OPENAI_MAX_TOKENS: "1200",
  OPENROUTER_ENABLED: "false",
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  OPENROUTER_MODELS: "z-ai/glm-5.2:free,nvidia/nemotron-3-super-120b-a12b:free,liquid/lfm-2.5-2.6b:free,openrouter/free",
  OPENROUTER_TIMEOUT_MS: "12000",
  OPENROUTER_MAX_TOKENS: "800",
  AI_CUSTOM_PROVIDERS: "",
  AI_CUSTOM_ACTIVE_ID: "",
};

const PROFILE_FIELD_TO_ENV = {
  enabled: "AI_AGENT_ENABLED",
  provider: "AI_PROVIDER",
  providerPolicy: "AI_PROVIDER_POLICY",
  providerChain: "AI_PROVIDER_CHAIN",
  understandingEnabled: "AI_UNDERSTANDING_ENABLED",
  understandingModel: "AI_UNDERSTANDING_MODEL",
  plannerModel: "AI_PLANNER_MODEL",
  understandingProvider: "AI_UNDERSTANDING_PROVIDER",
  plannerProvider: "AI_PLANNER_PROVIDER",
  responseProvider: "AI_RESPONSE_PROVIDER",
  structuredTimeoutMs: "AI_STRUCTURED_TIMEOUT_MS",
  structuredMaxTokens: "AI_STRUCTURED_MAX_TOKENS",
  shadowEnabled: "AI_PROVIDER_SHADOW_ENABLED",
  shadowProvider: "AI_PROVIDER_SHADOW",
  shadowTimeoutMs: "AI_PROVIDER_SHADOW_TIMEOUT_MS",
  model: "AI_MODEL",
  reasoningModel: "AI_REASONING_MODEL",
  baseUrl: "AI_BASE_URL",
  timeoutMs: "AI_TIMEOUT_MS",
  maxTokens: "AI_MAX_TOKENS",
  temperature: "AI_TEMPERATURE",
  thinkingEnabled: "AI_THINKING_ENABLED",
  reasoningEffort: "AI_REASONING_EFFORT",
  jsonRepair: "AI_PROVIDER_JSON_REPAIR",
  strictJsonMode: "DEEPSEEK_STRICT_JSON_MODE",
  allowPersonalContext: "AI_ALLOW_PERSONAL_CONTEXT",
  runtimeMode: "AI_RUNTIME_MODE",
  cozeEnabled: "COZE_ENABLED",
  cozeExpiresAt: "COZE_EXPIRES_AT",
  cozeProviderRole: "COZE_PROVIDER_ROLE",
  cozeBaseUrl: "COZE_API_BASE_URL",
  cozeApiMode: "COZE_API_MODE",
  cozeBotId: "COZE_BOT_ID",
  cozeAgentId: "COZE_AGENT_ID",
  cozeChatEndpoint: "COZE_CHAT_ENDPOINT",
  cozeWorkloadEndpoint: "COZE_WORKLOAD_ENDPOINT",
  cozeProjectId: "COZE_PROJECT_ID",
  cozeTimeoutMs: "COZE_TIMEOUT_MS",
  cozePollEnabled: "COZE_POLL_ENABLED",
  cozePollIntervalMs: "COZE_POLL_INTERVAL_MS",
  cozePollMaxAttempts: "COZE_POLL_MAX_ATTEMPTS",
  cloudbaseOpenaiEnabled: "CLOUDBASE_OPENAI_ENABLED",
  cloudbaseOpenaiBaseUrl: "CLOUDBASE_OPENAI_BASE_URL",
  cloudbaseOpenaiTextModel: "CLOUDBASE_OPENAI_TEXT_MODEL",
  cloudbaseOpenaiTimeoutMs: "CLOUDBASE_OPENAI_TIMEOUT_MS",
  cloudbaseOpenaiMaxTokens: "CLOUDBASE_OPENAI_MAX_TOKENS",
  openrouterEnabled: "OPENROUTER_ENABLED",
  openrouterBaseUrl: "OPENROUTER_BASE_URL",
  openrouterModels: "OPENROUTER_MODELS",
  openrouterTimeoutMs: "OPENROUTER_TIMEOUT_MS",
  openrouterMaxTokens: "OPENROUTER_MAX_TOKENS",
  activeCustomId: "AI_CUSTOM_ACTIVE_ID",
};

const BOOLEAN_PROFILE_FIELDS = new Set([
  "enabled",
  "thinkingEnabled",
  "jsonRepair",
  "strictJsonMode",
  "allowPersonalContext",
  "cozeEnabled",
  "cozePollEnabled",
  "cloudbaseOpenaiEnabled",
  "openrouterEnabled",
  "understandingEnabled",
  "shadowEnabled",
]);

function parseEnv(text) {
  const map = {};
  String(text || "").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index <= 0) return;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  });
  return map;
}

function readEnvFile() {
  if (fs.existsSync(ENV_PATH)) return fs.readFileSync(ENV_PATH, "utf8");
  if (fs.existsSync(ENV_EXAMPLE_PATH)) return fs.readFileSync(ENV_EXAMPLE_PATH, "utf8");
  return "";
}

function quoteEnvValue(value) {
  const text = String(value == null ? "" : value);
  if (!text || /^[A-Za-z0-9_./:@{}[\],"-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function setEnvLines(text, updates) {
  const nextLines = String(text || "").split(/\r?\n/);
  const seen = new Set();
  for (let index = 0; index < nextLines.length; index += 1) {
    const line = nextLines[index];
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!match) continue;
    const key = match[1];
    if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
    nextLines[index] = `${key}=${quoteEnvValue(updates[key])}`;
    seen.add(key);
  }
  Object.keys(updates).forEach((key) => {
    if (!seen.has(key)) nextLines.push(`${key}=${quoteEnvValue(updates[key])}`);
  });
  return nextLines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}

function readRuntimeValues() {
  return readRuntimeValuesResult().values;
}

function readRuntimeValuesResult() {
  try {
    return { values: runtimeStore.readRuntimeConfig(), error: null };
  } catch (error) {
    return { values: {}, error };
  }
}

// 进程级紧急开关：这些键允许运维用 process.env 显式覆盖运行时存储（kill switch），
// 其余键一律以持久化运行时存储（后台保存的配置文件）为准。
// 背景：历史上 process.env 优先会导致容器外写入（如配置脚本）被服务进程里的
// 陈旧 env 遮盖，后台切换 Provider 必须重启才生效——存储必须是唯一权威源。
const PROCESS_ENV_PRIORITY_KEYS = new Set(["AI_AGENT_ENABLED", "AI_UNDERSTANDING_ENABLED"]);

function getEffectiveValue(envFileValues, runtimeValues, key) {
  if (runtimeValues[key] && !PROCESS_ENV_PRIORITY_KEYS.has(key)) return runtimeValues[key];
  return process.env[key] || runtimeValues[key] || envFileValues[key] || DEFAULTS[key] || "";
}

function keyLast4(value) {
  const text = String(value || "");
  return text ? text.slice(-4) : "";
}

function normalizeProvider(value) {
  const provider = String(value || "mock").trim().toLowerCase();
  if (["hunyuan3", "hunyuan-3", "tencent-hunyuan3"].includes(provider)) {
    return "cloudbase-openai";
  }
  if (["openai-compatible", "custom-openai-compatible"].includes(provider)) {
    return "custom-openai";
  }
  if (["anthropic", "claude", "custom-claude"].includes(provider)) {
    return "custom-anthropic";
  }
  return ["mock", "openrouter", "deepseek", "coze", "cloudbase-openai", "custom-openai", "custom-anthropic"].includes(provider) ? provider : "mock";
}

function normalizeProviderPolicy(value) {
  const policy = String(value || "auto").trim().toLowerCase();
  return ["auto", "always", "tool-only"].includes(policy) ? policy : "auto";
}

// Strict chain-name normalizer: unknown names become "" (unlike normalizeProvider,
// which falls back to "mock"). Empty string is a valid stage assignment meaning
// "跟随主 Provider".
function normalizeChainName(value) {
  const provider = String(value == null ? "" : value).trim().toLowerCase();
  if (!provider) return "";
  if (["hunyuan3", "hunyuan-3", "tencent-hunyuan3"].includes(provider)) {
    return "cloudbase-openai";
  }
  if (["openai-compatible", "custom-openai-compatible"].includes(provider)) {
    return "custom-openai";
  }
  if (["anthropic", "claude", "custom-claude"].includes(provider)) {
    return "custom-anthropic";
  }
  return ["mock", "openrouter", "deepseek", "coze", "cloudbase-openai", "custom-openai", "custom-anthropic"].includes(provider) ? provider : "";
}

function parseChainNames(value) {
  const items = String(value || "")
    .split(",")
    .map((item) => normalizeChainName(item))
    .filter(Boolean);
  return Array.from(new Set(items));
}

function parseDisabledProviders(value) {
  return Array.from(new Set(String(value || "")
    .split(",")
    .map((item) => normalizeProvider(item))
    .filter((name) => REMOVABLE_BUILTIN_PROVIDERS.includes(name))));
}

const STAGE_PROVIDER_FIELDS = ["understandingProvider", "plannerProvider", "responseProvider"];

// 单选 == 第一跳：选哪个 Provider，就把持久化链重算为 [primary, ...旧链剔除 primary]，
// 保持其余 fallback 顺序。不允许出现"单选 A 但链首是 B"的持久态。
function recomputeChainForPrimary(provider, previousChainValue) {
  const primary = normalizeChainName(provider) || "mock";
  const rest = parseChainNames(previousChainValue).filter((name) => name !== primary);
  return [primary].concat(rest).join(",");
}

function normalizeBoolean(value) {
  return value === true || String(value).toLowerCase() === "true" ? "true" : "false";
}

function boolValue(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function normalizeEnvironment(value) {
  const env = String(value || "").trim().toLowerCase();
  if (env === "formal" || env === "release" || env === "production") return "public";
  if (env === "develop" || env === "development" || env === "devtools") return "dev";
  return ENVIRONMENTS.includes(env) ? env : "public";
}

function runtimeModeForEnvironment(environment) {
  return normalizeEnvironment(environment) === "public" ? "public" : "competition";
}

function defaultProfile(environment) {
  const env = normalizeEnvironment(environment);
  const base = {
    environment: env,
    enabled: false,
    provider: "mock",
    providerPolicy: env === "public" ? "tool-only" : "auto",
    providerChain: env === "public" ? "mock" : (env === "trial" || env === "dev" ? "openrouter,hunyuan3,deepseek,coze,mock" : ""),
    understandingEnabled: true,
    understandingModel: DEFAULTS.AI_UNDERSTANDING_MODEL,
    plannerModel: DEFAULTS.AI_PLANNER_MODEL,
    understandingProvider: "",
    plannerProvider: "",
    responseProvider: "",
    structuredTimeoutMs: DEFAULTS.AI_STRUCTURED_TIMEOUT_MS,
    structuredMaxTokens: DEFAULTS.AI_STRUCTURED_MAX_TOKENS,
    shadowEnabled: false,
    shadowProvider: "",
    shadowTimeoutMs: DEFAULTS.AI_PROVIDER_SHADOW_TIMEOUT_MS,
    model: DEFAULTS.AI_MODEL,
    reasoningModel: DEFAULTS.AI_REASONING_MODEL,
    baseUrl: DEFAULTS.AI_BASE_URL,
    timeoutMs: DEFAULTS.AI_TIMEOUT_MS,
    maxTokens: DEFAULTS.AI_MAX_TOKENS,
    temperature: DEFAULTS.AI_TEMPERATURE,
    thinkingEnabled: false,
    reasoningEffort: DEFAULTS.AI_REASONING_EFFORT,
    jsonRepair: true,
    strictJsonMode: false,
    allowPersonalContext: false,
    runtimeMode: runtimeModeForEnvironment(env),
    cozeEnabled: false,
    cozeExpiresAt: "",
    cozeProviderRole: "temporary",
    cozeBaseUrl: DEFAULTS.COZE_API_BASE_URL,
    cozeApiMode: DEFAULTS.COZE_API_MODE,
    cozeBotId: "",
    cozeAgentId: "",
    cozeChatEndpoint: DEFAULTS.COZE_CHAT_ENDPOINT,
    cozeWorkloadEndpoint: DEFAULTS.COZE_WORKLOAD_ENDPOINT,
    cozeProjectId: DEFAULTS.COZE_PROJECT_ID,
    cozeTimeoutMs: DEFAULTS.COZE_TIMEOUT_MS,
    cozePollEnabled: true,
    cozePollIntervalMs: DEFAULTS.COZE_POLL_INTERVAL_MS,
    cozePollMaxAttempts: DEFAULTS.COZE_POLL_MAX_ATTEMPTS,
    cloudbaseOpenaiEnabled: false,
    cloudbaseOpenaiBaseUrl: DEFAULTS.CLOUDBASE_OPENAI_BASE_URL,
    cloudbaseOpenaiTextModel: DEFAULTS.CLOUDBASE_OPENAI_TEXT_MODEL,
    cloudbaseOpenaiTimeoutMs: DEFAULTS.CLOUDBASE_OPENAI_TIMEOUT_MS,
    cloudbaseOpenaiMaxTokens: DEFAULTS.CLOUDBASE_OPENAI_MAX_TOKENS,
    openrouterEnabled: false,
    openrouterBaseUrl: DEFAULTS.OPENROUTER_BASE_URL,
    openrouterModels: DEFAULTS.OPENROUTER_MODELS,
    openrouterTimeoutMs: DEFAULTS.OPENROUTER_TIMEOUT_MS,
    openrouterMaxTokens: DEFAULTS.OPENROUTER_MAX_TOKENS,
    activeCustomId: "",
  };
  if (env === "dev") {
    base.thinkingEnabled = true;
  }
  return base;
}

function normalizeProfile(profile = {}, environment = "public") {
  const env = normalizeEnvironment(profile.environment || environment);
  const base = Object.assign({}, defaultProfile(env), profile || {}, {
    environment: env,
    runtimeMode: runtimeModeForEnvironment(env),
  });
  Object.keys(PROFILE_FIELD_TO_ENV).forEach((field) => {
    if (BOOLEAN_PROFILE_FIELDS.has(field)) {
      base[field] = boolValue(base[field]);
    } else if (field === "provider") {
      base[field] = normalizeProvider(base[field]);
    } else if (field === "providerPolicy") {
      base[field] = normalizeProviderPolicy(base[field]);
    } else if (field !== "runtimeMode") {
      base[field] = String(base[field] == null ? "" : base[field]).trim();
    }
  });
  base.cozeApiMode = base.cozeApiMode === "workload" ? "workload" : "bot";
  STAGE_PROVIDER_FIELDS.forEach((field) => {
    base[field] = normalizeChainName(base[field]);
  });
  if (env === "public") {
    base.enabled = false;
    base.provider = "mock";
    base.providerPolicy = "tool-only";
    base.providerChain = "mock";
    base.understandingProvider = "";
    base.plannerProvider = "";
    base.responseProvider = "";
    base.allowPersonalContext = false;
    base.thinkingEnabled = false;
    base.shadowEnabled = false;
    base.runtimeMode = "public";
  }
  if (base.provider === "mock") {
    base.enabled = false;
  }
  return base;
}

function profileToEnvUpdates(profile = {}) {
  const normalized = normalizeProfile(profile, profile.environment);
  const updates = {};
  Object.keys(PROFILE_FIELD_TO_ENV).forEach((field) => {
    const key = PROFILE_FIELD_TO_ENV[field];
    const value = normalized[field];
    updates[key] = BOOLEAN_PROFILE_FIELDS.has(field) ? normalizeBoolean(value) : String(value == null ? "" : value);
  });
  return updates;
}

function envValuesToProfile(value, environment) {
  const profile = {};
  Object.keys(PROFILE_FIELD_TO_ENV).forEach((field) => {
    const key = PROFILE_FIELD_TO_ENV[field];
    const raw = value(key);
    profile[field] = BOOLEAN_PROFILE_FIELDS.has(field) ? boolValue(raw) : raw;
  });
  return normalizeProfile(profile, environment);
}

function parseEnvironmentProfiles(rawValue, legacyProfile) {
  let parsed = null;
  try {
    parsed = rawValue ? JSON.parse(String(rawValue)) : null;
  } catch (error) {
    parsed = null;
  }
  const source = parsed && parsed.environments && typeof parsed.environments === "object"
    ? parsed.environments
    : (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null);
  const profiles = {};
  ENVIRONMENTS.forEach((env) => {
    profiles[env] = normalizeProfile(source && source[env] || defaultProfile(env), env);
  });
  if (!source && legacyProfile) {
    const legacyEnv = legacyProfile.runtimeMode === "competition" || EXTERNAL_PROVIDERS.includes(legacyProfile.provider)
      ? "trial"
      : "public";
    profiles[legacyEnv] = normalizeProfile(Object.assign({}, legacyProfile, {
      environment: legacyEnv,
      runtimeMode: runtimeModeForEnvironment(legacyEnv),
    }), legacyEnv);
    profiles.dev = normalizeProfile(Object.assign({}, profiles.trial, {
      environment: "dev",
      providerPolicy: profiles.trial.providerPolicy || "auto",
      runtimeMode: "competition",
    }), "dev");
  }
  profiles.public = normalizeProfile(profiles.public, "public");
  return profiles;
}

function serializeEnvironmentProfiles(profiles = {}) {
  const payload = {};
  ENVIRONMENTS.forEach((env) => {
    payload[env] = normalizeProfile(profiles[env], env);
  });
  return JSON.stringify(payload);
}

function buildSecretUpdates(payload = {}) {
  const updates = {};
  if (payload.apiKey) updates.AI_API_KEY = String(payload.apiKey).trim();
  if (payload.deepseekApiKey) updates.DEEPSEEK_API_KEY = String(payload.deepseekApiKey).trim();
  if (payload.cozeApiKey) updates.COZE_API_KEY = String(payload.cozeApiKey).trim();
  if (payload.cloudbaseOpenaiApiKey) updates.CLOUDBASE_OPENAI_API_KEY = String(payload.cloudbaseOpenaiApiKey).trim();
  if (payload.openrouterApiKey) updates.OPENROUTER_API_KEY = String(payload.openrouterApiKey).trim();
  return updates;
}

function buildProfilePatch(payload = {}) {
  const patch = {};
  Object.keys(PROFILE_FIELD_TO_ENV).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return;
    patch[field] = payload[field];
  });
  return patch;
}

function applyPreset(profile, preset, payload = {}) {
  const mode = String(preset || "").trim().toLowerCase();
  if (!mode) return profile;
  if (mode === "public-safe") {
    return normalizeProfile(defaultProfile("public"), "public");
  }
  if (mode === "mock" || mode === "restore-mock") {
    return normalizeProfile(Object.assign({}, profile, {
      enabled: false,
      provider: "mock",
      providerPolicy: "tool-only",
    }), profile.environment);
  }
  if (mode === "trial-enhanced") {
    return normalizeProfile(Object.assign({}, profile, {
      enabled: true,
      provider: EXTERNAL_PROVIDERS.includes(normalizeProvider(payload.provider || profile.provider)) ? normalizeProvider(payload.provider || profile.provider) : "deepseek",
      providerPolicy: "auto",
      runtimeMode: "competition",
    }), profile.environment === "public" ? "trial" : profile.environment);
  }
  if (mode === "dev-full") {
    return normalizeProfile(Object.assign({}, profile, {
      enabled: true,
      provider: EXTERNAL_PROVIDERS.includes(normalizeProvider(profile.provider)) ? profile.provider : "deepseek",
      providerPolicy: "always",
      thinkingEnabled: true,
      runtimeMode: "competition",
    }), "dev");
  }
  return profile;
}

function resolveSaveEnvironment(payload = {}, currentStatus = {}) {
  if (payload.environment || payload.targetEnvironment || payload.activeEnvironment) {
    return normalizeEnvironment(payload.environment || payload.targetEnvironment || payload.activeEnvironment);
  }
  if (payload.preset === "public-safe") return "public";
  if (payload.preset === "dev-full") return "dev";
  if (payload.preset === "trial-enhanced") return "trial";
  if (String(payload.runtimeMode || "").toLowerCase() === "competition") return "trial";
  if (payload.provider && normalizeProvider(payload.provider) !== "mock") return "trial";
  return normalizeEnvironment(currentStatus.activeEnvironment || "public");
}

function normalizeMirrorEnvironments(value, primaryEnvironment) {
  const primary = normalizeEnvironment(primaryEnvironment);
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  return list
    .map((item) => normalizeEnvironment(item))
    .filter((env) => env !== "public" && env !== primary)
    .filter((env) => {
      if (seen.has(env)) return false;
      seen.add(env);
      return true;
    });
}

function computeGlobalRuntimeMode(profiles = {}) {
  return ENVIRONMENTS.some((env) => {
    if (env === "public") return false;
    const profile = normalizeProfile(profiles[env], env);
    return profile.enabled && profile.provider !== "mock";
  }) ? "competition" : "public";
}

function ensureEnvFile() {
  if (fs.existsSync(ENV_PATH)) return readEnvFile();
  const seed = fs.existsSync(ENV_EXAMPLE_PATH) ? fs.readFileSync(ENV_EXAMPLE_PATH, "utf8") : "";
  fs.writeFileSync(ENV_PATH, seed, { encoding: "utf8", mode: 0o600 });
  return seed;
}

function applyUpdatesToProcessEnv(updates = {}) {
  Object.keys(updates).forEach((key) => {
    if (AI_ENV_KEYS.includes(key)) process.env[key] = String(updates[key]);
  });
}

function hasAnyDeepSeekKey(envFileValues, runtimeValues) {
  return Boolean(
    process.env.AI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.FOSUCLASS_DEEPSEEK_API_KEY ||
    runtimeValues.AI_API_KEY ||
    runtimeValues.DEEPSEEK_API_KEY ||
    envFileValues.AI_API_KEY ||
    envFileValues.DEEPSEEK_API_KEY
  );
}

function hasCloudbaseOpenAiKey(envFileValues, runtimeValues) {
  return Boolean(
    process.env.CLOUDBASE_OPENAI_API_KEY ||
    runtimeValues.CLOUDBASE_OPENAI_API_KEY ||
    envFileValues.CLOUDBASE_OPENAI_API_KEY
  );
}

function hasOpenRouterKey(envFileValues, runtimeValues) {
  return Boolean(
    process.env.OPENROUTER_API_KEY ||
    runtimeValues.OPENROUTER_API_KEY ||
    envFileValues.OPENROUTER_API_KEY
  );
}

function readCloudbaseClientConfig() {
  try {
    const text = fs.readFileSync(CLOUDBASE_CLIENT_CONFIG_PATH, "utf8");
    const parsed = {};
    const pattern = /const\s+([A-Z0-9_]+)\s*=\s*([^;\n]+)\s*;/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const key = match[1];
      const raw = match[2].trim();
      if (/^["'].*["']$/.test(raw)) parsed[key] = raw.slice(1, -1);
      else if (raw === "true" || raw === "false") parsed[key] = raw === "true";
      else if (/^-?\d+(?:\.\d+)?$/.test(raw)) parsed[key] = Number(raw);
    }
    return parsed;
  } catch (error) {
    return {};
  }
}

function getCloudbaseHunyuanStatus() {
  const config = readCloudbaseClientConfig();
  const expiresAt = config.CLOUDBASE_AI_PROMO_EXPIRES_AT || "2026-12-14T23:59:59+08:00";
  const expiresMs = Date.parse(expiresAt);
  const daysUntilPromoExpires = Number.isFinite(expiresMs)
    ? Math.ceil((expiresMs - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  let warningLevel = "unknown";
  if (Number.isFinite(daysUntilPromoExpires)) {
    if (daysUntilPromoExpires < 0) warningLevel = "expired";
    else if (daysUntilPromoExpires <= 7) warningLevel = "7d";
    else if (daysUntilPromoExpires <= 30) warningLevel = "30d";
    else warningLevel = "ok";
  }
  return {
    envId: config.ENV_ID || "cloud1-d3g17rpe7566d3d5c",
    enabled: config.CLOUDBASE_AI_ENABLED !== false,
    model: config.CLOUDBASE_AI_MODEL || "hy3-preview",
    promoExpiresAt: expiresAt,
    daysUntilPromoExpires,
    warningLevel,
    publicGenerativeEnabled: config.AI_GENERATIVE_PUBLIC_ENABLED === true,
    competitionMode: config.AI_COMPETITION_MODE === true,
    toolOnlyMode: config.AI_TOOL_ONLY_MODE === true,
  };
}

function getKeyStatus(envFileValues, runtimeValues) {
  const cozeKey = runtimeValues.COZE_API_KEY || process.env.COZE_API_KEY || envFileValues.COZE_API_KEY || "";
  const customList = customProviderStore.parseList(
    runtimeValues.AI_CUSTOM_PROVIDERS || process.env.AI_CUSTOM_PROVIDERS || envFileValues.AI_CUSTOM_PROVIDERS || ""
  );
  return {
    deepseekKeyConfigured: hasAnyDeepSeekKey(envFileValues, runtimeValues),
    deepseekKeyLast4: keyLast4(process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || runtimeValues.AI_API_KEY || runtimeValues.DEEPSEEK_API_KEY || envFileValues.AI_API_KEY || envFileValues.DEEPSEEK_API_KEY),
    cozeKeyConfigured: Boolean(cozeKey),
    cozeKeyLast4: keyLast4(cozeKey),
    cloudbaseOpenaiKeyConfigured: hasCloudbaseOpenAiKey(envFileValues, runtimeValues),
    cloudbaseOpenaiKeyLast4: keyLast4(process.env.CLOUDBASE_OPENAI_API_KEY || runtimeValues.CLOUDBASE_OPENAI_API_KEY || envFileValues.CLOUDBASE_OPENAI_API_KEY),
    openrouterKeyConfigured: hasOpenRouterKey(envFileValues, runtimeValues),
    openrouterKeyLast4: keyLast4(process.env.OPENROUTER_API_KEY || runtimeValues.OPENROUTER_API_KEY || envFileValues.OPENROUTER_API_KEY),
    customOpenaiConfigured: customList.some((entry) => entry.protocol === "openai" && customProviderStore.isEntryUsable(entry)),
    customAnthropicConfigured: customList.some((entry) => entry.protocol === "anthropic" && customProviderStore.isEntryUsable(entry)),
  };
}

function providerCompleteness(provider, profile, keyStatus) {
  const checks = [];
  if (provider === "mock") {
    checks.push(["localRules", true], ["knowledge", true], ["fallback", true]);
  } else if (provider === "deepseek") {
    checks.push(["baseUrl", Boolean(profile.baseUrl)], ["apiKey", Boolean(keyStatus.deepseekKeyConfigured)], ["model", Boolean(profile.model)], ["timeout", Boolean(profile.timeoutMs)]);
  } else if (provider === "cloudbase-openai") {
    checks.push(["enabled", profile.cloudbaseOpenaiEnabled === true], ["baseUrl", Boolean(profile.cloudbaseOpenaiBaseUrl)], ["apiKey", Boolean(keyStatus.cloudbaseOpenaiKeyConfigured)], ["model", Boolean(profile.cloudbaseOpenaiTextModel)]);
  } else if (provider === "openrouter") {
    checks.push(["enabled", profile.openrouterEnabled === true], ["baseUrl", Boolean(profile.openrouterBaseUrl)], ["apiKey", Boolean(keyStatus.openrouterKeyConfigured)], ["models", Boolean(profile.openrouterModels)]);
  } else if (provider === "custom-openai" || provider === "custom-anthropic") {
    const usable = provider === "custom-openai" ? keyStatus.customOpenaiConfigured : keyStatus.customAnthropicConfigured;
    checks.push(["entry", usable], ["apiKey", usable], ["model", usable]);
  } else if (provider === "coze") {
    if (profile.cozeApiMode === "workload") {
      checks.push(["workloadEndpoint", Boolean(profile.cozeWorkloadEndpoint)], ["projectId", Boolean(profile.cozeProjectId)], ["apiKey", Boolean(keyStatus.cozeKeyConfigured)]);
    } else {
      checks.push(["baseUrl", Boolean(profile.cozeBaseUrl)], ["botId", Boolean(profile.cozeBotId)], ["apiKey", Boolean(keyStatus.cozeKeyConfigured)], ["endpoint", Boolean(profile.cozeChatEndpoint)]);
    }
  }
  const passed = checks.filter((item) => item[1]).length;
  return {
    passed,
    total: checks.length,
    percent: checks.length ? Math.round((passed / checks.length) * 100) : 0,
    missing: checks.filter((item) => !item[1]).map((item) => item[0]),
  };
}

function buildEnvironmentStatus(env, profile, keyStatus, disabledProviders = []) {
  const normalized = normalizeProfile(profile, env);
  const disabled = new Set(disabledProviders);
  const keyFlagFor = (name) => (name === "deepseek"
    ? keyStatus.deepseekKeyConfigured
    : name === "coze"
      ? keyStatus.cozeKeyConfigured
        : name === "openrouter"
          ? keyStatus.openrouterKeyConfigured
        : name === "cloudbase-openai"
        ? keyStatus.cloudbaseOpenaiKeyConfigured
        : name === "custom-openai"
          ? keyStatus.customOpenaiConfigured
          : name === "custom-anthropic"
            ? keyStatus.customAnthropicConfigured
            : true);
  const keyLast4For = (name) => (name === "deepseek"
    ? keyStatus.deepseekKeyLast4
    : name === "coze"
      ? keyStatus.cozeKeyLast4
      : name === "openrouter"
        ? keyStatus.openrouterKeyLast4
      : name === "cloudbase-openai"
        ? keyStatus.cloudbaseOpenaiKeyLast4
        : "");
  const providers = ["mock", "openrouter", "cloudbase-openai", "deepseek", "coze", "custom-openai", "custom-anthropic"].map((name) => ({
    name,
    installed: name === "mock" || !disabled.has(name),
    removable: REMOVABLE_BUILTIN_PROVIDERS.includes(name),
    enabled: normalized.provider === name && normalized.enabled !== false,
    configured: providerCompleteness(name, normalized, keyStatus).percent === 100,
    completeness: providerCompleteness(name, normalized, keyStatus),
    keyConfigured: keyFlagFor(name),
    keyLast4: keyLast4For(name),
  }));
  return {
    environment: env,
    runtimeMode: normalized.runtimeMode,
    provider: normalized.provider,
    providerPolicy: normalized.providerPolicy,
    enabled: normalized.enabled,
    safePublic: env === "public" && normalized.provider === "mock" && normalized.enabled === false,
    providers,
    profile: normalized,
  };
}

function getStatus(requestedEnvironment) {
  const envText = readEnvFile();
  const envFileValues = parseEnv(envText);
  const runtimeRead = readRuntimeValuesResult();
  const runtimeValues = runtimeRead.values;
  const runtimePath = runtimeStore.getConfigPath();
  const value = (key) => getEffectiveValue(envFileValues, runtimeValues, key);
  const legacyProfile = envValuesToProfile(value, value("AI_RUNTIME_MODE") === "competition" ? "trial" : "public");
  const profiles = parseEnvironmentProfiles(value("AI_PROVIDER_ENVIRONMENTS"), legacyProfile);
  const activeEnvironment = normalizeEnvironment(
    requestedEnvironment ||
    value("AI_PROVIDER_ACTIVE_ENV") ||
    (computeGlobalRuntimeMode(profiles) === "competition" ? "trial" : "public")
  );
  const activeProfile = normalizeProfile(profiles[activeEnvironment], activeEnvironment);
  const activeUpdates = profileToEnvUpdates(activeProfile);
  const keyStatus = getKeyStatus(envFileValues, runtimeValues);
  const disabledProviders = parseDisabledProviders(value("AI_DISABLED_PROVIDERS"));
  const environmentStatuses = ENVIRONMENTS.map((env) => buildEnvironmentStatus(env, profiles[env], keyStatus, disabledProviders));
  const activeEnvironmentStatus = environmentStatuses.find((item) => item.environment === activeEnvironment) || environmentStatuses[0];

  return Object.assign({}, keyStatus, {
    envPath: ENV_PATH,
    envExists: fs.existsSync(ENV_PATH),
    runtimeConfigPath: runtimePath,
    runtimeConfigExists: fs.existsSync(runtimePath),
    activeEnvironment,
    runtimeVersion: value("AI_PROVIDER_RUNTIME_VERSION"),
    runtimeUpdatedAt: value("AI_PROVIDER_RUNTIME_UPDATED_AT"),
    globalRuntimeMode: computeGlobalRuntimeMode(profiles),
    disabledProviders,
    builtinProviders: BUILTIN_PROVIDERS.map((name) => ({
      name,
      removable: REMOVABLE_BUILTIN_PROVIDERS.includes(name),
      installed: name === "mock" || !disabledProviders.includes(name),
    })),
    environmentProfiles: profiles,
    environments: environmentStatuses,
    activeEnvironmentStatus,
    enabled: activeProfile.enabled,
    provider: activeProfile.provider,
    providerPolicy: activeProfile.providerPolicy,
    model: activeProfile.model,
    reasoningModel: activeProfile.reasoningModel,
    baseUrl: activeProfile.baseUrl,
    timeoutMs: activeProfile.timeoutMs,
    maxTokens: activeProfile.maxTokens,
    temperature: activeProfile.temperature,
    thinkingEnabled: activeProfile.thinkingEnabled,
    reasoningEffort: activeProfile.reasoningEffort,
    jsonRepair: activeProfile.jsonRepair,
    strictJsonMode: activeProfile.strictJsonMode,
    allowPersonalContext: activeProfile.allowPersonalContext,
    runtimeMode: activeUpdates.AI_RUNTIME_MODE,
    trialAuthorization: runtimeModeService.getAuthorizationStatus(),
    cozeBaseUrl: activeProfile.cozeBaseUrl,
    cozeApiMode: activeProfile.cozeApiMode,
    cozeBotIdConfigured: Boolean(activeProfile.cozeBotId),
    cozeBotIdLast4: keyLast4(activeProfile.cozeBotId),
    cozeWorkloadEndpointConfigured: Boolean(activeProfile.cozeWorkloadEndpoint),
    cozeProjectIdConfigured: Boolean(activeProfile.cozeProjectId),
    cozeProjectIdLast4: keyLast4(activeProfile.cozeProjectId),
    cozeUserIdMode: "principal_hmac",
    cozeChatEndpoint: activeProfile.cozeChatEndpoint,
    cozePollEnabled: activeProfile.cozePollEnabled,
    cozePollIntervalMs: activeProfile.cozePollIntervalMs,
    cozePollMaxAttempts: activeProfile.cozePollMaxAttempts,
    cloudbaseOpenaiEnabled: activeProfile.cloudbaseOpenaiEnabled,
    cloudbaseOpenaiBaseUrl: activeProfile.cloudbaseOpenaiBaseUrl,
    cloudbaseOpenaiTextModel: activeProfile.cloudbaseOpenaiTextModel,
    cloudbaseOpenaiTimeoutMs: activeProfile.cloudbaseOpenaiTimeoutMs,
    cloudbaseOpenaiMaxTokens: activeProfile.cloudbaseOpenaiMaxTokens,
    openrouterEnabled: activeProfile.openrouterEnabled,
    openrouterBaseUrl: activeProfile.openrouterBaseUrl,
    openrouterModels: activeProfile.openrouterModels,
    openrouterTimeoutMs: activeProfile.openrouterTimeoutMs,
    openrouterMaxTokens: activeProfile.openrouterMaxTokens,
    // 自定义 Provider：仅脱敏视图（id/label/协议/baseUrl/模型/key 尾号），永不回传明文密钥。
    customProviders: customProviderStore.publicView(value("AI_CUSTOM_PROVIDERS")),
    activeCustomId: activeProfile.activeCustomId || "",
    encryptionConfigured: runtimeStore.hasEncryptionKey(),
    encryptionReady: runtimeStore.hasEncryptionKey() && !runtimeRead.error,
    encryptionBlocker: runtimeRead.error && (runtimeRead.error.code || "AI_PROVIDER_RUNTIME_CONFIG_READ_FAILED") || "",
    encryptionBlockerMessage: runtimeRead.error ? "FOSU_AI_CONFIG_ENCRYPTION_KEY must be configured before AI provider keys can be saved or migrated." : "",
    cloudbaseHunyuan: getCloudbaseHunyuanStatus(),
  });
}

function buildUpdates(payload = {}) {
  const environment = normalizeEnvironment(payload.environment || payload.targetEnvironment || "trial");
  const profile = normalizeProfile(Object.assign({}, defaultProfile(environment), buildProfilePatch(payload)), environment);
  return Object.assign({}, profileToEnvUpdates(profile), buildSecretUpdates(payload));
}

function getProfilesForSave() {
  const status = getStatus();
  return {
    status,
    profiles: Object.assign({}, status.environmentProfiles || {}),
  };
}

function saveConfig(payload = {}) {
  const current = getProfilesForSave();
  let environment = resolveSaveEnvironment(payload, current.status);
  const requestedProvider = Object.prototype.hasOwnProperty.call(payload, "provider")
    ? normalizeProvider(payload.provider)
    : "";
  if (requestedProvider && (current.status.disabledProviders || []).includes(requestedProvider)) {
    const error = new Error("该内置 Provider 已从运行时移除，请先恢复后再启用。");
    error.code = "BUILTIN_PROVIDER_REMOVED";
    throw error;
  }
  let profile = normalizeProfile(Object.assign(
    {},
    current.profiles[environment] || defaultProfile(environment),
    buildProfilePatch(payload),
    { environment }
  ), environment);
  profile = applyPreset(profile, payload.preset, payload);
  environment = normalizeEnvironment(profile.environment || environment);
  const disabledProviders = current.status.disabledProviders || [];
  const removedReference = [profile.provider]
    .concat(STAGE_PROVIDER_FIELDS.map((field) => profile[field]))
    .map((name) => normalizeChainName(name))
    .find((name) => name && disabledProviders.includes(name));
  if (removedReference) {
    const error = new Error("配置仍引用已移除的内置 Provider，请先恢复或选择其他 Provider。");
    error.code = "BUILTIN_PROVIDER_REMOVED";
    throw error;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "provider")) {
    const previousChain = (current.profiles[environment] || {}).providerChain;
    profile.providerChain = recomputeChainForPrimary(profile.provider, previousChain);
  }
  current.profiles[environment] = normalizeProfile(profile, environment);
  normalizeMirrorEnvironments(payload.mirrorEnvironments || payload.applyToEnvironments, environment).forEach((env) => {
    current.profiles[env] = normalizeProfile(Object.assign({}, profile, { environment: env }), env);
  });
  current.profiles.public = normalizeProfile(current.profiles.public || defaultProfile("public"), "public");

  const activeEnvironment = normalizeEnvironment(payload.activeEnvironment || payload.environment || environment);
  const activeProfile = normalizeProfile(current.profiles[activeEnvironment] || current.profiles[environment], activeEnvironment);
  const updates = Object.assign(
    {},
    profileToEnvUpdates(activeProfile),
    {
      AI_PROVIDER_ACTIVE_ENV: activeEnvironment,
      AI_PROVIDER_ENVIRONMENTS: serializeEnvironmentProfiles(current.profiles),
      AI_RUNTIME_MODE: computeGlobalRuntimeMode(current.profiles),
    },
    buildSecretUpdates(payload)
  );

  runtimeStore.writeRuntimeConfig(updates);
  applyUpdatesToProcessEnv(updates);
  // 配置已变更：旧配置时期积累的熔断/失败态不再代表新配置，立即清空，
  // 保证后台切换 Provider 实时生效（无需等待熔断冷却或重启）。
  require("./providerChainService").resetCircuitState();

  if (String(process.env.FOSU_AI_PROVIDER_WRITE_ENV || "").toLowerCase() === "true") {
    const currentText = ensureEnvFile();
    const nextText = setEnvLines(currentText, updates);
    fs.writeFileSync(ENV_PATH, nextText, { encoding: "utf8", mode: 0o600 });
  }

  return getStatus(activeEnvironment);
}

function getEnvironmentForContext(context = {}, runtimeMode) {
  const mode = String(runtimeMode || "public").trim().toLowerCase();
  if (mode === "public") return "public";
  const envVersion = String(context.envVersion || context.deployEnv || "").trim().toLowerCase();
  if (mode === "dev" || ["develop", "development", "dev", "devtools"].includes(envVersion)) return "dev";
  if (mode === "trial" || mode === "competition") return "trial";
  return "public";
}

function getRuntimeConfigForEnvironment(environment) {
  const envText = readEnvFile();
  const envFileValues = parseEnv(envText);
  const runtimeRead = readRuntimeValuesResult();
  const runtimeValues = runtimeRead.values;
  const status = getStatus(environment);
  const env = normalizeEnvironment(environment || status.activeEnvironment);
  const profile = normalizeProfile(status.environmentProfiles && status.environmentProfiles[env] || defaultProfile(env), env);
  const values = {};
  AI_ENV_KEYS.forEach((key) => {
    values[key] = getEffectiveValue(envFileValues, runtimeValues, key);
  });
  Object.assign(values, profileToEnvUpdates(profile), {
    AI_PROVIDER_ACTIVE_ENV: env,
    AI_PROVIDER_ENVIRONMENTS: serializeEnvironmentProfiles(status.environmentProfiles || {}),
    AI_RUNTIME_MODE: runtimeModeForEnvironment(env),
  });
  // Process-level explicit false is the emergency kill switch. Environment
  // profiles may enable providers, but they must never override an operator stop.
  if (["false", "0"].includes(String(process.env.AI_AGENT_ENABLED || "").toLowerCase())) {
    values.AI_AGENT_ENABLED = "false";
  }
  if (["false", "0"].includes(String(process.env.AI_UNDERSTANDING_ENABLED || "").toLowerCase())) {
    values.AI_UNDERSTANDING_ENABLED = "false";
  }
  if (env === "public") {
    values.AI_AGENT_ENABLED = "false";
    values.AI_PROVIDER = "mock";
    values.AI_PROVIDER_POLICY = "tool-only";
    values.AI_RUNTIME_MODE = "public";
  }
  return values;
}

function resolveRuntimeProviderConfig(input = {}) {
  const env = getEnvironmentForContext(input.context || {}, input.runtimeMode || "public");
  return getRuntimeConfigForEnvironment(env);
}

function writeCustomProviderUpdates(updates) {
  runtimeStore.writeRuntimeConfig(updates);
  applyUpdatesToProcessEnv(updates);
  // 配置变更即时生效：清熔断，避免旧失败态遮盖新配置。
  require("./providerChainService").resetCircuitState();
}

/**
 * 新增/更新一条自定义 Provider（CCSwitch 式）。
 * payload: { entry: {id?, label, protocol, baseUrl, apiKey?, model, enabled?, strictJsonMode?}, setActive?, activeCustomId? }
 * apiKey 留空 = 编辑时保留旧密钥；"__clear__" = 清除密钥。
 */
function saveCustomProvider(payload = {}) {
  const runtimeValues = readRuntimeValues();
  const entry = customProviderStore.sanitizeEntry(payload.entry || {});
  if (!entry.protocol || !entry.baseUrl) {
    const error = new Error("自定义 Provider 需要合法的 protocol（openai/anthropic）与 https baseUrl。");
    error.code = "CUSTOM_PROVIDER_INVALID";
    throw error;
  }
  const list = customProviderStore.upsertEntry(runtimeValues.AI_CUSTOM_PROVIDERS || "", payload.entry || {});
  const updates = { AI_CUSTOM_PROVIDERS: customProviderStore.serializeList(list) };
  if (payload.activeCustomId !== undefined) {
    updates.AI_CUSTOM_ACTIVE_ID = String(payload.activeCustomId || "").trim();
  } else if (payload.setActive === true) {
    updates.AI_CUSTOM_ACTIVE_ID = entry.id;
  }
  writeCustomProviderUpdates(updates);
  return getStatus();
}

/** 删除一条自定义 Provider；若它是当前 active，则清空 active。 */
function deleteCustomProvider(payload = {}) {
  const runtimeValues = readRuntimeValues();
  const id = String(payload.id || "").trim();
  if (!id) {
    const error = new Error("缺少要删除的自定义 Provider id。");
    error.code = "CUSTOM_PROVIDER_INVALID";
    throw error;
  }
  const list = customProviderStore.removeEntry(runtimeValues.AI_CUSTOM_PROVIDERS || "", id);
  const updates = { AI_CUSTOM_PROVIDERS: customProviderStore.serializeList(list) };
  if (String(runtimeValues.AI_CUSTOM_ACTIVE_ID || "").trim() === id) {
    updates.AI_CUSTOM_ACTIVE_ID = "";
  }
  writeCustomProviderUpdates(updates);
  return getStatus();
}

/** 获取模型列表：apiKey 留空且给了 id 时，回退用已存储条目的密钥（不明文出仓）。 */
async function fetchCustomProviderModels(payload = {}) {
  let apiKey = String(payload.apiKey || "").trim();
  if (!apiKey && payload.id) {
    const existing = customProviderStore.findEntry(readRuntimeValues().AI_CUSTOM_PROVIDERS || "", payload.id);
    if (existing) apiKey = existing.apiKey;
  }
  return customProviderStore.fetchModelList({
    protocol: payload.protocol,
    baseUrl: payload.baseUrl,
    apiKey,
    timeoutMs: payload.timeoutMs,
  });
}

/**
 * 运行时移除/恢复内置外部 Provider。
 * 移除仅撤销注册和各环境链路引用，保留加密凭据，便于审计后恢复；mock 不可移除。
 */
function setBuiltinProviderInstalled(payload = {}, installed) {
  const provider = normalizeProvider(payload.provider);
  if (!REMOVABLE_BUILTIN_PROVIDERS.includes(provider)) {
    const error = new Error("只能移除或恢复受支持的内置外部 Provider，mock 安全锚点不可移除。");
    error.code = "BUILTIN_PROVIDER_INVALID";
    throw error;
  }
  const status = getStatus();
  const disabled = new Set(status.disabledProviders || []);
  if (installed) disabled.delete(provider);
  else disabled.add(provider);

  const profiles = Object.assign({}, status.environmentProfiles || {});
  if (!installed) {
    ["trial", "dev"].forEach((environment) => {
      const profile = normalizeProfile(profiles[environment] || defaultProfile(environment), environment);
      const remaining = parseChainNames(profile.providerChain)
        .filter((name) => name !== provider && !disabled.has(name));
      if (!remaining.includes("mock")) remaining.push("mock");
      if (profile.provider === provider) {
        profile.provider = remaining.find((name) => name !== "mock") || "mock";
        profile.enabled = profile.provider !== "mock";
      }
      profile.providerChain = [profile.provider]
        .concat(remaining.filter((name) => name !== profile.provider))
        .join(",");
      STAGE_PROVIDER_FIELDS.forEach((field) => {
        if (profile[field] === provider) profile[field] = "";
      });
      if (profile.shadowProvider === provider) {
        profile.shadowProvider = "";
        profile.shadowEnabled = false;
      }
      if (provider === "coze") profile.cozeEnabled = false;
      if (provider === "cloudbase-openai") profile.cloudbaseOpenaiEnabled = false;
      if (provider === "openrouter") profile.openrouterEnabled = false;
      profiles[environment] = normalizeProfile(profile, environment);
    });
  }
  profiles.public = normalizeProfile(profiles.public || defaultProfile("public"), "public");
  const activeEnvironment = normalizeEnvironment(status.activeEnvironment || "public");
  const activeProfile = normalizeProfile(profiles[activeEnvironment] || defaultProfile(activeEnvironment), activeEnvironment);
  const updates = Object.assign({}, profileToEnvUpdates(activeProfile), {
    AI_DISABLED_PROVIDERS: Array.from(disabled).sort().join(","),
    AI_PROVIDER_ACTIVE_ENV: activeEnvironment,
    AI_PROVIDER_ENVIRONMENTS: serializeEnvironmentProfiles(profiles),
    AI_RUNTIME_MODE: computeGlobalRuntimeMode(profiles),
  });
  writeCustomProviderUpdates(updates);
  return getStatus(activeEnvironment);
}

function removeBuiltinProvider(payload = {}) {
  return setBuiltinProviderInstalled(payload, false);
}

function restoreBuiltinProvider(payload = {}) {
  return setBuiltinProviderInstalled(payload, true);
}

/**
 * 权威 Provider 配置五元组：后台选哪个 Provider，实际第一跳就用哪个。
 * - primaryProvider = profile.provider（单选）
 * - fallbackProviders = 链中除 primary 外的有序余项
 * - effectiveChain = [primary, ...fallbacks]（public 恒 ["mock"]）
 * - stageAssignments = 各阶段（understanding/planner/response）解析后的第一跳 Provider；
 *   阶段字段为空表示"跟随主 Provider"，解析结果即 primaryProvider。
 * - configVersion = 每次保存都会变化的 runtime version。
 */
function getAuthoritativeProviderConfig(environment) {
  const status = getStatus(environment);
  const env = normalizeEnvironment(environment || status.activeEnvironment);
  const profile = normalizeProfile(
    status.environmentProfiles && status.environmentProfiles[env] || defaultProfile(env),
    env
  );
  const configVersion = String(status.runtimeVersion || "");
  if (env === "public") {
    return {
      environment: "public",
      primaryProvider: "mock",
      fallbackProviders: [],
      effectiveChain: ["mock"],
      stageAssignments: { understanding: "mock", planner: "mock", response: "mock" },
      configVersion,
    };
  }
  const disabled = new Set(status.disabledProviders || []);
  const configuredPrimary = normalizeProvider(profile.provider);
  const remainingChain = parseChainNames(profile.providerChain).filter((name) => !disabled.has(name));
  const primaryProvider = disabled.has(configuredPrimary)
    ? (remainingChain.find((name) => name !== "mock") || "mock")
    : configuredPrimary;
  const fallbackProviders = remainingChain.filter((name) => name !== primaryProvider);
  const resolveStage = (value) => {
    const provider = normalizeChainName(value);
    return provider && !disabled.has(provider) ? provider : primaryProvider;
  };
  return {
    environment: env,
    primaryProvider,
    fallbackProviders,
    effectiveChain: [primaryProvider].concat(fallbackProviders),
    stageAssignments: {
      understanding: resolveStage(profile.understandingProvider),
      planner: resolveStage(profile.plannerProvider),
      response: resolveStage(profile.responseProvider),
    },
    configVersion,
  };
}

module.exports = {
  AI_ENV_KEYS,
  BUILTIN_PROVIDERS,
  DEFAULTS,
  ENVIRONMENTS,
  ENV_PATH,
  buildUpdates,
  deleteCustomProvider,
  fetchCustomProviderModels,
  getAuthoritativeProviderConfig,
  getEnvironmentForContext,
  getRuntimeConfigForEnvironment,
  getStatus,
  normalizeEnvironment,
  parseDisabledProviders,
  parseChainNames,
  parseEnv,
  recomputeChainForPrimary,
  resolveRuntimeProviderConfig,
  saveConfig,
  saveCustomProvider,
  removeBuiltinProvider,
  restoreBuiltinProvider,
  setEnvLines,
};
