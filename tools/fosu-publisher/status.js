#!/usr/bin/env node

const {
  formatLockStatus,
  inspectPublisherLock,
} = require("./publish");

function main() {
  const status = inspectPublisherLock();
  formatLockStatus(status).forEach((line) => console.log(line));
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  main,
};
