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
      cacheEpoch: json && json.cacheEpoch || "",
      forceRefreshToken: json && json.forceRefreshToken || "",
      hash: sha1(buffer),
      size: buffer.length,
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
        hash: text ? sha1(Buffer.from(text)) : "",
        size: text ? Buffer.byteLength(text) : 0,
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

function getItemId(item) {
  return item && (item.id || item.detailId || item.classId || item.teacherId || item.classroomId || item.courseId || item.name || item.className || item.teacherName || item.roomName || item.courseName) || "";
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
      compareField("cacheEpoch", cloudbaseItem, oracleItem, required.has("cacheEpoch")),
      compareField("forceRefreshToken", cloudbaseItem, oracleItem, required.has("forceRefreshToken")),
      compareField("hash", cloudbaseItem, oracleItem, required.has("hash")),
      compareField("size", cloudbaseItem, oracleItem, required.has("size")),
    ],
  };
}

async function runLiveSmoke(options = {}) {
  const cloudbaseBaseUrl = String(options.cloudbaseBaseUrl || cloudbaseConfig.CLOUDBASE_HOSTING_BASE_URL || "").trim().replace(/\/+$/g, "");
  const oracleBaseUrl = String(options.oracleBaseUrl || ORACLE_API_BASE_URL || "").trim().replace(/\/+$/g, "");
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const steps = [];
  const comparisons = [];

  const cloudbasePointer = await fetchJsonStep(
    "CloudBase runtime/active.json",
    joinUrl(cloudbaseBaseUrl, "runtime", `active.json?bucket=${Date.now()}`),
    "cloudbase",
    { timeoutMs }
  );
  steps.push(cloudbasePointer.item);
  const cloudbaseReleaseVersion = cloudbasePointer.json && (cloudbasePointer.json.releaseVersion || cloudbasePointer.json.version) || "";

  const cloudbaseManifest = await fetchJsonStep(
    "CloudBase manifest.json",
    joinUrl(cloudbaseBaseUrl, "releases", cloudbaseReleaseVersion, "manifest.json"),
    "cloudbase",
    { timeoutMs }
  );
  steps.push(cloudbaseManifest.item);

  const cloudbaseIndexes = {};
  for (const type of INDEX_TYPES) {
    const index = await fetchJsonStep(
      `CloudBase index/${type}`,
      joinUrl(cloudbaseBaseUrl, "releases", cloudbaseReleaseVersion, indexPath(type)),
      "cloudbase",
      { timeoutMs }
    );
    steps.push(index.item);
    cloudbaseIndexes[type] = index.json;
  }

  for (const type of INDEX_TYPES) {
    const item = Array.isArray(cloudbaseIndexes[type] && cloudbaseIndexes[type].items)
      ? cloudbaseIndexes[type].items[0]
      : null;
    const id = getItemId(item);
    const detail = await fetchJsonStep(
      `CloudBase detail/${type}`,
      joinUrl(cloudbaseBaseUrl, "releases", cloudbaseReleaseVersion, detailPath(type, id)),
      "cloudbase",
      { timeoutMs }
    );
    steps.push(detail.item);
  }

  const cloudbaseEmptyRoom = await fetchJsonStep(
    "CloudBase empty-room",
    joinUrl(cloudbaseBaseUrl, "releases", cloudbaseReleaseVersion, emptyRoomPath()),
    "cloudbase",
    { timeoutMs }
  );
  steps.push(cloudbaseEmptyRoom.item);

  const oraclePointer = await fetchJsonStep(
    "Oracle runtime pointer",
    joinUrl(oracleBaseUrl, "static", "runtime", `active.json?bucket=${Date.now()}`),
    "oracle",
    { timeoutMs }
  );
  steps.push(oraclePointer.item);
  const oracleReleaseVersion = oraclePointer.json && (oraclePointer.json.releaseVersion || oraclePointer.json.version) || "";

  const oracleManifest = await fetchJsonStep(
    "Oracle manifest",
    joinUrl(oracleBaseUrl, "static", "releases", oracleReleaseVersion, "manifest.json"),
    "oracle",
    { timeoutMs }
  );
  steps.push(oracleManifest.item);

  comparisons.push(compareMeta("runtime pointer", cloudbasePointer.item, oraclePointer.item, ["releaseVersion", "cacheEpoch", "forceRefreshToken"]));
  comparisons.push(compareMeta("manifest", cloudbaseManifest.item, oracleManifest.item, ["releaseVersion", "cacheEpoch", "forceRefreshToken", "hash", "size"]));

  const success = steps.every((item) => item.ok) &&
    comparisons.every((comparison) => comparison.fields.every((field) => !field.required || field.match));

  return {
    success,
    checkedAt: new Date().toISOString(),
    cloudbaseBaseUrl: sanitizeUrl(cloudbaseBaseUrl),
    oracleBaseUrl: sanitizeUrl(oracleBaseUrl),
    cloudbaseReleaseVersion,
    oracleReleaseVersion,
    steps,
    comparisons,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runLiveSmoke({
    cloudbaseBaseUrl: args["cloudbase-base-url"] || args.cloudbaseBaseUrl,
    oracleBaseUrl: args["oracle-base-url"] || args.oracleBaseUrl,
    timeoutMs: args.timeout || args.timeoutMs,
  });
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
  runLiveSmoke,
  sanitizeUrl,
};
