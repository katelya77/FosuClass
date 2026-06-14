#!/usr/bin/env node

const {
  ENV_ID,
  parseArgs,
  pruneReleasePack,
} = require("./release-pack-utils");

function help() {
  console.log([
    "Usage:",
    "  node tools/cloudbase/prune-release-pack.js --dry-run",
    "  node tools/cloudbase/prune-release-pack.js --execute",
    "",
    "Options:",
    `  --env-id=<id>             CloudBase env id, default ${ENV_ID}`,
    "  --public-root=<path>      local public Release Pack root used to plan deletion",
    "  --keep-latest=<n>         stable releases to keep, default 3",
    "  --keep=a,b,c              extra releaseVersion values to preserve",
    "  --execute                 actually call tcb hosting delete",
    "  --dry-run                 print deletion plan only (default)",
  ].join("\n"));
}

function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    help();
    return;
  }
  const plan = pruneReleasePack({
    envId: args["env-id"] || ENV_ID,
    publicRoot: args["public-root"],
    keepLatest: args["keep-latest"] || args.keepLatest || 3,
    keep: splitList(args.keep),
    dryRun: args.execute !== true,
  });
  console.log(JSON.stringify(plan, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    code: error.code || "CLOUDBASE_RELEASE_PRUNE_FAILED",
    message: error.message,
  }, null, 2));
  process.exit(1);
}
