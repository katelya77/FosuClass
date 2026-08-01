# Xiaofu Agent Product Platform P2 Implementation Plan

> This plan executes P2 of the approved product-platform design. Each task follows RED -> GREEN -> focused regression -> independent commit. No production deployment is part of this plan.

## Outcome

Replace the trial/dev two-call Understanding + Planner path with one constrained `DecisionContract V2` call owned by a real `@xiaofu-agent/provider-runtime`. Public remains deterministic with zero external attempts; adaptive is explicit. The production Run path records the actual policy/provider/fallback/timing truth and shares one abortable hard deadline.

## Task 1: Protocol and Provider Runtime

**Files**

- Create `packages/provider-runtime/package.json`
- Create `packages/provider-runtime/index.js`
- Create `packages/provider-runtime/src/executionPolicy.js`
- Create `packages/provider-runtime/src/decisionContract.js`
- Create `packages/provider-runtime/src/deadline.js`
- Create `packages/provider-runtime/src/metrics.js`
- Create `packages/provider-runtime/src/providerRuntime.js`
- Modify `packages/agent-protocol/index.js`
- Create `tools/test-provider-runtime-contracts.js`

**RED**

- Assert public resolves only `deterministic`, trial/dev default to `strict_model_first`, and adaptive requires an explicit trusted config value.
- Assert strict Decision JSON has exact keys, exact allowed Skill IDs, no Tool fields at any depth, and valid plan skeleton references.
- Assert public cannot invoke an adapter, a stage receives the smaller of its cap and remaining deadline, abort maps to `ABORTED`, and only one fallback attempt is allowed.
- Assert low-cardinality stage metrics expose count/P50/P95 without prompts or principal data.

**GREEN**

- Implement the package as executable runtime code, not a server re-export.
- Use injected provider adapters and a shared absolute deadline; emit selected/started/completed/failed events from real attempts.
- Keep retry ownership here: primary plus at most one configured fallback across the Decision stage.

**Verify and commit**

- `node tools/test-provider-runtime-contracts.js`
- `npm run test:agent-platform-p1`
- Commit: `feat(agent): add bounded provider runtime`

## Task 2: Fosu Provider Adapters and Unified Decision

**Files**

- Create `server/src/services/ai/providerRuntimeComposition.js`
- Create `server/src/services/ai/decision/decisionService.js`
- Create `server/src/services/ai/decision/decisionPrompt.js`
- Modify `server/src/services/ai/platformComposition.js`
- Modify `server/src/services/ai/runtime/fosuTurnPorts.js`
- Modify `server/src/services/ai/runtime/plannerCoordinator.js`
- Modify `packages/agent-runtime/src/stageTrace.js`
- Create `tools/test-agent-strict-decision.js`
- Create `tools/test-provider-adapter-conformance.js`

**RED**

- Run an actual HTTP mock through the production `/agent/runs` composition and prove the first semantic Provider request is `decision`, exactly one structured request occurs before Tool execution, and the old Planner model is not called.
- Prove recorded fields: `executionPolicy`, `intendedProvider`, `actualFirstProvider`, `decisionSource`, `goal`, `selectedSkill`, `fallbackPath`.
- Prove model output cannot name a Tool and an unknown/mismatched Skill is rejected before planning.
- Run equivalent structured Decision fixtures through DeepSeek/OpenAI-compatible, CloudBase OpenAI-compatible, and Anthropic adapters.

**GREEN**

- Adapt existing audited provider implementations into Provider Runtime adapters while keeping secrets server-side.
- Build allowed Skill descriptors from the published campus plugin snapshot and pass only those descriptors to the model.
- Convert the validated Decision into the existing GoalContract/Intent compatibility shape; resolve Skill and Tool only after validation.
- Force the downstream Planner to deterministic constrained plan construction when a unified Decision was already obtained. Preserve public deterministic behavior and allow the old adaptive rule fast path only when explicitly selected.

**Verify and commit**

- `node tools/test-agent-strict-decision.js`
- `node tools/test-provider-adapter-conformance.js`
- `npm run test:agent-understanding`
- `npm run test:agent-platform-p1`
- Commit: `feat(agent): make unified decision model first`

## Task 3: Deadline, Cancellation, Connection Reuse, and Timing Truth

**Files**

- Modify `packages/agent-runtime/src/agentRuntime.js`
- Modify `apps/agent-server/src/createAgentPlatform.js`
- Modify `apps/agent-server/src/createRunHandlers.js`
- Modify `server/src/services/ai/agentKernel.js`
- Modify Provider HTTP adapters as needed to honor `signal`
- Modify `packages/agent-protocol/src/platformTrace.js`
- Create `tools/test-agent-deadline-runtime.js`
- Create `tools/test-agent-performance-budget.js`

**RED**

- Prove the Run owns a maximum 15 second deadline and every stage sees a derived budget/AbortSignal.
- Prove cancellation stops Provider and Tool work and prevents a later success terminal event.
- Prove the three HTTP Provider adapters reuse a keep-alive connection/dispatcher abstraction.
- Measure `createRun`, `decision`, `tool`, `verification`, `response`, and `total`; prove first persisted real RunEvent <=500ms under the deterministic test harness, simple P95 <=6s, multi-tool P95 <=12s, and no run exceeds 15s.

**GREEN**

- Create the deadline at Run acceptance/execution and pass it through Runtime, Provider, Tool, Verification, and Response.
- Replace fixed per-Provider full timeouts with stage leases from the remaining deadline; fallback shares the same lease.
- Record timings for successes, failures, timeouts, and cancellations without request text, Tool args, principal, or secrets.

**Verify and commit**

- `node tools/test-agent-deadline-runtime.js`
- `node tools/test-agent-performance-budget.js`
- `npm run test:agent-run-events`
- `npm run test:provider-runtime-matrix`
- Commit: `perf(agent): enforce end-to-end run budgets`

## Task 4: Runtime/Admin Truth, Gates, and P2 Evidence

**Files**

- Modify `apps/agent-admin` topology/readiness/trace views
- Modify `server/src/services/ai/platformComposition.js`
- Modify `package.json`
- Modify `.github/workflows/*` as required by existing path filters
- Modify `specs/xiaofu-agent-product-platform/tasks.md`
- Create `docs/xiaofu-agent/product-platform-p2-evidence.md`

**RED/GREEN**

- Add `test:agent-platform-p2` as the single P2 gate.
- Prove admin reads the same Provider Runtime metrics and platform traces used by production Runs.
- Prove public external attempt count is always zero even if provider credentials/config are present.
- Document mock results separately from credential-gated staging-live validation.

**Full verification and commit**

- `npm run test:agent-platform-p2`
- `npm run test:agent-foundation`
- `npm run test:agent-regression`
- `npm run test:ai-competition`
- `npm run test:agent-final-convergence`
- `npm run test:agent-phase2`
- `npm run test:agent-phase3`
- `npm run test:agent-release-gate`
- Commit: `docs(agent): record P2 decision runtime evidence`

## Rollback

Revert P2 commits in reverse order. P1 remains a complete production-wired deterministic platform. No Release Pack, conversation, Run, or Provider configuration data is deleted during rollback.
