#!/usr/bin/env node
const assert = require("assert");
const {
  deriveExecutionOutcome,
  deriveFinalResponseOutcome,
  deriveProviderRunTruth,
  deriveValidatedResponseStatus,
} = require("../server/src/services/ai/agentService");

function run() {
  assert.strictEqual(typeof deriveProviderRunTruth, "function");
  assert.strictEqual(typeof deriveExecutionOutcome, "function");
  assert.strictEqual(typeof deriveFinalResponseOutcome, "function");
  assert.strictEqual(typeof deriveValidatedResponseStatus, "function");

  const truth = deriveProviderRunTruth({
    runtimeMode: "trial",
    understanding: {
      source: "deterministic_fallback",
      fallback: true,
      reasonCode: "INVALID_PROVIDER_JSON",
      providerUsed: "deepseek",
      externalProviderUsed: true,
      providerChain: [{ provider: "deepseek", status: "success" }],
    },
    planner: {
      plannerProvider: "coze",
      plannerStatus: "ok",
      successCount: 1,
      failureCount: 0,
      plannerFallback: false,
    },
    response: {
      provider: "mock",
      externalProviderUsed: false,
      providerChain: [],
      fallbackReason: "",
    },
  });
  assert.strictEqual(truth.externalProviderUsed, true, "all provider stages must contribute to usage truth");
  assert.strictEqual(truth.fallback, true, "understanding fallback must degrade the final run");
  assert.strictEqual(truth.stages.understanding.attempted, true);
  assert.strictEqual(truth.stages.understanding.completed, false);
  assert.strictEqual(truth.stages.planner.completed, true);
  assert.ok(truth.fallbackReason.includes("understanding"));

  assert.deepStrictEqual(
    deriveExecutionOutcome({ execution: { verification: { ok: false, errors: [{ code: "VERIFY_FAILED" }] } }, providerTruth: { fallback: false } }),
    { status: "failed", success: false, eventType: "run.failed", partialCompletion: false, verificationOk: false, errors: [{ code: "VERIFY_FAILED" }] }
  );
  assert.strictEqual(
    deriveExecutionOutcome({ execution: { partialCompletion: true, verification: { ok: false, errors: [{ code: "ONE_MISSING" }] } }, providerTruth: { fallback: false } }).status,
    "partial"
  );
  assert.strictEqual(
    deriveExecutionOutcome({ execution: { verification: { ok: true, errors: [] } }, providerTruth: { fallback: true } }).status,
    "degraded"
  );
  assert.strictEqual(
    deriveExecutionOutcome({ execution: { verification: { ok: true, errors: [] } }, providerTruth: { fallback: false } }).status,
    "completed"
  );
  assert.strictEqual(
    deriveValidatedResponseStatus({ status: "completed", success: true }, [{ code: "CARD_NOT_ALLOWED_FOR_INTENT" }]),
    "partial",
    "protocol/card validation errors must not retain completed status"
  );
  const postValidation = deriveFinalResponseOutcome({
    status: "partial",
    success: false,
    errors: [{ code: "CARD_NOT_ALLOWED_FOR_INTENT" }],
    verification: { ok: true, errors: [] },
  }, { fallback: false });
  assert.strictEqual(postValidation.status, "partial");
  assert.strictEqual(postValidation.success, false);
  assert.strictEqual(postValidation.eventType, "run.degraded");
  assert.strictEqual(postValidation.verificationOk, false);

  console.log("test-agent-terminal-truth: PASS");
}

run();
