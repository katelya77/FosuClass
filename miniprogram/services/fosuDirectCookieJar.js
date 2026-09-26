const { ALLOWED_HOSTS } = require("./fosuDirectConfig");
const { splitUrl } = require("./fosuDirectUrl");

function parseHttpDate(value) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function defaultPath(pathname) {
  const path = String(pathname || "/");
  const slash = path.lastIndexOf("/");
  if (slash <= 0) return "/";
  return path.slice(0, slash);
}

function splitSetCookieHeader(header) {
  if (!header) return [];
  if (Array.isArray(header)) return header.map((item) => String(item));
  return String(header).split(/,(?=\s*[^;,\s]+=)/);
}

function parseSetCookie(line, requestUrl, now) {
  const parts = String(line || "").split(";").map((item) => item.trim()).filter(Boolean);
  if (!parts.length || parts[0].indexOf("=") < 0) return null;
  const separator = parts[0].indexOf("=");
  const name = parts[0].slice(0, separator).trim();
  const value = parts[0].slice(separator + 1).trim();
  if (!name || /[\s;]/.test(name)) return null;
  const url = splitUrl(requestUrl);
  if (!url) return null;
  const cookie = {
    name,
    value,
    domain: url.host,
    path: defaultPath(url.pathname),
    secure: false,
    expiresAt: 0,
  };
  parts.slice(1).forEach((part) => {
    const index = part.indexOf("=");
    const key = (index >= 0 ? part.slice(0, index) : part).trim().toLowerCase();
    const attr = index >= 0 ? part.slice(index + 1).trim() : "";
    if (key === "domain" && attr) cookie.domain = attr.replace(/^\./, "").toLowerCase();
    if (key === "path" && attr) cookie.path = attr.charAt(0) === "/" ? attr : `/${attr}`;
    if (key === "secure") cookie.secure = true;
    if (key === "max-age") {
      const seconds = Number(attr);
      cookie.expiresAt = Number.isFinite(seconds) ? now() + seconds * 1000 : 0;
    }
    if (key === "expires" && !cookie.expiresAt) cookie.expiresAt = parseHttpDate(attr);
  });
  return cookie;
}

function domainMatches(cookieDomain, host) {
  const domain = String(cookieDomain || "").toLowerCase();
  const hostname = String(host || "").toLowerCase();
  if (!domain || !hostname) return false;
  if (ALLOWED_HOSTS.indexOf(domain) < 0 && domain !== "fosu.edu.cn") return false;
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function pathMatches(cookiePath, requestPath) {
  const path = cookiePath || "/";
  const target = requestPath || "/";
  return target === path || target.startsWith(path.endsWith("/") ? path : `${path}/`) || path === "/";
}

function createCookieJar(options) {
  const now = options && options.now || (() => Date.now());
  const cookies = [];

  function absorb(requestUrl, response) {
    const header = response && (response.header || response.headers) || {};
    const lines = [];
    if (response && Array.isArray(response.cookies)) {
      response.cookies.forEach((cookie) => {
        if (!cookie || !cookie.name) return;
        lines.push([
          `${cookie.name}=${cookie.value || ""}`,
          cookie.domain ? `Domain=${cookie.domain}` : "",
          cookie.path ? `Path=${cookie.path}` : "",
          cookie.expires ? `Expires=${cookie.expires}` : "",
          cookie.secure ? "Secure" : "",
        ].filter(Boolean).join("; "));
      });
    }
    lines.push(...splitSetCookieHeader(header["Set-Cookie"] || header["set-cookie"]));
    lines.forEach((line) => {
      const parsed = parseSetCookie(line, requestUrl, now);
      if (!parsed) return;
      const url = splitUrl(requestUrl);
      if (!url) return;
      if (!domainMatches(parsed.domain, url.host) && parsed.domain !== url.host) return;
      const index = cookies.findIndex((item) => item.name === parsed.name && item.domain === parsed.domain && item.path === parsed.path);
      if (index >= 0) cookies.splice(index, 1);
      if (parsed.expiresAt && parsed.expiresAt <= now()) return;
      cookies.push(parsed);
    });
  }

  function matchingCookies(requestUrl) {
    const url = splitUrl(requestUrl);
    if (!url) return [];
    return cookies.filter((cookie) => {
      if (!cookie.name) return false;
      if (cookie.expiresAt && cookie.expiresAt <= now()) return false;
      if (cookie.secure && url.scheme !== "https") return false;
      if (!domainMatches(cookie.domain, url.host)) return false;
      return pathMatches(cookie.path, url.pathname);
    });
  }

  function cookieHeader(requestUrl) {
    return matchingCookies(requestUrl).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }

  function cookieNames(requestUrl) {
    return matchingCookies(requestUrl).map((cookie) => cookie.name);
  }

  function clear() {
    cookies.forEach((cookie) => {
      cookie.value = "";
      cookie.name = "";
    });
    cookies.length = 0;
  }

  return {
    absorb,
    cookieHeader,
    cookieNames,
    clear,
    size() {
      return cookies.length;
    },
  };
}

module.exports = {
  createCookieJar,
  parseSetCookie,
  splitSetCookieHeader,
};
