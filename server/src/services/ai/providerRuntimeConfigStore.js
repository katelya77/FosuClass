const fs = require("fs");
const path = require("path");

const DEFAULT_CONFIG_PATH = "/app/storage/secure/ai-provider-config.json";

const RUNTIME_CONFIG_KEYS = [
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

const RUNTIME_CONFIG_KEY_SET = new Set(RUNTIME_CONFIG_KEYS);

function getConfigPath() {
  return path.resolve(process.env.FOSU_AI_PROVIDER_CONFIG_PATH || DEFAULT_CONFIG_PATH);
}

function ensureSecureDirectory(configPath = getConfigPath()) {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
  return dir;
}

function sanitizeRuntimeConfig(input = {}) {
  const output = {};
  RUNTIME_CONFIG_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return;
    const value = input[key];
    if (value === undefined || value === null) return;
    output[key] = String(value);
  });
  return output;
}

function readRuntimeConfig(configPath = getConfigPath()) {
  try {
    if (!fs.existsSync(configPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return sanitizeRuntimeConfig(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});
  } catch (error) {
    error.code = error.code || "AI_PROVIDER_RUNTIME_CONFIG_READ_FAILED";
    throw error;
  }
}

function writeRuntimeConfig(updates = {}, configPath = getConfigPath()) {
  ensureSecureDirectory(configPath);
  const current = fs.existsSync(configPath) ? readRuntimeConfig(configPath) : {};
  const next = Object.assign({}, current, sanitizeRuntimeConfig(updates));
  const tmpPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(tmpPath, 0o600);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
  fs.renameSync(tmpPath, configPath);
  try {
    fs.chmodSync(configPath, 0o600);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
  return next;
}

function applyToProcessEnv(values = {}, options = {}) {
  const defaults = options.defaults || {};
  const applied = {};
  RUNTIME_CONFIG_KEYS.forEach((key) => {
    const explicit = process.env[key];
    if (explicit !== undefined && explicit !== "") return;
    const value = values[key] !== undefined && values[key] !== "" ? values[key] : defaults[key];
    if (value === undefined || value === null || value === "") return;
    process.env[key] = String(value);
    applied[key] = String(value);
  });
  return applied;
}

function loadRuntimeConfigIntoProcessEnv(options = {}) {
  const configPath = options.configPath || getConfigPath();
  let values = {};
  try {
    values = readRuntimeConfig(configPath);
  } catch (error) {
    if (options.throwOnError) throw error;
    values = {};
  }
  const applied = applyToProcessEnv(values, { defaults: options.defaults || {} });
  return {
    configPath,
    values,
    applied,
  };
}

function isRuntimeConfigKey(key) {
  return RUNTIME_CONFIG_KEY_SET.has(key);
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  RUNTIME_CONFIG_KEYS,
  applyToProcessEnv,
  ensureSecureDirectory,
  getConfigPath,
  isRuntimeConfigKey,
  loadRuntimeConfigIntoProcessEnv,
  readRuntimeConfig,
  sanitizeRuntimeConfig,
  writeRuntimeConfig,
};
