/**
 * 微信小程序 wx.request 网络请求封装
 */

const { API_BASE_URL } = require("../config/api");
const buildInfo = require("../config/buildInfo");
const clientSecurityCheckService = require("../services/clientSecurityCheckService");
const securitySessionService = require("../services/securitySessionService");
const staticAccessService = require("../services/staticAccessService");
const platform = require("./platform");
const {
  extractPathWithQuery,
  extractPathname,
  isAbsoluteHttpUrl,
  joinBaseAndPath,
  parseAbsoluteUrl,
} = require("./trustedUrl");

const REQUEST_DIAG_KEY = "FOSU_REQUEST_DIAG";
const SECURITY_FAST_TIMEOUT_MS = 15000;
const CLIENT_CHECK_TIMEOUT_MS = 12000;
const inflightRequests = new Map();
let lastDiagnostics = {
  lastError: null,
  lastSuccess: null,
  criticalLastError: null,
  backgroundLastError: null,
  lastCriticalSuccess: null,
  lastStaticSuccess: null,
  currentHealth: "unknown",
};
let transportBuildLogged = false;

const PROFILE_RULES = [
  { name: "runtime-pointer-static", pattern: /\/static\/runtime\/active\.json$/, timeout: 2000, retries: 0 },
  { name: "runtime-pointer-api", pattern: /\/api\/fosu\/runtime\/active$/, timeout: 2000, retries: 0 },
  { name: "manifest", pattern: /\/api\/fosu\/release-pack\/manifest$/, timeout: SECURITY_FAST_TIMEOUT_MS, retries: 1 },
  { name: "app-config", pattern: /\/api\/fosu\/app-config$/, timeout: SECURITY_FAST_TIMEOUT_MS, retries: 1 },
  { name: "bootstrap", pattern: /\/api\/fosu\/bootstrap$/, timeout: SECURITY_FAST_TIMEOUT_MS, retries: 1 },
  { name: "index", pattern: /\/api\/fosu\/release-pack\/index\/[^/]+$/, timeout: 25000, retries: 2 },
  { name: "catalog", pattern: /\/api\/fosu\/catalog$/, timeout: 25000, retries: 2 },
  { name: "search-index", pattern: /\/api\/fosu\/search-index$/, timeout: 25000, retries: 2 },
  { name: "detail", pattern: /\/api\/fosu\/release-pack\/detail\/[^/]+\/[^/]+$/, timeout: 20000, retries: 2 },
  { name: "schedule-detail", pattern: /\/api\/fosu\/schedule-detail$/, timeout: 20000, retries: 2 },
  { name: "empty-room", pattern: /\/api\/fosu\/release-pack\/empty-room$/, timeout: 25000, retries: 2 },
  { name: "empty-classrooms", pattern: /\/api\/fosu\/empty-classrooms$/, timeout: 25000, retries: 2 },
  { name: "fosu-import", pattern: /\/api\/schedule-import\/fosu\/(?:public-key|preview|preview\/start|preview\/status|confirm|cancel|recent|recent\/confirm)$/, timeout: 60000, retries: 0 },
  { name: "static-release-manifest", pattern: /\/static\/releases\/[^/]+\/manifest\.json$/, timeout: SECURITY_FAST_TIMEOUT_MS, retries: 1 },
  { name: "static-release-index", pattern: /\/static\/releases\/[^/]+\/index\/.+\.json$/, timeout: 25000, retries: 2 },
  { name: "static-release-detail", pattern: /\/static\/releases\/[^/]+\/detail\/[^/]+\/[^/]+\.json$/, timeout: 20000, retries: 2 },
  { name: "static-release-empty-room", pattern: /\/static\/releases\/[^/]+\/empty-room\/index\.json$/, timeout: 25000, retries: 2 },
];

function translateErrorMessage(payload, defaultMsg) {
  const reasonCode = payload ? payload.reasonCode : "";
  const msg = (payload ? payload.message : defaultMsg) || "请求服务发生网络异常";
  const msgLower = msg.toLowerCase();

  if (reasonCode === "NO_SYNC_DATA" || reasonCode === "NO_SCHEDULE_SYNCED") {
    return "暂未同步该专业课表，可稍后再试或联系维护者补充同步。";
  }

  if (reasonCode === "NO_MATCHED_CLASS") {
    return "已同步该专业课表，但没有匹配到指定班级。";
  }

  if (reasonCode === "INVALID_FILTER") {
    return "请选择学院、年级和专业后再查询课表。";
  }

  if (msgLower.includes("timeout") || msg.includes("超时") || msg.includes("网络较慢")) {
    return "网络较慢，请稍后重试";
  }

  if (
    reasonCode === "FOSU_INTRANET_ONLY" ||
    msgLower.includes("enotfound") ||
    msgLower.includes("node_tls_handshake_failed") ||
    msgLower.includes("tls") ||
    msgLower.includes("handshake") ||
    msgLower.includes("disconnected") ||
    msgLower.includes("fail")
  ) {
    return "该数据需要维护者在校园网/VPN环境下同步后才能查看。\n\n你也可以导入自己的课表，帮助完善班级课表数据。";
  }

  const hasTechnicalKey =
    msgLower.includes("captcha") ||
    msgLower.includes("login") ||
    msgLower.includes("fallback") ||
    msgLower.includes("mock") ||
    msgLower.includes("har") ||
    msgLower.includes("bnsk") ||
    msgLower.includes("debug");

  if (hasTechnicalKey) {
    return "该数据需要维护者在校园网/VPN环境下同步后才能查看。\n\n你也可以导入自己的课表，帮助完善班级课表数据。";
  }

  return msg;
}

function stripQuery(url) {
  return String(url || "").split("?")[0].split("#")[0];
}

function getPathname(url) {
  return extractPathname(url);
}

function getRequestProfile(url) {
  const pathname = getPathname(url);
  const matched = PROFILE_RULES.find((rule) => rule.pattern.test(pathname));
  if (matched) {
    return {
      name: matched.name,
      timeout: matched.timeout,
      retries: matched.retries,
    };
  }
  return {
    name: "default",
    timeout: 15000,
    retries: 0,
  };
}

function getDefaultTimeout(url) {
  return getRequestProfile(url).timeout;
}

function stableStringify(value) {
  if (!value || typeof value !== "object") {
    return String(value == null ? "" : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${key}:${stableStringify(value[key])}`).join(",")}}`;
}

function shouldRedactQueryKey(key) {
  const normalized = String(key || "").toLowerCase();
  return normalized === "token" ||
    normalized === "access_token" ||
    normalized === "admintoken" ||
    normalized.indexOf("token") >= 0 ||
    normalized.indexOf("ticket") >= 0 ||
    normalized.indexOf("session") >= 0 ||
    normalized.indexOf("secret") >= 0 ||
    normalized === "openid" ||
    normalized === "cookie" ||
    normalized === "password";
}

function redactQuery(search) {
  const value = String(search || "");
  if (!value || value[0] !== "?") return value;
  return `?${value.slice(1).split("&").map((part) => {
    if (!part) return part;
    const equalsIndex = part.indexOf("=");
    const rawKey = equalsIndex >= 0 ? part.slice(0, equalsIndex) : part;
    const key = rawKey.replace(/\+/g, " ");
    return shouldRedactQueryKey(key)
      ? `${rawKey}=[redacted]`
      : part;
  }).join("&")}`;
}

function redactUrl(url) {
  const pathWithQuery = extractPathWithQuery(url);
  const hashless = stripQuery(pathWithQuery);
  const queryIndex = pathWithQuery.indexOf("?");
  if (queryIndex < 0) return hashless;
  return `${hashless}${redactQuery(pathWithQuery.slice(queryIndex))}`;
}

function writeDiagnostics(patch) {
  lastDiagnostics = Object.assign({}, lastDiagnostics, patch || {});
  try {
    wx.setStorageSync(REQUEST_DIAG_KEY, lastDiagnostics);
  } catch (error) {
    // Diagnostics are best-effort only.
  }
}

function classifyRequest(url, options = {}) {
  if (options.diagnosisClass) return options.diagnosisClass;
  const pathname = getPathname(url);
  if (
    pathname.indexOf("/periodic-data") >= 0 ||
    pathname.indexOf("/prefetch") >= 0 ||
    pathname.indexOf("/security/client-check") >= 0 ||
    pathname.indexOf("/telemetry") >= 0 ||
    pathname.indexOf("/warmup") >= 0
  ) {
    return "background";
  }
  if (pathname.indexOf("/static/") >= 0) return "static";
  return "critical";
}

function logTransportBuildInfoOnce() {
  if (transportBuildLogged || !platform.isDeveloperEnv()) return;
  transportBuildLogged = true;
  try {
    console.info("[Fosu Security Transport]", {
      buildId: buildInfo.CLIENT_BUILD_ID,
      pipelineVersion: buildInfo.REQUEST_PIPELINE_VERSION,
      gitCommit: buildInfo.GIT_COMMIT_SHORT_SHA,
      apiBaseHost: getApiBaseHost(),
    });
  } catch (error) {
    // Developer diagnostics only.
  }
}

function getApiBaseHost() {
  try {
    const parsed = parseAbsoluteUrl(API_BASE_URL);
    return parsed && parsed.host || "";
  } catch (error) {
    return "";
  }
}

function getRequestDiagnostics() {
  try {
    return wx.getStorageSync(REQUEST_DIAG_KEY) || lastDiagnostics;
  } catch (error) {
    return lastDiagnostics;
  }
}

function sanitizeRequestErrMsg(value) {
  return String(value || "")
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/ig, "$1[redacted]")
    .replace(/((?:token|ticket|session|secret|password|cookie|api[-_]?key)\s*[:=]\s*)[^\s,;]+/ig, "$1[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function classifyTransportCode(messageText) {
  const lower = String(messageText || "").toLowerCase();
  if (/network is disconnected|network unavailable|not connected to internet|offline|errno\s*[:=]\s*-1009/.test(lower)) return "NETWORK_OFFLINE";
  if (/err_name_not_resolved|enotfound|eai_again|dns/.test(lower)) return "DNS_FAILED";
  if (/url not in domain list|not in valid domain|domain (?:is )?not configured|domain not allowed/.test(lower)) return "WECHAT_DOMAIN_NOT_ALLOWED";
  if (/ssl|tls|handshake|certificate|cert path/.test(lower)) return "TLS_FAILED";
  if (/connect(?:ion)?[^\n]{0,20}timeout|connect_timeout/.test(lower)) return "CONNECT_TIMEOUT";
  if (/timeout|timed out|etimedout/.test(lower)) return "REQUEST_TIMEOUT";
  return "WECHAT_NETWORK_REQUEST_FAILED";
}

function failureLayerForCode(code) {
  const normalized = String(code || "").toUpperCase();
  if (normalized === "WECHAT_DOMAIN_NOT_ALLOWED" || normalized === "WECHAT_NETWORK_REQUEST_FAILED") return "wechat";
  if (/^(NETWORK_OFFLINE|DNS_FAILED|TLS_FAILED|CONNECT_TIMEOUT|REQUEST_TIMEOUT|HTTP_4XX|HTTP_5XX)$/.test(normalized)) return "network";
  if (/SESSION|FOSU_SESSION/.test(normalized)) return "session";
  if (/^RUNTIME_/.test(normalized)) return "runtime";
  if (/^RUN_/.test(normalized)) return "run";
  if (/^PROVIDER_/.test(normalized)) return "provider";
  if (/^TOOL_/.test(normalized)) return "tool";
  if (/^MEMORY_/.test(normalized)) return "memory";
  return "application";
}

function normalizeRequestError(input, meta = {}) {
  const rawMessage = input && (input.errMsg || input.message || input.statusText || "");
  const messageText = String(rawMessage || "");
  const lower = messageText.toLowerCase();
  const payloadCode = meta.payload && (meta.payload.reasonCode || meta.payload.code);
  let code = meta.code || "";
  let retriable = meta.retriable;

  if (!code && !payloadCode && !meta.invalidPayload && !meta.statusCode) {
    code = classifyTransportCode(messageText);
  }

  if (!code) {
    if (payloadCode) {
      code = payloadCode;
    } else if (meta.invalidPayload) {
      code = "INVALID_PAYLOAD";
    } else if (meta.statusCode >= 500) {
      code = "HTTP_5XX";
    } else if (meta.statusCode >= 400) {
      code = "HTTP_4XX";
    } else if (lower.includes("timeout") || messageText.includes("超时") || messageText.includes("网络较慢")) {
      code = "TIMEOUT";
    } else {
      code = "NETWORK";
    }
  }

  if (retriable === undefined) {
    retriable = ["NETWORK_OFFLINE", "DNS_FAILED", "CONNECT_TIMEOUT", "REQUEST_TIMEOUT", "WECHAT_NETWORK_REQUEST_FAILED", "HTTP_5XX"].includes(code);
  }

  const displayMessage = code === "TIMEOUT"
    ? "网络较慢，请稍后重试"
    : translateErrorMessage(meta.payload || null, messageText || meta.defaultMessage || "请求服务发生网络异常");

  const transportMessage = {
    NETWORK_OFFLINE: "当前设备没有可用网络，请恢复连接后重试",
    DNS_FAILED: "域名解析失败，请稍后重试或运行连接诊断",
    TLS_FAILED: "安全连接建立失败，请运行连接诊断",
    WECHAT_DOMAIN_NOT_ALLOWED: "当前 API 域名未通过微信合法域名校验",
    CONNECT_TIMEOUT: "连接服务器超时，请稍后重试",
    REQUEST_TIMEOUT: "请求处理超时，请稍后重试",
    WECHAT_NETWORK_REQUEST_FAILED: "微信网络层请求失败，请运行连接诊断",
  }[code] || "";
  const error = new Error(transportMessage || displayMessage);
  error.code = code;
  error.reasonCode = meta.reasonCode || payloadCode || code;
  error.legacyCode = code === "REQUEST_TIMEOUT" ? "TIMEOUT" : "";
  error.message = transportMessage || displayMessage;
  error.retriable = Boolean(retriable);
  error.url = redactUrl(meta.url || "");
  error.elapsedMs = Number(meta.elapsedMs || 0);
  error.statusCode = meta.statusCode || 0;
  error.payload = meta.payload;
  error.failureLayer = meta.failureLayer || failureLayerForCode(error.reasonCode || code);
  error.safeErrMsg = sanitizeRequestErrMsg(rawMessage || "request:fail");
  error.requestId = String(meta.requestId || meta.payload && meta.payload.requestId || "").slice(0, 96);
  error.runId = String(meta.runId || meta.payload && meta.payload.runId || "").slice(0, 100);
  error.originalError = input || null;
  return error;
}

function shouldRetry(error, attempt, retries) {
  return attempt <= retries && error && error.retriable;
}

function jitterDelay(attempt, options = {}) {
  const base = Number(options.retryBaseDelayMs || 260);
  const max = Number(options.retryMaxDelayMs || 1600);
  const exponential = Math.min(max, base * Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * Math.min(240, exponential));
  return exponential + jitter;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showError(msg) {
  wx.showModal({
    title: "提示",
    content: msg,
    showCancel: false,
    confirmText: "知道了",
  });
}

function runWxRequest(requestUrl, method, data, headers, timeout, startedAt, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: requestUrl,
      method: method.toUpperCase(),
      data,
      header: headers,
      timeout,
      success: (res) => {
        const elapsedMs = Date.now() - startedAt;
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(normalizeRequestError(new Error(`HTTP status error: ${res.statusCode}`), {
            url: requestUrl,
            statusCode: res.statusCode,
            payload: res.data,
            elapsedMs,
          }));
          return;
        }

        const payload = res.data;
        if (payload && payload.success === false) {
          const errMsg = translateErrorMessage(payload, payload.message);
          reject(normalizeRequestError(new Error(errMsg), {
            url: requestUrl,
            payload,
            elapsedMs,
            invalidPayload: false,
            code: payload.code || payload.reasonCode || "INVALID_PAYLOAD",
            reasonCode: payload.reasonCode || payload.code || "",
            retriable: payload.retriable === true,
          }));
          return;
        }

        const successDiag = {
          url: redactUrl(requestUrl),
          elapsedMs,
          at: new Date().toISOString(),
        };
        const classification = classifyRequest(requestUrl, options);
        const patch = { lastSuccess: successDiag };
        if (classification === "critical") {
          patch.lastCriticalSuccess = successDiag;
          patch.currentHealth = "online";
        } else if (classification === "static") {
          patch.lastStaticSuccess = successDiag;
          if (!lastDiagnostics.lastCriticalSuccess) patch.currentHealth = "degraded";
        }
        writeDiagnostics(patch);
        resolve(payload);
      },
      fail: (err) => {
        const elapsedMs = Date.now() - startedAt;
        reject(normalizeRequestError(err, {
          url: requestUrl,
          elapsedMs,
        }));
      },
    });
  });
}

async function buildSecurityHeaders(requestUrl, headers, options) {
  const sessionHeaders = await securitySessionService.buildSessionHeaders(requestUrl, options);
  const staticHeaders = await staticAccessService.buildStaticHeaders(requestUrl, options);
  const runtimeHeaders = securitySessionService.isTrustedApiUrl(requestUrl)
    ? { "X-Fosu-Env-Version": platform.getMiniProgramEnvVersion() }
    : {};
  if (platform.isDeveloperEnv()) {
    const sessionHeaderAttached = Boolean(sessionHeaders["X-Fosu-Session"]);
    const mode = securitySessionService.getCachedSecurityMode();
    writeDiagnostics({
      lastSecurity: {
        trustedApiUrl: securitySessionService.isTrustedApiUrl(requestUrl),
        sessionAvailable: sessionHeaderAttached || securitySessionService.isSessionAvailable({ refreshSkewMs: options.refreshSkewMs }),
        sessionHeaderAttached,
        requestPath: getPathname(requestUrl),
        securityMode: mode.securityMode,
      },
    });
  }
  return Object.assign({}, headers, runtimeHeaders, sessionHeaders, staticHeaders);
}

function isClientCheckUrl(requestUrl) {
  return securitySessionService.normalizeTrustedPath(requestUrl) === "/api/fosu/security/client-check";
}

function extractReleaseVersion(payload, data) {
  const source = payload || {};
  const activeSnapshot = source.activeSnapshot || {};
  const manifest = source.manifest || {};
  const meta = source.meta || {};
  return source.releaseVersion ||
    source.activeReleaseVersion ||
    activeSnapshot.releaseVersion ||
    manifest.releaseVersion ||
    meta.releaseVersion ||
    data && (data.releaseVersion || data.version) ||
    "";
}

function maybeReportClientSecurityCheck(requestUrl, data, headers, payload, options) {
  if (options.skipClientCheck || isClientCheckUrl(requestUrl)) return;
  if (!securitySessionService.isTrustedApiUrl(requestUrl) || securitySessionService.isBootstrapUrl(requestUrl)) return;
  const sessionHeaderAttached = Boolean(headers && headers["X-Fosu-Session"]);
  if (!sessionHeaderAttached) return;

  const staticTicketAttached = Boolean(headers && headers["X-Fosu-Static-Ticket"]);
  const mode = securitySessionService.getCachedSecurityMode();
  const releaseVersion = extractReleaseVersion(payload, data);
  clientSecurityCheckService.markProtectedRequestSucceeded({
    releaseVersion,
    securityMode: mode.securityMode,
    sessionHeaderAttached,
    staticTicketAttached,
  });
  const reportPayload = clientSecurityCheckService.buildClientCheckPayload({
    releaseVersion,
    securityMode: mode.securityMode,
    sessionHeaderAttached,
    staticTicketAttached,
  });
  if (!clientSecurityCheckService.shouldReportClientCheck(reportPayload)) return;

  setTimeout(() => {
    request("/api/fosu/security/client-check", "POST", reportPayload, {
      showLoading: false,
      silentError: true,
      timeout: CLIENT_CHECK_TIMEOUT_MS,
      retries: 1,
      dedupe: false,
      skipClientCheck: true,
    })
      .then((response) => {
        clientSecurityCheckService.markClientCheckReported(reportPayload, response || {});
      })
      .catch((error) => {
        clientSecurityCheckService.markClientCheckFailed(reportPayload, error || {});
      });
  }, 0);
}

function isStaticTicketHttpError(error, requestUrl) {
  return staticAccessService.isStaticReleaseUrl(requestUrl) && (error.statusCode === 401 || error.statusCode === 403);
}

async function requestWithRetry(requestUrl, method, data, options, profile) {
  const retries = options.retries !== undefined ? Number(options.retries) : profile.retries;
  const timeout = options.timeout || profile.timeout;
  const baseHeaders = Object.assign({
    "content-type": method.toUpperCase() === "POST" ? "application/json" : "application/x-www-form-urlencoded",
  }, options.header || options.headers || {});

  let attempt = 0;
  let maxAttempts = retries + 1;
  let lastError = null;
  let sessionRefreshed = false;
  let staticTicketRefreshed = false;
  while (attempt < maxAttempts) {
    attempt += 1;
    const startedAt = Date.now();
    try {
      const headers = await buildSecurityHeaders(requestUrl, baseHeaders, options);
      const payload = await runWxRequest(requestUrl, method, data, headers, timeout, startedAt, options);
      maybeReportClientSecurityCheck(requestUrl, data, headers, payload, options);
      return payload;
    } catch (error) {
      lastError = error;
      if (!sessionRefreshed && securitySessionService.shouldRefreshForError(error)) {
        sessionRefreshed = true;
        securitySessionService.clearSession();
        try {
          await securitySessionService.ensureSession({ forceRefresh: true, refreshSkewMs: 0 });
          maxAttempts += 1;
          continue;
        } catch (refreshError) {
          lastError = refreshError;
          break;
        }
      }
      if (!staticTicketRefreshed && (staticAccessService.shouldRefreshForError(error) || isStaticTicketHttpError(error, requestUrl))) {
        staticTicketRefreshed = true;
        staticAccessService.clearTicket(staticAccessService.getReleaseVersionFromUrl(requestUrl));
        try {
          await staticAccessService.ensureTicket(staticAccessService.getReleaseVersionFromUrl(requestUrl), { force: true, forceRefresh: true });
          maxAttempts += 1;
          continue;
        } catch (refreshError) {
          lastError = refreshError;
          break;
        }
      }
      if (!shouldRetry(error, attempt, retries)) {
        break;
      }
      await sleep(jitterDelay(attempt, options));
    }
  }

  const errorDiag = {
    code: lastError && lastError.code || "NETWORK",
    reasonCode: lastError && lastError.reasonCode || "",
    message: lastError && lastError.message || "请求失败",
    retriable: Boolean(lastError && lastError.retriable),
    url: lastError && lastError.url || redactUrl(requestUrl),
    elapsedMs: lastError && lastError.elapsedMs || 0,
    statusCode: lastError && lastError.statusCode || 0,
    failureLayer: lastError && lastError.failureLayer || "application",
    safeErrMsg: lastError && lastError.safeErrMsg || "",
    requestId: lastError && lastError.requestId || "",
    runId: lastError && lastError.runId || "",
    at: new Date().toISOString(),
  };
  const classification = classifyRequest(requestUrl, options);
  const patch = { lastError: errorDiag };
  if (classification === "background") {
    patch.backgroundLastError = errorDiag;
    patch.currentHealth = lastDiagnostics.lastCriticalSuccess || lastDiagnostics.lastStaticSuccess ? "degraded" : (lastDiagnostics.currentHealth || "unknown");
  } else {
    patch.criticalLastError = errorDiag;
    patch.currentHealth = lastDiagnostics.lastCriticalSuccess || lastDiagnostics.lastStaticSuccess ? "degraded" : "offline";
  }
  writeDiagnostics(patch);
  throw lastError;
}

function buildDedupeKey(method, requestUrl, data) {
  return `${method.toUpperCase()} ${redactUrl(requestUrl)} ${stableStringify(data || {})}`;
}

function request(url, method = "GET", data = {}, options = {}) {
  logTransportBuildInfoOnce();
  const profile = getRequestProfile(url);
  const opt = Object.assign({
    showLoading: true,
    loadingTitle: "正在加载...",
    dedupe: method.toUpperCase() === "GET",
  }, options);
  const requestUrl = isAbsoluteHttpUrl(url) ? url : joinBaseAndPath(API_BASE_URL, url);
  const dedupeKey = opt.dedupe ? buildDedupeKey(method, requestUrl, data) : "";

  if (dedupeKey && inflightRequests.has(dedupeKey)) {
    return inflightRequests.get(dedupeKey);
  }

  if (opt.showLoading) {
    wx.showLoading({
      title: opt.loadingTitle,
      mask: true,
    });
  }

  const task = requestWithRetry(requestUrl, method, data, opt, profile)
    .catch((error) => {
      if (!opt.silentError) {
        showError(error && error.message ? error.message : "请求失败，请稍后重试");
      }
      const logPayload = {
        code: error && error.code,
        url: error && error.url,
        elapsedMs: error && error.elapsedMs,
        retriable: error && error.retriable,
      };
      if (!opt.suppressWarn) {
        console.warn("wx.request failed", logPayload);
      }
      throw error;
    })
    .finally(() => {
      if (opt.showLoading) {
        wx.hideLoading();
      }
      if (dedupeKey) {
        inflightRequests.delete(dedupeKey);
      }
    });

  if (dedupeKey) {
    inflightRequests.set(dedupeKey, task);
  }
  return task;
}

module.exports = {
  REQUEST_DIAG_KEY,
  getDefaultTimeout,
  getRequestDiagnostics,
  getRequestProfile,
  normalizeRequestError,
  sanitizeRequestErrMsg,
  request,
  get: (url, data = {}, options = {}) => request(url, "GET", data, options),
  post: (url, data = {}, options = {}) => request(url, "POST", data, options),
};
