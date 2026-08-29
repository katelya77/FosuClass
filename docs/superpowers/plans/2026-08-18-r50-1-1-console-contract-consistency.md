# R50.1.1 Console Contract Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the R50.1 ADP console binding instructions, automated prompt/tool gates, and competition-demo-v3 type contract agree before console cutover.

**Architecture:** Treat the existing R50 Prompt architecture test as the semantic source of truth for domain ownership. Add a dedicated R50.1.1 control-plane consistency test that checks the human console documentation against that map, then minimally repair the docs and extend the stale data-version union. No CampusTools runtime behavior or CloudBase deployment changes are allowed.

**Tech Stack:** Node.js `node:test`, TypeScript contracts, Markdown console runbooks, GitHub branch `feat/campusflow-adp-integration`.

**Spec:** `docs/superpowers/specs/2026-08-18-r50-1-1-console-contract-consistency-design.md`

## Global Constraints

- PR #49 stays OPEN / UNMERGED.
- No CloudBase deployment.
- No ADP formal/test publish.
- No new CampusTools and no changes to existing CampusTools business semantics.
- Do not modify the four R50.1 final Prompt files unless a failing consistency test proves they are wrong; current prompt architecture is the binding source of truth.
- Preserve competition-demo-v1 and competition-demo-v2 compatibility while admitting competition-demo-v3 in TypeScript contracts.
- No real school/teacher/class identity or credential material may be added.

---

### Task 1: Lock the canonical console binding map with a failing test

**Files:**
- Create: `competition/adp-kit/r49-ma/tests/test-r50-1-1-console-contract-consistency.js`
- Read: `competition/adp-kit/r49-ma/tests/test-r50-prompt-architecture.js`
- Read: `competition/adp-kit/r50.1/R50.1-ADP-CONSOLE-CUTOVER.md`
- Read: `competition/adp-kit/r50.1/R50.1-CONSOLE-ACCEPTANCE.md`

**Interfaces:**
- Consumes: canonical binding semantics already asserted by `test-r50-prompt-architecture.js`.
- Produces: a regression gate that fails if console documentation maps a tool to the wrong Agent or repeats the false “all tools appear exactly once” invariant.

- [ ] **Step 1: Write the failing test**

Create a table with the exact canonical bindings:

```js
const CANONICAL = {
  schedule: [
    "campus_schedule_query",
    "campus_schedule_range_query",
    "campus_classroom_search",
    "campus_entity_search",
    "campus_academic_context",
    "campus_common_free_time_query",
    "campus_group_plan",
  ],
  risk: [
    "campus_risk_check",
    "campus_day_plan",
    "campus_academic_context",
    "campus_reschedule_feasibility",
  ],
  insight: [
    "campus_overview",
    "campus_teacher_load_query",
    "campus_room_utilization_query",
  ],
};
```

Assert that `R50.1-ADP-CONSOLE-CUTOVER.md` contains exactly those domain rows, explicitly states 13 unique operations / 14 bindings, and explicitly states `campus_academic_context` is the only intentional cross-domain duplicate. Assert the acceptance doc uses the same mapping summary.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test competition/adp-kit/r49-ma/tests/test-r50-1-1-console-contract-consistency.js
```

Expected: FAIL against the current R50.1 cutover manual because Schedule/Risk/Insight rows drift and the “each appears once” statement is false.

- [ ] **Step 3: Commit only the RED test**

```bash
git add competition/adp-kit/r49-ma/tests/test-r50-1-1-console-contract-consistency.js
git commit -m "test(adp): lock R50.1.1 console binding contract"
```

---

### Task 2: Repair the R50.1 console documentation to the canonical map

**Files:**
- Modify: `competition/adp-kit/r50.1/R50.1-ADP-CONSOLE-CUTOVER.md`
- Modify: `competition/adp-kit/r50.1/R50.1-CONSOLE-ACCEPTANCE.md`
- Inspect and modify only if needed: `competition/adp-kit/r50.1/R50.1-ADP-RUNTIME-CONFIG.md`
- Inspect and modify only if needed: `competition/adp-kit/r50.1/R50.1-TOOL-MODEL-VISIBILITY.md`

**Interfaces:**
- Consumes: `CANONICAL` from Task 1.
- Produces: a human cutover guide that cannot misconfigure ADP.

- [ ] **Step 1: Replace the binding table**

Use exactly:

```text
Main: no CampusTools
Schedule: schedule_query, schedule_range_query, classroom_search, entity_search, academic_context, common_free_time_query, group_plan
Risk: risk_check, day_plan, academic_context, reschedule_feasibility
Insight: overview, teacher_load_query, room_utilization_query
```

- [ ] **Step 2: Replace the false uniqueness sentence**

State:

```text
13 个 unique Agent Tool 全部被覆盖，共 14 个 Agent 绑定；campus_academic_context 仅在 Schedule 与 Risk 间共享，其余工具不得跨域重复绑定。
```

- [ ] **Step 3: Keep console control rules unchanged**

Preserve Direct Result=OFF, Main clarification=ON Widget, child clarification=OFF, new Turn→Main, and DeepSeek V4 Flash baseline.

- [ ] **Step 4: Run the R50.1.1 consistency test and verify GREEN**

```bash
node --test competition/adp-kit/r49-ma/tests/test-r50-1-1-console-contract-consistency.js
```

Expected: PASS.

- [ ] **Step 5: Run adjacent prompt architecture tests**

```bash
node --test competition/adp-kit/r49-ma/tests/test-r50-prompt-architecture.js competition/adp-kit/r49-ma/tests/test-r50-1-prompt-convergence.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add competition/adp-kit/r50.1/R50.1-ADP-CONSOLE-CUTOVER.md competition/adp-kit/r50.1/R50.1-CONSOLE-ACCEPTANCE.md competition/adp-kit/r50.1/R50.1-ADP-RUNTIME-CONFIG.md competition/adp-kit/r50.1/R50.1-TOOL-MODEL-VISIBILITY.md
git commit -m "fix(adp): align R50.1 console tool bindings"
```

---

### Task 3: Extend the TypeScript data-version contract to v3 with TDD

**Files:**
- Modify: `competition/adp-kit/mcp/campus-tools-mcp/src/contracts.ts`
- Test: use the nearest existing MCP contract/type test; if none directly covers `CompetitionDataVersion`, add a focused test under `competition/adp-kit/mcp/campus-tools-mcp/test/` following repository naming conventions.

**Interfaces:**
- Consumes: runtime dataset meta may return `competition-demo-v3`.
- Produces: `CompetitionDataVersion = v1 | v2 | v3` and `DATA_VERSIONS` including v3 without changing runtime selection behavior.

- [ ] **Step 1: Add the failing assertion**

Assert that the exported/static contract admits all three values and that v3 is present in `DATA_VERSIONS`.

- [ ] **Step 2: Verify RED**

Run the focused test or `npm test` in `competition/adp-kit/mcp/campus-tools-mcp` and confirm failure is caused by v3 being absent.

- [ ] **Step 3: Make the minimal type change**

Change only:

```ts
export type CompetitionDataVersion =
  | "competition-demo-v1"
  | "competition-demo-v2"
  | "competition-demo-v3";

export const DATA_VERSIONS: readonly CompetitionDataVersion[] = [
  "competition-demo-v1",
  "competition-demo-v2",
  "competition-demo-v3",
];
```

Keep `DATA_VERSION` compatibility default unchanged unless an existing test proves otherwise.

- [ ] **Step 4: Verify GREEN**

```bash
npm test --prefix competition/adp-kit/mcp/campus-tools-mcp
npm run check --prefix competition/adp-kit/mcp/campus-tools-mcp
```

Expected: all tests pass and TypeScript check is green.

- [ ] **Step 5: Commit**

```bash
git add competition/adp-kit/mcp/campus-tools-mcp/src/contracts.ts competition/adp-kit/mcp/campus-tools-mcp/test
git commit -m "fix(adp): admit competition demo v3 in type contract"
```

---

### Task 4: Record R50.1.1 state and run the full regression gate

**Files:**
- Modify: `competition/adp-kit/reports/current-adp-checkpoint.md`
- Create: `competition/adp-kit/r50.1/2026-08-18-r50.1.1-final-report.md`

**Interfaces:**
- Consumes: Tasks 1-3 verification outputs.
- Produces: an auditable handoff for the user's ADP console cutover.

- [ ] **Step 1: Update checkpoint**

Record that R50.1.1 fixes console binding/type-contract drift only; Runtime remains R50.0 deployed baseline and ADP Console D1-D6 is still a user-side gate.

- [ ] **Step 2: Run full relevant regressions**

```bash
node --test "competition/adp-kit/r49-ma/tests/*.js"
npm test --prefix competition/adp-kit/mcp/campus-tools-mcp
npm run check --prefix competition/adp-kit/mcp/campus-tools-mcp
node competition/adp-kit/r50/build-agent-prompts.js --check
node competition/adp-kit/scripts/sync-campusflow-function.js --check
node competition/adp-kit/scripts/test-http-function.js
git diff --check
```

Also run the repository's current Golden evaluation command documented in AGENTS.md/R50.1 report and require the existing 33/33 semantic baseline to remain green.

- [ ] **Step 3: Confirm no runtime deployment is required**

Because only docs/tests/type declarations change, do not deploy CloudBase. If investigation unexpectedly reveals generated/runtime JS changes are required, stop and re-scope before deployment.

- [ ] **Step 4: Write final report**

Include root cause, canonical binding map, RED→GREEN evidence, data-version fix, exact test counts, commit SHAs, PR state, and the remaining user-side Console D1-D6 steps.

- [ ] **Step 5: Commit and push**

```bash
git add competition/adp-kit/reports/current-adp-checkpoint.md competition/adp-kit/r50.1/2026-08-18-r50.1.1-final-report.md
git commit -m "docs(adp): close R50.1.1 console consistency gate"
git push origin feat/campusflow-adp-integration
```

Expected: PR #49 remains OPEN / UNMERGED.
