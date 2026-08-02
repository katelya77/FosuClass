#!/usr/bin/env node
const assert = require("assert");

const { createProviderRuntime } = require("../packages/provider-runtime");
const providerChainService = require("../server/src/services/ai/providerChainService");
const {
  createProviderOperationsLogService,
  findLatestDurableProviderAttempt,
} = require("../server/src/services/ai/providerOperationsLogService");

async function testRuntimeObserverReceivesRealAttempts() {
  const observed = [];
  const runtime = createProviderRuntime({
    adapters: [{
      id: "deepseek",
      async generateStructured() {
        return { contract: { ok: true } };
      },
    }],
    onEvent(event) { observed.push(event); },
  });
  await runtime.generateStructured({
    runtimeMode: "trial",
    intendedProvider: "deepseek",
    stage: "decision",
    timeoutMs: 1000,
  });
  assert.deepStrictEqual(observed.map((event) => event.type), [
    "provider.selected",
    "provider.started",
    "provider.completed",
  ]);
  assert.strictEqual(observed[2].status, "success");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(observed[2], "message"), false);
}

async function testHttpFailuresUseActionableOperationalCodes() {
  for (const [status, expected] of [[401, "PROVIDER_UNAUTHORIZED"], [429, "PROVIDER_RATE_LIMITED"]]) {
    const observed = [];
    const runtime = createProviderRuntime({
      adapters: [{
        id: "deepseek",
        async generateStructured() {
          const error = new Error("transport rejected");
          error.code = "ERR_BAD_REQUEST";
          error.status = status;
          throw error;
        },
      }],
      onEvent(event) { observed.push(event); },
    });
    await assert.rejects(runtime.generateStructured({
      runtimeMode: "trial",
      intendedProvider: "deepseek",
      stage: "decision",
      timeoutMs: 1000,
    }));
    const failed = observed.find((event) => event.type === "provider.failed");
    assert.strictEqual(failed.reasonCode, expected);
  }
}

function testRuntimeEventsUpdateReadinessProjection() {
  providerChainService.resetForTest();
  providerChainService.observeRuntimeEvent({
    type: "provider.started",
    provider: "deepseek",
    stage: "decision",
    status: "started",
  });
  providerChainService.observeRuntimeEvent({
    type: "provider.completed",
    provider: "deepseek",
    stage: "decision",
    status: "success",
    latencyMs: 642,
  });
  const status = providerChainService.getStatus("trial", {
    AI_PROVIDER_CHAIN: "deepseek,mock",
    DEEPSEEK_API_KEY: "unit-test-key-not-real",
  }).find((item) => item.name === "deepseek");
  assert.strictEqual(status.verified, true);
  assert.strictEqual(status.health, "ok");
  assert.strictEqual(status.latencyMs, 642);
  const events = providerChainService.getRecentCallEvents(10);
  assert.ok(events.some((event) => event.status === "started" && event.stage === "decision"));
  assert.ok(events.some((event) => event.ok === true && event.latencyMs === 642));
}

async function testDurableEventsRemainQueryableAndSanitized() {
  const durableRuns = [{
    runId: "run_durable_1",
    requestId: "req_durable_1",
    runtimeMode: "trial",
    createdAtMs: Date.parse("2026-08-02T12:00:00.000Z"),
    events: [
      {
        eventId: "evt_started",
        type: "provider.started",
        sequence: 3,
        at: "2026-08-02T12:00:01.000Z",
        provider: "deepseek",
        stage: "decision",
        status: "started",
        providerUsed: true,
      },
      {
        eventId: "evt_failed",
        type: "provider.failed",
        sequence: 4,
        at: "2026-08-02T12:00:02.000Z",
        provider: "deepseek",
        stage: "decision",
        status: "failed",
        reasonCode: "PROVIDER_TIMEOUT",
        latencyMs: 1001,
        providerUsed: true,
      },
    ],
    rawMessage: "must-never-appear",
    openid: "must-never-appear",
  }];
  const service = createProviderOperationsLogService({
    listRunRecords: async () => durableRuns,
    getRecentCallEvents: () => [{
      at: "2026-08-02T11:59:59.000Z",
      provider: "coze",
      stage: "probe",
      kind: "probe",
      ok: true,
      latencyMs: 300,
      token: "must-never-appear",
    }],
  });

  const result = await service.list({ limit: 10 });
  assert.strictEqual(result.source, "durable-run-event-store+runtime-probe");
  assert.deepStrictEqual(result.events.slice(0, 2).map((event) => event.eventId), [
    "evt_failed",
    "evt_started",
  ]);
  assert.deepStrictEqual(result.events[0], {
    eventId: "evt_failed",
    at: "2026-08-02T12:00:02.000Z",
    runId: "run_durable_1",
    requestId: "req_durable_1",
    environment: "trial",
    provider: "deepseek",
    stage: "decision",
    status: "failed",
    ok: false,
    reasonCode: "PROVIDER_TIMEOUT",
    latencyMs: 1001,
    kind: "run",
  });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("must-never-appear"));

  const latestTrial = findLatestDurableProviderAttempt(durableRuns.concat({
    runId: "run_dev_newer",
    runtimeMode: "dev",
    events: [{
      eventId: "evt_dev_completed",
      type: "provider.completed",
      at: "2026-08-02T12:05:00.000Z",
      provider: "coze",
      stage: "response",
      status: "success",
      latencyMs: 50,
    }],
  }), "trial");
  assert.deepStrictEqual(latestTrial, {
    provider: "deepseek",
    at: "2026-08-02T12:00:02.000Z",
    status: "failed",
    stage: "decision",
    reasonCode: "PROVIDER_TIMEOUT",
  }, "operations truth must survive restart and remain isolated by environment");

  providerChainService.resetForTest();
  const afterRestart = await service.list({ limit: 10, after: "2026-08-02T12:00:00.500Z" });
  assert.strictEqual(afterRestart.events.length, 2,
    "durable provider events remain visible when the process-local projection is empty");
}

async function run() {
  await testRuntimeObserverReceivesRealAttempts();
  await testHttpFailuresUseActionableOperationalCodes();
  testRuntimeEventsUpdateReadinessProjection();
  await testDurableEventsRemainQueryableAndSanitized();
  console.log("test-agent-provider-live-operations: PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
