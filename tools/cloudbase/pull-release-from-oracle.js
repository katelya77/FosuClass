#!/usr/bin/env node

const {
  DEFAULT_OUTPUT_ROOT,
  downloadReleaseFromOracle,
  parseArgs,
} = require("./oracle-release-source");

function help() {
  console.log([
    "Usage:",
    "  node tools/cloudbase/pull-release-from-oracle.js [--oracle-base-url=https://class.katelya.eu.org]",
    "",
    "Options:",
    "  --oracle-base-url=<url>       Oracle API/static origin, default https://class.katelya.eu.org",
    `  --output-root=<path>          local cache root, default ${DEFAULT_OUTPUT_ROOT}`,
    "  --concurrency=<n>             max parallel downloads, default 5",
    "  --retry-count=<n>             retry attempts per file, default 3",
    "  --max-single-file-bytes=<n>   max bytes per file",
    "  --max-total-bytes=<n>         max total manifest-declared bytes",
  ].join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    help();
    return;
  }
  const result = await downloadReleaseFromOracle({
    oracleBaseUrl: args["oracle-base-url"] || args.oracleBaseUrl,
    outputRoot: args["output-root"] || args.outputRoot,
    concurrency: args.concurrency,
    retryCount: args["retry-count"] || args.retryCount,
    maxSingleFileBytes: args["max-single-file-bytes"] || args.maxSingleFileBytes,
    maxTotalBytes: args["max-total-bytes"] || args.maxTotalBytes,
    onProgress: (progress) => {
      process.stderr.write([
        "download",
        `${progress.completed}/${progress.total}`,
        progress.status,
        progress.relativePath,
      ].join(" ") + "\n");
    },
  });
  console.log(JSON.stringify({
    success: true,
    pointerSource: result.pointerSource,
    term: result.term,
    releaseVersion: result.releaseVersion,
    cacheEpoch: result.cacheEpoch,
    forceRefreshToken: result.forceRefreshToken,
    releaseDir: result.releaseDir,
    fileCount: result.fileCount,
    totalSize: result.totalSize,
    checkedFiles: result.verification.local.checkedFiles.length,
    samples: result.verification.local.samples,
    emptyRoomCount: result.verification.local.emptyRoomCount,
    privacyScan: result.verification.privacy.success,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    code: error.code || "ORACLE_RELEASE_PULL_FAILED",
    message: error.message,
    status: error.status || undefined,
    findings: error.findings || undefined,
  }, null, 2));
  process.exit(1);
});
