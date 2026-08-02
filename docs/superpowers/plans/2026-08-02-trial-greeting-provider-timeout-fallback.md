# Trial Greeting Provider Timeout Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a `trial` greeting reaches a truthful deterministic terminal response when the response Provider times out, instead of ending the Run with `STAGE_TIMEOUT`.

**Architecture:** Keep `strict_model_first` and the shared Provider Runtime intact. Give the Provider attempt a smaller lease than the enclosing response stage so the existing classified fallback path can finish before the outer stage aborts; configuration and authorization failures remain fail-fast.

**Tech Stack:** Node.js, CommonJS, `@xiaofu-agent/provider-runtime`, Fosu Agent Runtime, GitHub Actions.

## Global Constraints

- Do not change `public` external Provider calls from zero.
- Do not swallow configuration, authorization, cancellation, or non-fallback-eligible failures.
- Tool data remains authoritative and deterministic fallback must not invent campus facts.
- Write and run the regression test before production code.
- Work only on a `codex/` branch based on the latest `origin/main`.

---

### Task 1: Reproduce the enclosing-stage timeout race

**Files:**
- Modify: `tools/test-agent-fallback-eligibility.js`

**Interfaces:**
- Consumes: `providerOrchestrator.generateAssistantResponse(input)` and a real `createProviderRuntime()` adapter that waits until its signal aborts.
- Produces: A regression assertion that a transient response timeout returns the deterministic payload before the parent response signal aborts.

- [ ] **Step 1: Add the failing timed fallback test**

```js
const parent = createStageSignal(null, 100);
const runtime = createProviderRuntime({
  adapters: ["deepseek", "cloudbase-openai"].map((id) => ({
    id,
    generate: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), {
        code: "PROVIDER_TIMEOUT",
      })), { once: true });
    }),
    generateStructured: async () => ({}),
  })),
});
providerRuntimeComposition.getProviderRuntime = () => runtime;
const result = await orchestrator.generateAssistantResponse(responseInput({
  signal: parent.signal,
  responseBudgetMs: 100,
}));
assert.strictEqual(result.providerName, "mock");
assert.strictEqual(result.failureClass, "timeout");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node tools/test-agent-fallback-eligibility.js`

Expected: FAIL because the parent response stage aborts at the same budget as the Provider attempt, so `generateAssistantResponse()` rejects instead of returning deterministic fallback.

### Task 2: Reserve time for deterministic response fallback

**Files:**
- Modify: `server/src/services/ai/runtime/providerOrchestrator.js`
- Test: `tools/test-agent-fallback-eligibility.js`

**Interfaces:**
- Consumes: `input.responseBudgetMs` from the enclosing Agent Runtime response-stage lease.
- Produces: `responseProviderLease(responseBudgetMs, attemptCount)` with a per-attempt cap that keeps the whole one-or-two Provider chain inside the outer response budget and a bounded completion reserve.

- [ ] **Step 1: Implement the minimal lease calculation**

```js
function responseProviderLease(responseBudgetMs, attemptCount = 1) {
  const outerBudgetMs = Math.max(1, Number(responseBudgetMs || 1500) || 1500);
  const completionReserveMs = outerBudgetMs > 1
    ? Math.min(outerBudgetMs - 1, 250, Math.max(25, Math.floor(outerBudgetMs * 0.2)))
    : 0;
  const boundedAttemptCount = Math.max(1, Math.min(2, Number(attemptCount) || 1));
  return {
    stageCapMs: Math.max(1, Math.floor((outerBudgetMs - completionReserveMs) / boundedAttemptCount)),
    finishReserveMs: completionReserveMs,
  };
}
```

Derive `attemptCount` from the resolved primary/fallback pair and the shared fallback ledger. Use both returned values in `providerRuntime.generate()` rather than handing each Provider the entire response budget.

- [ ] **Step 2: Run the focused test and verify GREEN**

Run: `node tools/test-agent-fallback-eligibility.js`

Expected: PASS; timeout is classified as `timeout`, Provider truth records fallback, and deterministic payload remains available.

- [ ] **Step 3: Run nearby runtime tests**

Run: `node tools/test-response-provider-runtime.js`

Run: `node tools/test-agent-deadline-runtime.js`

Expected: PASS; successful Provider calls still use the shared runtime and hard cancellations still terminate.

### Task 3: Gate, publish, and verify the hotfix

**Files:**
- Modify: `docs/xiaofu-agent/real-device-reliability-root-cause.md`
- Modify: `docs/xiaofu-agent/reliability-product-convergence-verification.md`

**Interfaces:**
- Consumes: the focused regression result and required repository gates.
- Produces: a reviewable hotfix PR and production evidence tied to its merge SHA.

- [ ] **Step 1: Record the discovered production race and exact verification status**

Document that the first deployment succeeded operationally but the `trial` greeting exposed a response-stage Provider timeout race; distinguish local automated, CI, production HTTP, Provider Probe, DevTools, and iPhone verification.

- [ ] **Step 2: Run required gates**

Run: `npm run test:agent-foundation`

Run: `npm run test:agent-regression`

Run: `npm run test:ai-competition`

Run: `npm run test:agent-final-convergence`

Run: `npm run test:agent-phase3`

Run: `git diff --check`

Expected: all pass, with no new secret-scan finding.

- [ ] **Step 3: Commit, push, and create the PR**

```text
git add tools/test-agent-fallback-eligibility.js server/src/services/ai/runtime/providerOrchestrator.js docs/xiaofu-agent/real-device-reliability-root-cause.md docs/xiaofu-agent/reliability-product-convergence-verification.md docs/superpowers/plans/2026-08-02-trial-greeting-provider-timeout-fallback.md
git commit -m "fix(agent): preserve trial response fallback on provider timeout"
git push -u origin codex/xiaofu-agent-trial-greeting-provider-fallback
gh pr create --base main --head codex/xiaofu-agent-trial-greeting-provider-fallback
```

- [ ] **Step 4: Merge only after checks pass and monitor deployment**

Expected: PR checks are green, the merge SHA triggers `Deploy to VPS`, CI and deploy Jobs pass, and production `trial` greeting ends `completed` or truthful `degraded` with exactly one terminal event and no `run.failed`.

- [ ] **Step 5: Observe production for at least 15 minutes**

Check `/api/health`, public/trial readiness, Run create/poll, and Provider truth at the beginning and end of the observation window. Do not claim iPhone, DevTools, real Provider Probe, or experience-build verification unless each was actually performed.

### Task 4: Apply the same parent-stage invariant to Decision

**Files:**
- Modify: `packages/provider-runtime/src/deadline.js`
- Modify: `packages/provider-runtime/index.js`
- Modify: `server/src/services/ai/decision/decisionService.js`
- Modify: `server/src/services/ai/runtime/providerOrchestrator.js`
- Test: `tools/test-agent-fallback-eligibility.js`

**Interfaces:**
- Consumes: the Decision/Response parent-stage budget, resolved primary/fallback Provider pair, and shared fallback ledger.
- Produces: `deriveProviderStageLease(options)` so every one-or-two Provider chain ends before its enclosing Agent Runtime stage.

- [ ] **Step 1: Add the Decision RED case discovered after the first hotfix deployment**

Use two real slow Provider Runtime adapters, a 100ms parent Decision signal, a 100ms Decision budget, and a 20ms completion reserve. Assert that Decision returns `deterministic_fallback` with two `PROVIDER_TIMEOUT` path entries. Before the shared fix this must fail with `ABORTED` because the parent signal wins.

- [ ] **Step 2: Move the attempt-count and lease calculation into the existing deadline module**

```js
function deriveProviderStageLease(options = {}) {
  const outerBudgetMs = Math.max(1, Number(options.outerBudgetMs || 1) || 1);
  const finishReserveMs = outerBudgetMs > 1
    ? Math.min(outerBudgetMs - 1, Math.max(0, Number(options.finishReserveMs || 0) || 0))
    : 0;
  const attemptCount = providerAttemptCount(options.selection, options.providerAttemptLedger);
  return Object.freeze({
    stageCapMs: Math.max(1, Math.floor((outerBudgetMs - finishReserveMs) / attemptCount)),
    finishReserveMs,
    attemptCount,
  });
}
```

- [ ] **Step 3: Consume the shared lease in both Decision and Response**

Decision uses its existing 500ms finish reserve. Response keeps its bounded 20%/250ms completion reserve. Neither caller changes failure classification, execution policy, authorization, or cancellation semantics.

- [ ] **Step 4: Verify RED→GREEN and rerun the full gate/deployment loop**

Run: `node tools/test-agent-fallback-eligibility.js`

Expected: the Decision case fails with `ABORTED` before implementation and passes with two timeout path entries after implementation; the existing Response case remains green. Then rerun repository-required gates, merge only green PR checks, deploy the resulting merge SHA, and repeat the production trial greeting plus 15-minute observation.
