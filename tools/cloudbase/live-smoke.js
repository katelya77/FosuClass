#!/usr/bin/env node

const crypto = require("crypto");
const dns = require("dns").promises;
const { spawnSync } = require("child_process");

const cloudbaseConfig = require("../../miniprogram/config/cloudbase");
const {
  ORACLE_API_BASE_URL,
} = require("../../miniprogram/config/api");
const {
  joinUrl,
  parseArgs,
} = require("./oracle-release-source");
const { getPublisherAdminToken } = require("../fosu-publisher/admin-token-utils");

const INDEX_TYPES = ["class", "teacher", "classroom", "course"];
const DEFAULT_TIMEOUT_MS = 30000;

function sha1(buffer) {
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

function sanitizeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch (error) {
    return String(value || "").split("?")[0];
  }
}

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (timer.unref) timer.unref();
  return { controller, timer };
}

function adminToken(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "adminToken")) {
    return String(options.adminToken || "").trim();
  }
  return String(getPublisherAdminToken().token || process.env.ADMIN_TOKEN || "").trim();
}

function buildAdminHeaders(options = {}) {
  const token = adminToken(options);
  if (!token) return {};
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-admin-token": token,
    authorization: `Bearer ${token}`,
  };
}

async function lookupHost(url) {
  try {
    const host = new URL(url).hostname;
    const result = await dns.lookup(host);
    return { host, address: result.address, family: result.family };
  } catch (error) {
    return { host: "", error: error.code || error.message };
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasProxyEnv() {
  return Boolean(
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy
  );
}

function shouldUseCurlFallback(error) {
  if (String(process.env.FOSU_LIVE_SMOKE_DISABLE_CURL_FALLBACK || "") === "1") return false;
  const code = String(error && (error.code || error.cause && error.cause.code) || "");
  const message = String(error && error.message || "");
  const name = String(error && error.name || "");
  return hasProxyEnv() && (
    name === "AbortError" ||
    message === "fetch failed" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENETUNREACH" ||
    code === "ECONNREFUSED"
  );
}

function errorDiagnostics(error) {
  const cause = error && error.cause || null;
  return {
    errorName: error && error.name || "",
    errorMessage: error && error.message || "",
    errorCauseCode: cause && cause.code || "",
    errorCauseMessage: cause && cause.message || "",
    errorCauseSyscall: cause && cause.syscall || "",
    errorCauseErrno: cause && cause.errno || "",
  };
}

function curlBinary() {
  return process.platform === "win32" ? "curl.exe" : "curl";
}

function fetchTextWithCurl(url, options = {}) {
  const timeoutSeconds = Math.max(1, Math.ceil((options.timeoutMs || DEFAULT_TIMEOUT_MS) / 1000));
  const marker = "\n__FOSU_LIVE_SMOKE_CURL_META__";
  const method = String(options.method || "GET").toUpperCase();
  const args = [
    "--location",
    "--silent",
    "--show-error",
    "--max-time",
    String(timeoutSeconds),
    "--request",
    method,
  ];
  const headers = Object.assign({}, options.headers || {});
  Object.keys(headers).forEach((name) => {
    const value = headers[name];
    if (value == null || value === "") return;
    args.push("--header", `${name}: ${value}`);
  });
  if (options.body != null) {
    args.push("--data-binary", "@-");
  }
  args.push(
    "--write-out",
    `${marker}%{http_code}|%{content_type}`,
    url
  );
  const result = spawnSync(curlBinary(), args, {
    input: options.body == null ? undefined : String(options.body),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const error = new Error((result.stderr || result.error && result.error.message || "curl failed").trim());
    error.code = result.error && result.error.code || `CURL_EXIT_${result.status}`;
    throw error;
  }
  const stdout = String(result.stdout || "");
  const markerIndex = stdout.lastIndexOf(marker);
  if (markerIndex < 0) {
    const error = new Error("curl response metadata missing");
    error.code = "CURL_META_MISSING";
    throw error;
  }
  const text = stdout.slice(0, markerIndex);
  const meta = stdout.slice(markerIndex + marker.length).trim();
  const [statusText, contentType] = meta.split("|");
  return {
    status: Number(statusText || 0),
    contentType: contentType || "",
    text,
  };
}

function buildStepItem(label, source, url, dnsInfo, startedAt, responseInfo, text, json) {
  const buffer = Buffer.from(text || "");
  return {
    label,
    source,
    url: sanitizeUrl(url),
    dns: dnsInfo,
    status: responseInfo.status,
    contentType: responseInfo.contentType || "",
    latencyMs: Date.now() - startedAt,
    releaseVersion: json && (json.releaseVersion || json.version || json.activeReleaseVersion) || "",
    term: json && (json.term || json.semester || json.activeTerm || json.termConfig && json.termConfig.term) || "",
    cacheEpoch: json && json.cacheEpoch || "",
    forceRefreshToken: json && json.forceRefreshToken || "",
    hash: sha1(buffer),
    size: buffer.length,
    count: getPayloadCount(json),
    ok: responseInfo.status >= 200 && responseInfo.status < 300,
    transport: responseInfo.transport || "fetch",
  };
}

function skippedStepItem(label, source, url, reason) {
  return {
    label,
    source,
    url: sanitizeUrl(url || ""),
    dns: { host: "" },
    status: 0,
    contentType: "",
    latencyMs: 0,
    releaseVersion: "",
    term: "",
    hash: "",
    size: 0,
    count: 0,
    ok: false,
    errorCode: reason || "SKIPPED",
  };
}

function parseJsonStepText(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    error.code = "LIVE_SMOKE_INVALID_JSON";
    throw error;
  }
}

async function fetchJsonStepOnce(label, url, source, options = {}) {
  const startedAt = Date.now();
  const dnsInfo = await lookupHost(url);
  const { controller, timer } = timeoutSignal(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  let response = null;
  let text = "";
  try {
    response = await fetch(url, {
      method: "GET",
      headers: Object.assign({ accept: "application/json" }, options.headers || {}),
      signal: controller.signal,
    });
    text = await response.text();
    const json = parseJsonStepText(text);
    const item = buildStepItem(label, source, url, dnsInfo, startedAt, {
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      transport: "fetch",
    }, text, json);
    if (!response.ok) {
      item.ok = false;
      item.errorCode = `HTTP_${response.status}`;
    }
    return { item, json, text };
  } catch (error) {
    if (shouldUseCurlFallback(error)) {
      try {
        const curlResponse = fetchTextWithCurl(url, {
          method: "GET",
          headers: Object.assign({ accept: "application/json" }, options.headers || {}),
          timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        });
        text = curlResponse.text;
        const json = parseJsonStepText(text);
        const item = buildStepItem(label, source, url, dnsInfo, startedAt, {
          status: curlResponse.status,
          contentType: curlResponse.contentType,
          transport: "curl",
        }, text, json);
        if (!item.ok) {
          item.errorCode = `HTTP_${curlResponse.status}`;
        }
        return { item, json, text };
      } catch (curlError) {
        error.curlFallback = errorDiagnostics(curlError);
      }
    }
    const details = errorDiagnostics(error);
    return {
      item: {
        label,
        source,
        url: sanitizeUrl(url),
        dns: dnsInfo,
        status: response && response.status || 0,
        contentType: response && response.headers && response.headers.get("content-type") || "",
        latencyMs: Date.now() - startedAt,
        releaseVersion: "",
        term: "",
        hash: text ? sha1(Buffer.from(text)) : "",
        size: text ? Buffer.byteLength(text) : 0,
        count: 0,
        ok: false,
        errorCode: error.name === "AbortError" ? "TIMEOUT" : (error.code || error.message || "REQUEST_FAILED"),
        ...details,
        curlFallback: error.curlFallback || null,
      },
      json: null,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonStep(label, url, source, options = {}) {
  const retries = Math.max(0, Number(options.retries == null ? 1 : options.retries) || 0);
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    last = await fetchJsonStepOnce(label, url, source, options);
    const code = String(last.item && last.item.errorCode || "");
    const retryable = !last.item.ok && (
      code === "fetch failed" ||
      code === "TIMEOUT" ||
      /^HTTP_5\d\d$/.test(code)
    );
    if (!retryable || attempt >= retries) return last;
    await delay(250 * (attempt + 1));
  }
  return last;
}

async function fetchAdminStaticTicket(releaseVersion, roots, options = {}) {
  const headers = buildAdminHeaders(options);
  if (!headers["x-admin-token"] && !headers.authorization) return null;
  const url = joinUrl(roots.baseUrl, "api", "admin", "static-ticket", "create");
  const { controller, timer } = timeoutSignal(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const requestBody = JSON.stringify({
    releaseVersion,
    pathPrefix: `/static/releases/${releaseVersion}/`,
    ttlSeconds: 600,
  });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: requestBody,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      error.code = "STATIC_TICKET_ADMIN_INVALID_JSON";
      throw error;
    }
    if (!response.ok || payload.success === false || !payload.ticket) {
      const error = new Error(payload.message || `admin static ticket failed with status ${response.status}`);
      error.code = payload.code || `HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }
    return {
      ticket: payload.ticket,
      headerName: payload.headerName || "X-Fosu-Static-Ticket",
      expiresAt: payload.expiresAt || "",
    };
  } catch (error) {
    if (shouldUseCurlFallback(error)) {
      const curlResponse = fetchTextWithCurl(url, {
        method: "POST",
        headers,
        body: requestBody,
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      });
      let payload = null;
      try {
        payload = JSON.parse(curlResponse.text);
      } catch (parseError) {
        parseError.code = "STATIC_TICKET_ADMIN_INVALID_JSON";
        throw parseError;
      }
      if (curlResponse.status < 200 || curlResponse.status >= 300 || payload.success === false || !payload.ticket) {
        const ticketError = new Error(payload.message || `admin static ticket failed with status ${curlResponse.status}`);
        ticketError.code = payload.code || `HTTP_${curlResponse.status}`;
        ticketError.status = curlResponse.status;
        throw ticketError;
      }
      return {
        ticket: payload.ticket,
        headerName: payload.headerName || "X-Fosu-Static-Ticket",
        expiresAt: payload.expiresAt || "",
      };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function shouldRefreshOracleTicket(item) {
  return item && (item.status === 401 || item.status === 403 || /STATIC_TICKET_(REQUIRED|INVALID|EXPIRED)/.test(String(item.errorCode || "")));
}

function getPayloadCount(json) {
  if (!json || typeof json !== "object") return 0;
  if (Array.isArray(json.items)) return json.items.length;
  if (Array.isArray(json.rooms)) return json.rooms.length;
  if (Array.isArray(json.courses)) return json.courses.length;
  if (Array.isArray(json.data)) return json.data.length;
  return 0;
}

function getIndexItems(json) {
  if (!json || typeof json !== "object") return [];
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.data)) return json.data;
  return [];
}

function getItemId(item) {
  return item && (
    item.id ||
    item.detailId ||
    item.classId ||
    item.teacherId ||
    item.classroomId ||
    item.courseId ||
    item.name ||
    item.className ||
    item.teacherName ||
    item.roomName ||
    item.courseName
  ) || "";
}

function indexPath(type) {
  return `index/${type}/all.json`;
}

function detailPath(type, id) {
  return `detail/${encodeURIComponent(type)}/${encodeURIComponent(String(id || ""))}.json`;
}

function emptyRoomPath() {
  return "empty-room/index.json";
}

function sourceRoots(source, options = {}) {
  if (source === "cloudbase") {
    const baseUrl = String(options.cloudbaseBaseUrl || cloudbaseConfig.CLOUDBASE_HOSTING_BASE_URL || "").trim().replace(/\/+$/g, "");
    return {
      source,
      baseUrl,
      pointerUrl: joinUrl(baseUrl, "runtime", `active.json?bucket=${Date.now()}`),
      releaseRoot: (releaseVersion) => joinUrl(baseUrl, "releases", releaseVersion),
    };
  }
  const baseUrl = String(options.oracleBaseUrl || ORACLE_API_BASE_URL || "").trim().replace(/\/+$/g, "");
  return {
    source: "oracle",
    baseUrl,
    pointerUrl: joinUrl(baseUrl, "static", "runtime", `active.json?bucket=${Date.now()}`),
    releaseRoot: (releaseVersion) => joinUrl(baseUrl, "static", "releases", releaseVersion),
  };
}

async function smokeSource(source, options = {}) {
  const roots = sourceRoots(source, options);
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const steps = [];
  const indexes = {};
  const details = {};
  const ticketState = {
    releaseVersion: "",
    entry: null,
    refreshed: false,
  };

  async function ensureOracleTicket(releaseVersion, forceRefresh = false) {
    if (roots.source !== "oracle" || options.oracleTicket === false) return null;
    if (!releaseVersion) return null;
    if (!forceRefresh && ticketState.entry && ticketState.releaseVersion === releaseVersion) return ticketState.entry;
    ticketState.entry = await fetchAdminStaticTicket(releaseVersion, roots, options);
    ticketState.releaseVersion = releaseVersion;
    return ticketState.entry;
  }

  async function fetchSourceStep(label, url, relativePath, releaseVersion) {
    let headers = {};
    if (roots.source === "oracle" && releaseVersion) {
      const ticket = await ensureOracleTicket(releaseVersion, false).catch(() => null);
      if (ticket && ticket.ticket) headers[ticket.headerName || "X-Fosu-Static-Ticket"] = ticket.ticket;
    }
    let result = await fetchJsonStep(label, url, roots.source, { timeoutMs, headers });
    if (roots.source === "oracle" && releaseVersion && shouldRefreshOracleTicket(result.item) && !ticketState.refreshed) {
      ticketState.refreshed = true;
      const ticket = await ensureOracleTicket(releaseVersion, true).catch(() => null);
      if (ticket && ticket.ticket) {
        headers = { [ticket.headerName || "X-Fosu-Static-Ticket"]: ticket.ticket };
        result = await fetchJsonStep(label, url, roots.source, { timeoutMs, headers });
      }
    }
    if (result.item && relativePath && roots.source === "oracle") {
      result.item.staticPath = relativePath;
      result.item.ticketMode = Boolean(headers["X-Fosu-Static-Ticket"]);
    }
    return result;
  }

  const pointer = await fetchJsonStep(`${roots.source} runtime/active.json`, roots.pointerUrl, roots.source, { timeoutMs });
  steps.push(pointer.item);
  const releaseVersion = pointer.json && (pointer.json.releaseVersion || pointer.json.version) || "";
  if (!pointer.item.ok || !releaseVersion) {
    return {
      success: false,
      source: roots.source,
      baseUrl: sanitizeUrl(roots.baseUrl),
      releaseVersion,
      ticketMode: false,
      term: pointer.item.term || "",
      pointer: pointer.item,
      manifest: { ok: false, errorCode: "RUNTIME_POINTER_UNAVAILABLE" },
      indexes: {},
      details: {},
      emptyRoom: { ok: false, errorCode: "RUNTIME_POINTER_UNAVAILABLE" },
      steps,
    };
  }
  const releaseRoot = roots.releaseRoot(releaseVersion);

  const manifest = await fetchSourceStep(`${roots.source} manifest.json`, joinUrl(releaseRoot, "manifest.json"), "manifest.json", releaseVersion);
  steps.push(manifest.item);

  for (const type of INDEX_TYPES) {
    const relPath = indexPath(type);
    const index = await fetchSourceStep(`${roots.source} index/${type}`, joinUrl(releaseRoot, relPath), relPath, releaseVersion);
    steps.push(index.item);
    indexes[type] = index;
  }

  for (const type of INDEX_TYPES) {
    const item = getIndexItems(indexes[type] && indexes[type].json)[0] || {};
    const id = getItemId(item);
    if (!id) {
      const skipped = {
        item: skippedStepItem(`${roots.source} detail/${type}`, roots.source, "", `INDEX_${type.toUpperCase()}_UNAVAILABLE`),
        json: null,
        text: "",
      };
      steps.push(skipped.item);
      details[type] = skipped;
      continue;
    }
    const relPath = detailPath(type, id);
    const detail = await fetchSourceStep(`${roots.source} detail/${type}`, joinUrl(releaseRoot, relPath), relPath, releaseVersion);
    steps.push(detail.item);
    details[type] = detail;
  }

  const emptyRelPath = emptyRoomPath();
  const emptyRoom = await fetchSourceStep(`${roots.source} empty-room`, joinUrl(releaseRoot, emptyRelPath), emptyRelPath, releaseVersion);
  steps.push(emptyRoom.item);

  const requiredMeta = [
    pointer.item.releaseVersion,
    manifest.item.releaseVersion,
    manifest.item.term || pointer.item.term,
    manifest.item.cacheEpoch || pointer.item.cacheEpoch,
    manifest.item.forceRefreshToken || pointer.item.forceRefreshToken,
  ];
  const success = steps.every((item) => item.ok) && requiredMeta.every((value) => String(value || "").trim());
  return {
    success,
    source: roots.source,
    baseUrl: sanitizeUrl(roots.baseUrl),
    releaseVersion,
    ticketMode: roots.source === "oracle" ? Boolean(ticketState.entry && ticketState.entry.ticket) : false,
    term: manifest.item.term || pointer.item.term || "",
    pointer: pointer.item,
    manifest: manifest.item,
    indexes: Object.keys(indexes).reduce((acc, type) => {
      acc[type] = indexes[type].item;
      return acc;
    }, {}),
    details: Object.keys(details).reduce((acc, type) => {
      acc[type] = details[type].item;
      return acc;
    }, {}),
    emptyRoom: emptyRoom.item,
    steps,
  };
}

function compareField(name, cloudbase, oracle, required) {
  return {
    field: name,
    cloudbase: cloudbase && cloudbase[name] || "",
    oracle: oracle && oracle[name] || "",
    match: String(cloudbase && cloudbase[name] || "") === String(oracle && oracle[name] || ""),
    required: required === true,
  };
}

function compareMeta(label, cloudbaseItem, oracleItem, requiredFields) {
  const required = new Set(requiredFields || []);
  return {
    label,
    fields: [
      compareField("releaseVersion", cloudbaseItem, oracleItem, required.has("releaseVersion")),
      compareField("term", cloudbaseItem, oracleItem, required.has("term")),
      compareField("cacheEpoch", cloudbaseItem, oracleItem, required.has("cacheEpoch")),
      compareField("forceRefreshToken", cloudbaseItem, oracleItem, required.has("forceRefreshToken")),
      compareField("hash", cloudbaseItem, oracleItem, required.has("hash")),
      compareField("size", cloudbaseItem, oracleItem, required.has("size")),
      compareField("count", cloudbaseItem, oracleItem, required.has("count")),
    ],
  };
}

function compareSources(cloudbase, oracle) {
  const comparisons = [
    compareMeta("runtime pointer", cloudbase.pointer, oracle.pointer, ["releaseVersion", "term", "cacheEpoch", "forceRefreshToken"]),
    compareMeta("manifest", cloudbase.manifest, oracle.manifest, ["releaseVersion", "term", "cacheEpoch", "forceRefreshToken", "hash", "size"]),
    compareMeta("empty-room", cloudbase.emptyRoom, oracle.emptyRoom, ["releaseVersion", "hash", "size", "count"]),
  ];
  INDEX_TYPES.forEach((type) => {
    comparisons.push(compareMeta(`index/${type}`, cloudbase.indexes[type], oracle.indexes[type], ["releaseVersion", "hash", "size", "count"]));
    comparisons.push(compareMeta(`detail/${type}`, cloudbase.details[type], oracle.details[type], ["releaseVersion", "hash", "size"]));
  });
  return comparisons;
}

async function runOracleOnlySmoke(options = {}) {
  const oracle = await smokeSource("oracle", options);
  return {
    success: oracle.success,
    mode: "oracle-only",
    checkedAt: new Date().toISOString(),
    oracleBaseUrl: oracle.baseUrl,
    oracleReleaseVersion: oracle.releaseVersion,
    oracle,
    steps: oracle.steps,
  };
}

async function runLiveSmoke(options = {}) {
  const cloudbase = await smokeSource("cloudbase", options);
  const oracle = await smokeSource("oracle", options);
  const comparisons = compareSources(cloudbase, oracle);
  const success = cloudbase.success &&
    oracle.success &&
    comparisons.every((comparison) => comparison.fields.every((field) => !field.required || field.match));

  return {
    success,
    mode: "dual-source-full",
    checkedAt: new Date().toISOString(),
    cloudbaseBaseUrl: cloudbase.baseUrl,
    oracleBaseUrl: oracle.baseUrl,
    cloudbaseReleaseVersion: cloudbase.releaseVersion,
    oracleReleaseVersion: oracle.releaseVersion,
    cloudbase,
    oracle,
    steps: cloudbase.steps.concat(oracle.steps),
    comparisons,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = {
    cloudbaseBaseUrl: args["cloudbase-base-url"] || args.cloudbaseBaseUrl,
    oracleBaseUrl: args["oracle-base-url"] || args.oracleBaseUrl,
    timeoutMs: args.timeout || args.timeoutMs,
  };
  const oracleOnly = args["oracle-only"] === true || args.source === "oracle" || args.mode === "oracle-only";
  const result = oracleOnly ? await runOracleOnlySmoke(options) : await runLiveSmoke(options);
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      success: false,
      code: error.code || "CLOUDBASE_LIVE_SMOKE_FAILED",
      message: error.message,
    }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  compareMeta,
  compareSources,
  fetchAdminStaticTicket,
  runLiveSmoke,
  runOracleOnlySmoke,
  sanitizeUrl,
  smokeSource,
};
