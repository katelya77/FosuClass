#!/usr/bin/env node

const staticReleaseSyncService = require("../server/src/services/staticReleaseSyncService");

function parseArgs(argv) {
  const args = {};
  argv.forEach((item) => {
    if (!item.startsWith("--")) return;
    const body = item.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex >= 0) {
      args[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
    } else {
      args[body] = true;
    }
  });
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log([
      "Usage: npm run sync:static-release -- --version=<releaseVersion>",
      "",
      "Environment:",
      "  RELEASE_PACK_SRC=/home/ubuntu/FosuClass/server/storage/public/releases",
      "  OPENRESTY_STATIC_RELEASE_DIR=/opt/1panel/www/sites/class.katelya.eu.org/index/static/releases",
      "  PUBLIC_BASE_URL=https://class.katelya.eu.org/static/releases",
      "  STATIC_RELEASE_KEEP_LATEST=3",
    ].join("\n"));
    return;
  }

  const version = args.version || args.releaseVersion || "";
  const status = await staticReleaseSyncService.syncStaticRelease(version, {
    config: args["no-http-verify"] ? { verifyHttp: false } : undefined,
  });
  console.log(JSON.stringify({
    success: true,
    releaseVersion: status.releaseVersion,
    status: status.status,
    staticManifestUrl: status.staticManifestUrl,
    staticClassIndexUrl: status.staticClassIndexUrl,
    staticEmptyRoomIndexUrl: status.staticEmptyRoomIndexUrl,
    keptReleases: status.keptReleases,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    code: error.code || "STATIC_SYNC_FAILED",
    message: error.message,
  }, null, 2));
  process.exit(1);
});
