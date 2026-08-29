# Final ADP Convergence Implementation Plan

> **For execution:** Follow test-driven-development for every behavior change and verification-before-completion before any success claim, deploy, commit, or push.

**Goal:** Produce the Final Golden Campus Steward experience while preserving the existing four-Agent/13-tool/14-binding runtime and verified fact boundaries.

**Architecture:** Add deterministic outcome selection and public-copy projection between existing Mission/Decision semantics and the existing 15-field unified Widget contract. Create new final prompts and final acceptance/evidence assets, synchronize only affected Cloud Function code, then verify and deploy code-only if required.

**Tech stack:** Node.js CommonJS, Python contract adapter/tests, Tencent ADP Native Widget DSL, CloudBase Function, JSON Schema/Zod export contract, Markdown control-plane assets.

---

## Task 1: Freeze approved sources and Final Prompt contract

**Files:**

- Create: `competition/adp-kit/final/prompts/main-orchestrator.md`
- Create: `competition/adp-kit/final/prompts/schedule-space.md`
- Create: `competition/adp-kit/final/prompts/risk-planning.md`
- Create: `competition/adp-kit/final/prompts/campus-insight.md`
- Create: `competition/adp-kit/final/acceptance/test-final-prompts.js`
- Modify: `competition/adp-kit/ops/runtime-control-plane/desired-state/agents.json`
- Modify: `competition/adp-kit/ops/runtime-control-plane/desired-state/app.json`
- Modify: `competition/adp-kit/ops/runtime-control-plane/desired-state/runtime.json`

1. Write failing tests for bounded prompt length, prohibited engineering/test terms, no concrete test teachers, no required image tool, fresh-fact discipline, single clarification exit, authoritative-decision discipline, and final Console model/tool invariants.
2. Run the focused test and capture RED.
3. Add the four final prompts and update desired state without changing historical R51 prompts.
4. Run focused test to GREEN.

## Task 2: Add deterministic Public Copy Projector

**Files:**

- Create: `competition/adp-kit/r51/decision/public-copy.js`
- Modify: `competition/adp-kit/r51/decision/receipt.js`
- Modify: `competition/adp-kit/r51/decision/outcome-synthesizer.js`
- Modify: `competition/adp-kit/r51/decision/index.js`
- Create/Modify: `competition/adp-kit/r49-ma/tests/test-final-public-copy.js`
- Modify: `competition/adp-kit/r49-ma/tests/test-decision-outcome-receipt.js`

1. Write failing tests proving internal constraint IDs/reason text cannot enter receipt or Widget, known reasons map deterministically, unknown reasons are omitted, receipt and Widget copy match, no evidence yields no reason, and no result yields no recommendation.
2. Run RED.
3. Implement a structured allowlist projector; do not change evaluator/ranking semantics.
4. Feed receipt and Widget from the same projected reason objects.
5. Run GREEN plus all Decision tests.

## Task 3: Add deterministic FinalOutcomeSelector

**Files:**

- Create: `competition/adp-kit/r51/mission/final-outcome-selector.js`
- Modify: `competition/adp-kit/r50.2/widget/view-model.js`
- Modify: `competition/adp-kit/r51/mission/index.js` if present/needed
- Create: `competition/adp-kit/r49-ma/tests/test-final-outcome-selector.js`

1. Write failing tests for stale schedule versus completed risk, collaboration intermediate versus final plan, ranking drill-down, incomplete/unverified terminal evidence, and verified decision non-reranking.
2. Run RED.
3. Implement goal/completion-aware deterministic selection and integrate it into Mission final Widget projection.
4. Run GREEN plus Mission/Decision regressions.

## Task 4: Rebuild unified Widget projection and contract

**Files:**

- Modify: `competition/adp-kit/r50.2/widget/variant-adapters.js`
- Modify: `competition/adp-kit/widget/native/campus-result-unified-v1/{schema.json,zod-schema.txt,default.json,template.txt,contract.json,adapter.py,payload-validator.js}`
- Modify: `competition/adp-kit/r50.2/console-bundle/widget/*`
- Modify: `competition/adp-kit/widget/native/audit-widget-contract.js`
- Modify: `competition/adp-kit/widget/native/real-adp-export-catalog.json`
- Modify: `competition/adp-kit/widget/native/widget-registry.json`
- Create: `competition/adp-kit/final/widget/小序-校园智序结果卡.widget`
- Create: `competition/adp-kit/final/acceptance/widget-payloads/*.json`
- Create: `competition/adp-kit/final/acceptance/test-final-widget.js`

1. Write failing tests for all ten variants, one-Hero hierarchy, temporal schedule, risk semantics, compact 20+ alternatives, no internal terms, malformed fail-closed, exact sys.chat actions, and tieGroupCount omission/minimum behavior.
2. Write a failing real-export audit test that parses the actual nested Zod schema and accepts Tencent's empty outer template convention.
3. Run RED.
4. Refactor adapters and the supported-component-only View; keep the 15-field public shape.
5. Generate a deterministic import candidate from the real exported Widget structure/ID and register its real source hash without fabricating a new ID.
6. Run Widget contract/adapter/export tests to GREEN.

## Task 5: Final assets, acceptance matrix, and hygiene

**Files:**

- Create: `competition/adp-kit/final/acceptance/FINAL-ACCEPTANCE-MATRIX.md`
- Create: `competition/adp-kit/final/acceptance/test-final-acceptance.js`
- Create: `competition/adp-kit/final/evidence/widget-screenshots/*.png`
- Create: `competition/adp-kit/final/console/FINAL-CONSOLE-DESIRED-STATE.md`
- Create: `competition/adp-kit/final/console/MANUAL-ADP-ACTIONS.md`
- Modify: relevant `competition/adp-kit/knowledge/current/*.md`
- Create: `competition/adp-kit/final/FINAL-ADP-CONVERGENCE-REPORT.md`

1. Add failing acceptance tests for A-P scenarios and paraphrases, fresh tool calls, one-call preferences, final risk semantics, Knowledge RAG boundary, workflow/model/KB/dataVersion hygiene, and prohibited user-visible vocabulary.
2. Run RED.
3. Add deterministic fixtures, final Console truth, minimal manual actions, and knowledge wording fixes that keep all ten core documents.
4. Produce ten local visual-QA screenshots from the same payload fixtures; label them evidence, not Console execution.
5. Run GREEN and inspect every screenshot at mobile and desktop widths.

## Task 6: Synchronize runtime and prove all gates

**Files:**

- Modify generated Cloud Function copies through `competition/adp-kit/cloudfunctions/sync-campusflow-function.js` only.
- Modify generated manifests/submission assets through their canonical generators only.

1. Sync affected Decision/Mission/Widget modules into `campusflowAdpTools` and verify generated diffs contain no data or configuration changes.
2. Run Final focused tests, Widget contract/adapter, Decision, r49-ma all, knowledge/prompt/security gates, MCP, golden, adp-kit aggregate, root foundation/regression/AI competition/final convergence, asset manifest, and `git diff --check`.
3. Apply verification-before-completion: inspect outputs, counts, diff, leaked-term scan, counts (4/13/14/Main=0), and user PNG status.
4. If and only if runtime code differs and every prerequisite passes: run CloudBase code-only dry-run, inspect allowlist/hash, deploy only `campusflowAdpTools`, then health and remote-hash verification.
5. Do not alter environment variables, function configuration, credentials, production data, or ADP release state.

## Task 7: Commit, push, and remote verification

1. Stage only scoped files; explicitly exclude both user PNGs.
2. Commit in coherent TDD/runtime/final-asset commits.
3. Push `feat/campusflow-adp-integration` directly (no blind sync).
4. Verify PR #49 head equals final HEAD, remains OPEN/UNMERGED and mergeable, and wait for relevant CI results.
5. Update the final report with exact verified evidence and only genuinely manual Console steps.
