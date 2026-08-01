#!/usr/bin/env node
"use strict";

const assert = require("assert");
const mockEnv = require("./mock-env");
const { createAgentRunShell } = require("../miniprogram/services/agentRunShell");
const { createRunHandlers } = require("../apps/agent-server/src/createRunHandlers");
const requestContextAssembler = require("../server/src/services/ai/runtime/requestContextAssembler");
const runtimeModeService = require("../server/src/services/ai/runtimeModeService");
const agentReadinessService = require("../server/src/services/ai/agentReadinessService");
const platformComposition = require("../server/src/services/ai/platformComposition");

const checks = [];
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    checks.push(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    checks.push(`FAIL ${name}: ${error && error.message}`);
  }
}

function withRuntimeEnv(patch, fn) {
  const keys = Object.keys(patch);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => {
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = String(patch[key]);
  });
  const finish = () => keys.forEach((key) => {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  });
  try {
    const value = fn();
    if (value && typeof value.then === "function") return value.finally(finish);
    finish();
    return value;
  } catch (error) {
    finish();
    throw error;
  }
}

function createStorage() {
  const map = new Map();
  return {
    get: (key) => map.get(key) || null,
    set: (key, value) => map.set(key, value),
    remove: (key) => map.delete(key),
  };
}

function terminalBackend() {
  const calls = [];
  return {
    calls,
    async request(req) {
      calls.push(req);
      if (req.method === "POST" && req.path === "/api/ai/agent/runs") {
        return {
          status: 202,
          json: {
            success: true,
            runId: "run_env",
            pollToken: "poll_env",
            status: "queued",
            eventCursor: 0,
            nextPollMs: 1,
            protocolVersion: "agent.v2",
            capabilities: { cursorResume: true },
          },
        };
      }
      if (req.method === "GET" && req.path === "/api/ai/agent/runs/run_env") {
        return {
          status: 200,
          json: {
            success: true,
            runId: "run_env",
            status: "completed",
            eventCursor: 1,
            nextPollMs: 0,
            events: [{ type: "run.completed", sequence: 1, eventId: "evt_env" }],
            result: { success: true, runtimeMode: "trial", answer: "ok" },
          },
        };
      }
      return { status: 404, json: { code: "RUN_NOT_FOUND" } };
    },
  };
}

function fakeRunDependencies(capture) {
  const repository = {
    createRun() {}, createEventEmitter() {}, getRunView() {}, cancelRun() {}, isCancelled() {}, setResult() {},
    statusFromResult() { return "completed"; },
  };
  return {
    platform: {
      async executeTurn(input) {
        capture.input = input;
        return { success: true, runtimeMode: input.runtimeMode, answer: "ok" };
      },
    },
    runRepository: repository,
    protocol: { createRequestId: () => "req_server" },
    agui: { mapRunToAguiEvents: () => [], serializeSse: () => "" },
    buildFailureResponse: () => ({ success: false }),
  };
}

function fakeResponse() {
  return {
    statusCode: 200,
    payload: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
    send(payload) { this.payload = payload; return payload; },
  };
}

async function main() {
  await check("HTTP 202 is a successful Run create and trusted API receives the single env header", async () => {
    mockEnv.clearStorage();
    global.wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: "trial" } });
    let calls = 0;
    let capturedHeader = null;
    global.wx.mockRequest = (options) => {
      calls += 1;
      capturedHeader = options.header;
      options.success({
        statusCode: 202,
        data: { success: true, runId: "run_202", pollToken: "poll_202", status: "queued" },
      });
    };
    const http = require("../miniprogram/utils/request");
    const payload = await http.post("/api/ai/agent/runs", { message: "你好" }, {
      showLoading: false,
      silentError: true,
      retries: 2,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 1,
    });
    assert.strictEqual(payload.runId, "run_202");
    assert.strictEqual(calls, 1, "a valid 202 must never be retried");
    assert.strictEqual(capturedHeader["X-Fosu-Env-Version"], "trial");
    assert.strictEqual(http.getRequestDiagnostics().currentHealth, "online");
  });

  await check("environment header is never leaked to an untrusted absolute URL", async () => {
    let capturedHeader = null;
    global.wx.mockRequest = (options) => {
      capturedHeader = options.header;
      options.success({ statusCode: 200, data: { success: true } });
    };
    const http = require("../miniprogram/utils/request");
    await http.get("https://example.invalid/health", {}, { showLoading: false, silentError: true, retries: 0 });
    assert.strictEqual(capturedHeader["X-Fosu-Env-Version"], undefined);
  });

  await check("Run shell defaults idempotencyKey to requestId so one question creates one Run", async () => {
    const backend = terminalBackend();
    let now = 0;
    const shell = createAgentRunShell({
      request: backend.request,
      storage: createStorage(),
      sleep: (ms) => { now += Number(ms) || 0; return Promise.resolve(); },
      now: () => now,
      maxWaitMs: 1000,
    });
    const result = await shell.startRun({ message: "你好", requestId: "req-one-question" });
    assert.strictEqual(result.status, "completed");
    const creates = backend.calls.filter((call) => call.method === "POST" && call.path === "/api/ai/agent/runs");
    assert.strictEqual(creates.length, 1);
    assert.strictEqual(creates[0].body.idempotencyKey, "req-one-question");
  });

  await check("server-authorized env context survives platformInput and defensive request assembly", async () => withRuntimeEnv({
    AI_RUNTIME_MODE: "trial",
    AI_PROVIDER_ACTIVE_ENV: "trial",
    AI_COMPETITION_ALLOW_TRIAL_ENV: "true",
    AI_COMPETITION_REQUIRE_SESSION: "false",
    AI_ENHANCED_REQUIRE_SESSION: "false",
  }, async () => {
    const capture = {};
    const handlers = createRunHandlers(fakeRunDependencies(capture));
    const req = {
      body: { message: "你好", context: {} },
      headers: {},
      query: {},
      agentRuntimeDecision: { runtimeMode: "trial", configuredMode: "trial", authorized: true },
      agentRuntimeContext: { envVersion: "trial", miniprogramVersion: "trial" },
    };
    await handlers.chatCompat(req, fakeResponse());
    assert.strictEqual(capture.input.context.envVersion, "trial");
    const prepared = requestContextAssembler.prepareRequest(capture.input);
    assert.strictEqual(prepared.runtimeDecision.runtimeMode, "trial");
  }));

  await check("develop binds dev, trial binds trial, and release always binds public", async () => {
    for (const row of [
      { configured: "dev", envVersion: "develop", expected: "dev" },
      { configured: "trial", envVersion: "trial", expected: "trial" },
      { configured: "trial", envVersion: "release", expected: "public" },
    ]) {
      await withRuntimeEnv({
        AI_RUNTIME_MODE: row.configured,
        AI_PROVIDER_ACTIVE_ENV: row.configured,
        AI_COMPETITION_ALLOW_TRIAL_ENV: "true",
        AI_COMPETITION_REQUIRE_SESSION: "false",
        AI_ENHANCED_REQUIRE_SESSION: "false",
      }, async () => {
        const decision = runtimeModeService.resolveRuntimeMode({ context: { envVersion: row.envVersion } });
        assert.strictEqual(decision.runtimeMode, row.expected, JSON.stringify(row));
      });
    }
  });

  await check("readiness runtime and Run config snapshot environment stay identical", async () => {
    for (const row of [
      { configured: "dev", envVersion: "develop", expected: "dev" },
      { configured: "trial", envVersion: "trial", expected: "trial" },
      { configured: "trial", envVersion: "release", expected: "public" },
    ]) {
      await withRuntimeEnv({
        AI_RUNTIME_MODE: row.configured,
        AI_PROVIDER_ACTIVE_ENV: row.configured,
        AI_COMPETITION_ALLOW_TRIAL_ENV: "true",
        AI_COMPETITION_REQUIRE_SESSION: "false",
        AI_ENHANCED_REQUIRE_SESSION: "false",
      }, async () => {
        const readiness = agentReadinessService.resolveRequestReadiness({ context: { envVersion: row.envVersion } });
        const snapshotEnvironment = platformComposition.resolveSnapshotEnvironment({ runtimeMode: readiness.runtimeMode });
        await platformComposition.initPlatform();
        const snapshot = await platformComposition.getConfigKernel().getCurrentSnapshot(snapshotEnvironment);
        assert.strictEqual(readiness.runtimeMode, row.expected, JSON.stringify(row));
        assert.strictEqual(snapshot.environment, readiness.runtimeMode, JSON.stringify({ row, readiness, snapshot }));
        assert.match(snapshot.configVersion, new RegExp(`^cfg-${row.expected}-`));
      });
    }
  });

  await check("a forged trial env cannot bypass the existing enhanced-session policy", async () => withRuntimeEnv({
    AI_RUNTIME_MODE: "trial",
    AI_PROVIDER_ACTIVE_ENV: "trial",
    AI_COMPETITION_ALLOW_TRIAL_ENV: "true",
    AI_COMPETITION_REQUIRE_SESSION: "true",
    AI_ENHANCED_REQUIRE_SESSION: "true",
    AI_COMPETITION_ALLOW_ALL_SESSIONS: "false",
    AI_COMPETITION_OPENID_HASH_PREFIXES: undefined,
    AI_COMPETITION_CAPABILITY_TOKEN_SHA256: undefined,
  }, async () => {
    const forged = runtimeModeService.resolveRuntimeMode({
      context: { envVersion: "trial", runtimeMode: "trial", serverSession: { openidHash: "client-forged" } },
      serverSession: null,
    });
    assert.strictEqual(forged.runtimeMode, "public");
    assert.strictEqual(forged.authorized, false);
  }));

  delete global.wx.mockRequest;
  checks.forEach((line) => console.log(line));
  if (failures) {
    console.error(`test-agent-env-version-propagation failed: ${failures} check(s)`);
    process.exit(1);
  }
  console.log(`test-agent-env-version-propagation passed: ${checks.length} checks`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
