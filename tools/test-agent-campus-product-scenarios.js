#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const suites = [
  { id: "conversation", file: "tools/test-ai-conversation-rag-schedule.js", type: "local-integration" },
  { id: "http_memory", file: "tools/test-agent-e2e-release-scenarios.js", type: "local-http-integration" },
  { id: "kernel", file: "tools/test-agent-e2e-matrix.js", type: "kernel-integration-with-deterministic-fixtures" },
  { id: "search", file: "tools/test-search-contract-unified.js", type: "release-pack-contract" },
  { id: "provider_faults", file: "tools/test-agent-fallback-eligibility.js", type: "structural-fault-injection" },
  { id: "run_protocol", file: "tools/test-agent-run-protocol.js", type: "run-store-integration" },
  { id: "local_fallback", file: "tools/test-agent-local-tool-fallback.js", type: "miniprogram-local-integration" },
  { id: "diagnostics", file: "tools/test-agent-real-device-diagnostics-contract.js", type: "network-contract-fault-injection" },
  { id: "environment", file: "tools/test-agent-env-version-propagation.js", type: "client-server-integration" },
  { id: "memory_semantics", file: "tools/test-agent-memory-semantic-validator.js", type: "memory-boundary-integration" },
  { id: "memory_migration", file: "tools/test-agent-memory-invalid-migration.js", type: "encrypted-store-migration" },
];

const scenarios = [
  ["你好", "kernel"], ["你能做什么", "conversation"], ["查教师课表", "kernel"],
  ["查陈芳老师本周课表", "search"], ["周三呢", "http_memory"], ["换成第16周", "conversation"],
  ["查25动医6课表", "conversation"], ["25动医存在多个候选", "search"], ["查某间教室", "conversation"],
  ["查某门课程", "conversation"], ["今天有什么课", "kernel"], ["明天有什么课", "kernel"],
  ["找连续两节空教室", "kernel"], ["空教室加天气组合任务", "http_memory"], ["当前教学周", "kernel"],
  ["校园办事知识 RAG", "conversation"], ["记住我常在仙溪校区", "http_memory"], ["你能记住什么", "memory_semantics"],
  ["我叫什么", "memory_semantics"], ["纠正称呼", "memory_semantics"], ["设置默认提醒", "http_memory"],
  ["Provider timeout", "provider_faults"], ["Provider 401", "provider_faults"], ["Provider 429", "provider_faults"],
  ["VPS 不可达", "diagnostics"], ["Run poll 中断后恢复", "run_protocol"], ["小程序重开后恢复 active Run", "run_protocol"],
  ["public 外部调用保持 0", "environment"], ["trial 绑定 trial configVersion", "environment"], ["服务器异常时本地课表接管", "local_fallback"],
  ["无重复终态和错误卡片", "local_fallback"], ["旧错误记忆安全迁移", "memory_migration"],
];

function runSuite(suite) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [suite.file], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== 0) {
        reject(new Error(`${suite.id} failed (${suite.file}); code=${code}; signal=${signal || "none"}`));
        return;
      }
      resolve({ id: suite.id, file: suite.file, verificationType: suite.type, ok: true });
    });
  });
}

async function main() {
  const results = [];
  for (const suite of suites) results.push(await runSuite(suite));
  const passed = new Set(results.filter((item) => item.ok).map((item) => item.id));
  scenarios.forEach(([name, suiteId]) => assert.ok(passed.has(suiteId), `${name}: missing passing evidence ${suiteId}`));
  const byType = Object.fromEntries(results.map((item) => [item.id, item.verificationType]));
  console.log(JSON.stringify({
    ok: true,
    scenarioCount: scenarios.length,
    scenarios: scenarios.map(([name, suiteId]) => ({ name, evidenceSuite: suiteId, verificationType: byType[suiteId] })),
    note: "No real-device or real-provider pass is claimed by this local scenario gate.",
  }, null, 2));
  console.log(`test-agent-campus-product-scenarios: PASS (${scenarios.length} scenarios)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
