const { API_BASE_URL, STATIC_RELEASE_BASE_URL } = require("../config/api");
const securitySessionService = require("./securitySessionService");

const STORAGE_KEY = "FOSU_STATIC_ACCESS_TICKETS";
const REFRESH_SKEW_MS = 60 * 1000;
const ticketCache = {};
const inflightByRelease = {};

function now() {
  return Date.now();
}

function readStorage() {
  if (typeof wx === "undefined") return;
  try {
    const value = wx.getStorageSync(STORAGE_KEY) || {};
    Object.keys(value).forEach((key) => { ticketCache[key] = value[key]; });
  } catch (error) {
    // best effort
  }
}

function persist() {
  if (typeof wx === "undefined") return;
  try {
    wx.setStorageSync(STORAGE_KEY, ticketCache);
  } catch (error) {
    // best effort
  }
}

readStorage();

function isStaticReleaseUrl(url) {
  const text = String(url || "");
  if (!text) return false;
  try {
    const target = new URL(text, API_BASE_URL);
    const staticBase = new URL(STATIC_RELEASE_BASE_URL || `${API_BASE_URL}/static/releases`, API_BASE_URL);
    return target.protocol === staticBase.protocol && target.host === staticBase.host && target.pathname.startsWith(staticBase.pathname.replace(/\/+$/g, "") + "/");
  } catch (error) {
    return text.indexOf("/static/releases/") >= 0;
  }
}

function getReleaseVersionFromUrl(url) {
  try {
    const target = new URL(String(url || ""), API_BASE_URL);
    const match = target.pathname.match(/\/static\/releases\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  } catch (error) {
    const match = String(url || "").match(/\/static\/releases\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }
}

function isTicketUsable(entry) {
  if (!entry || !entry.ticket || !entry.expiresAt) return false;
  const expiresAt = Date.parse(entry.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt - now() > REFRESH_SKEW_MS;
}

function requestTicket(releaseVersion) {
  return securitySessionService.ensureSession()
    .then((session) => new Promise((resolve, reject) => {
      wx.request({
        url: `${API_BASE_URL}/api/fosu/static-access/bootstrap`,
        method: "POST",
        data: { releaseVersion },
        header: {
          "content-type": "application/json",
          "X-Fosu-Session": session.sessionToken,
        },
        timeout: 8000,
        success: (res) => {
          const payload = res.data || {};
          if (res.statusCode !== 200 || payload.success === false) {
            reject(Object.assign(new Error(payload.code || payload.reasonCode || "STATIC_TICKET_BOOTSTRAP_FAILED"), {
              code: payload.code || payload.reasonCode || "STATIC_TICKET_BOOTSTRAP_FAILED",
              statusCode: res.statusCode,
            }));
            return;
          }
          resolve(payload);
        },
        fail: (err) => reject(Object.assign(new Error("STATIC_TICKET_BOOTSTRAP_NETWORK_FAILED"), {
          code: "STATIC_TICKET_BOOTSTRAP_NETWORK_FAILED",
          originalError: err,
        })),
      });
    }));
}

function ensureTicket(releaseVersion, options = {}) {
  const version = String(releaseVersion || "").trim();
  if (!version) return Promise.resolve(null);
  const mode = securitySessionService.getCachedSecurityMode();
  if (mode.staticAccessMode !== "ticket" && mode.securityMode !== "ticket" && !options.force) {
    return Promise.resolve(null);
  }
  const cached = ticketCache[version];
  if (!options.forceRefresh && isTicketUsable(cached)) {
    return Promise.resolve(cached);
  }
  if (inflightByRelease[version]) {
    return inflightByRelease[version];
  }
  inflightByRelease[version] = requestTicket(version)
    .then((payload) => {
      if (!payload.ticket) return null;
      const entry = {
        releaseVersion: version,
        ticket: payload.ticket,
        expiresAt: payload.expiresAt,
        headerName: payload.headerName || "X-Fosu-Static-Ticket",
        savedAt: now(),
      };
      ticketCache[version] = entry;
      persist();
      return entry;
    })
    .finally(() => {
      delete inflightByRelease[version];
    });
  return inflightByRelease[version];
}

function buildStaticHeaders(url, options = {}) {
  if (!isStaticReleaseUrl(url)) return Promise.resolve({});
  const releaseVersion = getReleaseVersionFromUrl(url);
  return ensureTicket(releaseVersion, options)
    .then((entry) => entry && entry.ticket ? { [entry.headerName || "X-Fosu-Static-Ticket"]: entry.ticket } : {})
    .catch(() => ({}));
}

function clearTicket(releaseVersion) {
  if (releaseVersion) {
    delete ticketCache[releaseVersion];
  } else {
    Object.keys(ticketCache).forEach((key) => { delete ticketCache[key]; });
  }
  persist();
}

function shouldRefreshForError(error) {
  const code = error && (error.reasonCode || error.code || error.payload && (error.payload.code || error.payload.reasonCode));
  return code === "STATIC_TICKET_REQUIRED" || code === "STATIC_TICKET_INVALID" || code === "STATIC_TICKET_EXPIRED";
}

module.exports = {
  STORAGE_KEY,
  buildStaticHeaders,
  clearTicket,
  ensureTicket,
  getReleaseVersionFromUrl,
  isStaticReleaseUrl,
  shouldRefreshForError,
};
