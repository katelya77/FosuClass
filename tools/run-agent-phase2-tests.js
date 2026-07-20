#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const tests = [
  "tools/test-conversation-memory.js",
  "tools/test-kb-control-plane-v2.js",
  "tools/test-kb-mcp.js",
  "tools/test-xiaofu-agent-ui-v2.js",
  "tools/test-knowledge-control-plane.js",
  "tools/test-ai-assistant-minimal-ui.js",
  "tools/test-ai-assistant-ui-layout.js",
  "tools/test-campus-assistant-copy-audit.js",
];

let failed = 0;
tests.forEach((rel) => {
  console.log(`\n[agent-phase2] ${rel}`);
  const result = spawnSync(process.execPath, [path.join(ROOT, rel)], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    failed += 1;
    console.error(`FAILED ${rel} exit=${result.status}`);
  }
});

if (failed) {
  console.error(`\nAgent phase2 tests failed: ${failed}/${tests.length}`);
  process.exit(1);
}
console.log(`\nAgent phase2 tests passed: ${tests.length}/${tests.length}`);
