# Final Interaction & Presentation Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Final handoff, presentation, Widget-oracle, and Console desired-state drift before the ADP Runtime feature freeze.

**Architecture:** Add deterministic contract modules around the existing Mission and Widget projection layers. Extend the single Widget with an optional semantic section discriminator so v7 payloads remain valid while verified v8 projections gain distinct visual modules.

**Tech Stack:** Node.js CommonJS, Node test runner, JSON Schema, Tencent ADP Widget DSL/Zod export, Python adapter, Markdown Console runbooks.

**Spec:** `docs/superpowers/specs/2026-08-21-final-interaction-presentation-convergence-design.md`

## Global Constraints

- Keep PR #49 OPEN and UNMERGED; do not publish the ADP application.
- Keep 4 Agents, 13 unique CampusTools, 14 bindings, Main CampusTools = 0, and no Child→Child path.
- Treat Widget ID `601418106a374b2eb7de54c65a3de7e0` as current Console truth.
- Preserve v7 Widget payload compatibility; `section.kind` is optional.
- CampusTool direct result output is OFF for all 13 operations.
- Preserve the two user-modified PNG files without staging them.

---

### Task 1: Handoff evidence and deterministic contract

**Files:**
- Create: `competition/adp-kit/final/acceptance/HANDOFF-PROBE-MATRIX.md`
- Create: `competition/adp-kit/final/console/FINAL-TRANSFER-DESCRIPTIONS.md`
- Create: `competition/adp-kit/r51/mission/handoff-contract.js`
- Create: `competition/adp-kit/final/acceptance/test-final-interaction.js`
- Modify: `competition/adp-kit/final/prompts/*.md`
- Modify: `competition/adp-kit/ops/runtime-control-plane/desired-state/agents.json`
- Modify: `competition/adp-kit/ops/runtime-control-plane/desired-state/runtime.json`

**Interfaces:**
- Produces: `allowedTransfer(from, to)`, `decideChildReturn({ domain, requiredDomains, completedDomains })`, and `newTurnStart(source)`.
- Consumes: normalized domain names `main`, `schedule`, `risk`, and `insight`.

- [ ] **Step 1: Write failing interaction tests** asserting Main start for keyboard/sys.chat, Child→Main-only edges, residual-goal return, simple-domain completion, and exact topology.
- [ ] **Step 2: Run** `node --test competition/adp-kit/final/acceptance/test-final-interaction.js` and confirm failures are caused by the missing contract and prompt/desired-state rules.
- [ ] **Step 3: Implement the pure handoff contract**, the canonical transfer descriptions, the probe matrix, bounded Prompt patches, and desired-state graph/direct-output fields.
- [ ] **Step 4: Re-run the interaction tests** and confirm all pass without adding test strings or concrete entity IDs to prompts.

### Task 2: FinalPresentationPolicy

**Files:**
- Create: `competition/adp-kit/r51/presentation/final-presentation-policy.js`
- Create: `competition/adp-kit/final/acceptance/test-final-presentation.js`
- Modify: `competition/adp-kit/r51/decision/index.js`

**Interfaces:**
- Produces: `selectFinalPresentation({ responseClass, mission, toolResults, capabilityToolMap, resultCard, validateResultCard })` returning `{ mode, selectedOutcome, resultCard, fallbackText }`.
- Consumes: `selectFinalOutcome()` and the unified Widget validator callback.

- [ ] **Step 1: Write failing policy tests** for verified Widget selection, compound terminal outcome, stale intermediate rejection, invalid payload fail-closed, clarification exclusion, message/text selection, and L3 confirmation.
- [ ] **Step 2: Run** `node --test competition/adp-kit/final/acceptance/test-final-presentation.js` and confirm the module-not-found/behavior failures.
- [ ] **Step 3: Implement the minimal pure selector** with no model-dependent routing and export it from the Decision index.
- [ ] **Step 4: Re-run policy tests** and confirm every response class is deterministic.

### Task 3: Campus Canvas v8 semantic modules

**Files:**
- Modify: `competition/adp-kit/r50.2/widget/variant-adapters.js`
- Modify: `competition/adp-kit/r50.2/widget/envelope.js`
- Modify: `competition/adp-kit/r50.2/widget/view-model.js`
- Modify: `competition/adp-kit/widget/native/campus-result-unified-v1/{schema.json,schema.zod.txt,contract.json,payload-validator.js,template.txt,adapter.py}`
- Modify: `competition/adp-kit/r50.2/console-bundle/widget/*`
- Modify: `competition/adp-kit/final/acceptance/test-final-widget.js`
- Modify: `competition/adp-kit/final/acceptance/widget-payloads/*.json`

**Interfaces:**
- Produces: optional `section.kind` from the fixed nine-value enum.
- Consumes: only verified raw CampusTool results and existing rows/actions/days.

- [ ] **Step 1: Add failing Widget tests** for semantic kinds, risk route, day timeline, recommendation, ranking, comparison, metric, prose/notice, v7 payload compatibility, and malformed kind rejection.
- [ ] **Step 2: Run the focused Widget test** and confirm the new assertions fail against v7.
- [ ] **Step 3: Add deterministic kind projection** to each existing projector and extend schema/Zod/validator/adapter without making `kind` required.
- [ ] **Step 4: Refactor the Tencent template** to render semantic modules with the campus-path spine while retaining the v7 generic fallback.
- [ ] **Step 5: Regenerate ten payload fixtures and visual evidence**, inspect all ten screenshots, and run Widget focused/contract tests.

### Task 4: Latest real Export rebind and Console truth

**Files:**
- Modify: `competition/adp-kit/final/widget/{REAL-EXPORT-DIFF.md,generate-final-widget.js,小序-校园智序结果卡.widget}`
- Modify: `competition/adp-kit/widget/native/{audit-widget-contract.js,widget-registry.json,test-r50-2b-widget-contract.js}`
- Modify: `competition/adp-kit/widget/native/campus-result-unified-v1/contract.json`
- Modify: `competition/adp-kit/r50.2/console-bundle/widget/contract.json`
- Modify: `competition/adp-kit/ops/runtime-control-plane/desired-state/{app.json,runtime.json}`
- Modify: `competition/adp-kit/final/console/{FINAL-CONSOLE-DESIRED-STATE.md,MANUAL-ADP-ACTIONS.md}`

**Interfaces:**
- Consumes: current export ID and SHA from the approved design.
- Produces: one generated v8 import candidate bound to the latest live ID as its oracle.

- [ ] **Step 1: Add failing latest-ID and direct-output desired-state assertions** to the focused acceptance tests.
- [ ] **Step 2: Run the focused tests** and verify they fail on the old ID/missing guard.
- [ ] **Step 3: Rebind every active contract/audit/bundle/registry source** and update knowledge current-vs-desired documentation without changing thresholds.
- [ ] **Step 4: Generate and audit the v8 `.widget`**; prove its schema/default/view validity and ensure the old ID is absent from active Final truth.

### Task 5: Runtime mirrors and regression gates

**Files:**
- Modify generated mirrors only through existing sync/build scripts under `competition/adp-kit/cloudfunctions/`, `competition/submission-package/`, and `output/competition-adp/next/`.
- Modify: `competition/adp-kit/reports/generated-assets-manifest.json`

**Interfaces:**
- Consumes: canonical projector and Widget assets.
- Produces: byte-consistent function/submission mirrors and authoritative asset hashes.

- [ ] **Step 1: Run focused Final, Widget, Decision, and Mission tests.**
- [ ] **Step 2: Sync CloudFunction and submission mirrors with existing generators.**
- [ ] **Step 3: Run r49-ma, MCP, golden, knowledge, security, foundation, regression, AI competition, final convergence, aggregate ADP, manifest, and `git diff --check` gates.**
- [ ] **Step 4: If the function hash changed, run CloudBase dry-run, deploy only `campusflowAdpTools` code with `--safe --confirm`, then prove health and local/remote hash equality.**

### Task 6: Commit, push, and Final report

**Files:**
- Create: `competition/adp-kit/final/FINAL-INTERACTION-PRESENTATION-CONVERGENCE-REPORT.md`

**Interfaces:**
- Consumes: fresh test, deployment, PR, and CI evidence.
- Produces: feature-freeze readiness decision and exact manual Console steps.

- [ ] **Step 1: Confirm only task files are staged and both user PNGs remain unstaged.**
- [ ] **Step 2: Commit scoped changes and push `feat/campusflow-adp-integration` explicitly.**
- [ ] **Step 3: Verify PR #49 head, OPEN/UNMERGED/MERGEABLE state, and wait for all relevant CI checks.**
- [ ] **Step 4: Report Repo truth separately from `MANUAL_REQUIRED` Tencent Console probes; do not claim ADP publication.**
