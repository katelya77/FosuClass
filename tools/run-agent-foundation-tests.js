#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tests = [
  "tools/test-capability-contract.js",
  "tools/test-xiaofu-action-bus.js",
  "tools/test-coze-tool-gateway.js",
  "tools/test-ai-voice-transcribe.js",
  "tools/test-agent-capability-manifest.js",
  "tools/test-agent-protocol-v2.js",
  "tools/test-agent-runtime-boundaries.js",
  "tools/test-agent-kernel-foundation.js",
  "tools/test-agent-trace-redaction.js",
  "tools/test-agent-trace-integration.js",
  "tools/test-agent-factual-evidence-v2.js",
  "tools/test-agent-capabilities-endpoint.js",
  "tools/test-xiaofu-online-server-first-v2.js",
  "tools/test-knowledge-control-plane.js",
  "tools/test-agent-prompt-injection-v2.js",
  "tools/test-ai-agent-protocol-v1.js",
  "tools/test-ai-agent-safety.js",
  "tools/test-ai-clarification-followup.js",
  "tools/test-ai-context-week-fields.js",
  "tools/test-ai-conversation-rag-schedule.js",
  "tools/test-assistant-kb-service.js",
  "tools/test-agent-personal-memory.js",
  "tools/test-agent-context-memory-flow.js"
];

let passed = 0;
for (const file of tests) {
  console.log(`\n[agent-foundation] ${file}`);
  const result = spawnSync(process.execPath, [path.join(root, file)], {
    cwd: root,
    env: Object.assign({}, process.env, {
      AI_AGENT_ENABLED: "false",
      AI_COMPETITION_ALLOW_ALL_SESSIONS: "true",
      // When suite inherits AI_RUNTIME_MODE=competition without active env, map to trial.
      AI_PROVIDER_ACTIVE_ENV: process.env.AI_PROVIDER_ACTIVE_ENV || "trial",
    }),
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`Agent foundation tests failed: ${passed}/${tests.length} passed; failure=${file}`);
    process.exit(result.status || 1);
  }
  passed += 1;
}

console.log(`\nAgent foundation tests passed: ${passed}/${tests.length}`);
