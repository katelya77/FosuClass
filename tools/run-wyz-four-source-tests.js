"use strict";
const { spawnSync } = require("child_process");
const tests = ["test-schedule-collector", "test-collector-scheduling", "test-wyz-collector", "test-four-direct-source-production", "test-four-direct-adapters", "test-sync-operations-plan", "test-staging-fingerprint", "test-staging-upload", "test-fosu-publisher", "test-cloudbase-preflight-config", "test-cloudbase-release-tools", "test-cloudbase-static-origin", "test-release-pack-cache-switch", "test-school-static-search", "test-search-contract-unified", "test-teacher-search-contract-unified", "test-school-stable-release-pack", "test-schedule-week-state-isolation", "test-empty-room-classroom-resolver", "test-personal-sync-direct-mode", "test-personal-sync-xls-only", "test-personal-sync-term-options", "test-personal-routes-xls-only-server"];
for (const name of tests) {
  const result = spawnSync(process.execPath, ["tools/" + name + ".js"], { stdio: "inherit", windowsHide: true, timeout: 180000 });
  if (result.status !== 0) { console.error("FAILED:" + name); process.exit(result.status || 1); }
}
console.log("wyz-four-source: " + tests.length + " suites PASS; fixture/local validation only");
