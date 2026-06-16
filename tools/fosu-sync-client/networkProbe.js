const dns = require("dns").promises;
const net = require("net");
const axios = require("axios");
const {
  loadSyncClientEnv,
  prepareDirectNetworkEnvironment,
  safeEnvSummary,
} = require("./syncEnv");

const ACCEPTABLE_HTTP_STATUSES = new Set([200, 204, 301, 302, 303, 307, 308, 401, 403, 503]);

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
    const addresses = (Array.isArray(records) ? records : [records])
      .map((item) => item && item.address || item)
      .filter(Boolean);
    return {
      ok: addresses.length > 0,
      hostname,
      addresses,
      privateAddresses: addresses.filter(isPrivateIpv4),
      campusAddresses: addresses.filter(isFosuCampusIpv4),
    };
  } catch (error) {
    return {
      ok: false,
      hostname,
      addresses: [],
      privateAddresses: [],
      campusAddresses: [],
      code: error.code || "DNS_LOOKUP_FAILED",
      message: error.message,
    };
  }
}

function probeTcp(hostname, port, timeoutMs = 5000, deps = {}) {
  const socketFactory = deps.createConnection || net.createConnection;
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const socket = socketFactory({ host: hostname, port });
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (error) {}
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
      timeout: options.timeoutMs || 8000,
      maxRedirects: 0,
      validateStatus: () => true,
      proxy: false,
      headers: { Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" },
    });
    const location = response.headers && (response.headers.location || response.headers.Location) || "";
    const redirectedToLogin = response.status >= 300 && response.status < 400 &&
      /authserver\.fosu\.edu\.cn|login/i.test(String(location));
    return {
      ok: response.status >= 200 && response.status < 400,
      url: String(url),
      status: response.status,
      redirectedToLogin,
      location: sanitizeLocation(location),
      elapsedMs: Date.now() - startedAt,
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
      elapsedMs: Date.now() - startedAt,
    };
  }
}

function hasAcceptableHttp(http) {
  const status = Number(http && http.status || 0);
  return Boolean(http && (http.redirectedToLogin || ACCEPTABLE_HTTP_STATUSES.has(status) || (status >= 200 && status < 400)));
}

function summarizeHttp(http) {
  if (!http) return "";
  if (http.redirectedToLogin) return "HTTP 302 登录跳转";
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
      warnings.push(`已解析到校内地址，Node HTTP 返回 ${status.replace(/^HTTP\s+/i, "")}，但可继续验证浏览器登录态。`);
    }
  } else if (dnsPrivate) {
    warnings.push("DNS 已解析到 RFC1918 内网地址，可继续验证浏览器登录态。");
  } else if (dnsOk) {
    warnings.push("DNS 未解析到校内内网地址；如果浏览器登录态有效，将继续执行。");
  }

  if (httpResult.redirectedToLogin) {
    return {
      success: true,
      readiness: "ready",
      warnings,
      blockers,
    };
  }

  if (authTimeout && sessionCapable === true) {
    warnings.push("统一认证服务访问超时，但已有有效教务登录态，可继续抓取。");
  } else if (authTimeout) {
    warnings.push("统一认证服务访问超时，将由登录态验证决定是否继续。");
  }

  if (dnsCampus || dnsPrivate) {
    return {
      success: true,
      readiness: warnings.length ? "ready-with-warning" : "ready",
      warnings,
      blockers,
    };
  }

  if (httpAcceptable || tcpResult.ok || authResult.ok) {
    return {
      success: true,
      readiness: warnings.length ? "ready-with-warning" : "ready",
      warnings,
      blockers,
    };
  }

  if (!dnsOk) blockers.push("DNS 解析失败。");
  if (!anyRoute) blockers.push("未检测到可用校园网路由。");
  if (sessionCapable === false) blockers.push("教务登录态验证失败。");

  return {
    success: false,
    readiness: "blocked",
    warnings,
    blockers: blockers.length ? blockers : ["校园网 DNS、TCP/HTTP 与登录态均不可用。"],
  };
}

async function probeCampusNetwork(options = {}) {
  const env = options.env || process.env;
  loadSyncClientEnv({ env });
  const proxy = prepareDirectNetworkEnvironment(env, { axios: options.axios || axios });
  const baseUrl = toUrl(env.FOSU_BASE_URL, "https://100.fosu.edu.cn");
  const authUrl = toUrl(env.FOSU_AUTH_URL, "https://authserver.fosu.edu.cn");
  const port = baseUrl.port ? Number(baseUrl.port) : (baseUrl.protocol === "https:" ? 443 : 80);

  const dnsResult = await lookupHost(baseUrl.hostname, options.deps || {});
  const tcpResult = dnsResult.ok
    ? await probeTcp(baseUrl.hostname, port, options.tcpTimeoutMs || 5000, options.deps || {})
    : { ok: false, hostname: baseUrl.hostname, port, code: "DNS_UNAVAILABLE", message: "DNS lookup did not return addresses" };
  const httpResult = await probeHttp(baseUrl.toString(), {
    axios: options.axios || axios,
    timeoutMs: options.httpTimeoutMs || 8000,
  });
  const authResult = await probeHttp(authUrl.toString(), {
    axios: options.axios || axios,
    timeoutMs: options.authTimeoutMs || 8000,
  });
  const readiness = evaluateNetworkReadiness({
    dns: dnsResult,
    tcp: tcpResult,
    http: httpResult,
    auth: authResult,
    sessionCapable: options.sessionCapable,
  });

  return {
    success: readiness.success,
    readiness: readiness.readiness,
    dns: Object.assign({}, dnsResult, {
      hasPrivateAddress: Boolean(dnsResult.privateAddresses && dnsResult.privateAddresses.length),
      hasCampusAddress: Boolean(dnsResult.campusAddresses && dnsResult.campusAddresses.length),
    }),
    tcp: tcpResult,
    http: httpResult,
    auth: authResult,
    sessionCapable: options.sessionCapable === undefined ? "unknown" : Boolean(options.sessionCapable),
    warnings: readiness.warnings,
    blockers: readiness.blockers,
    proxy: {
      disabled: proxy.disableProxy,
      detectedProxyNames: proxy.detectedProxyNames,
      removedProxyNames: proxy.removedProxyNames,
      noProxy: proxy.noProxy,
    },
    env: safeEnvSummary(env),
  };
}

function printDiagnosisSummary(result, logger = console) {
  logger.log("=== FosuClass 校园网检查 ===");
  logger.log(`readiness: ${result.readiness}`);
  logger.log(`DNS: ${result.dns.ok ? "PASS" : "BLOCKED"} ${result.dns.addresses && result.dns.addresses.length ? result.dns.addresses.join(", ") : result.dns.code || ""}`);
  logger.log(`TCP: ${result.tcp.ok ? "PASS" : "WARN"} ${result.tcp.code || ""}`);
  logger.log(`HTTP: ${result.http.status || result.http.code || "n/a"}${result.http.redirectedToLogin ? " 登录跳转" : ""}`);
  logger.log(`Auth: ${result.auth.status || result.auth.code || "n/a"}`);
  if (result.proxy.detectedProxyNames.length) {
    logger.warn(`检测到代理环境变量: ${result.proxy.detectedProxyNames.join(", ")}`);
    if (result.proxy.disabled) logger.warn("已在当前进程禁用代理变量，并使用直连访问校园教务、Oracle 与 CloudBase。");
  }
  result.warnings.forEach((warning) => logger.warn(`WARN: ${warning}`));
  result.blockers.forEach((blocker) => logger.error(`BLOCKED: ${blocker}`));
  if (result.readiness === "ready-with-warning") {
    logger.warn("网络检查存在警告，将继续验证教务登录态。");
  }
  if (result.readiness === "blocked") {
    logger.error("请连接校园网或 EasyConnect 后重试。");
  }
}

module.exports = {
  ACCEPTABLE_HTTP_STATUSES,
  evaluateNetworkReadiness,
  isFosuCampusIpv4,
  isPrivateIpv4,
  lookupHost,
  printDiagnosisSummary,
  probeCampusNetwork,
  probeHttp,
  probeTcp,
};
