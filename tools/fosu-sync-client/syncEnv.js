const fs = require("fs");
const path = require("path");

const CLIENT_DIR = __dirname;
const SYNC_ENV_PATH = path.join(CLIENT_DIR, ".env");
const SYNC_LOCAL_ENV_PATH = path.join(CLIENT_DIR, ".env.local");
const REPO_LOCAL_ENV_PATH = path.resolve(CLIENT_DIR, "..", "..", ".env.local");

const SYNC_DEFAULTS = {
  FOSU_BASE_URL: "https://100.fosu.edu.cn",
  FOSU_AUTH_URL: "https://authserver.fosu.edu.cn",
  FOSU_API_BASE: "https://class.katelya.eu.org",
  SYNC_DISABLE_PROXY: "true",
  PREFERRED_SEMESTER: "",
};

const SYNC_ENV_FIELDS = Object.keys(SYNC_DEFAULTS);
const PROXY_ENV_NAMES = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
];

const DIRECT_NO_PROXY_HOSTS = [
  "100.fosu.edu.cn",
  "authserver.fosu.edu.cn",
  "class.katelya.eu.org",
  "cloud1-d3g17rpe7566d3d5c-1442900641.tcloudbaseapp.com",
  "localhost",
  "127.0.0.1",
  "172.16.0.0/12",
];
const DIRECT_BROWSER_ARGS = [
  "--no-proxy-server",
  "--proxy-bypass-list=*",
];

function parseEnvValue(rawValue) {
  let value = String(rawValue == null ? "" : rawValue).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value.replace(/\\n/g, "\n");
}

function parseEnvText(text) {
  return String(text || "").split(/\r?\n/).reduce((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return acc;
    const index = trimmed.indexOf("=");
    if (index <= 0) return acc;
    const key = trimmed.slice(0, index).trim();
    if (!key) return acc;
    acc[key] = parseEnvValue(trimmed.slice(index + 1));
    return acc;
  }, {});
}

function readSyncClientEnv(envPath = SYNC_ENV_PATH, deps = {}) {
  const fsImpl = deps.fs || fs;
  try {
    if (!fsImpl.existsSync(envPath)) return {};
    return parseEnvText(fsImpl.readFileSync(envPath, "utf8"));
  } catch (error) {
    return {};
  }
}

function loadSyncClientEnv(options = {}) {
  const env = options.env || process.env;
  const envPath = options.envPath || SYNC_ENV_PATH;
  const deps = options.deps || {};
  const parsed = Object.prototype.hasOwnProperty.call(options, "envPath")
    ? readSyncClientEnv(envPath, deps)
    : Object.assign(
      {},
      readSyncClientEnv(envPath, deps),
      readSyncClientEnv(REPO_LOCAL_ENV_PATH, deps),
      readSyncClientEnv(SYNC_LOCAL_ENV_PATH, deps),
    );

  Object.keys(parsed).forEach((key) => {
    if (env[key] === undefined || env[key] === "") {
      env[key] = parsed[key];
    }
  });

  SYNC_ENV_FIELDS.forEach((key) => {
    if (env[key] === undefined || env[key] === "") {
      env[key] = SYNC_DEFAULTS[key];
    }
  });

  return {
    envPath,
    loaded: Object.keys(parsed),
    values: SYNC_ENV_FIELDS.reduce((acc, key) => {
      acc[key] = env[key];
      return acc;
    }, {}),
  };
}

function mergeNoProxy(existing, additions) {
  const seen = new Set();
  return String(existing || "")
    .split(",")
    .concat(additions || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(",");
}

function envFlag(value, defaultValue) {
  if (value === undefined || value === "") return Boolean(defaultValue);
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function prepareDirectNetworkEnvironment(env = process.env, options = {}) {
  if (env.SYNC_DISABLE_PROXY === undefined || env.SYNC_DISABLE_PROXY === "") {
    env.SYNC_DISABLE_PROXY = "true";
  }
  const disableProxy = envFlag(env.SYNC_DISABLE_PROXY, true);
  const detectedProxyNames = PROXY_ENV_NAMES.filter((name) => Boolean(env[name]));

  if (disableProxy) {
    PROXY_ENV_NAMES.forEach((name) => {
      delete env[name];
    });
  }

  const mergedNoProxy = mergeNoProxy(env.NO_PROXY || env.no_proxy || "", DIRECT_NO_PROXY_HOSTS);
  env.NO_PROXY = mergedNoProxy;
  env.no_proxy = mergedNoProxy;

  if (options.axios && options.axios.defaults) {
    options.axios.defaults.proxy = false;
  }

  return {
    disableProxy,
    detectedProxyNames,
    noProxy: mergedNoProxy,
    removedProxyNames: disableProxy ? detectedProxyNames : [],
  };
}

function withDirectBrowserArgs(args = []) {
  const seen = new Set();
  return (Array.isArray(args) ? args : [])
    .concat(DIRECT_BROWSER_ARGS)
    .filter((item) => {
      const key = String(item || "").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function safeEnvSummary(env = process.env) {
  return {
    FOSU_BASE_URL: env.FOSU_BASE_URL || SYNC_DEFAULTS.FOSU_BASE_URL,
    FOSU_AUTH_URL: env.FOSU_AUTH_URL || SYNC_DEFAULTS.FOSU_AUTH_URL,
    FOSU_API_BASE: env.FOSU_API_BASE || SYNC_DEFAULTS.FOSU_API_BASE,
    SYNC_DISABLE_PROXY: env.SYNC_DISABLE_PROXY || SYNC_DEFAULTS.SYNC_DISABLE_PROXY,
    PREFERRED_SEMESTER: env.PREFERRED_SEMESTER || "",
  };
}

module.exports = {
  CLIENT_DIR,
  DIRECT_BROWSER_ARGS,
  DIRECT_NO_PROXY_HOSTS,
  PROXY_ENV_NAMES,
  SYNC_DEFAULTS,
  SYNC_ENV_FIELDS,
  SYNC_LOCAL_ENV_PATH,
  SYNC_ENV_PATH,
  REPO_LOCAL_ENV_PATH,
  loadSyncClientEnv,
  mergeNoProxy,
  parseEnvText,
  prepareDirectNetworkEnvironment,
  readSyncClientEnv,
  safeEnvSummary,
  withDirectBrowserArgs,
};
