const { API_BASE_URL } = require("../config/api");

const STORAGE_KEY = "FOSU_SECURITY_SESSION";
const REFRESH_SKEW_MS = 5 * 60 * 1000;
let inflightBootstrap = null;
let lastSession = null;

function now() {
  return Date.now();
}

function readStorage() {
  if (lastSession) return lastSession;
  if (typeof wx === "undefined") return null;
  try {
    lastSession = wx.getStorageSync(STORAGE_KEY) || null;
  } catch (error) {
    lastSession = null;
  }
  return lastSession;
}

function writeStorage(value) {
  lastSession = value || null;
  if (typeof wx === "undefined") return;
  try {
    if (value) wx.setStorageSync(STORAGE_KEY, value);
    else wx.removeStorageSync(STORAGE_KEY);
  } catch (error) {
    // best-effort cache only
  }
}

function isTrustedApiUrl(url) {
  const text = String(url || "");
  if (text.startsWith("/api/")) return true;
  try {
    const api = new URL(API_BASE_URL);
    const target = new URL(text, API_BASE_URL);
    return target.protocol === api.protocol && target.host === api.host && target.pathname.startsWith("/api/");
  } catch (error) {
    return false;
  }
}

function isBootstrapUrl(url) {
  try {
    const target = new URL(String(url || ""), API_BASE_URL);
    return target.pathname === "/api/fosu/session/bootstrap";
  } catch (error) {
    return String(url || "").indexOf("/api/fosu/session/bootstrap") >= 0;
  }
}

function isSessionUsable(session, options = {}) {
  if (!session || !session.sessionToken || !session.expiresAt) return false;
  const expiresAt = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt - now() > (options.refreshSkewMs == null ? REFRESH_SKEW_MS : options.refreshSkewMs);
}

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res && res.code) resolve(res.code);
        else reject(Object.assign(new Error("WX_LOGIN_CODE_MISSING"), { code: "WX_LOGIN_CODE_MISSING" }));
      },
      fail: (err) => reject(Object.assign(new Error("WX_LOGIN_FAILED"), { code: "WX_LOGIN_FAILED", originalError: err })),
    });
  });
}

function bootstrapWithCode(code) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}/api/fosu/session/bootstrap`,
      method: "POST",
      data: { code },
      header: { "content-type": "application/json" },
      timeout: 8000,
      success: (res) => {
        const payload = res.data || {};
        if (res.statusCode !== 200 || payload.success === false || !payload.sessionToken) {
          reject(Object.assign(new Error(payload.code || payload.reasonCode || "FOSU_SESSION_BOOTSTRAP_FAILED"), {
            code: payload.code || payload.reasonCode || "FOSU_SESSION_BOOTSTRAP_FAILED",
            statusCode: res.statusCode,
          }));
          return;
        }
        const expiresAt = payload.expiresAt || new Date(now() + Number(payload.expiresIn || 0) * 1000).toISOString();
        resolve({
          sessionToken: payload.sessionToken,
          expiresAt,
          expiresIn: payload.expiresIn || 0,
          securityMode: payload.securityMode || "observe",
          staticAccessMode: payload.staticAccessMode || "public",
          serverTime: payload.serverTime || "",
          savedAt: now(),
        });
      },
      fail: (err) => reject(Object.assign(new Error("FOSU_SESSION_BOOTSTRAP_NETWORK_FAILED"), {
        code: "FOSU_SESSION_BOOTSTRAP_NETWORK_FAILED",
        originalError: err,
      })),
    });
  });
}

function ensureSession(options = {}) {
  const cached = readStorage();
  if (!options.forceRefresh && isSessionUsable(cached, options)) {
    return Promise.resolve(cached);
  }
  if (typeof wx === "undefined") {
    return Promise.resolve(cached || null);
  }
  if (inflightBootstrap) {
    return inflightBootstrap;
  }
  inflightBootstrap = wxLogin()
    .then(bootstrapWithCode)
    .then((session) => {
      writeStorage(session);
      return session;
    })
    .finally(() => {
      inflightBootstrap = null;
    });
  return inflightBootstrap;
}

function warmupSession() {
  return ensureSession({ refreshSkewMs: 0 }).catch(() => readStorage() || null);
}

function clearSession() {
  writeStorage(null);
}

function shouldRefreshForError(error) {
  const code = error && (error.reasonCode || error.code || error.payload && (error.payload.code || error.payload.reasonCode));
  return code === "FOSU_SESSION_REQUIRED" || code === "FOSU_SESSION_INVALID" || code === "FOSU_SESSION_EXPIRED";
}

function getCachedSecurityMode() {
  const cached = readStorage();
  return {
    securityMode: cached && cached.securityMode || "observe",
    staticAccessMode: cached && cached.staticAccessMode || "public",
  };
}

function buildSessionHeaders(url, options = {}) {
  if (!isTrustedApiUrl(url) || isBootstrapUrl(url) || options.skipSession) {
    return Promise.resolve({});
  }
  return ensureSession({ refreshSkewMs: options.refreshSkewMs })
    .then((session) => session && session.sessionToken ? { "X-Fosu-Session": session.sessionToken } : {})
    .catch(() => ({}));
}

module.exports = {
  STORAGE_KEY,
  buildSessionHeaders,
  clearSession,
  ensureSession,
  getCachedSecurityMode,
  isTrustedApiUrl,
  shouldRefreshForError,
  warmupSession,
};
