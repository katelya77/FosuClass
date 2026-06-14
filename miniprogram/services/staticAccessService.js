const { API_BASE_URL, ORACLE_STATIC_RELEASE_BASE_URL } = require("../config/api");
const securitySessionService = require("./securitySessionService");
const {
  extractPathname,
  isAbsoluteHttpUrl,
  joinBaseAndPath,
  normalizePathPrefix,
  normalizeTrustedPath,
} = require("../utils/trustedUrl");

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

function getStaticReleaseBaseUrl() {
  const configured = String(ORACLE_STATIC_RELEASE_BASE_URL || "").trim();
  if (!configured) return joinBaseAndPath(API_BASE_URL, "/static/releases");
  if (isAbsoluteHttpUrl(configured)) return configured;
  if (configured[0] === "/") return joinBaseAndPath(API_BASE_URL, configured);
  return joinBaseAndPath(API_BASE_URL, configured);
}

function getStaticReleasePathPrefix() {
  return normalizePathPrefix(extractPathname(getStaticReleaseBaseUrl()) || "/static/releases");
}

function normalizeStaticReleasePath(url) {
  return normalizeTrustedPath(url, getStaticReleaseBaseUrl(), getStaticReleasePathPrefix());
}

function isStaticReleaseUrl(url) {
  return Boolean(normalizeStaticReleasePath(url));
}

function getReleaseVersionFromUrl(url) {
  const pathname = normalizeStaticReleasePath(url);
  if (!pathname) return "";
  const prefix = getStaticReleasePathPrefix();
  const version = pathname.slice(prefix.length).split("/")[0] || "";
  try {
    return decodeURIComponent(version);
  } catch (error) {
    return version;
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
        timeout: 15000,
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
  if (options.skipSession || options.skipStaticTicket) return Promise.resolve({});
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
  const code = error && (
    error.payload && (error.payload.reasonCode || error.payload.code) ||
    error.reasonCode ||
    error.code
  );
  return code === "STATIC_TICKET_REQUIRED" || code === "STATIC_TICKET_INVALID" || code === "STATIC_TICKET_EXPIRED";
}

module.exports = {
  STORAGE_KEY,
  buildStaticHeaders,
  clearTicket,
  ensureTicket,
  getReleaseVersionFromUrl,
  isStaticReleaseUrl,
  normalizeStaticReleasePath,
  shouldRefreshForError,
};
