const { ALLOWED_HOSTS, HTTPS_UPGRADE_HOSTS, MAX_REDIRECTS } = require("./fosuDirectConfig");
const { resolveRelativeUrl, splitUrl } = require("./fosuDirectUrl");

function directError(code, details) {
  const error = new Error(code);
  const info = details || {};
  const host = String(info.locationHost || "");
  const normalized = code === "UNTRUSTED_REDIRECT" && !host ? "REDIRECT_LOCATION_MISSING" : code;
  error.message = normalized;
  error.code = normalized;
  error.stage = info.stage || "";
  error.statusCode = info.statusCode || 0;
  error.locationHost = host;
  error.locationPath = String(info.locationPath || "").split("?")[0].split("#")[0];
  error.safeRedirect = {
    scheme: String(info.scheme || "").replace(":", ""),
    host,
    pathname: error.locationPath,
  };
  error.transportPhase = info.transportPhase || "";
  error.targetHost = String(info.targetHost || "");
  error.wxErrno = Number(info.wxErrno || 0) || 0;
  error.wxErrorCategory = String(info.wxErrorCategory || "");
  error.wxErrMsgSafe = String(info.wxErrMsgSafe || "").slice(0, 180);
  return error;
}

function isRedirectStatus(status) {
  const code = Number(status || 0);
  return code >= 300 && code < 400;
}

function parseUrl(value, base) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(raw) || !base ? raw : resolveRelativeUrl(base, raw);
  const url = splitUrl(absolute);
  if (!url) return null;
  return {
    protocol: `${url.scheme}:`,
    username: /:\/\/[^/?#]*@/.test(absolute) ? "present" : "",
    password: "",
    hostname: url.host,
    pathname: url.pathname,
    search: url.search,
    toString() {
      return `${this.protocol}//${this.hostname}${this.pathname}${this.search}`;
    },
  };
}

function assertHttpsSchoolUrl(value) {
  const url = parseUrl(value);
  if (!url || !url.hostname) {
    throw directError("REDIRECT_LOCATION_MISSING", {
      scheme: url ? String(url.protocol || "").replace(":", "") : "",
      locationPath: url ? url.pathname : "",
    });
  }
  if (url.protocol !== "https:" || ALLOWED_HOSTS.indexOf(url.hostname) < 0) {
    throw directError("UNTRUSTED_REDIRECT", {
      scheme: String(url.protocol || "").replace(":", ""),
      locationHost: url.hostname,
      locationPath: url.pathname,
    });
  }
  return url.toString();
}

function resolveSchoolRedirect(currentUrl, location) {
  if (!String(location || "").trim()) {
    throw directError("REDIRECT_LOCATION_MISSING");
  }
  const current = parseUrl(currentUrl);
  const next = parseUrl(location, currentUrl);
  if (!current || !next || !next.hostname) {
    throw directError("REDIRECT_LOCATION_MISSING");
  }
  if (next.username || next.password) {
    throw directError("UNTRUSTED_REDIRECT", {
      scheme: String(next.protocol || "").replace(":", ""),
      locationHost: next.hostname,
      locationPath: next.pathname,
    });
  }
  if (next.protocol === "http:" && HTTPS_UPGRADE_HOSTS.indexOf(next.hostname) >= 0) {
    next.protocol = "https:";
    return {
      url: next.toString(),
      upgraded: true,
      host: next.hostname,
      path: next.pathname,
    };
  }
  if (next.protocol !== "https:" || ALLOWED_HOSTS.indexOf(next.hostname) < 0) {
    throw directError(next.protocol === "http:" ? "HTTP_REQUEST_FORBIDDEN" : "UNTRUSTED_REDIRECT", {
      scheme: String(next.protocol || "").replace(":", ""),
      locationHost: next.hostname,
      locationPath: next.pathname,
    });
  }
  return {
    url: next.toString(),
    upgraded: false,
    host: next.hostname,
    path: next.pathname,
  };
}

function inspectSchoolResponse(currentUrl, statusCode, location) {
  const status = Number(statusCode || 0);
  if (!isRedirectStatus(status)) {
    return { redirect: false, statusCode: status };
  }
  if (!String(location || "").trim()) {
    throw directError("REDIRECT_LOCATION_MISSING", { statusCode: status });
  }
  const resolved = resolveSchoolRedirect(currentUrl, location);
  return {
    redirect: true,
    statusCode: status,
    url: resolved.url,
    upgraded: resolved.upgraded,
    host: resolved.host,
    path: resolved.path,
  };
}

module.exports = {
  MAX_REDIRECTS,
  assertHttpsSchoolUrl,
  directError,
  inspectSchoolResponse,
  isRedirectStatus,
  resolveSchoolRedirect,
};
