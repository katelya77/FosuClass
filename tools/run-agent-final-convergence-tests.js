#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");

const tests = [
  "tools/test-memory-upsert.js",
  "tools/test-agent-planner.js",
  "tools/test-planner-model-adapter.js",
  "tools/test-planner-model-adapter-http.js",
  "tools/test-planner-unified-provider-layer.js",
  "tools/test-agent-model-first-integration.js",
  "tools/test-agent-observation-loop.js",
  "tools/test-hybrid-rag.js",
  "tools/test-context-assembler.js",
  "tools/test-response-composer.js",
  "tools/test-xiaofu-final-ui.js",
  "tools/test-agent-e2e-matrix.js",
  "tools/test-agent-evaluation-120.js",
  "tools/test-agent-client-error-mapper.js",
  "tools/test-safe-markdown-renderer.js",
  "tools/test-course-reminder-agent-integration.js",
  "tools/test-course-action-agent.js",
  "tools/test-xiaofu-proactive-workspace.js",
];

let failed = 0;
for (const rel of tests) {
  const file = path.join(__dirname, "..", rel.replace(/^tools\//, "tools/"));
  const result = spawnSync(process.execPath, [path.resolve(__dirname, "..", rel)], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    failed += 1;
    console.error(`FAILED: ${rel}`);
  }
}

if (failed) {
  console.error(`agent-final-convergence: ${failed} failed`);
  process.exit(1);
}
console.log("agent-final-convergence: all passed");
