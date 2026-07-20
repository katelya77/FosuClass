#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tests = [
  "tools/test-agent-run-events.js",
  "tools/test-provider-readiness.js",
  "tools/test-provider-runtime-matrix.js",
  "tools/test-coze-provider-v3.js",
  "tools/test-xiaofu-runtime-ui.js",
  "tools/test-xiaofu-memory-integration.js",
];

let failed = 0;
for (const rel of tests) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(root, rel)], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  const ms = Date.now() - started;
  if (result.status === 0) {
    process.stdout.write(`[PASS] ${rel} (${ms}ms)\n`);
    if (result.stdout) process.stdout.write(result.stdout);
  } else {
    failed += 1;
    process.stdout.write(`[FAIL] ${rel} (${ms}ms)\n`);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
}

if (failed) {
  process.stderr.write(`run-agent-phase3-tests: ${failed} failed\n`);
  process.exit(1);
}
process.stdout.write("run-agent-phase3-tests: all passed\n");
