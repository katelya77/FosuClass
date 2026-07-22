const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
  "AI_PROVIDER_ACTIVE_ENV",
  "AI_PROVIDER_ENVIRONMENTS",
  "AI_PROVIDER_RUNTIME_VERSION",
  "AI_PROVIDER_RUNTIME_UPDATED_AT",
  "AI_API_KEY",
  "DEEPSEEK_API_KEY",
  "COZE_API_BASE_URL",
  "COZE_API_KEY",
  "COZE_BOT_ID",
  "COZE_CHAT_ENDPOINT",
  "COZE_POLL_ENABLED",
  "COZE_POLL_INTERVAL_MS",
  "COZE_POLL_MAX_ATTEMPTS",
  "AI_RUNTIME_MODE",
  "CLOUDBASE_OPENAI_ENABLED",
  "CLOUDBASE_OPENAI_BASE_URL",
  "CLOUDBASE_OPENAI_API_KEY",
  "CLOUDBASE_OPENAI_TEXT_MODEL",
  "CLOUDBASE_OPENAI_TIMEOUT_MS",
  "CLOUDBASE_OPENAI_MAX_TOKENS",
];

const RUNTIME_CONFIG_KEY_SET = new Set(RUNTIME_CONFIG_KEYS);
const SECRET_CONFIG_KEYS = new Set([
  "AI_API_KEY",
  "DEEPSEEK_API_KEY",
  "COZE_API_KEY",
  "CLOUDBASE_OPENAI_API_KEY",
]);
const ENCRYPTED_PREFIX = "enc:v1:";

function createConfigError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

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

function isEncryptedSecret(value) {
  return String(value || "").startsWith(ENCRYPTED_PREFIX);
}

function hasEncryptionKey() {
  return Boolean(getEncryptionKey());
}

function hasPlaintextSecrets(input = {}) {
  return Object.keys(input || {}).some((key) => {
    if (!SECRET_CONFIG_KEYS.has(key)) return false;
    const value = input[key];
    return value !== undefined && value !== null && value !== "" && !isEncryptedSecret(value);
  });
}

function sanitizeRuntimeConfig(input = {}) {
  const output = {};
  RUNTIME_CONFIG_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return;
    const value = input[key];
    if (value === undefined || value === null) return;
    output[key] = SECRET_CONFIG_KEYS.has(key) ? decryptSecretValue(String(value)) : String(value);
  });
  return output;
}

function getEncryptionKey() {
  const raw = String(process.env.FOSU_AI_CONFIG_ENCRYPTION_KEY || "").trim();
  if (!raw) return null;
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw).digest();
}

function encryptSecretValue(value) {
  const text = String(value || "");
  if (!text || text.startsWith(ENCRYPTED_PREFIX)) return text;
  const key = getEncryptionKey();
  if (!key) {
    throw createConfigError(
      "FOSU_AI_CONFIG_ENCRYPTION_KEY is required before saving AI provider secrets.",
      "AI_CONFIG_ENCRYPTION_KEY_REQUIRED"
    );
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTED_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

function decryptSecretValue(value) {
  const text = String(value || "");
  if (!text.startsWith(ENCRYPTED_PREFIX)) return text;
  const key = getEncryptionKey();
  if (!key) {
    throw createConfigError(
      "FOSU_AI_CONFIG_ENCRYPTION_KEY is required to decrypt AI provider secret.",
      "AI_CONFIG_ENCRYPTION_KEY_REQUIRED"
    );
  }
  const parts = text.split(":");
  if (parts.length !== 6) {
    throw createConfigError("Invalid encrypted AI provider secret format.", "AI_CONFIG_SECRET_INVALID");
  }
  const iv = Buffer.from(parts[3], "base64url");
  const tag = Buffer.from(parts[4], "base64url");
  const ciphertext = Buffer.from(parts[5], "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function serializeRuntimeConfig(values = {}) {
  const output = {};
  Object.keys(values).forEach((key) => {
    if (!RUNTIME_CONFIG_KEY_SET.has(key)) return;
    const value = values[key];
    if (value === undefined || value === null) return;
    output[key] = SECRET_CONFIG_KEYS.has(key) ? encryptSecretValue(value) : String(value);
  });
  return output;
}

function readRawRuntimeConfig(configPath = getConfigPath()) {
  if (!fs.existsSync(configPath)) return {};
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function writeRawRuntimeConfig(configPath, values) {
  ensureSecureDirectory(configPath);
  const tmpPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(values, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
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
}

function backupPlaintextConfig(configPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${configPath}.plaintext-backup-${timestamp}`;
  fs.copyFileSync(configPath, backupPath);
  try {
    fs.chmodSync(backupPath, 0o600);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
  return backupPath;
}

function migratePlaintextSecrets(configPath = getConfigPath(), rawValues = readRawRuntimeConfig(configPath)) {
  if (!hasPlaintextSecrets(rawValues)) {
    return { migrated: false, configPath, backupPath: "" };
  }
  if (!hasEncryptionKey()) {
    throw createConfigError(
      "Plaintext AI provider secrets exist, but FOSU_AI_CONFIG_ENCRYPTION_KEY is not configured.",
      "AI_CONFIG_PLAINTEXT_SECRET_REQUIRES_MIGRATION"
    );
  }
  const backupPath = backupPlaintextConfig(configPath);
  const encrypted = {};
  Object.keys(rawValues).forEach((key) => {
    if (!RUNTIME_CONFIG_KEY_SET.has(key)) return;
    const value = rawValues[key];
    if (value === undefined || value === null) return;
    encrypted[key] = SECRET_CONFIG_KEYS.has(key) ? encryptSecretValue(value) : String(value);
  });
  writeRawRuntimeConfig(configPath, encrypted);
  return { migrated: true, configPath, backupPath };
}

function readRuntimeConfig(configPath = getConfigPath()) {
  try {
    if (!fs.existsSync(configPath)) return {};
    let parsed = readRawRuntimeConfig(configPath);
    if (hasPlaintextSecrets(parsed)) {
      migratePlaintextSecrets(configPath, parsed);
      parsed = readRawRuntimeConfig(configPath);
    }
    return sanitizeRuntimeConfig(parsed);
  } catch (error) {
    error.code = error.code || "AI_PROVIDER_RUNTIME_CONFIG_READ_FAILED";
    throw error;
  }
}

function writeRuntimeConfig(updates = {}, configPath = getConfigPath()) {
  ensureSecureDirectory(configPath);
  if (hasPlaintextSecrets(updates) && !hasEncryptionKey()) {
    throw createConfigError(
      "FOSU_AI_CONFIG_ENCRYPTION_KEY is required before saving AI provider secrets.",
      "AI_CONFIG_ENCRYPTION_KEY_REQUIRED"
    );
  }
  const current = fs.existsSync(configPath) ? readRuntimeConfig(configPath) : {};
  const next = Object.assign({}, current, sanitizeRuntimeConfig(updates));
  next.AI_PROVIDER_RUNTIME_VERSION = String(Date.now());
  next.AI_PROVIDER_RUNTIME_UPDATED_AT = new Date().toISOString();
  writeRawRuntimeConfig(configPath, serializeRuntimeConfig(next));
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
  hasEncryptionKey,
  hasPlaintextSecrets,
  isRuntimeConfigKey,
  loadRuntimeConfigIntoProcessEnv,
  migratePlaintextSecrets,
  readRuntimeConfig,
  sanitizeRuntimeConfig,
  writeRuntimeConfig,
};
