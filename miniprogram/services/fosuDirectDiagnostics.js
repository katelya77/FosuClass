function redirectFromUrl(value) {
  try {
    const url = new URL(value);
    return {
      scheme: String(url.protocol || "").replace(":", ""),
      host: url.hostname,
      pathname: url.pathname,
    };
  } catch (error) {
    return { scheme: "", host: "", pathname: "" };
  }
}

function cookieNamesFromHeader(header) {
  return String(header || "")
    .split(";")
    .map((part) => part.split("=")[0].trim())
    .filter((name) => name && !/[\r\n]/.test(name));
}

function setCookieNames(response) {
  const headers = response && (response.header || response.headers) || {};
  const raw = headers["Set-Cookie"] || headers["set-cookie"] || [];
  const lines = Array.isArray(raw) ? raw : String(raw || "").split(/,(?=\s*[^;,\s]+=)/);
  return lines.map((line) => String(line).split(";")[0].split("=")[0].trim()).filter(Boolean);
}

function buildSafeDiagnostic(input) {
  const source = input || {};
  const redirect = source.redirect && typeof source.redirect === "object"
    ? {
      scheme: String(source.redirect.scheme || "").replace(":", ""),
      host: String(source.redirect.host || ""),
      pathname: String(source.redirect.pathname || "").split("?")[0],
    }
    : { scheme: "", host: "", pathname: "" };
  const network = source.networkEnvironment || {};
  return {
    mode: "client-direct",
    stage: String(source.stage || ""),
    httpStatus: Number(source.httpStatus || 0) || 0,
    redirect,
    cookieNames: cookieNamesFromHeader((source.cookieNames || []).join("; ")),
    elapsedMs: Number(source.elapsedMs || 0) || 0,
    errorCode: String(source.errorCode || ""),
    networkEnvironment: {
      authReachable: network.authReachable === true,
      eduReachable: network.eduReachable === true,
    },
  };
}

function createDiagnosticSink(options) {
  const enabled = Boolean(options && options.debug);
  const startedAt = Date.now();
  const entries = [];
  return {
    record(input) {
      const entry = buildSafeDiagnostic(Object.assign({}, input, {
        elapsedMs: input && input.elapsedMs != null ? input.elapsedMs : Date.now() - startedAt,
      }));
      entries.push(entry);
      if (enabled && typeof console !== "undefined" && console.info) {
        console.info("[Fosu direct]", entry);
      }
      return entry;
    },
    list() {
      return entries.slice();
    },
  };
}

module.exports = {
  buildSafeDiagnostic,
  cookieNamesFromHeader,
  createDiagnosticSink,
  redirectFromUrl,
  setCookieNames,
};
