# CampusFlow ADP R4.2 A+B Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the user's latest five ADP R4-UX-Pro workflow exports, six RuntimeSafe Widgets, and seven knowledge documents into a three-campus privacy-safe R4.2 package with stable multi-turn context, strict canonical/display separation, deterministic CampusTools v2 data, and verified import artifacts.

**Architecture:** Treat the uploaded R4 exports/Widgets/knowledge as the runtime baseline. Introduce a single `R4.2 Runtime Contract` with two namespaces: canonical tool values (`校区A/校区B/校区C`, `教师001...`) and user-facing aliases (`A校区/B校区/C校区`, `T01老师...`). Build a new `competition-demo-v2` three-campus fixture and ensure presentation aliasing happens only after deterministic tool results; state recovery happens before parameter validation.

**Tech Stack:** Tencent ADP Workflow V2_6 JSON/XLSX bundles, RuntimeSafe `.widget` JSON, Python 3 artifact compiler/validator, Node-compatible CampusTools fixture contract, Markdown knowledge base.

## Global Constraints

- Uploaded ZIP/Widget/MD files are the authoritative current ADP baseline.
- Preserve all five current WorkflowIDs and current bound Widget IDs inside workflows.
- Three real anonymous campuses must exist in the deterministic data contract: 校区A / 校区B / 校区C.
- User-facing campus aliases: A校区 / B校区 / C校区.
- User-facing teacher aliases: T01老师…; canonical tools use 教师001….
- Presentation aliases must never be fed back into CampusTools.
- Dynamic facts must come from CampusTools/competition-demo-v2 only.
- No real school, teacher, class, room, building, URL, key, token, queryId, hash, RuntimeSafe/version jargon in ordinary Widget UI.
- Keep internal verification metadata in envelopes/tests, not normal display.
- Multi-turn follow-ups must inherit only last confirmed same-task state; new explicit values override old values.
- Failed/ambiguous/unverified values must never enter remembered state.
- 04 keeps fixed anonymous demo visitor identity.
- Deliver importable ZIPs, Widget files, knowledge files, app config/copy, CampusTools v2 fixture/deployment patch, validation report, checksums, and a one-click aggregate ZIP.

---

### Task 1: Baseline forensic validator
- [ ] Inventory WorkflowIDs, nodes, Widget IDs and XLSX headers.
- [ ] Reproduce 02/03 alias pollution and 01 multi-turn entity loss.

### Task 2: R4.2 runtime contract + competition-demo-v2
- [ ] Create canonical/display alias contract.
- [ ] Generate a real 3-campus anonymous fixture with C-campus rooms/lessons.
- [ ] Validate referential integrity, weeks, periods, capacities and privacy.

### Task 3: Workflow 01
- [ ] Add deterministic same-task state recovery.
- [ ] Normalize Txx/A-B-C aliases to canonical before tools.
- [ ] Keep DAY/WEEK/DATE tool inputs canonical; alias only after tool success.

### Task 4: Workflow 02
- [ ] Preserve campus/date/period/capacity across same-task follow-ups.
- [ ] Support A/B/C display aliases while tool receives 校区A/B/C.
- [ ] Distinguish real tool failure from missing/not-found/out-of-range recovery.

### Task 5: Workflow 03
- [ ] Support Txx aliases canonically.
- [ ] Single-teacher risk intent becomes deterministic self-compare.
- [ ] Keep true two-entity comparison unchanged.

### Task 6: Workflows 04/05
- [ ] Preserve successful 04 path, add C-campus preference and state inheritance.
- [ ] Upgrade 05 guard/metrics/UI to competition-demo-v2 and 3 campuses.
- [ ] Derive counts from tool output instead of v1 hardcoded totals where possible.

### Task 7: RuntimeSafe Widgets
- [ ] Remove engineering metadata from visible UI.
- [ ] Add C-campus overview presentation.
- [ ] Keep required primitive schema/defaults and current workflow bindings.

### Task 8: Knowledge base + application configuration
- [ ] Rewrite 7 MD files for v2, 3 campuses, canonical/display split and five dynamic tasks.
- [ ] Create R4.2 role instruction, welcome/examples and application config.

### Task 9: Package and verification
- [ ] Round-trip all workflow ZIPs and preserve WorkflowIDs/XLSX headers.
- [ ] Parse/validate all JSON and widgets.
- [ ] Regression-test multi-turn 01/02/03 sequences and C-campus data.
- [ ] Produce validation report, replacement/testing guide, checksums and aggregate ZIP.
