#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  cutoverReleasePack,
  ENV_ID,
  parseArgs,
  writeJson,
} = require("./release-pack-utils");
const {
  DEFAULT_OUTPUT_ROOT,
  extractActiveRelease,
  fetchOracleActivePointer,
} = require("./oracle-release-source");

function runGitStatus() {
  const result = spawnSync("git", ["status", "--short", "--branch"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    text: String(result.stdout || "").trim(),
  };
}

function readConfirmation(args) {
  return String(args.confirm || args.confirmation || process.env.CLOUDBASE_CUTOVER_CONFIRM || "").trim();
}

function writeReceipt(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJson(filePath, payload);
  return filePath;
}

async function runReleaseCutover(options = {}) {
  const envId = options.envId || ENV_ID;
  const releaseVersion = String(options.releaseVersion || "").trim();
  const hostingBaseUrl = String(options.hostingBaseUrl || "").trim();
  const publicRoot = path.resolve(options.publicRoot || options.outputRoot || DEFAULT_OUTPUT_ROOT);
  if (!releaseVersion || !hostingBaseUrl) {
    const error = new Error("releaseVersion and hostingBaseUrl are required");
    error.code = "CLOUDBASE_CUTOVER_CONFIG_REQUIRED";
    throw error;
  }
  const oracleSource = await fetchOracleActivePointer({ oracleBaseUrl: options.oracleBaseUrl });
  const oracleActive = extractActiveRelease(oracleSource);
  const gitStatus = runGitStatus();
  const result = await cutoverReleasePack({
    envId,
    publicRoot,
    releaseVersion,
    hostingBaseUrl,
    confirmation: options.confirmation,
    oracleActiveReleaseVersion: oracleActive.releaseVersion,
    gitStatusRecorded: gitStatus.ok,
    gitStatusText: gitStatus.text,
    concurrency: options.concurrency || 5,
    retryCount: options.retryCount || 3,
  });
  const receipt = {
    success: true,
    mode: "cloudbase-release-cutover",
    envId,
    createdAt: new Date().toISOString(),
    hostingBaseUrl,
    oracle: {
      source: oracleSource.source,
      term: oracleActive.term,
      releaseVersion: oracleActive.releaseVersion,
      cacheEpoch: oracleActive.cacheEpoch,
      forceRefreshToken: oracleActive.forceRefreshToken,
    },
    git: gitStatus,
    releaseVersion,
    localVerification: {
      releaseDir: result.verification.releaseDir,
      checkedFiles: result.verification.checkedFiles.length,
      samples: result.verification.samples,
      emptyRoomCount: result.verification.emptyRoomCount,
      privacyScan: result.privacy.success,
    },
    remoteBefore: result.remoteBefore,
    pointerVerification: result.pointerVerification,
    remoteAfter: result.remoteAfter,
    commands: result.commands,
    readyRecommendation: result.readyRecommendation,
    oldReleaseCleanupPerformed: false,
  };
  const receiptPath = writeReceipt(path.join(publicRoot, "receipts", `${releaseVersion}-cutover.json`), receipt);
  return Object.assign({}, receipt, { receiptPath });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runReleaseCutover({
    envId: args["env-id"] || ENV_ID,
    publicRoot: args["public-root"],
    outputRoot: args["output-root"],
    releaseVersion: args["release-version"] || args.releaseVersion,
    hostingBaseUrl: args["hosting-base-url"] || args.hostingBaseUrl,
    oracleBaseUrl: args["oracle-base-url"] || args.oracleBaseUrl,
    confirmation: readConfirmation(args),
    concurrency: args.concurrency || 5,
    retryCount: args["retry-count"] || args.retryCount || 3,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      success: false,
      code: error.code || "CLOUDBASE_RELEASE_CUTOVER_FAILED",
      message: error.message,
      findings: error.findings || undefined,
    }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  runReleaseCutover,
};
