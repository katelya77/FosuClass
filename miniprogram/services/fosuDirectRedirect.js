const { ALLOWED_HOSTS, HTTPS_UPGRADE_HOSTS, MAX_REDIRECTS } = require("./fosuDirectConfig");

function directError(code, details) {
  const error = new Error(code);
  error.code = code;
  if (details) {
    error.stage = details.stage || "";
    error.statusCode = details.statusCode || 0;
    error.locationHost = details.locationHost || "";
    error.locationPath = details.locationPath || "";
  }
  return error;
}

function parseUrl(value, base) {
  try {
    return new URL(value, base);
  } catch (error) {
    return null;
  }
}

function assertHttpsSchoolUrl(value) {
  const url = parseUrl(value);
  if (!url || url.protocol !== "https:" || ALLOWED_HOSTS.indexOf(url.hostname) < 0) {
    throw directError("UNTRUSTED_REDIRECT", {
      locationHost: url ? url.hostname : "",
      locationPath: url ? url.pathname : "",
    });
  }
  return url.toString();
}

function resolveSchoolRedirect(currentUrl, location) {
  const current = parseUrl(currentUrl);
  const next = parseUrl(location, currentUrl);
  if (!current || !next) {
    throw directError("UNTRUSTED_REDIRECT");
  }
  if (next.username || next.password) {
    throw directError("UNTRUSTED_REDIRECT", {
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

module.exports = {
  MAX_REDIRECTS,
  assertHttpsSchoolUrl,
  directError,
  resolveSchoolRedirect,
};
