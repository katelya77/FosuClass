#!/usr/bin/env node

const {
  deployReleasePack,
  ENV_ID,
  parseArgs,
} = require("./release-pack-utils");

function help() {
  console.log([
    "Usage:",
    "  node tools/cloudbase/deploy-release-pack.js --release-version=<version> [--dry-run]",
    "  node tools/cloudbase/deploy-release-pack.js --release-version=<version> --execute --hosting-base-url=<url>",
    "",
    "Options:",
    `  --env-id=<id>                 CloudBase env id, default ${ENV_ID}`,
    "  --public-root=<path>          local public Release Pack root",
    "  --release-version=<version>   releaseVersion to deploy; defaults to current active release",
    "  --hosting-base-url=<url>      real CloudBase Hosting base URL for remote verification",
    "  --execute                     upload only releases/{releaseVersion}",
    "  --dry-run                     validate and print planned commands only (default)",
    "  --skip-unchanged              with --execute, skip upload when remote release already verifies identical (default)",
    "  --no-skip-unchanged           force upload even when remote release verifies identical",
    "  --skip-remote-verify          allow execute without remote HTTP verification",
  ].join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    help();
    return;
  }
  const result = await deployReleasePack({
    envId: args["env-id"] || ENV_ID,
    publicRoot: args["public-root"],
    releaseVersion: args["release-version"] || args.releaseVersion,
    hostingBaseUrl: args["hosting-base-url"] || args.hostingBaseUrl,
    execute: args.execute === true,
    dryRun: args.execute !== true,
    skipRemoteVerify: args["skip-remote-verify"] === true,
    skipUnchanged: args["no-skip-unchanged"] === true ? false : args.execute === true,
    concurrency: args.concurrency || 5,
    retryCount: args["retry-count"] || 3,
  });
  console.log(JSON.stringify({
    success: true,
    dryRun: result.dryRun,
    releaseVersion: result.releaseVersion,
    releaseDir: result.verification.releaseDir,
    samples: result.verification.samples,
    checkedFiles: result.verification.checkedFiles.length,
    privacyScan: result.privacy.success,
    planned: result.planned,
    uploaded: result.commands ? result.commands.length : 0,
    skipped: Boolean(result.skipped || result.unchanged),
    skipReason: result.skipReason || "",
    savedFiles: result.skipped ? result.planned.length : 0,
    pointerSource: result.pointer.source,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    code: error.code || "CLOUDBASE_RELEASE_DEPLOY_FAILED",
    message: error.message,
    findings: error.findings || undefined,
  }, null, 2));
  process.exit(1);
});
