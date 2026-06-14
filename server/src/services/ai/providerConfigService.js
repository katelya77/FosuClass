const fs = require("fs");
const path = require("path");
const runtimeStore = require("./providerRuntimeConfigStore");

const SERVER_ROOT = path.resolve(__dirname, "../../..");
const ENV_PATH = path.join(SERVER_ROOT, ".env");
const ENV_EXAMPLE_PATH = path.join(SERVER_ROOT, ".env.example");
const CLOUDBASE_CLIENT_CONFIG_PATH = path.resolve(SERVER_ROOT, "..", "miniprogram", "config", "cloudbase.js");

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
];

const DEFAULTS = {
  AI_AGENT_ENABLED: "false",
  AI_PROVIDER: "deepseek",
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
  COZE_API_BASE_URL: "https://api.coze.cn",
  COZE_USER_ID: "fosuclass-user",
  COZE_CHAT_ENDPOINT: "/v3/chat",
  COZE_POLL_ENABLED: "true",
  COZE_POLL_INTERVAL_MS: "1000",
  COZE_POLL_MAX_ATTEMPTS: "8",
};

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
  if (fs.existsSync(ENV_PATH)) {
    return fs.readFileSync(ENV_PATH, "utf8");
  }
  if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    return fs.readFileSync(ENV_EXAMPLE_PATH, "utf8");
  }
  return "";
}

function quoteEnvValue(value) {
  const text = String(value == null ? "" : value);
  if (!text || /^[A-Za-z0-9_./:@-]+$/.test(text)) return text;
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
  try {
    return runtimeStore.readRuntimeConfig();
  } catch (error) {
    return {};
  }
}

function getEffectiveValue(envFileValues, runtimeValues, key) {
  return process.env[key] || runtimeValues[key] || envFileValues[key] || DEFAULTS[key] || "";
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

function readCloudbaseClientConfig() {
  try {
    const text = fs.readFileSync(CLOUDBASE_CLIENT_CONFIG_PATH, "utf8");
    const parsed = {};
    const pattern = /const\s+([A-Z0-9_]+)\s*=\s*([^;\n]+)\s*;/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const key = match[1];
      const raw = match[2].trim();
      if (/^["'].*["']$/.test(raw)) {
        parsed[key] = raw.slice(1, -1);
      } else if (raw === "true" || raw === "false") {
        parsed[key] = raw === "true";
      } else if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
        parsed[key] = Number(raw);
      }
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

function getStatus() {
  const envText = readEnvFile();
  const envFileValues = parseEnv(envText);
  const runtimeValues = readRuntimeValues();
  const runtimePath = runtimeStore.getConfigPath();
  const value = (key) => getEffectiveValue(envFileValues, runtimeValues, key);
  return {
    envPath: ENV_PATH,
    envExists: fs.existsSync(ENV_PATH),
    runtimeConfigPath: runtimePath,
    runtimeConfigExists: fs.existsSync(runtimePath),
    enabled: value("AI_AGENT_ENABLED") === "true",
    provider: value("AI_PROVIDER"),
    providerPolicy: value("AI_PROVIDER_POLICY"),
    model: value("AI_MODEL"),
    reasoningModel: value("AI_REASONING_MODEL"),
    baseUrl: value("AI_BASE_URL"),
    timeoutMs: value("AI_TIMEOUT_MS"),
    maxTokens: value("AI_MAX_TOKENS"),
    temperature: value("AI_TEMPERATURE"),
    thinkingEnabled: value("AI_THINKING_ENABLED") === "true",
    reasoningEffort: value("AI_REASONING_EFFORT"),
    jsonRepair: value("AI_PROVIDER_JSON_REPAIR") !== "false",
    strictJsonMode: value("DEEPSEEK_STRICT_JSON_MODE") === "true",
    allowPersonalContext: value("AI_ALLOW_PERSONAL_CONTEXT") === "true",
    deepseekKeyConfigured: hasAnyDeepSeekKey(envFileValues, runtimeValues),
    cozeBaseUrl: value("COZE_API_BASE_URL"),
    cozeBotIdConfigured: Boolean(value("COZE_BOT_ID")),
    cozeKeyConfigured: Boolean(process.env.COZE_API_KEY || runtimeValues.COZE_API_KEY || envFileValues.COZE_API_KEY),
    cozeUserId: value("COZE_USER_ID"),
    cozeChatEndpoint: value("COZE_CHAT_ENDPOINT"),
    cozePollEnabled: value("COZE_POLL_ENABLED") !== "false",
    cozePollIntervalMs: value("COZE_POLL_INTERVAL_MS"),
    cozePollMaxAttempts: value("COZE_POLL_MAX_ATTEMPTS"),
    cloudbaseHunyuan: getCloudbaseHunyuanStatus(),
  };
}

function normalizeProvider(value) {
  const provider = String(value || "mock").trim().toLowerCase();
  return ["mock", "deepseek", "coze"].includes(provider) ? provider : "mock";
}

function normalizeProviderPolicy(value) {
  const policy = String(value || "auto").trim().toLowerCase();
  return ["auto", "always", "tool-only"].includes(policy) ? policy : "auto";
}

function normalizeBoolean(value) {
  return value === true || String(value).toLowerCase() === "true" ? "true" : "false";
}

function buildUpdates(payload = {}) {
  const updates = {};
  const simpleFields = {
    provider: "AI_PROVIDER",
    providerPolicy: "AI_PROVIDER_POLICY",
    model: "AI_MODEL",
    reasoningModel: "AI_REASONING_MODEL",
    baseUrl: "AI_BASE_URL",
    timeoutMs: "AI_TIMEOUT_MS",
    maxTokens: "AI_MAX_TOKENS",
    temperature: "AI_TEMPERATURE",
    reasoningEffort: "AI_REASONING_EFFORT",
    cozeBaseUrl: "COZE_API_BASE_URL",
    cozeBotId: "COZE_BOT_ID",
    cozeUserId: "COZE_USER_ID",
    cozeChatEndpoint: "COZE_CHAT_ENDPOINT",
    cozePollIntervalMs: "COZE_POLL_INTERVAL_MS",
    cozePollMaxAttempts: "COZE_POLL_MAX_ATTEMPTS",
  };
  Object.keys(simpleFields).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return;
    updates[simpleFields[field]] = field === "provider"
      ? normalizeProvider(payload[field])
      : field === "providerPolicy"
        ? normalizeProviderPolicy(payload[field])
        : String(payload[field] == null ? "" : payload[field]).trim();
  });
  [
    ["enabled", "AI_AGENT_ENABLED"],
    ["thinkingEnabled", "AI_THINKING_ENABLED"],
    ["jsonRepair", "AI_PROVIDER_JSON_REPAIR"],
    ["strictJsonMode", "DEEPSEEK_STRICT_JSON_MODE"],
    ["allowPersonalContext", "AI_ALLOW_PERSONAL_CONTEXT"],
    ["cozePollEnabled", "COZE_POLL_ENABLED"],
  ].forEach(([field, key]) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) updates[key] = normalizeBoolean(payload[field]);
  });
  if (payload.apiKey) updates.AI_API_KEY = String(payload.apiKey).trim();
  if (payload.deepseekApiKey) updates.DEEPSEEK_API_KEY = String(payload.deepseekApiKey).trim();
  if (payload.cozeApiKey) updates.COZE_API_KEY = String(payload.cozeApiKey).trim();
  return updates;
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

function saveConfig(payload = {}) {
  const updates = buildUpdates(payload);
  runtimeStore.writeRuntimeConfig(updates);
  applyUpdatesToProcessEnv(updates);

  if (String(process.env.FOSU_AI_PROVIDER_WRITE_ENV || "").toLowerCase() === "true") {
    const currentText = ensureEnvFile();
    const nextText = setEnvLines(currentText, updates);
    fs.writeFileSync(ENV_PATH, nextText, { encoding: "utf8", mode: 0o600 });
  }

  return getStatus();
}

module.exports = {
  AI_ENV_KEYS,
  DEFAULTS,
  buildUpdates,
  ENV_PATH,
  getStatus,
  parseEnv,
  saveConfig,
  setEnvLines,
};
