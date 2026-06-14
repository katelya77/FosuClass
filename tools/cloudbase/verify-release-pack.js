#!/usr/bin/env node

const {
  parseArgs,
  scanPrivacy,
  verifyLocalReleasePack,
  verifyRemoteReleasePack,
} = require("./release-pack-utils");

function help() {
  console.log([
    "Usage:",
    "  node tools/cloudbase/verify-release-pack.js --release-version=<version>",
    "  node tools/cloudbase/verify-release-pack.js --release-version=<version> --remote-base-url=<url>",
    "",
    "Options:",
    "  --public-root=<path>          local public Release Pack root",
    "  --release-version=<version>   releaseVersion to verify",
    "  --remote-base-url=<url>       optional CloudBase Hosting base URL for remote sampling",
  ].join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    help();
    return;
  }
  const releaseVersion = args["release-version"] || args.releaseVersion;
  const local = verifyLocalReleasePack({
    publicRoot: args["public-root"],
    releaseVersion,
  });
  const privacy = scanPrivacy(local.releaseDir);
  let remote = null;
  if (args["remote-base-url"] || args.remoteBaseUrl) {
    remote = await verifyRemoteReleasePack({
      publicRoot: args["public-root"],
      releaseVersion,
      hostingBaseUrl: args["remote-base-url"] || args.remoteBaseUrl,
    });
  }
  console.log(JSON.stringify({
    success: true,
    releaseVersion,
    releaseDir: local.releaseDir,
    samples: local.samples,
    checkedFiles: local.checkedFiles.length,
    emptyRoomCount: local.emptyRoomCount,
    privacyScan: privacy.success,
    remote,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    code: error.code || "CLOUDBASE_RELEASE_VERIFY_FAILED",
    message: error.message,
    findings: error.findings || undefined,
  }, null, 2));
  process.exit(1);
});
