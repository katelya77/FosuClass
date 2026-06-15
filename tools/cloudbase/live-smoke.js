#!/usr/bin/env node

const crypto = require("crypto");
const dns = require("dns").promises;

const cloudbaseConfig = require("../../miniprogram/config/cloudbase");
const {
  ORACLE_API_BASE_URL,
} = require("../../miniprogram/config/api");
const {
  joinUrl,
  parseArgs,
} = require("./oracle-release-source");

const INDEX_TYPES = ["class", "teacher", "classroom", "course"];
const DEFAULT_TIMEOUT_MS = 10000;

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

async function lookupHost(url) {
  try {
    const host = new URL(url).hostname;
    const result = await dns.lookup(host);
    return { host, address: result.address, family: result.family };
  } catch (error) {
    return { host: "", error: error.code || error.message };
  }
}

async function fetchJsonStep(label, url, source, options = {}) {
  const startedAt = Date.now();
  const dnsInfo = await lookupHost(url);
  const { controller, timer } = timeoutSignal(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  let response = null;
  let text = "";
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    text = await response.text();
    const buffer = Buffer.from(text);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (error) {
      error.code = "LIVE_SMOKE_INVALID_JSON";
      throw error;
    }
    const item = {
      label,
      source,
      url: sanitizeUrl(url),
      dns: dnsInfo,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      latencyMs: Date.now() - startedAt,
      releaseVersion: json && (json.releaseVersion || json.version || json.activeReleaseVersion) || "",
      term: json && (json.term || json.semester || json.activeTerm || json.termConfig && json.termConfig.term) || "",
      cacheEpoch: json && json.cacheEpoch || "",
      forceRefreshToken: json && json.forceRefreshToken || "",
      hash: sha1(buffer),
      size: buffer.length,
      count: getPayloadCount(json),
      ok: response.ok,
    };
    if (!response.ok) {
      item.ok = false;
      item.errorCode = `HTTP_${response.status}`;
    }
    return { item, json, text };
  } catch (error) {
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
      },
      json: null,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
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

  const pointer = await fetchJsonStep(`${roots.source} runtime/active.json`, roots.pointerUrl, roots.source, { timeoutMs });
  steps.push(pointer.item);
  const releaseVersion = pointer.json && (pointer.json.releaseVersion || pointer.json.version) || "";
  const releaseRoot = roots.releaseRoot(releaseVersion);

  const manifest = await fetchJsonStep(`${roots.source} manifest.json`, joinUrl(releaseRoot, "manifest.json"), roots.source, { timeoutMs });
  steps.push(manifest.item);

  for (const type of INDEX_TYPES) {
    const index = await fetchJsonStep(`${roots.source} index/${type}`, joinUrl(releaseRoot, indexPath(type)), roots.source, { timeoutMs });
    steps.push(index.item);
    indexes[type] = index;
  }

  for (const type of INDEX_TYPES) {
    const item = getIndexItems(indexes[type] && indexes[type].json)[0] || {};
    const id = getItemId(item);
    const detail = await fetchJsonStep(`${roots.source} detail/${type}`, joinUrl(releaseRoot, detailPath(type, id)), roots.source, { timeoutMs });
    steps.push(detail.item);
    details[type] = detail;
  }

  const emptyRoom = await fetchJsonStep(`${roots.source} empty-room`, joinUrl(releaseRoot, emptyRoomPath()), roots.source, { timeoutMs });
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
  runLiveSmoke,
  runOracleOnlySmoke,
  sanitizeUrl,
  smokeSource,
};
