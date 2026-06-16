#!/usr/bin/env node

const {
  formatLockStatus,
  inspectPublisherLock,
  reconcilePublisherLock,
  removePublisherLock,
} = require("./publish");

function parseArgs(argv = []) {
  return argv.reduce((acc, item) => {
    if (item === "--dry-run") acc.dryRun = true;
    if (item === "--force") acc.force = true;
    return acc;
  }, { dryRun: false, force: false });
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const status = inspectPublisherLock();
  formatLockStatus(status).forEach((line) => console.log(line));
  if (!status.locked) {
    console.log("unlock: no lock to remove");
    return 0;
  }
  if (status.isPublisherProcess && !status.canUnlock) {
    console.error("unlock: 已有同步正在运行，拒绝删除锁。请运行 npm run publisher:status 查看。");
    return 2;
  }
  if (args.dryRun) {
    console.log(`unlock: dry-run, would ${status.canUnlock || args.force ? "remove" : "keep"} lock (${status.reason})`);
    return 0;
  }
  const result = status.canUnlock
    ? reconcilePublisherLock()
    : (args.force ? removePublisherLock("force") : Object.assign({}, status, { removed: false }));
  if (!result.removed) {
    console.error("unlock: 无法安全判断锁状态；如确认没有 Publisher 在运行，可追加 --force。");
    return 1;
  }
  console.log(`unlock: removed lock (${result.removedReason || result.reason})`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  main,
  parseArgs,
};
