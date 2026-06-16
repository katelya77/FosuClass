const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_LOCAL_ENV_PATH = path.join(PROJECT_ROOT, ".local", "fosu-publisher", "admin-token.env");
const DEFAULT_LOCAL_JSON_PATH = path.join(PROJECT_ROOT, ".local", "fosu-publisher", "admin-token.json");

function cleanSecret(value) {
  return String(value == null ? "" : value).trim();
}

function hasSecret(value) {
  return cleanSecret(value).length > 0;
}

function parseEnvText(text) {
  return String(text || "").split(/\r?\n/).reduce((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return acc;
    const index = trimmed.indexOf("=");
    if (index <= 0) return acc;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    acc[key] = value;
    return acc;
  }, {});
}

function readWindowsUserEnv(name) {
  if (process.platform !== "win32") return "";
  const escapedName = String(name || "").replace(/'/g, "''");
  const script = `[Environment]::GetEnvironmentVariable('${escapedName}', 'User')`;
  try {
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status !== 0 || result.error) return "";
    return cleanSecret(result.stdout);
  } catch (error) {
    return "";
  }
}

function readLocalTokenConfig() {
  const explicit = cleanSecret(process.env.FOSU_PUBLISHER_ADMIN_TOKEN_FILE);
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [DEFAULT_LOCAL_ENV_PATH, DEFAULT_LOCAL_JSON_PATH];
  for (const filePath of candidates) {
    try {
      if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = path.extname(filePath).toLowerCase() === ".json"
        ? JSON.parse(raw)
        : parseEnvText(raw);
      const token = cleanSecret(parsed.ADMIN_API_TOKEN || parsed.ORACLE_ADMIN_TOKEN);
      if (token) {
        return {
          token,
          filePath,
          name: parsed.ADMIN_API_TOKEN ? "ADMIN_API_TOKEN" : "ORACLE_ADMIN_TOKEN",
        };
      }
    } catch (error) {
      return { token: "", filePath, name: "", error: error.message };
    }
  }
  return { token: "", filePath: "", name: "" };
}

function getPublisherAdminToken(options = {}) {
  const allowOracleAlias = options.allowOracleAlias !== false;
  const processAdminToken = cleanSecret(process.env.ADMIN_API_TOKEN);
  const processOracleToken = allowOracleAlias ? cleanSecret(process.env.ORACLE_ADMIN_TOKEN) : "";
  const windowsUserToken = readWindowsUserEnv("ADMIN_API_TOKEN");
  const localConfig = readLocalTokenConfig();

  let token = "";
  let source = "";
  let name = "";
  if (processAdminToken) {
    token = processAdminToken;
    source = "process";
    name = "ADMIN_API_TOKEN";
  } else if (windowsUserToken) {
    token = windowsUserToken;
    source = "windows-user";
    name = "ADMIN_API_TOKEN";
  } else if (localConfig.token) {
    token = localConfig.token;
    source = "local-config";
    name = localConfig.name || "ADMIN_API_TOKEN";
  } else if (processOracleToken) {
    token = processOracleToken;
    source = "process";
    name = "ORACLE_ADMIN_TOKEN";
  }

  return {
    token,
    source,
    name,
    localConfigured: Boolean(token),
    processConfigured: hasSecret(process.env.ADMIN_API_TOKEN),
    windowsUserConfigured: Boolean(windowsUserToken),
    localConfigConfigured: Boolean(localConfig.token),
    localConfigPath: localConfig.filePath || "",
    terminalRefreshRecommended: source === "windows-user" && !hasSecret(process.env.ADMIN_API_TOKEN),
  };
}

function isCiEnvironment(env = process.env) {
  return String(env.GITHUB_ACTIONS || "").toLowerCase() === "true" ||
    String(env.CI || "").toLowerCase() === "true";
}

module.exports = {
  DEFAULT_LOCAL_ENV_PATH,
  DEFAULT_LOCAL_JSON_PATH,
  getPublisherAdminToken,
  isCiEnvironment,
  readLocalTokenConfig,
  readWindowsUserEnv,
};
