const fs = require("fs");
const path = require("path");

const SERVER_ROOT = path.resolve(__dirname, "../../..");
const ENV_PATH = path.join(SERVER_ROOT, ".env");
const ENV_EXAMPLE_PATH = path.join(SERVER_ROOT, ".env.example");

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
  "AI_ALLOW_PERSONAL_CONTEXT",
  "AI_API_KEY",
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

function getEffectiveValue(envFileValues, key) {
  return process.env[key] || envFileValues[key] || DEFAULTS[key] || "";
}

function hasAnyDeepSeekKey(envFileValues) {
  return Boolean(
    process.env.AI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.FOSUCLASS_DEEPSEEK_API_KEY ||
    envFileValues.AI_API_KEY
  );
}

function getStatus() {
  const envText = readEnvFile();
  const envFileValues = parseEnv(envText);
  return {
    envPath: ENV_PATH,
    envExists: fs.existsSync(ENV_PATH),
    enabled: getEffectiveValue(envFileValues, "AI_AGENT_ENABLED") === "true",
    provider: getEffectiveValue(envFileValues, "AI_PROVIDER"),
    providerPolicy: getEffectiveValue(envFileValues, "AI_PROVIDER_POLICY"),
    model: getEffectiveValue(envFileValues, "AI_MODEL"),
    reasoningModel: getEffectiveValue(envFileValues, "AI_REASONING_MODEL"),
    baseUrl: getEffectiveValue(envFileValues, "AI_BASE_URL"),
    timeoutMs: getEffectiveValue(envFileValues, "AI_TIMEOUT_MS"),
    maxTokens: getEffectiveValue(envFileValues, "AI_MAX_TOKENS"),
    temperature: getEffectiveValue(envFileValues, "AI_TEMPERATURE"),
    thinkingEnabled: getEffectiveValue(envFileValues, "AI_THINKING_ENABLED") === "true",
    reasoningEffort: getEffectiveValue(envFileValues, "AI_REASONING_EFFORT"),
    jsonRepair: getEffectiveValue(envFileValues, "AI_PROVIDER_JSON_REPAIR") !== "false",
    allowPersonalContext: getEffectiveValue(envFileValues, "AI_ALLOW_PERSONAL_CONTEXT") === "true",
    deepseekKeyConfigured: hasAnyDeepSeekKey(envFileValues),
    cozeBaseUrl: getEffectiveValue(envFileValues, "COZE_API_BASE_URL"),
    cozeBotIdConfigured: Boolean(getEffectiveValue(envFileValues, "COZE_BOT_ID")),
    cozeKeyConfigured: Boolean(process.env.COZE_API_KEY || envFileValues.COZE_API_KEY),
    cozeUserId: getEffectiveValue(envFileValues, "COZE_USER_ID"),
    cozeChatEndpoint: getEffectiveValue(envFileValues, "COZE_CHAT_ENDPOINT"),
    cozePollEnabled: getEffectiveValue(envFileValues, "COZE_POLL_ENABLED") !== "false",
    cozePollIntervalMs: getEffectiveValue(envFileValues, "COZE_POLL_INTERVAL_MS"),
    cozePollMaxAttempts: getEffectiveValue(envFileValues, "COZE_POLL_MAX_ATTEMPTS"),
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
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      updates[simpleFields[field]] = field === "provider"
        ? normalizeProvider(payload[field])
        : field === "providerPolicy"
          ? normalizeProviderPolicy(payload[field])
        : String(payload[field] == null ? "" : payload[field]).trim();
    }
  });
  [
    ["enabled", "AI_AGENT_ENABLED"],
    ["thinkingEnabled", "AI_THINKING_ENABLED"],
    ["jsonRepair", "AI_PROVIDER_JSON_REPAIR"],
    ["allowPersonalContext", "AI_ALLOW_PERSONAL_CONTEXT"],
    ["cozePollEnabled", "COZE_POLL_ENABLED"],
  ].forEach(([field, key]) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) updates[key] = normalizeBoolean(payload[field]);
  });
  if (payload.apiKey) updates.AI_API_KEY = String(payload.apiKey).trim();
  if (payload.cozeApiKey) updates.COZE_API_KEY = String(payload.cozeApiKey).trim();
  return updates;
}

function ensureEnvFile() {
  if (fs.existsSync(ENV_PATH)) return readEnvFile();
  const seed = fs.existsSync(ENV_EXAMPLE_PATH) ? fs.readFileSync(ENV_EXAMPLE_PATH, "utf8") : "";
  fs.writeFileSync(ENV_PATH, seed, { encoding: "utf8", mode: 0o600 });
  return seed;
}

function saveConfig(payload = {}) {
  const updates = buildUpdates(payload);
  const currentText = ensureEnvFile();
  const nextText = setEnvLines(currentText, updates);
  fs.writeFileSync(ENV_PATH, nextText, { encoding: "utf8", mode: 0o600 });
  Object.keys(updates).forEach((key) => {
    if (AI_ENV_KEYS.includes(key)) process.env[key] = updates[key];
  });
  return getStatus();
}

module.exports = {
  buildUpdates,
  ENV_PATH,
  getStatus,
  parseEnv,
  saveConfig,
  setEnvLines,
};
