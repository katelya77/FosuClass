const fs = require("fs");
const path = require("path");
const runtimeStore = require("./providerRuntimeConfigStore");
const runtimeModeService = require("./runtimeModeService");

const SERVER_ROOT = path.resolve(__dirname, "../../..");
const ENV_PATH = path.join(SERVER_ROOT, ".env");
const ENV_EXAMPLE_PATH = path.join(SERVER_ROOT, ".env.example");
const CLOUDBASE_CLIENT_CONFIG_PATH = path.resolve(SERVER_ROOT, "..", "miniprogram", "config", "cloudbase.js");

const ENVIRONMENTS = ["public", "trial", "dev"];
const EXTERNAL_PROVIDERS = ["cloudbase-openai", "deepseek", "coze"];

const AI_ENV_KEYS = [
  "AI_AGENT_ENABLED",
  "AI_PROVIDER",
  "AI_PROVIDER_POLICY",
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
  "AI_API_KEY",
  "DEEPSEEK_API_KEY",
  "COZE_API_BASE_URL",
  "COZE_API_KEY",
  "COZE_BOT_ID",
  "COZE_USER_ID",
  "COZE_CHAT_ENDPOINT",
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
];

const DEFAULTS = {
  AI_AGENT_ENABLED: "false",
  AI_PROVIDER: "mock",
  AI_PROVIDER_POLICY: "auto",
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
  COZE_API_BASE_URL: "https://api.coze.cn",
  COZE_USER_ID: "fosuclass-user",
  COZE_CHAT_ENDPOINT: "/v3/chat",
  COZE_POLL_ENABLED: "true",
  COZE_POLL_INTERVAL_MS: "1000",
  COZE_POLL_MAX_ATTEMPTS: "8",
  AI_RUNTIME_MODE: "public",
  CLOUDBASE_OPENAI_ENABLED: "false",
  CLOUDBASE_OPENAI_BASE_URL: "https://cloud1-d3g17rpe7566d3d5c.api.tcloudbasegateway.com/v1/ai/cloudbase",
  CLOUDBASE_OPENAI_TEXT_MODEL: "hy3-preview",
  CLOUDBASE_OPENAI_TIMEOUT_MS: "15000",
  CLOUDBASE_OPENAI_MAX_TOKENS: "1200",
};

const PROFILE_FIELD_TO_ENV = {
  enabled: "AI_AGENT_ENABLED",
  provider: "AI_PROVIDER",
  providerPolicy: "AI_PROVIDER_POLICY",
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
  cozeBaseUrl: "COZE_API_BASE_URL",
  cozeBotId: "COZE_BOT_ID",
  cozeUserId: "COZE_USER_ID",
  cozeChatEndpoint: "COZE_CHAT_ENDPOINT",
  cozePollEnabled: "COZE_POLL_ENABLED",
  cozePollIntervalMs: "COZE_POLL_INTERVAL_MS",
  cozePollMaxAttempts: "COZE_POLL_MAX_ATTEMPTS",
  cloudbaseOpenaiEnabled: "CLOUDBASE_OPENAI_ENABLED",
  cloudbaseOpenaiBaseUrl: "CLOUDBASE_OPENAI_BASE_URL",
  cloudbaseOpenaiTextModel: "CLOUDBASE_OPENAI_TEXT_MODEL",
  cloudbaseOpenaiTimeoutMs: "CLOUDBASE_OPENAI_TIMEOUT_MS",
  cloudbaseOpenaiMaxTokens: "CLOUDBASE_OPENAI_MAX_TOKENS",
};

const BOOLEAN_PROFILE_FIELDS = new Set([
  "enabled",
  "thinkingEnabled",
  "jsonRepair",
  "strictJsonMode",
  "allowPersonalContext",
  "cozePollEnabled",
  "cloudbaseOpenaiEnabled",
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

function getEffectiveValue(envFileValues, runtimeValues, key) {
  return process.env[key] || runtimeValues[key] || envFileValues[key] || DEFAULTS[key] || "";
}

function keyLast4(value) {
  const text = String(value || "");
  return text ? text.slice(-4) : "";
}

function normalizeProvider(value) {
  const provider = String(value || "mock").trim().toLowerCase();
  return ["mock", "deepseek", "coze", "cloudbase-openai"].includes(provider) ? provider : "mock";
}

function normalizeProviderPolicy(value) {
  const policy = String(value || "auto").trim().toLowerCase();
  return ["auto", "always", "tool-only"].includes(policy) ? policy : "auto";
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
    enabled: env !== "public",
    provider: env === "public" ? "mock" : "deepseek",
    providerPolicy: env === "public" ? "tool-only" : "auto",
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
    cozeBaseUrl: DEFAULTS.COZE_API_BASE_URL,
    cozeBotId: "",
    cozeUserId: DEFAULTS.COZE_USER_ID,
    cozeChatEndpoint: DEFAULTS.COZE_CHAT_ENDPOINT,
    cozePollEnabled: true,
    cozePollIntervalMs: DEFAULTS.COZE_POLL_INTERVAL_MS,
    cozePollMaxAttempts: DEFAULTS.COZE_POLL_MAX_ATTEMPTS,
    cloudbaseOpenaiEnabled: false,
    cloudbaseOpenaiBaseUrl: DEFAULTS.CLOUDBASE_OPENAI_BASE_URL,
    cloudbaseOpenaiTextModel: DEFAULTS.CLOUDBASE_OPENAI_TEXT_MODEL,
    cloudbaseOpenaiTimeoutMs: DEFAULTS.CLOUDBASE_OPENAI_TIMEOUT_MS,
    cloudbaseOpenaiMaxTokens: DEFAULTS.CLOUDBASE_OPENAI_MAX_TOKENS,
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
  if (env === "public") {
    base.enabled = false;
    base.provider = "mock";
    base.providerPolicy = "tool-only";
    base.allowPersonalContext = false;
    base.thinkingEnabled = false;
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
  return {
    deepseekKeyConfigured: hasAnyDeepSeekKey(envFileValues, runtimeValues),
    deepseekKeyLast4: keyLast4(process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || runtimeValues.AI_API_KEY || runtimeValues.DEEPSEEK_API_KEY || envFileValues.AI_API_KEY || envFileValues.DEEPSEEK_API_KEY),
    cozeKeyConfigured: Boolean(process.env.COZE_API_KEY || runtimeValues.COZE_API_KEY || envFileValues.COZE_API_KEY),
    cozeKeyLast4: keyLast4(process.env.COZE_API_KEY || runtimeValues.COZE_API_KEY || envFileValues.COZE_API_KEY),
    cloudbaseOpenaiKeyConfigured: hasCloudbaseOpenAiKey(envFileValues, runtimeValues),
    cloudbaseOpenaiKeyLast4: keyLast4(process.env.CLOUDBASE_OPENAI_API_KEY || runtimeValues.CLOUDBASE_OPENAI_API_KEY || envFileValues.CLOUDBASE_OPENAI_API_KEY),
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
  } else if (provider === "coze") {
    checks.push(["baseUrl", Boolean(profile.cozeBaseUrl)], ["botId", Boolean(profile.cozeBotId)], ["apiKey", Boolean(keyStatus.cozeKeyConfigured)], ["userId", Boolean(profile.cozeUserId)], ["endpoint", Boolean(profile.cozeChatEndpoint)]);
  }
  const passed = checks.filter((item) => item[1]).length;
  return {
    passed,
    total: checks.length,
    percent: checks.length ? Math.round((passed / checks.length) * 100) : 0,
    missing: checks.filter((item) => !item[1]).map((item) => item[0]),
  };
}

function buildEnvironmentStatus(env, profile, keyStatus) {
  const normalized = normalizeProfile(profile, env);
  const providers = ["mock", "cloudbase-openai", "deepseek", "coze"].map((name) => ({
    name,
    enabled: normalized.provider === name && normalized.enabled !== false,
    configured: providerCompleteness(name, normalized, keyStatus).percent === 100,
    completeness: providerCompleteness(name, normalized, keyStatus),
    keyConfigured: name === "deepseek"
      ? keyStatus.deepseekKeyConfigured
      : name === "coze"
        ? keyStatus.cozeKeyConfigured
        : name === "cloudbase-openai"
          ? keyStatus.cloudbaseOpenaiKeyConfigured
          : true,
    keyLast4: name === "deepseek"
      ? keyStatus.deepseekKeyLast4
      : name === "coze"
        ? keyStatus.cozeKeyLast4
        : name === "cloudbase-openai"
          ? keyStatus.cloudbaseOpenaiKeyLast4
          : "",
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
  const environmentStatuses = ENVIRONMENTS.map((env) => buildEnvironmentStatus(env, profiles[env], keyStatus));
  const activeEnvironmentStatus = environmentStatuses.find((item) => item.environment === activeEnvironment) || environmentStatuses[0];

  return Object.assign({}, keyStatus, {
    envPath: ENV_PATH,
    envExists: fs.existsSync(ENV_PATH),
    runtimeConfigPath: runtimePath,
    runtimeConfigExists: fs.existsSync(runtimePath),
    activeEnvironment,
    globalRuntimeMode: computeGlobalRuntimeMode(profiles),
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
    cozeBotIdConfigured: Boolean(activeProfile.cozeBotId),
    cozeBotIdLast4: keyLast4(activeProfile.cozeBotId),
    cozeUserId: activeProfile.cozeUserId,
    cozeChatEndpoint: activeProfile.cozeChatEndpoint,
    cozePollEnabled: activeProfile.cozePollEnabled,
    cozePollIntervalMs: activeProfile.cozePollIntervalMs,
    cozePollMaxAttempts: activeProfile.cozePollMaxAttempts,
    cloudbaseOpenaiEnabled: activeProfile.cloudbaseOpenaiEnabled,
    cloudbaseOpenaiBaseUrl: activeProfile.cloudbaseOpenaiBaseUrl,
    cloudbaseOpenaiTextModel: activeProfile.cloudbaseOpenaiTextModel,
    cloudbaseOpenaiTimeoutMs: activeProfile.cloudbaseOpenaiTimeoutMs,
    cloudbaseOpenaiMaxTokens: activeProfile.cloudbaseOpenaiMaxTokens,
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
  let profile = normalizeProfile(Object.assign(
    {},
    current.profiles[environment] || defaultProfile(environment),
    buildProfilePatch(payload),
    { environment }
  ), environment);
  profile = applyPreset(profile, payload.preset, payload);
  environment = normalizeEnvironment(profile.environment || environment);
  current.profiles[environment] = normalizeProfile(profile, environment);
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

  if (String(process.env.FOSU_AI_PROVIDER_WRITE_ENV || "").toLowerCase() === "true") {
    const currentText = ensureEnvFile();
    const nextText = setEnvLines(currentText, updates);
    fs.writeFileSync(ENV_PATH, nextText, { encoding: "utf8", mode: 0o600 });
  }

  return getStatus(activeEnvironment);
}

function getEnvironmentForContext(context = {}, runtimeMode) {
  if (runtimeMode === "public") return "public";
  const envVersion = String(context.envVersion || context.miniprogramVersion || "").trim().toLowerCase();
  if (envVersion === "release" || envVersion === "public") return "public";
  if (envVersion === "trial") return "trial";
  if (envVersion === "develop" || envVersion === "development" || envVersion === "dev" || envVersion === "devtools") return "dev";
  const active = normalizeEnvironment(getStatus().activeEnvironment);
  return active === "dev" || active === "trial" ? active : "trial";
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

module.exports = {
  AI_ENV_KEYS,
  DEFAULTS,
  ENVIRONMENTS,
  ENV_PATH,
  buildUpdates,
  getEnvironmentForContext,
  getRuntimeConfigForEnvironment,
  getStatus,
  normalizeEnvironment,
  parseEnv,
  resolveRuntimeProviderConfig,
  saveConfig,
  setEnvLines,
};
