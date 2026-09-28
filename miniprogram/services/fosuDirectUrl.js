function splitUrl(value) {
  const raw = String(value || "").trim();
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i.exec(raw);
  if (!match) return null;
  const authority = match[2];
  const at = authority.lastIndexOf("@");
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  return {
    scheme: match[1].toLowerCase(),
    host: hostPort.replace(/:\d+$/, "").toLowerCase(),
    pathname: match[3] || "/",
    search: match[4] || "",
  };
}

function getScheme(value) {
  const url = splitUrl(value);
  return url ? url.scheme : "";
}

function getHost(value) {
  const url = splitUrl(value);
  return url ? url.host : "";
}

function getPathname(value) {
  const url = splitUrl(value);
  return url ? url.pathname : "";
}

function buildUrl(parts) {
  return `${parts.scheme}://${parts.host}${parts.pathname || "/"}${parts.search || ""}`;
}

function resolveRelativeUrl(base, relative) {
  const target = String(relative || "").trim();
  if (!target) return String(base || "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
  const current = splitUrl(base);
  if (!current) return target;
  if (target.indexOf("//") === 0) return `${current.scheme}:${target}`;
  if (target.charAt(0) === "/") return `${current.scheme}://${current.host}${target.split("#")[0]}`;
  if (target.charAt(0) === "?") return `${current.scheme}://${current.host}${current.pathname}${target.split("#")[0]}`;
  const directory = current.pathname.replace(/[^/]*$/, "");
  return `${current.scheme}://${current.host}${directory}${target.split("#")[0]}`;
}

function upgradeHttpHost(value, host) {
  const url = splitUrl(value);
  if (!url || url.scheme !== "http" || url.host !== host) return String(value || "");
  return buildUrl(Object.assign({}, url, { scheme: "https" }));
}

module.exports = {
  buildUrl,
  getHost,
  getPathname,
  getScheme,
  resolveRelativeUrl,
  splitUrl,
  upgradeHttpHost,
};
