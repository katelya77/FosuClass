#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const request = require("../miniprogram/utils/request");
const mapper = require("../miniprogram/services/agentClientErrorMapper");

const cases = [
  ["request:fail network is disconnected", "NETWORK_OFFLINE", "network"],
  ["request:fail err_name_not_resolved", "DNS_FAILED", "network"],
  ["request:fail ssl handshake error", "TLS_FAILED", "network"],
  ["request:fail url not in domain list", "WECHAT_DOMAIN_NOT_ALLOWED", "wechat"],
  ["request:fail connect timeout", "CONNECT_TIMEOUT", "network"],
  ["request:fail timeout", "REQUEST_TIMEOUT", "network"],
  ["request:fail", "WECHAT_NETWORK_REQUEST_FAILED", "wechat"],
];

cases.forEach(([errMsg, expectedCode, expectedLayer]) => {
  const error = request.normalizeRequestError({ errMsg }, {
    url: "/api/ai/agent/runs?sessionToken=secret",
    elapsedMs: 123,
  });
  assert.strictEqual(error.code, expectedCode, errMsg);
  assert.strictEqual(error.reasonCode, expectedCode, errMsg);
  assert.strictEqual(error.failureLayer, expectedLayer, errMsg);
  assert.strictEqual(error.elapsedMs, 123);
  assert.ok(error.safeErrMsg.length > 0);
  assert.ok(!error.url.includes("secret"));
});

const http4xx = request.normalizeRequestError(new Error("HTTP 401"), {
  url: "/api/ai/agent/runs",
  statusCode: 401,
  payload: { code: "FOSU_SESSION_INVALID", requestId: "req-http" },
  elapsedMs: 45,
});
assert.strictEqual(http4xx.code, "FOSU_SESSION_INVALID");
assert.strictEqual(http4xx.failureLayer, "session");
assert.strictEqual(http4xx.statusCode, 401);
assert.strictEqual(http4xx.requestId, "req-http");

const mappedCodes = [
  "NETWORK_OFFLINE",
  "DNS_FAILED",
  "TLS_FAILED",
  "WECHAT_DOMAIN_NOT_ALLOWED",
  "CONNECT_TIMEOUT",
  "REQUEST_TIMEOUT",
  "HTTP_4XX",
  "HTTP_5XX",
  "FOSU_SESSION_REQUIRED",
  "FOSU_SESSION_INVALID",
  "RUNTIME_NOT_AUTHORIZED",
  "RUN_CREATE_FAILED",
  "RUN_POLL_FAILED",
  "RUN_EXPIRED",
  "RUN_EXECUTOR_LOST",
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_UNVERIFIED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAUTHORIZED",
  "PROVIDER_RATE_LIMITED",
  "TOOL_FAILED",
  "MEMORY_STORE_UNAVAILABLE",
];

mappedCodes.forEach((code) => {
  const mapped = mapper.mapAgentError({ code });
  assert.strictEqual(mapped.code, code);
  assert.ok(/[\u4e00-\u9fff]/.test(mapped.userMessage), `${code} needs a Chinese action message`);
  assert.ok(!/UNKNOWN|undefined|\bnull\b/.test(mapped.userMessage));
});

const ambiguous = mapper.mapAgentError({ errMsg: "request:fail" });
assert.strictEqual(ambiguous.code, "WECHAT_NETWORK_REQUEST_FAILED");
assert.ok(ambiguous.userMessage.includes("微信网络层请求失败"));

const sanitized = request.normalizeRequestError({
  errMsg: "request:fail token=abc123 Authorization=Bearer-xyz\nsecond line",
}, { url: "/api/ai/agent/runs" });
assert.ok(!sanitized.safeErrMsg.includes("abc123"));
assert.ok(!sanitized.safeErrMsg.includes("Bearer-xyz"));
assert.ok(!sanitized.safeErrMsg.includes("\n"));

const diagnostics = require("../miniprogram/services/agentConnectionDiagnostics");
assert.strictEqual(diagnostics.isDiagnosticsVisible("release"), false, "release must not expose diagnostics");
assert.strictEqual(diagnostics.isDiagnosticsVisible("trial"), true);
assert.strictEqual(diagnostics.isDiagnosticsVisible("develop"), true);

let diagnosticsComponent = null;
global.Component = (definition) => { diagnosticsComponent = definition; };
require("../miniprogram/packageXiaofu/components/xiaofu-diagnostics-sheet/index");
delete global.Component;
assert.ok(diagnosticsComponent && diagnosticsComponent.methods);
const emitted = [];
const componentContext = { triggerEvent(name) { emitted.push(name); } };
diagnosticsComponent.methods.onRun.call(componentContext);
diagnosticsComponent.methods.onCopy.call(componentContext);
diagnosticsComponent.methods.onClose.call(componentContext);
assert.deepStrictEqual(emitted, ["run", "copy", "close"]);
const diagnosticsWxml = fs.readFileSync(path.join(__dirname, "../miniprogram/packageXiaofu/components/xiaofu-diagnostics-sheet/index.wxml"), "utf8");
assert.match(diagnosticsWxml, /Provider 真实状态/);
assert.match(diagnosticsWxml, /复制脱敏报告/);
assert.match(diagnosticsWxml, /item\.reasonCode/);

const fakeDeps = {
  apiBaseUrl: "https://class.katelya.eu.org",
  envVersion: "trial",
  getNetworkType: async () => "5g",
  getHealth: async () => ({ success: true, requestId: "req-health" }),
  getReadiness: async () => ({
    ok: true,
    runtimeMode: "trial",
    configVersion: "trial-v12",
    provider: "deepseek",
    providerConfigured: true,
    providerVerified: false,
    providerReachable: false,
    lastProbeAt: "2026-08-02T00:00:00.000Z",
    lastSuccessAt: "",
    circuitState: "closed",
    requestId: "req-ready",
  }),
  ensureSession: async () => ({
    sessionToken: "must-not-leak",
    expiresAt: "2099-01-01T00:00:00.000Z",
    securityMode: "enforce",
  }),
  createRun: async (payload) => ({ runId: "run-diag", pollToken: "must-not-leak", requestId: payload.requestId }),
  pollRun: async () => ({ status: "completed", result: { success: true, runtimeMode: "trial", configVersion: "trial-v12" } }),
  getMemorySnapshot: async () => ({ success: false, code: "MEMORY_STORE_UNAVAILABLE", statusCode: 503 }),
  now: () => 1785638400000,
};

(async () => {
  const report = await diagnostics.runConnectionDiagnostics({}, fakeDeps);
  assert.strictEqual(report.envVersion, "trial");
  assert.strictEqual(report.apiHostname, "class.katelya.eu.org");
  assert.deepStrictEqual(report.steps.map((step) => step.id), [
    "network", "health", "readiness", "session", "run_create", "run_poll", "memory_snapshot",
  ]);
  assert.strictEqual(report.runtimeMode, "trial");
  assert.strictEqual(report.configVersion, "trial-v12");
  assert.strictEqual(report.provider.configured, true);
  assert.strictEqual(report.provider.verified, false);
  assert.strictEqual(report.provider.reachable, false);
  assert.strictEqual(report.lastFailure.failureLayer, "memory");
  assert.strictEqual(report.lastFailure.reasonCode, "MEMORY_STORE_UNAVAILABLE");
  assert.ok(report.lastFailure.suggestion.length > 0);
  assert.ok(report.requestId);
  assert.strictEqual(report.runId, "run-diag");
  const copy = diagnostics.serializeDiagnosticReport(report);
  assert.ok(copy.includes("class.katelya.eu.org"));
  assert.ok(!copy.includes("must-not-leak"));
  assert.ok(!copy.includes("sessionToken"));
  assert.ok(!copy.includes("pollToken"));

  console.log(`test-agent-real-device-diagnostics-contract passed: ${cases.length + mappedCodes.length + 29} checks`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
