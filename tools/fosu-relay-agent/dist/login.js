var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// ../fosu-sync-client/syncEnv.js
var require_syncEnv = __commonJS({
  "../fosu-sync-client/syncEnv.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var CLIENT_DIR = __dirname;
    var SYNC_ENV_PATH = path2.join(CLIENT_DIR, ".env");
    var SYNC_LOCAL_ENV_PATH = path2.join(CLIENT_DIR, ".env.local");
    var REPO_LOCAL_ENV_PATH = path2.resolve(CLIENT_DIR, "..", "..", ".env.local");
    var SYNC_DEFAULTS = {
      FOSU_BASE_URL: "https://100.fosu.edu.cn",
      FOSU_AUTH_URL: "https://authserver.fosu.edu.cn",
      FOSU_API_BASE: "https://class.katelya.eu.org",
      SYNC_DISABLE_PROXY: "true",
      PREFERRED_SEMESTER: ""
    };
    var SYNC_ENV_FIELDS = Object.keys(SYNC_DEFAULTS);
    var PROXY_ENV_NAMES = [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy"
    ];
    var DIRECT_NO_PROXY_HOSTS = [
      "100.fosu.edu.cn",
      "authserver.fosu.edu.cn",
      "class.katelya.eu.org",
      "cloud1-d3g17rpe7566d3d5c-1442900641.tcloudbaseapp.com",
      "localhost",
      "127.0.0.1",
      "172.16.0.0/12"
    ];
    function parseEnvValue(rawValue) {
      let value = String(rawValue == null ? "" : rawValue).trim();
      if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
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
      const fsImpl = deps.fs || fs2;
      try {
        if (!fsImpl.existsSync(envPath)) return {};
        return parseEnvText(fsImpl.readFileSync(envPath, "utf8"));
      } catch (error) {
        return {};
      }
    }
    function loadSyncClientEnv2(options = {}) {
      const env = options.env || process.env;
      const envPath = options.envPath || SYNC_ENV_PATH;
      const deps = options.deps || {};
      const parsed = Object.prototype.hasOwnProperty.call(options, "envPath") ? readSyncClientEnv(envPath, deps) : Object.assign(
        {},
        readSyncClientEnv(envPath, deps),
        readSyncClientEnv(REPO_LOCAL_ENV_PATH, deps),
        readSyncClientEnv(SYNC_LOCAL_ENV_PATH, deps)
      );
      Object.keys(parsed).forEach((key) => {
        if (env[key] === void 0 || env[key] === "") {
          env[key] = parsed[key];
        }
      });
      SYNC_ENV_FIELDS.forEach((key) => {
        if (env[key] === void 0 || env[key] === "") {
          env[key] = SYNC_DEFAULTS[key];
        }
      });
      return {
        envPath,
        loaded: Object.keys(parsed),
        values: SYNC_ENV_FIELDS.reduce((acc, key) => {
          acc[key] = env[key];
          return acc;
        }, {})
      };
    }
    function mergeNoProxy(existing, additions) {
      const seen = /* @__PURE__ */ new Set();
      return String(existing || "").split(",").concat(additions || []).map((item) => String(item || "").trim()).filter(Boolean).filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).join(",");
    }
    function envFlag(value, defaultValue) {
      if (value === void 0 || value === "") return Boolean(defaultValue);
      return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
    }
    function prepareDirectNetworkEnvironment2(env = process.env, options = {}) {
      if (env.SYNC_DISABLE_PROXY === void 0 || env.SYNC_DISABLE_PROXY === "") {
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
        removedProxyNames: disableProxy ? detectedProxyNames : []
      };
    }
    function safeEnvSummary(env = process.env) {
      return {
        FOSU_BASE_URL: env.FOSU_BASE_URL || SYNC_DEFAULTS.FOSU_BASE_URL,
        FOSU_AUTH_URL: env.FOSU_AUTH_URL || SYNC_DEFAULTS.FOSU_AUTH_URL,
        FOSU_API_BASE: env.FOSU_API_BASE || SYNC_DEFAULTS.FOSU_API_BASE,
        SYNC_DISABLE_PROXY: env.SYNC_DISABLE_PROXY || SYNC_DEFAULTS.SYNC_DISABLE_PROXY,
        PREFERRED_SEMESTER: env.PREFERRED_SEMESTER || ""
      };
    }
    module2.exports = {
      CLIENT_DIR,
      DIRECT_NO_PROXY_HOSTS,
      PROXY_ENV_NAMES,
      SYNC_DEFAULTS,
      SYNC_ENV_FIELDS,
      SYNC_LOCAL_ENV_PATH,
      SYNC_ENV_PATH,
      REPO_LOCAL_ENV_PATH,
      loadSyncClientEnv: loadSyncClientEnv2,
      mergeNoProxy,
      parseEnvText,
      prepareDirectNetworkEnvironment: prepareDirectNetworkEnvironment2,
      readSyncClientEnv,
      safeEnvSummary
    };
  }
});

// ../fosu-sync-client/networkProbe.js
var require_networkProbe = __commonJS({
  "../fosu-sync-client/networkProbe.js"(exports2, module2) {
    var dns = require("dns").promises;
    var net = require("net");
    var axios = require("axios");
    var {
      loadSyncClientEnv: loadSyncClientEnv2,
      prepareDirectNetworkEnvironment: prepareDirectNetworkEnvironment2,
      safeEnvSummary
    } = require_syncEnv();
    var ACCEPTABLE_HTTP_STATUSES = /* @__PURE__ */ new Set([200, 204, 301, 302, 303, 307, 308, 401, 403, 503]);
    function toUrl(value, fallback) {
      try {
        return new URL(value || fallback);
      } catch (error) {
        const wrapped = new Error(`Invalid URL: ${value || fallback}`);
        wrapped.code = "INVALID_URL";
        throw wrapped;
      }
    }
    function isPrivateIpv4(ip) {
      const parts = String(ip || "").split(".").map((part) => Number(part));
      if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
      if (parts[0] === 10) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      return false;
    }
    function isFosuCampusIpv4(ip) {
      const parts = String(ip || "").split(".").map((part) => Number(part));
      return parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
    }
    async function lookupHost(hostname, deps = {}) {
      const lookup = deps.lookup || dns.lookup.bind(dns);
      try {
        const records = await lookup(hostname, { all: true });
        const addresses = (Array.isArray(records) ? records : [records]).map((item) => item && item.address || item).filter(Boolean);
        return {
          ok: addresses.length > 0,
          hostname,
          addresses,
          privateAddresses: addresses.filter(isPrivateIpv4),
          campusAddresses: addresses.filter(isFosuCampusIpv4)
        };
      } catch (error) {
        return {
          ok: false,
          hostname,
          addresses: [],
          privateAddresses: [],
          campusAddresses: [],
          code: error.code || "DNS_LOOKUP_FAILED",
          message: error.message
        };
      }
    }
    function probeTcp(hostname, port, timeoutMs = 5e3, deps = {}) {
      const socketFactory = deps.createConnection || net.createConnection;
      return new Promise((resolve) => {
        const startedAt = Date.now();
        let settled = false;
        const socket = socketFactory({ host: hostname, port });
        const done = (result) => {
          if (settled) return;
          settled = true;
          try {
            socket.destroy();
          } catch (error) {
          }
          resolve(Object.assign({ hostname, port, elapsedMs: Date.now() - startedAt }, result));
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => done({ ok: true }));
        socket.once("timeout", () => done({ ok: false, code: "TCP_TIMEOUT", message: `timeout after ${timeoutMs}ms` }));
        socket.once("error", (error) => done({ ok: false, code: error.code || "TCP_CONNECT_FAILED", message: error.message }));
      });
    }
    function sanitizeLocation(value) {
      const text = String(value || "");
      if (!text) return "";
      try {
        const url = new URL(text);
        return `${url.protocol}//${url.hostname}${url.pathname}`;
      } catch (error) {
        return text.replace(/([?&](?:token|ticket|cookie|session|password|secret)[^=]*=)[^&\s]+/gi, "$1[redacted]");
      }
    }
    async function probeHttp(url, options = {}) {
      const client = options.axios || axios;
      const startedAt = Date.now();
      try {
        const response = await client.get(String(url), {
          timeout: options.timeoutMs || 8e3,
          maxRedirects: 0,
          validateStatus: () => true,
          proxy: false,
          headers: { Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" }
        });
        const location = response.headers && (response.headers.location || response.headers.Location) || "";
        const redirectedToLogin = response.status >= 300 && response.status < 400 && /authserver\.fosu\.edu\.cn|login/i.test(String(location));
        return {
          ok: response.status >= 200 && response.status < 400,
          url: String(url),
          status: response.status,
          redirectedToLogin,
          location: sanitizeLocation(location),
          elapsedMs: Date.now() - startedAt
        };
      } catch (error) {
        const status = error.response && error.response.status || 0;
        const location = error.response && error.response.headers && error.response.headers.location || "";
        return {
          ok: false,
          url: String(url),
          status,
          redirectedToLogin: Boolean(location && /authserver\.fosu\.edu\.cn|login/i.test(String(location))),
          location: sanitizeLocation(location),
          code: error.code || "HTTP_REQUEST_FAILED",
          message: error.message,
          elapsedMs: Date.now() - startedAt
        };
      }
    }
    function hasAcceptableHttp(http) {
      const status = Number(http && http.status || 0);
      return Boolean(http && (http.redirectedToLogin || ACCEPTABLE_HTTP_STATUSES.has(status) || status >= 200 && status < 400));
    }
    function summarizeHttp(http) {
      if (!http) return "";
      if (http.redirectedToLogin) return "HTTP 302 \u767B\u5F55\u8DF3\u8F6C";
      if (http.status) return `HTTP ${http.status}`;
      if (http.code) return http.code;
      return "";
    }
    function evaluateNetworkReadiness(input = {}) {
      const dnsResult = input.dns || {};
      const tcpResult = input.tcp || {};
      const httpResult = input.http || {};
      const authResult = input.auth || {};
      const sessionCapable = input.sessionCapable;
      const warnings = [];
      const blockers = [];
      const dnsOk = dnsResult.ok === true;
      const dnsPrivate = Boolean(dnsResult.hasPrivateAddress || dnsResult.privateAddresses && dnsResult.privateAddresses.length);
      const dnsCampus = Boolean(dnsResult.hasCampusAddress || dnsResult.campusAddresses && dnsResult.campusAddresses.length);
      const httpAcceptable = hasAcceptableHttp(httpResult);
      const authTimeout = /TIMEOUT|ETIMEDOUT|ECONNABORTED/i.test(String(authResult.code || authResult.message || ""));
      const anyRoute = Boolean(tcpResult.ok || httpAcceptable || authResult.ok);
      if (dnsCampus) {
        const status = summarizeHttp(httpResult);
        if (status && (!httpResult.ok || Number(httpResult.status) === 503 || Number(httpResult.status) === 401 || Number(httpResult.status) === 403)) {
          warnings.push(`\u5DF2\u89E3\u6790\u5230\u6821\u5185\u5730\u5740\uFF0CNode HTTP \u8FD4\u56DE ${status.replace(/^HTTP\s+/i, "")}\uFF0C\u4F46\u53EF\u7EE7\u7EED\u9A8C\u8BC1\u6D4F\u89C8\u5668\u767B\u5F55\u6001\u3002`);
        }
      } else if (dnsPrivate) {
        warnings.push("DNS \u5DF2\u89E3\u6790\u5230 RFC1918 \u5185\u7F51\u5730\u5740\uFF0C\u53EF\u7EE7\u7EED\u9A8C\u8BC1\u6D4F\u89C8\u5668\u767B\u5F55\u6001\u3002");
      } else if (dnsOk) {
        warnings.push("DNS \u672A\u89E3\u6790\u5230\u6821\u5185\u5185\u7F51\u5730\u5740\uFF1B\u5982\u679C\u6D4F\u89C8\u5668\u767B\u5F55\u6001\u6709\u6548\uFF0C\u5C06\u7EE7\u7EED\u6267\u884C\u3002");
      }
      if (httpResult.redirectedToLogin) {
        return {
          success: true,
          readiness: "ready",
          warnings,
          blockers
        };
      }
      if (authTimeout && sessionCapable === true) {
        warnings.push("\u7EDF\u4E00\u8BA4\u8BC1\u670D\u52A1\u8BBF\u95EE\u8D85\u65F6\uFF0C\u4F46\u5DF2\u6709\u6709\u6548\u6559\u52A1\u767B\u5F55\u6001\uFF0C\u53EF\u7EE7\u7EED\u6293\u53D6\u3002");
      } else if (authTimeout) {
        warnings.push("\u7EDF\u4E00\u8BA4\u8BC1\u670D\u52A1\u8BBF\u95EE\u8D85\u65F6\uFF0C\u5C06\u7531\u767B\u5F55\u6001\u9A8C\u8BC1\u51B3\u5B9A\u662F\u5426\u7EE7\u7EED\u3002");
      }
      if (dnsCampus || dnsPrivate) {
        return {
          success: true,
          readiness: warnings.length ? "ready-with-warning" : "ready",
          warnings,
          blockers
        };
      }
      if (httpAcceptable || tcpResult.ok || authResult.ok) {
        return {
          success: true,
          readiness: warnings.length ? "ready-with-warning" : "ready",
          warnings,
          blockers
        };
      }
      if (!dnsOk) blockers.push("DNS \u89E3\u6790\u5931\u8D25\u3002");
      if (!anyRoute) blockers.push("\u672A\u68C0\u6D4B\u5230\u53EF\u7528\u6821\u56ED\u7F51\u8DEF\u7531\u3002");
      if (sessionCapable === false) blockers.push("\u6559\u52A1\u767B\u5F55\u6001\u9A8C\u8BC1\u5931\u8D25\u3002");
      return {
        success: false,
        readiness: "blocked",
        warnings,
        blockers: blockers.length ? blockers : ["\u6821\u56ED\u7F51 DNS\u3001TCP/HTTP \u4E0E\u767B\u5F55\u6001\u5747\u4E0D\u53EF\u7528\u3002"]
      };
    }
    async function probeCampusNetwork(options = {}) {
      const env = options.env || process.env;
      loadSyncClientEnv2({ env });
      const proxy = prepareDirectNetworkEnvironment2(env, { axios: options.axios || axios });
      const baseUrl = toUrl(env.FOSU_BASE_URL, "https://100.fosu.edu.cn");
      const authUrl = toUrl(env.FOSU_AUTH_URL, "https://authserver.fosu.edu.cn");
      const port = baseUrl.port ? Number(baseUrl.port) : baseUrl.protocol === "https:" ? 443 : 80;
      const dnsResult = await lookupHost(baseUrl.hostname, options.deps || {});
      const tcpResult = dnsResult.ok ? await probeTcp(baseUrl.hostname, port, options.tcpTimeoutMs || 5e3, options.deps || {}) : { ok: false, hostname: baseUrl.hostname, port, code: "DNS_UNAVAILABLE", message: "DNS lookup did not return addresses" };
      const httpResult = await probeHttp(baseUrl.toString(), {
        axios: options.axios || axios,
        timeoutMs: options.httpTimeoutMs || 8e3
      });
      const authResult = await probeHttp(authUrl.toString(), {
        axios: options.axios || axios,
        timeoutMs: options.authTimeoutMs || 8e3
      });
      const readiness = evaluateNetworkReadiness({
        dns: dnsResult,
        tcp: tcpResult,
        http: httpResult,
        auth: authResult,
        sessionCapable: options.sessionCapable
      });
      return {
        success: readiness.success,
        readiness: readiness.readiness,
        dns: Object.assign({}, dnsResult, {
          hasPrivateAddress: Boolean(dnsResult.privateAddresses && dnsResult.privateAddresses.length),
          hasCampusAddress: Boolean(dnsResult.campusAddresses && dnsResult.campusAddresses.length)
        }),
        tcp: tcpResult,
        http: httpResult,
        auth: authResult,
        sessionCapable: options.sessionCapable === void 0 ? "unknown" : Boolean(options.sessionCapable),
        warnings: readiness.warnings,
        blockers: readiness.blockers,
        proxy: {
          disabled: proxy.disableProxy,
          detectedProxyNames: proxy.detectedProxyNames,
          removedProxyNames: proxy.removedProxyNames,
          noProxy: proxy.noProxy
        },
        env: safeEnvSummary(env)
      };
    }
    function printDiagnosisSummary(result, logger = console) {
      logger.log("=== FosuClass \u6821\u56ED\u7F51\u68C0\u67E5 ===");
      logger.log(`readiness: ${result.readiness}`);
      logger.log(`DNS: ${result.dns.ok ? "PASS" : "BLOCKED"} ${result.dns.addresses && result.dns.addresses.length ? result.dns.addresses.join(", ") : result.dns.code || ""}`);
      logger.log(`TCP: ${result.tcp.ok ? "PASS" : "WARN"} ${result.tcp.code || ""}`);
      logger.log(`HTTP: ${result.http.status || result.http.code || "n/a"}${result.http.redirectedToLogin ? " \u767B\u5F55\u8DF3\u8F6C" : ""}`);
      logger.log(`Auth: ${result.auth.status || result.auth.code || "n/a"}`);
      if (result.proxy.detectedProxyNames.length) {
        logger.warn(`\u68C0\u6D4B\u5230\u4EE3\u7406\u73AF\u5883\u53D8\u91CF: ${result.proxy.detectedProxyNames.join(", ")}`);
        if (result.proxy.disabled) logger.warn("\u5DF2\u5728\u5F53\u524D\u8FDB\u7A0B\u7981\u7528\u4EE3\u7406\u53D8\u91CF\uFF0C\u5E76\u4F7F\u7528\u76F4\u8FDE\u8BBF\u95EE\u6821\u56ED\u6559\u52A1\u3001Oracle \u4E0E CloudBase\u3002");
      }
      result.warnings.forEach((warning) => logger.warn(`WARN: ${warning}`));
      result.blockers.forEach((blocker) => logger.error(`BLOCKED: ${blocker}`));
      if (result.readiness === "ready-with-warning") {
        logger.warn("\u7F51\u7EDC\u68C0\u67E5\u5B58\u5728\u8B66\u544A\uFF0C\u5C06\u7EE7\u7EED\u9A8C\u8BC1\u6559\u52A1\u767B\u5F55\u6001\u3002");
      }
      if (result.readiness === "blocked") {
        logger.error("\u8BF7\u8FDE\u63A5\u6821\u56ED\u7F51\u6216 EasyConnect \u540E\u91CD\u8BD5\u3002");
      }
    }
    module2.exports = {
      ACCEPTABLE_HTTP_STATUSES,
      evaluateNetworkReadiness,
      isFosuCampusIpv4,
      isPrivateIpv4,
      lookupHost,
      printDiagnosisSummary,
      probeCampusNetwork,
      probeHttp,
      probeTcp
    };
  }
});

// ../fosu-sync-client/diagnose.js
var require_diagnose = __commonJS({
  "../fosu-sync-client/diagnose.js"(exports2, module2) {
    var {
      printDiagnosisSummary,
      probeCampusNetwork
    } = require_networkProbe();
    function parseArgs(argv = []) {
      return argv.reduce((acc, item) => {
        if (!String(item).startsWith("--")) return acc;
        const body = String(item).slice(2);
        const index = body.indexOf("=");
        if (index >= 0) acc[body.slice(0, index)] = body.slice(index + 1);
        else acc[body] = true;
        return acc;
      }, {});
    }
    async function diagnose2(options = {}) {
      const result = await probeCampusNetwork(options);
      if (!options.json) {
        printDiagnosisSummary(result, options.logger || console);
      }
      return result;
    }
    if (require.main === module2) {
      const args = parseArgs(process.argv.slice(2));
      diagnose2({
        json: Boolean(args.json),
        publisher: Boolean(args.publisher)
      }).then((result) => {
        if (args.json) {
          console.log(JSON.stringify(result, null, 2));
        }
        process.exitCode = result.readiness === "blocked" ? 1 : 0;
      }).catch((error) => {
        const payload = {
          success: false,
          readiness: "blocked",
          code: error.code || "CAMPUS_NETWORK_CHECK_FAILED",
          message: error.message
        };
        if (args.json) console.log(JSON.stringify(payload, null, 2));
        else console.error(`${payload.code}: ${payload.message}`);
        process.exitCode = 1;
      });
    }
    module2.exports = diagnose2;
    module2.exports.parseArgs = parseArgs;
  }
});

// ../fosu-sync-client/login.js
var { chromium } = require("playwright");
var path = require("path");
var fs = require("fs");
var diagnose = require_diagnose();
var {
  loadSyncClientEnv,
  prepareDirectNetworkEnvironment
} = require_syncEnv();
loadSyncClientEnv();
prepareDirectNetworkEnvironment(process.env);
var FOSU_BASE_URL = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
var SESSION_DIR = path.join(__dirname, ".session");
var SESSION_PATH = path.join(SESSION_DIR, "session.json");
var MOBILE_SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
var WECHAT_IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49";
var DESKTOP_UA = "";
var FOSU_LOGIN_UA_MODE = String(process.env.FOSU_LOGIN_UA_MODE || process.env.FOSU_LOGIN_PROFILE || "mobile").toLowerCase() === "desktop" ? "desktop" : "mobile";
var LOGIN_AUTO = process.argv.includes("--auto") || process.argv.includes("auto") || process.env.FOSU_LOGIN_AUTO === "true";
function maskStudentId(studentId) {
  const value = String(studentId || "").trim();
  if (!value) return "";
  if (process.env.FOSU_LOGIN_SHOW_STUDENT_ID === "true") return value;
  if (value.length <= 8) return `${value.slice(0, 2)}****`;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
function getLoginCredentials() {
  const studentId = String(
    process.env.FOSU_SYNC_STUDENT_ID || process.env.FOSU_USERNAME || process.env.FOSU_STUDENT_ID || ""
  ).trim();
  const password = String(
    process.env.FOSU_SYNC_PASSWORD || process.env.FOSU_PASSWORD || ""
  );
  return { studentId, password };
}
function classifyLoginFailureContent(content, url, errorMessage) {
  const text = String(content || "").replace(/\s+/g, " ");
  const currentUrl = String(url || "");
  const message = String(errorMessage || "");
  if (/Timeout|超时|Navigation timeout/i.test(message)) return "NETWORK_TIMEOUT";
  if (/验证码|captcha/i.test(text)) return "CAPTCHA_REQUIRED";
  if (/滑块|拼图|人机|风险|风控|安全验证|risk/i.test(text)) return "RISK_CONTROL_REQUIRED";
  if (/密码错误|用户名或密码|账号或密码|认证失败|登录失败|不存在|incorrect/i.test(text)) return "INVALID_CREDENTIALS";
  if (/authserver\.fosu\.edu\.cn|\/authserver\/login/i.test(currentUrl) && !/username|password|账号|密码/i.test(text)) {
    return "LOGIN_PAGE_CHANGED";
  }
  if (/100\.fosu\.edu\.cn|authserver\.fosu\.edu\.cn/i.test(currentUrl)) return "LOGIN_NOT_COMPLETED";
  return "NETWORK_TIMEOUT";
}
function failureTipForCode(code) {
  if (code === "INVALID_CREDENTIALS") return "\u5B66\u53F7\u6216\u5BC6\u7801\u4E0D\u6B63\u786E\uFF0C\u8BF7\u786E\u8BA4\u540E\u91CD\u8BD5\u3002";
  if (code === "CAPTCHA_REQUIRED") return "\u5F53\u524D\u9700\u8981\u9A8C\u8BC1\u7801\uFF0C\u8BF7\u6539\u7528\u624B\u52A8\u767B\u5F55\u5B8C\u6210\u9A8C\u8BC1\u3002";
  if (code === "RISK_CONTROL_REQUIRED") return "\u5F53\u524D\u89E6\u53D1\u5B89\u5168\u6838\u9A8C\uFF0C\u8BF7\u5728\u6D4F\u89C8\u5668\u4E2D\u624B\u52A8\u5B8C\u6210\u9A8C\u8BC1\u3002";
  if (code === "LOGIN_PAGE_CHANGED") return "\u767B\u5F55\u9875\u7ED3\u6784\u53EF\u80FD\u5DF2\u53D8\u5316\uFF0C\u9700\u8981\u68C0\u67E5\u9009\u62E9\u5668\u3002";
  if (code === "NETWORK_TIMEOUT") return "\u8BBF\u95EE\u8D85\u65F6\uFF0C\u8BF7\u786E\u8BA4\u6821\u56ED\u7F51\u6216 VPN \u53EF\u7528\u3002";
  return "\u672A\u68C0\u6D4B\u5230\u767B\u5F55\u6210\u529F\uFF0C\u8BF7\u91CD\u65B0\u6267\u884C\u767B\u5F55\u6D41\u7A0B\u3002";
}
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}
async function login() {
  const network = await diagnose();
  if (!network || network.readiness === "blocked") {
    console.error("\u274C \u7F51\u7EDC\u8FDE\u63A5\u8BCA\u65AD\u672A\u901A\u8FC7\uFF0C\u65E0\u6CD5\u6267\u884C\u767B\u5F55\uFF01");
    console.error("\u{1F4A1} \u8BF7\u786E\u8BA4\u5DF2\u8FDE\u63A5 VPN \u6216\u5904\u4E8E\u6821\u56ED\u7F51\u73AF\u5883\u4E2D\u3002");
    process.exitCode = 1;
    return;
  }
  console.log("\n=== \u542F\u52A8 Playwright \u624B\u52A8\u767B\u5F55\u6D41\u7A0B ===");
  console.log("\u6B63\u5728\u4E3A\u60A8\u6253\u5F00\u6D4F\u89C8\u5668\uFF0C\u8BF7\u7A0D\u5019...");
  let userAgent = void 0;
  let viewport = void 0;
  if (FOSU_LOGIN_UA_MODE === "mobile") {
    userAgent = process.env.FOSU_LOGIN_UA || process.env.FOSU_IMPORT_MOBILE_UA || WECHAT_IOS_UA || MOBILE_SAFARI_UA;
    viewport = { width: 390, height: 844, isMobile: true };
  } else if (process.env.FOSU_LOGIN_UA) {
    userAgent = process.env.FOSU_LOGIN_UA;
  } else if (DESKTOP_UA) {
    userAgent = DESKTOP_UA;
  }
  console.log(`\u767B\u5F55 UA \u6A21\u5F0F: ${FOSU_LOGIN_UA_MODE}${LOGIN_AUTO ? "\uFF0C\u81EA\u52A8\u767B\u5F55" : "\uFF0C\u624B\u52A8\u767B\u5F55"}`);
  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--ignore-certificate-errors",
    "--disable-web-security"
  ];
  let browser;
  const channels = ["msedge", "chrome", null];
  for (const channel of channels) {
    try {
      const config = {
        headless: false,
        args: launchArgs
      };
      if (channel) {
        config.channel = channel;
        console.log(`\u5C1D\u8BD5\u4F7F\u7528\u7CFB\u7EDF\u6D4F\u89C8\u5668\u901A\u9053: ${channel} ...`);
      } else {
        console.log("\u4F7F\u7528\u5185\u7F6E Chromium \u6D4F\u89C8\u5668 ...");
      }
      browser = await chromium.launch(config);
      break;
    } catch (e) {
      console.warn(`\u26A0\uFE0F \u6D4F\u89C8\u5668\u901A\u9053 ${channel || "\u5185\u7F6E"} \u542F\u52A8\u5931\u8D25: ${e.message}`);
    }
  }
  if (!browser) {
    console.error("\u274C \u65E0\u6CD5\u542F\u52A8\u4EFB\u4F55\u6D4F\u89C8\u5668\uFF01\u8BF7\u68C0\u67E5 Playwright \u5B89\u88C5\u662F\u5426\u5B8C\u6574\u3002");
    process.exitCode = 1;
    return;
  }
  const context = await browser.newContext({
    userAgent,
    viewport,
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();
  const CAS_SERVICE_URL = "http://100.fosu.edu.cn/caslogin.jsp?kstzType=null";
  const AUTH_LOGIN_URL = "https://authserver.fosu.edu.cn/authserver/login?type=userNameLogin&service=" + encodeURIComponent(CAS_SERVICE_URL);
  console.log(`\u4F18\u5148\u901A\u8FC7\u8D26\u53F7\u5BC6\u7801\u767B\u5F55\u9875\u8FDB\u884C\u767B\u5F55: ${AUTH_LOGIN_URL} ...`);
  try {
    await page.goto(AUTH_LOGIN_URL, { timeout: 25e3 });
  } catch (error) {
    console.warn(`\u26A0\uFE0F \u8BBF\u95EE\u8D26\u53F7\u5BC6\u7801\u767B\u5F55\u9875\u5931\u8D25 (${error.message})\uFF0C\u5C1D\u8BD5\u76F4\u63A5\u8BBF\u95EE\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u767B\u5F55\u8DEF\u5F84...`);
    try {
      await page.goto("https://authserver.fosu.edu.cn/authserver/login", { timeout: 25e3 });
    } catch (authError) {
      console.error(`\u274C \u5BFC\u822A\u7EDF\u4E00\u8EAB\u4EFD\u8BA4\u8BC1\u7CFB\u7EDF\u5F7B\u5E95\u5931\u8D25: ${authError.message}`);
      console.log("\u{1F4A1} \u8BF7\u786E\u8BA4 EasyConnect \u662F\u5426\u6210\u529F\u8FDE\u63A5\uFF0C\u6216\u5DF2\u5904\u4E8E\u6821\u56ED\u7F51\u73AF\u5883\u4E2D\u3002");
    }
  }
  console.log("\n\u{1F4E2} [\u64CD\u4F5C\u63D0\u793A]");
  console.log("========================================================");
  console.log("1. \u8BF7\u5728\u6253\u5F00\u7684\u6D4F\u89C8\u5668\u4E2D\u624B\u52A8\u8F93\u5165\u60A8\u7684\u4F5B\u5927\u5B66\u5B66\u53F7\u4E0E\u5BC6\u7801\u3002");
  console.log("2. \u5982\u679C\u9047\u5230\u9A8C\u8BC1\u7801\u6216\u6ED1\u5757\u9A8C\u8BC1\uFF0C\u8BF7\u624B\u52A8\u5B8C\u6210\u8F93\u5165\u6216\u6ED1\u52A8\u3002");
  console.log("3. \u767B\u5F55\u6210\u529F\u540E\uFF0C\u811A\u672C\u4F1A\u81EA\u52A8\u68C0\u6D4B\u9875\u9762\u5E76\u4FDD\u5B58\u767B\u5F55\u6001\uFF0C\u968F\u540E\u81EA\u52A8\u5173\u95ED\u6D4F\u89C8\u5668\u3002");
  console.log("4. \u8BF7\u5728 5 \u5206\u949F\u5185\u5B8C\u6210\u767B\u5F55\u64CD\u4F5C\u3002");
  console.log("========================================================");
  const configuredCredentials = getLoginCredentials();
  if (LOGIN_AUTO) {
    if (!configuredCredentials.studentId || !configuredCredentials.password) {
      console.error("\u274C \u81EA\u52A8\u767B\u5F55\u9700\u8981\u914D\u7F6E FOSU_SYNC_STUDENT_ID \u548C FOSU_SYNC_PASSWORD\uFF0C\u6216\u5728 .env.local \u4E2D\u63D0\u4F9B\u3002");
      console.error("\u5BC6\u7801\u4E0D\u4F1A\u8F93\u51FA\u5230\u65E5\u5FD7\uFF0C\u4E5F\u4E0D\u4F1A\u5199\u5165 Git\u3002");
      await browser.close();
      process.exitCode = 1;
      return;
    }
    console.log(`\u81EA\u52A8\u767B\u5F55\u8D26\u53F7: ${maskStudentId(configuredCredentials.studentId)}`);
  }
  try {
    let loggedIn = false;
    let hasClickedTab = false;
    let autoSubmitted = false;
    const checkInterval = 1e3;
    const maxWaitTime = 3e5;
    let elapsed = 0;
    while (elapsed < maxWaitTime) {
      if (page.isClosed()) {
        break;
      }
      const currentUrl = page.url();
      if (currentUrl.includes("type=fidoLogin")) {
        console.log("\u26A0\uFE0F \u68C0\u6D4B\u5230\u5F53\u524D\u8FDB\u5165\u4E86\u751F\u7269\u8BC6\u522B\u767B\u5F55\u9875 (fidoLogin)\uFF0C\u6B63\u5728\u81EA\u52A8\u66FF\u6362 URL \u4E3A\u8D26\u53F7\u5BC6\u7801\u767B\u5F55\u9875 (userNameLogin)...");
        const newUrl = currentUrl.replace("type=fidoLogin", "type=userNameLogin");
        try {
          await page.goto(newUrl, { timeout: 15e3 });
          hasClickedTab = false;
          continue;
        } catch (e) {
          console.warn(`\u26A0\uFE0F \u81EA\u52A8\u8DF3\u8F6C\u5230\u8D26\u53F7\u5BC6\u7801\u767B\u5F55\u9875\u5931\u8D25: ${e.message}`);
        }
      }
      if (!hasClickedTab && !currentUrl.includes("type=userNameLogin")) {
        try {
          const tabs = [
            "text=/^\u8D26\u53F7\u767B\u5F55$/",
            "text=/^\u5BC6\u7801\u767B\u5F55$/",
            "text=/^\u8D26\u53F7\u5BC6\u7801\u767B\u5F55$/",
            "#userNameLogin",
            ".userNameLogin"
          ];
          for (const tabSelector of tabs) {
            const tab = page.locator(tabSelector).first();
            if (await tab.isVisible()) {
              console.log(`\u{1F4A1} \u68C0\u6D4B\u5230\u201C\u8D26\u53F7\u5BC6\u7801\u767B\u5F55\u201D\u76F8\u5173\u6807\u7B7E (${tabSelector})\uFF0C\u5C1D\u8BD5\u70B9\u51FB\u5207\u6362...`);
              await tab.click();
              hasClickedTab = true;
              await page.waitForTimeout(1e3);
              break;
            }
          }
        } catch (e) {
        }
      }
      const username = configuredCredentials.studentId;
      const password = configuredCredentials.password;
      if ((LOGIN_AUTO || username && password) && username && password) {
        try {
          const userSelectors = ['input[name="username"]', "#username", 'input[type="text"]'];
          const passSelectors = ['input[name="password"]', "#password", 'input[type="password"]'];
          let userEl = null;
          for (const sel of userSelectors) {
            const locator = page.locator(sel).first();
            if (await locator.isVisible()) {
              const val = await locator.inputValue();
              if (!val) {
                userEl = locator;
                break;
              }
            }
          }
          let passEl = null;
          for (const sel of passSelectors) {
            const locator = page.locator(sel).first();
            if (await locator.isVisible()) {
              const val = await locator.inputValue();
              if (!val) {
                passEl = locator;
                break;
              }
            }
          }
          if (userEl && passEl) {
            console.log(`\u68C0\u6D4B\u5230\u672A\u586B\u5199\u7684\u8D26\u53F7\u5BC6\u7801\u8F93\u5165\u6846\uFF0C\u5C1D\u8BD5\u81EA\u52A8\u586B\u5145\u8D26\u53F7 ${maskStudentId(username)}...`);
            await userEl.fill(username);
            await passEl.fill(password);
            if (LOGIN_AUTO && !autoSubmitted) {
              const submitSelectors = [
                "#login_submit",
                "#login",
                "button[type='submit']",
                "input[type='submit']",
                ".login-btn",
                "text=/^(\u767B\u5F55|\u767B \u5F55|\u63D0\u4EA4)$/"
              ];
              for (const selector of submitSelectors) {
                const submit = page.locator(selector).first();
                if (await submit.isVisible()) {
                  await submit.click();
                  autoSubmitted = true;
                  console.log("\u2705 \u5DF2\u63D0\u4EA4\u81EA\u52A8\u767B\u5F55\u8BF7\u6C42\u3002");
                  break;
                }
              }
              if (!autoSubmitted) {
                console.warn("\u26A0\uFE0F \u672A\u627E\u5230\u767B\u5F55\u6309\u94AE\uFF0C\u5DF2\u586B\u5145\u8D26\u53F7\uFF0C\u8BF7\u624B\u52A8\u70B9\u51FB\u767B\u5F55\u3002");
              }
            } else {
              console.log("\u2705 \u8D26\u53F7\u5BC6\u7801\u81EA\u52A8\u586B\u5145\u6210\u529F\uFF0C\u8BF7\u624B\u52A8\u5B8C\u6210\u9A8C\u8BC1\uFF08\u5982\u9A8C\u8BC1\u7801\u3001\u6ED1\u5757\u7B49\uFF09\u5E76\u63D0\u4EA4\u767B\u5F55\u3002");
            }
          }
        } catch (e) {
        }
      }
      const leftAuthserver = !currentUrl.includes("/authserver/login") && !currentUrl.includes("authserver.fosu.edu.cn/authserver/");
      const isCasLogin = currentUrl.includes("100.fosu.edu.cn/caslogin.jsp");
      const isEduSys = currentUrl.includes("100.fosu.edu.cn") && !currentUrl.includes("caslogin.jsp");
      const hasMainUrl = currentUrl.includes("/framework/xsMain.jsp") || currentUrl.includes("/framework/index.jsp") || currentUrl.includes("/xsMain.jsp");
      let hasMainContent = false;
      try {
        const content = await page.content();
        hasMainContent = content.includes("\u6559\u5B66\u4E00\u4F53\u5316\u670D\u52A1\u5E73\u53F0") || content.includes("\u6211\u7684\u684C\u9762") || content.includes("\u5B66\u671F\u7406\u8BBA\u8BFE\u8868");
      } catch (e) {
      }
      if (leftAuthserver && (isCasLogin || isEduSys) || hasMainUrl || hasMainContent) {
        loggedIn = true;
        break;
      }
      await page.waitForTimeout(checkInterval);
      elapsed += checkInterval;
    }
    if (!loggedIn) {
      const content = page.isClosed() ? "" : await page.content().catch(() => "");
      const code = classifyLoginFailureContent(content, page.isClosed() ? "" : page.url(), "\u767B\u5F55\u8D85\u65F6\u6216\u672A\u68C0\u6D4B\u5230\u767B\u5F55\u6210\u529F\u7684\u9875\u9762\u72B6\u6001");
      const error = new Error(failureTipForCode(code));
      error.code = code;
      throw error;
    }
    console.log("\u{1F389} \u68C0\u6D4B\u5230\u6210\u529F\u8FDB\u5165\u6559\u52A1\u7CFB\u7EDF\u4E3B\u9875\uFF01\u6B63\u5728\u4FDD\u5B58\u4F1A\u8BDD\u72B6\u6001...");
    await page.waitForTimeout(2e3);
    const storageState = await context.storageState();
    const cookiesCount = storageState.cookies.length;
    console.log(`\u6210\u529F\u83B7\u53D6\u5230 ${cookiesCount} \u4E2A\u4F1A\u8BDD\u51ED\u636E\u9879\u3002`);
    fs.writeFileSync(SESSION_PATH, JSON.stringify(storageState, null, 2), "utf-8");
    console.log(`\u2705 \u767B\u5F55\u6001\u5DF2\u6210\u529F\u4FDD\u5B58\u81F3\u672C\u5730\u6587\u4EF6: tools/fosu-sync-client/.session/session.json`);
    console.log("\u8BE5\u6587\u4EF6\u5305\u542B\u654F\u611F\u767B\u5F55\u51ED\u8BC1\uFF0C\u8BF7\u52FF\u5C06\u5176\u63D0\u4EA4\u5230 Git \u6216\u5171\u4EAB\u7ED9\u4ED6\u4EBA\u3002");
  } catch (error) {
    const content = page && !page.isClosed() ? await page.content().catch(() => "") : "";
    const code = error.code || classifyLoginFailureContent(content, page && !page.isClosed() ? page.url() : "", error.message);
    if (code === "NETWORK_TIMEOUT") {
      console.error("\n\u274C \u767B\u5F55\u8D85\u65F6\u6216\u7F51\u7EDC\u8BBF\u95EE\u5931\u8D25\uFF01");
    } else {
      console.error(`
\u274C \u767B\u5F55\u5931\u8D25: ${failureTipForCode(code)}`);
    }
    console.error(`\u5931\u8D25\u7C7B\u578B: ${code}`);
    console.error("\u{1F4A1} \u63D0\u793A\uFF1A");
    console.error("   - \u8BF7\u786E\u8BA4\u662F\u5426\u5904\u4E8E\u6821\u56ED\u7F51 / \u6821\u56ED VPN \u73AF\u5883\uFF08100.fosu.edu.cn \u5FC5\u987B\u80FD\u6B63\u5E38\u89E3\u6790\u548C\u8BBF\u95EE\uFF09");
    console.error("   - \u8BF7\u786E\u8BA4\u662F\u5426\u5207\u6362\u5230\u8D26\u53F7\u767B\u5F55\uFF0C\u4E14\u5DF2\u6B63\u786E\u5B8C\u6210\u9A8C\u8BC1\u7801\u6216\u6ED1\u5757\u9A8C\u8BC1\u7B49\u5B89\u5168\u6838\u9A8C");
    console.error("   - \u8BF7\u91CD\u65B0\u6267\u884C npm run sync:login");
  } finally {
    await browser.close();
    console.log("\u6D4F\u89C8\u5668\u5DF2\u5173\u95ED\u3002");
  }
}
if (require.main === module) {
  login();
}
module.exports = login;
