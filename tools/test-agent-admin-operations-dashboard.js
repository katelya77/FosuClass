#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createPlatformAdminHandlers } = require("../apps/agent-admin");

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

async function run() {
  const handlers = createPlatformAdminHandlers({
    getPlatformDiagnostics: async () => ({}),
    listRecentPlatformTraces: () => [],
    listDurableRunTraces: async () => [],
    getExecutionPolicy: () => ({}),
    getOperationsSnapshot: async (environment) => ({
      overallStatus: "degraded",
      environment,
      deploymentSha: "0123456789abcdef",
      configVersion: "cfg-trial-0002-abc",
      provider: {
        name: "deepseek",
        configured: true,
        verified: false,
        reachable: false,
        lastProbeAt: "",
        lastSuccessAt: "",
        circuitState: "closed",
      },
      metrics15m: { successRate: null, p50Ms: null, p95Ms: null, sampleCount: 0 },
      runningRuns: 0,
      stores: {
        memory: { backend: "file", status: "not_probed" },
        rag: { backend: "file", status: "not_probed" },
        queue: { backend: "embedded", status: "available" },
        postgresql: { status: "not_configured" },
        redis: { status: "not_configured" },
      },
      tools: { available: 9, total: 9 },
      checkedAt: "2026-08-02T02:00:00.000Z",
    }),
    runOperationsSmokeTest: async (environment) => ({
      environment,
      ok: false,
      checks: [{
        id: "trial_provider",
        status: "failed",
        verificationType: "real-provider-probe",
        durationMs: 42,
        reasonCode: "PROVIDER_UNVERIFIED",
      }],
    }),
  });
  const res = responseRecorder();
  await handlers.getOperations({ query: { environment: "trial" } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.payload.operations.environment, "trial");
  assert.strictEqual(res.payload.operations.provider.configured, true);
  assert.strictEqual(res.payload.operations.provider.verified, false);
  assert.strictEqual(res.payload.operations.provider.reachable, false);
  assert.strictEqual(res.payload.operations.metrics15m.p50Ms, null, "no samples must not render fake 0 ms");

  const smokeRes = responseRecorder();
  await handlers.postSmokeTest({ body: { environment: "trial" } }, smokeRes);
  assert.strictEqual(smokeRes.payload.ok, false, "a failed real probe must not be reported as success");
  assert.strictEqual(smokeRes.payload.checks[0].verificationType, "real-provider-probe");
  assert.strictEqual(smokeRes.payload.checks[0].reasonCode, "PROVIDER_UNVERIFIED");

  const html = fs.readFileSync(path.join(__dirname, "../apps/agent-admin/public/agent-platform.html"), "utf8");
  [
    "助手运行中心",
    "运行概览",
    "一键诊断",
    "Run 监控",
    "记忆运行状态",
    "能力管理",
    "高级配置",
    "已配置",
    "已验证",
    "当前可达",
    "最近成功",
  ].forEach((label) => assert.ok(html.includes(label), `operations UI missing: ${label}`));
  assert.ok(html.indexOf("运行概览") < html.indexOf("高级配置"), "runtime truth must precede raw config");
  assert.ok(!/height\s*[:=]\s*["']?6000/i.test(html), "must not use a fixed 6000px iframe workaround");
  console.log("test-agent-admin-operations-dashboard: PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
