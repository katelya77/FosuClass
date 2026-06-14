#!/usr/bin/env node

const {
  ENV_ID,
  parseArgs,
  pruneRemoteReleasePack,
} = require("./release-pack-utils");

function help() {
  console.log([
    "Usage:",
    "  node tools/cloudbase/prune-release-pack.js --dry-run",
    "  node tools/cloudbase/prune-release-pack.js --execute --confirm=CONFIRM_DELETE_CLOUDBASE_OLD_RELEASES",
    "",
    "Options:",
    `  --env-id=<id>             CloudBase env id, default ${ENV_ID}`,
    "  --hosting-base-url=<url>  CloudBase hosting origin used to read runtime/active.json",
    "  --keep-latest=<n>         stable releases to keep, default 3",
    "  --keep=a,b,c              extra releaseVersion values to preserve",
    "  --execute                 actually call tcb hosting delete",
    "  --confirm=<text>          must equal CONFIRM_DELETE_CLOUDBASE_OLD_RELEASES with --execute",
    "  --dry-run                 print deletion plan only (default)",
  ].join("\n"));
}

function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    help();
    return;
  }
  const plan = await pruneRemoteReleasePack({
    envId: args["env-id"] || ENV_ID,
    hostingBaseUrl: args["hosting-base-url"] || args.hostingBaseUrl,
    keepLatest: args["keep-latest"] || args.keepLatest || 3,
    keep: splitList(args.keep),
    execute: args.execute === true,
    dryRun: args.execute !== true,
    confirm: args.confirm || args.confirmation,
  });
  console.log(JSON.stringify(plan, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    code: error.code || "CLOUDBASE_RELEASE_PRUNE_FAILED",
    message: error.message,
    plan: error.plan || null,
  }, null, 2));
  process.exit(1);
});
