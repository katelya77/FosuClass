#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const {
  ENV_ID,
  cutoverReleasePack,
  deployReleasePack,
  parseArgs,
  verifyRemoteReleasePack,
  writeJson,
} = require("./release-pack-utils");
const {
  DEFAULT_OUTPUT_ROOT,
  downloadReleaseFromOracle,
  extractActiveRelease,
  fetchOracleActivePointer,
  joinUrl,
} = require("./oracle-release-source");
const cloudbaseConfig = require("../../miniprogram/config/cloudbase");

const RECEIPT_DIR = path.resolve(".local", "cloudbase-receipts");

function nowIso() {
  return new Date().toISOString();
}

function safeName(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._:-]+/g, "-").slice(0, 120);
}

function pointerTime(active) {
  const cacheEpoch = Number(active && active.cacheEpoch || 0) || 0;
  const updatedAt = Date.parse(active && active.pointer && active.pointer.updatedAt || "") || 0;
  return Math.max(cacheEpoch, updatedAt);
}

function pointerOrder(left, right) {
  const leftEpoch = Number(left && left.cacheEpoch || 0) || 0;
  const rightEpoch = Number(right && right.cacheEpoch || 0) || 0;
  if (leftEpoch && rightEpoch && leftEpoch !== rightEpoch) return leftEpoch - rightEpoch;
  return pointerTime(left) - pointerTime(right);
}

function sanitizeForReceipt(value) {
  const blocked = /token|ticket|cookie|secret|authorization|password|api[-_]?key/i;
  if (Array.isArray(value)) return value.map(sanitizeForReceipt);
  if (value && typeof value === "object") {
    return Object.keys(value).reduce((next, key) => {
      next[key] = blocked.test(key) ? "[redacted]" : sanitizeForReceipt(value[key]);
      return next;
    }, {});
  }
  if (typeof value === "string" && /(token|ticket|cookie|secret|authorization|password)=/i.test(value)) {
    return value.replace(/([?&]?(?:token|ticket|cookie|secret|authorization|password)[^=]*=)[^&\s]+/gi, "$1[redacted]");
  }
  return value;
}

function writeReceipt(payload) {
  const receipt = sanitizeForReceipt(Object.assign({
    success: payload && payload.success === true,
    createdAt: nowIso(),
  }, payload || {}));
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
  const filePath = path.join(RECEIPT_DIR, `sync-active-${safeName(receipt.releaseVersion)}-${Date.now()}.json`);
  writeJson(filePath, receipt);
  return Object.assign({}, receipt, { receiptPath: filePath });
}

async function fetchCloudbaseActivePointer(options = {}) {
  const baseUrl = String(options.hostingBaseUrl || cloudbaseConfig.CLOUDBASE_HOSTING_BASE_URL || "").trim().replace(/\/+$/g, "");
  if (!baseUrl) {
    const error = new Error("CloudBase hostingBaseUrl is required");
    error.code = "CLOUDBASE_HOSTING_BASE_URL_REQUIRED";
    throw error;
  }
  const url = joinUrl(baseUrl, "runtime", `active.json?bucket=${Date.now()}`);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`CloudBase active pointer HTTP ${response.status}`);
    error.code = "CLOUDBASE_ACTIVE_POINTER_HTTP";
    error.status = response.status;
    throw error;
  }
  return { source: "cloudbase-runtime", pointer: JSON.parse(text), url };
}

async function resolveCloudbaseActive(options = {}) {
  try {
    const source = await fetchCloudbaseActivePointer(options);
    return Object.assign({}, extractActiveRelease(source), {
      source: source.source,
      url: source.url,
      available: true,
    });
  } catch (error) {
    return {
      available: false,
      releaseVersion: "",
      cacheEpoch: 0,
      forceRefreshToken: "",
      errorCode: error.code || "CLOUDBASE_ACTIVE_POINTER_FAILED",
      errorMessage: error.message,
    };
  }
}

function classifyVersions(oracleActive, cloudbaseActive) {
  if (!cloudbaseActive.available || !cloudbaseActive.releaseVersion) return "oracle-newer";
  if (oracleActive.releaseVersion === cloudbaseActive.releaseVersion) return "same";
  if (pointerOrder(oracleActive, cloudbaseActive) > 0) return "oracle-newer";
  return "cloudbase-newer";
}

async function verifyCloudbaseMatchesOracle(oracleActive, options = {}) {
  const publicRoot = options.publicRoot || options.outputRoot || DEFAULT_OUTPUT_ROOT;
  try {
    return await verifyRemoteReleasePack({
      publicRoot,
      releaseVersion: oracleActive.releaseVersion,
      hostingBaseUrl: options.hostingBaseUrl,
    });
  } catch (error) {
    if (error.code !== "CLOUDBASE_RELEASE_FILE_MISSING") throw error;
    const pulled = await downloadReleaseFromOracle(Object.assign({}, options, {
      outputRoot: publicRoot,
      activeSource: options.oracleActiveSource,
    }));
    return verifyRemoteReleasePack({
      publicRoot: pulled.outputRoot,
      releaseVersion: oracleActive.releaseVersion,
      hostingBaseUrl: options.hostingBaseUrl,
    });
  }
}

async function syncActiveRelease(options = {}) {
  const envId = options.envId || ENV_ID;
  const dryRun = options.dryRun === true || options.execute !== true;
  const hostingBaseUrl = String(options.hostingBaseUrl || cloudbaseConfig.CLOUDBASE_HOSTING_BASE_URL || "").trim().replace(/\/+$/g, "");
  const oracleActiveSource = await fetchOracleActivePointer(options);
  const oracleActive = Object.assign({}, extractActiveRelease(oracleActiveSource), {
    source: oracleActiveSource.source,
  });
  const cloudbaseActive = await resolveCloudbaseActive({ hostingBaseUrl });
  const relation = classifyVersions(oracleActive, cloudbaseActive);

  const baseReceipt = {
    success: false,
    dryRun,
    envId,
    hostingBaseUrl,
    releaseVersion: oracleActive.releaseVersion,
    oracle: {
      source: oracleActive.source,
      term: oracleActive.term,
      releaseVersion: oracleActive.releaseVersion,
      cacheEpoch: oracleActive.cacheEpoch,
      forceRefreshToken: oracleActive.forceRefreshToken,
    },
    cloudbase: {
      available: cloudbaseActive.available === true,
      releaseVersion: cloudbaseActive.releaseVersion || "",
      cacheEpoch: cloudbaseActive.cacheEpoch || 0,
      forceRefreshToken: cloudbaseActive.forceRefreshToken || "",
      errorCode: cloudbaseActive.errorCode || "",
    },
    relation,
  };

  if (relation === "cloudbase-newer") {
    const receipt = writeReceipt(Object.assign({}, baseReceipt, {
      success: false,
      action: "conflict",
      code: "CLOUDBASE_NEWER_THAN_ORACLE",
      message: "CloudBase active pointer is newer than Oracle; refusing to overwrite.",
    }));
    const error = new Error(receipt.message);
    error.code = receipt.code;
    error.receipt = receipt;
    throw error;
  }

  if (relation === "same") {
    const remote = await verifyCloudbaseMatchesOracle(oracleActive, Object.assign({}, options, {
      hostingBaseUrl,
      oracleActiveSource,
    }));
    return writeReceipt(Object.assign({}, baseReceipt, {
      success: true,
      action: "no-op",
      remote,
      message: "Oracle and CloudBase active release match; remote hash/size verification passed.",
    }));
  }

  if (dryRun) {
    return writeReceipt(Object.assign({}, baseReceipt, {
      success: true,
      action: "dry-run-update-required",
      message: "Oracle active release is newer; dry-run did not upload or update CloudBase pointer.",
    }));
  }

  const pulled = await downloadReleaseFromOracle(Object.assign({}, options, {
    outputRoot: options.outputRoot || DEFAULT_OUTPUT_ROOT,
    activeSource: oracleActiveSource,
  }));
  const deployed = await deployReleasePack({
    envId,
    publicRoot: pulled.outputRoot,
    releaseVersion: oracleActive.releaseVersion,
    hostingBaseUrl,
    execute: true,
    dryRun: false,
    verifyRemote: true,
  });
  const cutover = await cutoverReleasePack({
    envId,
    publicRoot: pulled.outputRoot,
    releaseVersion: oracleActive.releaseVersion,
    hostingBaseUrl,
    confirmation: "CONFIRM_CLOUDBASE_CUTOVER",
    oracleActiveReleaseVersion: oracleActive.releaseVersion,
    gitStatusRecorded: true,
  });

  return writeReceipt(Object.assign({}, baseReceipt, {
    success: true,
    action: "uploaded-and-cutover",
    pulled,
    deployed,
    cutover,
    message: "Oracle active release was mirrored to CloudBase and runtime/active.json was updated atomically.",
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log([
      "Usage:",
      "  npm run cloudbase:release:sync-active -- --dry-run",
      "  npm run cloudbase:release:sync-active -- --execute --env-id=<envId>",
      "",
      "Options:",
      `  --env-id=<id>             CloudBase env id, default ${ENV_ID}`,
      "  --hosting-base-url=<url>  CloudBase hosting origin",
      "  --oracle-base-url=<url>   Oracle origin",
      "  --output-root=<path>      Local release cache root",
      "  --execute                 Upload and update runtime/active.json",
      "  --dry-run                 Compare only, no CloudBase writes (default)",
    ].join("\n"));
    return;
  }
  const receipt = await syncActiveRelease({
    envId: args["env-id"] || ENV_ID,
    hostingBaseUrl: args["hosting-base-url"] || args.hostingBaseUrl || cloudbaseConfig.CLOUDBASE_HOSTING_BASE_URL,
    oracleBaseUrl: args["oracle-base-url"] || args.oracleBaseUrl,
    outputRoot: args["output-root"] || args.outputRoot,
    execute: args.execute === true,
    dryRun: args.execute !== true,
  });
  console.log(JSON.stringify(receipt, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    const receipt = error.receipt || writeReceipt({
      success: false,
      action: "failed",
      code: error.code || "CLOUDBASE_SYNC_ACTIVE_FAILED",
      message: error.message,
    });
    console.error(JSON.stringify(receipt, null, 2));
    process.exit(1);
  });
}

module.exports = {
  classifyVersions,
  fetchCloudbaseActivePointer,
  sanitizeForReceipt,
  syncActiveRelease,
};
