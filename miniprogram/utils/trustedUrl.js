function firstIndexOfAny(text, chars) {
  let found = -1;
  chars.forEach((char) => {
    const index = text.indexOf(char);
    if (index >= 0 && (found < 0 || index < found)) {
      found = index;
    }
  });
  return found;
}

function stripHash(value) {
  const index = value.indexOf("#");
  return index >= 0 ? value.slice(0, index) : value;
}

function splitPathAndQuery(value) {
  const withoutHash = stripHash(String(value || ""));
  const queryIndex = withoutHash.indexOf("?");
  if (queryIndex < 0) {
    return {
      pathname: withoutHash || "/",
      search: "",
    };
  }
  return {
    pathname: withoutHash.slice(0, queryIndex) || "/",
    search: withoutHash.slice(queryIndex),
  };
}

function normalizePort(port) {
  const value = String(port || "");
  return /^\d+$/.test(value) ? value : "";
}

function parseAuthority(authority) {
  const text = String(authority || "");
  if (!text || /[\s\\]/.test(text) || text.indexOf("@") >= 0) return null;

  if (text[0] === "[") {
    const closeIndex = text.indexOf("]");
    if (closeIndex < 0) return null;
    const hostname = text.slice(0, closeIndex + 1).toLowerCase();
    const rest = text.slice(closeIndex + 1);
    if (!rest) return { hostname, port: "", host: hostname };
    if (rest[0] !== ":") return null;
    const port = normalizePort(rest.slice(1));
    if (!port) return null;
    return { hostname, port, host: `${hostname}:${port}` };
  }

  if (text.indexOf(":") !== text.lastIndexOf(":")) return null;
  const colonIndex = text.lastIndexOf(":");
  const hostname = (colonIndex >= 0 ? text.slice(0, colonIndex) : text).toLowerCase();
  if (!hostname) return null;
  const port = colonIndex >= 0 ? normalizePort(text.slice(colonIndex + 1)) : "";
  if (colonIndex >= 0 && !port) return null;
  return {
    hostname,
    port,
    host: port ? `${hostname}:${port}` : hostname,
  };
}

function parseAbsoluteUrl(url) {
  const text = String(url || "").trim();
  const match = text.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\//);
  if (!match) return null;

  const scheme = match[1].toLowerCase();
  const rest = text.slice(match[0].length);
  const boundary = firstIndexOfAny(rest, ["/", "?", "#"]);
  const authority = boundary >= 0 ? rest.slice(0, boundary) : rest;
  const suffix = boundary >= 0 ? rest.slice(boundary) : "";
  const parsedAuthority = parseAuthority(authority);
  if (!parsedAuthority) return null;

  const pathAndQuery = splitPathAndQuery(suffix || "/");
  const pathname = pathAndQuery.pathname && pathAndQuery.pathname[0] === "/"
    ? pathAndQuery.pathname
    : `/${pathAndQuery.pathname || ""}`;

  return Object.assign({
    scheme,
    protocol: `${scheme}:`,
    pathname,
    search: pathAndQuery.search,
    pathWithQuery: `${pathname}${pathAndQuery.search}`,
  }, parsedAuthority);
}

function extractPathname(url) {
  const absolute = parseAbsoluteUrl(url);
  if (absolute) return absolute.pathname || "/";
  const pathAndQuery = splitPathAndQuery(String(url || "").trim());
  return pathAndQuery.pathname || "/";
}

function extractPathWithQuery(url) {
  const absolute = parseAbsoluteUrl(url);
  if (absolute) return absolute.pathWithQuery || "/";
  const pathAndQuery = splitPathAndQuery(String(url || "").trim());
  return `${pathAndQuery.pathname || "/"}${pathAndQuery.search || ""}`;
}

function sameOrigin(left, right) {
  return Boolean(left && right) &&
    left.scheme === right.scheme &&
    left.hostname === right.hostname &&
    left.port === right.port;
}

function trimTrailingSlashes(value) {
  return String(value || "").replace(/\/+$/g, "");
}

function normalizePathPrefix(prefix) {
  const value = String(prefix || "/").trim();
  const withLeadingSlash = value[0] === "/" ? value : `/${value}`;
  return `${trimTrailingSlashes(withLeadingSlash)}/`;
}

function normalizeTrustedPath(url, baseUrl, pathPrefix) {
  const text = String(url || "").trim();
  if (!text) return "";
  const prefix = normalizePathPrefix(pathPrefix);

  if (text[0] === "/") {
    if (text.indexOf("//") === 0) return "";
    const pathname = extractPathname(text);
    return pathname.indexOf(prefix) === 0 ? pathname : "";
  }

  const target = parseAbsoluteUrl(text);
  const base = parseAbsoluteUrl(baseUrl);
  if (!target || !base || !sameOrigin(target, base)) return "";
  return target.pathname.indexOf(prefix) === 0 ? target.pathname : "";
}

function isAbsoluteHttpUrl(url) {
  const parsed = parseAbsoluteUrl(url);
  return Boolean(parsed && (parsed.scheme === "http" || parsed.scheme === "https"));
}

function joinBaseAndPath(baseUrl, path) {
  const base = trimTrailingSlashes(baseUrl);
  const suffix = String(path || "");
  if (!suffix) return base;
  return suffix[0] === "/" ? `${base}${suffix}` : `${base}/${suffix}`;
}

module.exports = {
  extractPathWithQuery,
  extractPathname,
  isAbsoluteHttpUrl,
  joinBaseAndPath,
  normalizePathPrefix,
  normalizeTrustedPath,
  parseAbsoluteUrl,
  sameOrigin,
};
