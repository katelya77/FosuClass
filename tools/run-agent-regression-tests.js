#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const toolsDir = path.join(root, "tools");
const discovered = fs.readdirSync(toolsDir)
  .filter((name) => /^(test-ai-|test-xiaofu-|test-agent-).+\.js$/.test(name))
  .map((name) => `tools/${name}`);
const additional = [
  "tools/test-knowledge-control-plane.js",
  "tools/test-assistant-kb-service.js",
  "tools/test-assistant-mode-switch.js",
  "tools/test-assistant-env-version-routing.js",
  "tools/test-assistant-local-rules-seed.js",
  "tools/test-assistant-kb-seed.js",
  "tools/test-fosu-rag-knowledge-base.js",
  "tools/test-cloudbase-ai-router.js",
  "tools/test-public-ai-safety.js",
  "tools/test-server-ai-module-require.js",
  "tools/test-server-no-root-shared-require.js"
];
const tests = Array.from(new Set(discovered.concat(additional))).sort();

let passed = 0;
for (const file of tests) {
  console.log(`\n[agent-regression] ${file}`);
  const result = spawnSync(process.execPath, [path.join(root, file)], {
    cwd: root,
    env: Object.assign({}, process.env, { AI_AGENT_ENABLED: "false" }),
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`Agent regression tests failed: ${passed}/${tests.length} passed; failure=${file}`);
    process.exit(result.status || 1);
  }
  passed += 1;
}

console.log(`\nAgent regression tests passed: ${passed}/${tests.length}`);
