#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { runPreflight } = require("./preflight");
const { downloadReleaseFromOracle, parseArgs } = require("./oracle-release-source");
const {
  ENV_ID,
  buildCloudbasePointer,
  deployReleasePack,
  writeJson,
} = require("./release-pack-utils");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReceipt(filePath, receipt) {
  ensureDir(path.dirname(filePath));
  writeJson(filePath, receipt);
  return filePath;
}

async function runReleaseAuto(options = {}) {
  const envId = options.envId || ENV_ID;
  const preflight = await runPreflight({
    envId,
    oracleBaseUrl: options.oracleBaseUrl,
  });
  const hostingBaseUrl = options.hostingBaseUrl || preflight.hosting.realDomain || preflight.hosting.configuredBaseUrl;
  if (!hostingBaseUrl) {
    const error = new Error("CloudBase Hosting real domain is required before release:auto");
    error.code = "CLOUDBASE_HOSTING_BASE_URL_REQUIRED";
    throw error;
  }
  const pull = await downloadReleaseFromOracle({
    oracleBaseUrl: options.oracleBaseUrl,
    outputRoot: options.outputRoot,
    concurrency: options.concurrency || 5,
    retryCount: options.retryCount || 3,
    onProgress: options.onProgress,
  });
  const publicRoot = pull.outputRoot;
  const releaseVersion = pull.releaseVersion;

  const dryRun = await deployReleasePack({
    envId,
    publicRoot,
    releaseVersion,
    hostingBaseUrl,
    dryRun: true,
  });
  const deployed = await deployReleasePack({
    envId,
    publicRoot,
    releaseVersion,
    hostingBaseUrl,
    execute: true,
    concurrency: options.concurrency || 5,
    retryCount: options.retryCount || 3,
  });
  const pointer = buildCloudbasePointer(deployed.verification.manifest, {
    releaseVersion,
    hostingBaseUrl,
  });
  const pendingDir = path.join(publicRoot, ".pending", releaseVersion, "runtime");
  const pendingPointerPath = path.join(pendingDir, "active.json");
  writeReceipt(pendingPointerPath, pointer);

  const receipt = {
    success: true,
    mode: "cloudbase-release-auto",
    envId,
    createdAt: new Date().toISOString(),
    hostingBaseUrl,
    oracle: {
      pointerSource: pull.pointerSource,
      term: pull.term,
      releaseVersion,
      cacheEpoch: pull.cacheEpoch,
      forceRefreshToken: pull.forceRefreshToken,
    },
    release: {
      releaseVersion,
      releaseDir: pull.releaseDir,
      fileCount: pull.fileCount,
      totalSize: pull.totalSize,
      checkedFiles: pull.verification.local.checkedFiles.length,
      samples: pull.verification.local.samples,
      emptyRoomCount: pull.verification.local.emptyRoomCount,
      privacyScan: pull.verification.privacy.success,
    },
    cloudbase: {
      dryRunPlan: dryRun.planned,
      uploadedVersionDirectory: true,
      commands: deployed.commands,
      remoteVerification: deployed.remote,
      activePointerUploaded: false,
      pendingPointerPath,
    },
    git: preflight.git,
    next: {
      productionCutoverPending: true,
      confirmationText: "CONFIRM_CLOUDBASE_CUTOVER",
      readyGate: "Do not set CLOUDBASE_HOSTING_READY=true until cutover uploads and verifies runtime/active.json.",
    },
  };
  const receiptPath = writeReceipt(path.join(publicRoot, "receipts", `${releaseVersion}-auto.json`), receipt);
  return Object.assign({}, receipt, { receiptPath });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runReleaseAuto({
    envId: args["env-id"] || ENV_ID,
    oracleBaseUrl: args["oracle-base-url"] || args.oracleBaseUrl,
    hostingBaseUrl: args["hosting-base-url"] || args.hostingBaseUrl,
    outputRoot: args["output-root"] || args.outputRoot,
    concurrency: args.concurrency || 5,
    retryCount: args["retry-count"] || args.retryCount || 3,
    onProgress: (progress) => {
      process.stderr.write(`download ${progress.completed}/${progress.total} ${progress.status} ${progress.relativePath}\n`);
    },
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      success: false,
      code: error.code || "CLOUDBASE_RELEASE_AUTO_FAILED",
      message: error.message,
      findings: error.findings || undefined,
    }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  runReleaseAuto,
};
