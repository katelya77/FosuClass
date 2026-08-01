#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createPlatformAdminHandlers } = require("../apps/agent-admin");
const { createAgentTraceRecorder } = require("../server/src/services/ai/agentTraceRecorder");
const { createJournalRunStore } = require("../server/src/services/ai/persistence/journalRunStore");

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

async function run() {
  let durableQueries = 0;
  const durable = [{
    traceId: "trace-durable",
    runId: "run-after-restart",
    requestId: "req-device-01",
    environment: "trial",
    runtimeMode: "trial",
    configVersion: "cfg-trial-0007-deadbeefcafe",
    intent: "teacher_schedule_query",
    selectedSkill: "teacher-schedule",
    toolCalls: [{ name: "query_teacher_schedule", status: "failed" }],
    provider: "deepseek",
    externalProviderUsed: true,
    fallbackLayer: "provider",
    failureLayer: "provider",
    errorCode: "PROVIDER_TIMEOUT",
    status: "failed",
    totalDurationMs: 2500,
    recordedAt: "2026-08-02T02:00:00.000Z",
  }];
  const handlers = createPlatformAdminHandlers({
    getPlatformDiagnostics: async () => ({}),
    listRecentPlatformTraces: () => [{ runId: "process-only-must-not-win" }],
    listDurableRunTraces: async () => {
      durableQueries += 1;
      return durable;
    },
    getOperationsSnapshot: async () => ({}),
    runOperationsSmokeTest: async () => ({ ok: true, checks: [] }),
    getExecutionPolicy: () => ({}),
  });
  const res = responseRecorder();
  await handlers.getRecentRuns({
    query: {
      limit: "20",
      environment: "trial",
      status: "failed",
      provider: "deepseek",
      tool: "query_teacher_schedule",
      errorCode: "PROVIDER_TIMEOUT",
      from: "2026-08-02T01:00:00.000Z",
      to: "2026-08-02T03:00:00.000Z",
    },
  }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(durableQueries, 1, "admin query must use the durable trace store");
  assert.strictEqual(res.payload.count, 1);
  assert.strictEqual(res.payload.source, "durable-run-trace-store");
  assert.strictEqual(res.payload.runs[0].runId, "run-after-restart");
  assert.strictEqual(res.payload.runs[0].failureLayer, "provider");
  assert.ok(!JSON.stringify(res.payload).includes("process-only-must-not-win"));

  const emptyRes = responseRecorder();
  await handlers.getRecentRuns({ query: { environment: "public" } }, emptyRes);
  assert.strictEqual(emptyRes.payload.count, 0, "environment filter must be exact");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-admin-durable-trace-"));
  try {
    const firstStore = createJournalRunStore({ root });
    const firstRecorder = createAgentTraceRecorder({ store: firstStore });
    firstRecorder.record({
      runId: "run-persisted-before-restart",
      requestId: "req-persisted",
      environment: "trial",
      runtimeMode: "trial",
      configVersion: "cfg-trial-0008-feedfacecafe",
      intent: "teacher_schedule_query",
      provider: "deepseek",
      providerUsed: true,
      totalDurationMs: 318,
      status: "completed",
    });
    const restartedStore = createJournalRunStore({ root });
    const restartedRecorder = createAgentTraceRecorder({ store: restartedStore });
    if (restartedRecorder.persistenceReady) await restartedRecorder.persistenceReady;
    const afterRestart = await restartedRecorder.listRecent();
    assert.ok(afterRestart.some((trace) => trace.runId === "run-persisted-before-restart"),
      "journal hydration must retain traces after recorder restart");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("test-agent-admin-durable-run-query: PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
