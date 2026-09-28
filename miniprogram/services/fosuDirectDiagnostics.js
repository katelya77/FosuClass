const { splitUrl } = require("./fosuDirectUrl");

function redirectFromUrl(value) {
  const url = splitUrl(value);
  if (!url) return { scheme: "", host: "", pathname: "" };
  return { scheme: url.scheme, host: url.host, pathname: url.pathname };
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
      pathname: String(source.redirect.pathname || "").split("?")[0].split("#")[0],
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
    transportPhase: String(source.transportPhase || ""),
    targetHost: String(source.targetHost || ""),
    redirectHost: String(source.redirectHost || redirect.host || ""),
    wxErrno: Number(source.wxErrno || 0) || 0,
    wxErrorCategory: String(source.wxErrorCategory || ""),
    wxErrMsgSafe: sanitizeWxErrMsg(source.wxErrMsgSafe),
    exceptionName: String(source.exceptionName || "").slice(0, 80),
    exceptionMessageSafe: sanitizeWxErrMsg(source.exceptionMessageSafe),
    stackTop: sanitizeWxErrMsg(source.stackTop).slice(0, 240),
    networkEnvironment: {
      authReachable: network.authReachable === true,
      eduReachable: network.eduReachable === true,
      preflightReachable: network.preflightReachable === true,
    },
  };
}

function sanitizeWxErrMsg(value) {
  return String(value || "")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[?#][^\s]*/g, "")
    .replace(/(ticket|password|cookie|execution|pwdencryptsalt)=[^\s&]*/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
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
        const redirect = entry.redirect || {};
        console.info(`[FosuDirect][${entry.stage || "request"}]`, {
          stage: entry.stage || "",
          transportPhase: entry.transportPhase || "",
          targetHost: entry.targetHost || "",
          redirectHost: entry.redirectHost || "",
          httpStatus: entry.httpStatus || 0,
          pathname: redirect.pathname || "",
          cookieNames: entry.cookieNames || [],
          elapsedMs: entry.elapsedMs || 0,
          errorCode: entry.errorCode || "",
          wxErrno: entry.wxErrno || 0,
          wxErrorCategory: entry.wxErrorCategory || "",
          wxErrMsgSafe: entry.wxErrMsgSafe || "",
          exceptionName: entry.exceptionName || "",
          exceptionMessageSafe: entry.exceptionMessageSafe || "",
          stackTop: entry.stackTop || "",
        });
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
  sanitizeWxErrMsg,
  cookieNamesFromHeader,
  createDiagnosticSink,
  redirectFromUrl,
  setCookieNames,
};
