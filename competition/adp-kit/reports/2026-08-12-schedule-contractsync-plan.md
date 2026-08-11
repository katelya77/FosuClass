# Schedule ContractSync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Schedule Widget outer wrapper / encodedWidget / Workflow WidgetParam 合同分裂，并生成 `01-多维课表查询-WidgetStable-可直接导入.zip`。

**Architecture:** 以 RuntimeSafe V3 21 字段作为唯一 canonical contract。保留现有 WidgetID 与冻结的 01 业务节点，只重建 Workflow 的 WIDGET 节点参数合同；同时增加 wrapper 合同校验，避免未来再次产出 mixed-state `.widget`。

**Tech Stack:** Tencent ADP workflow export JSON, `.widget` JSON + base64 encodedWidget, Node.js validation, Python/zip tooling, `artifact_tool` for XLSX-safe edits.

## Global Constraints

- PR #49 保持 open / unmerged。
- 不发布正式应用。
- 不修改 01/02/03/04 冻结事实逻辑。
- Schedule WidgetID 固定 `23fbc659efe3482fab588d754e4420a4`。
- `shownCount` 为 INT；其余 canonical fields 为 STRING。
- 所有 Widget 动态值来自上游 Adapter，不允许模型补造校园事实。

---

### Task 1: Build canonical Schedule contract

**Files:**
- Create: `competition/adp-kit/widget/native/schedule-runtime-safe-v3-contract.json`
- Test: `competition/adp-kit/widget/native/test-schedule-contractsync.js`

**Interfaces:**
- Consumes: current RuntimeSafe V3 template/schema/default and uploaded ADP exports.
- Produces: ordered 21-field contract used by Workflow ZIP generator and validators.

- [ ] **Step 1:** Encode the exact 21 fields and ADP types, with `shownCount=INT` and all others `STRING`.
- [ ] **Step 2:** Add a test asserting the contract keys equal Adapter output properties excluding `route`.
- [ ] **Step 3:** Add a test asserting there are no OBJECT/ARRAY_OBJECT fields.
- [ ] **Step 4:** Run the focused test and confirm PASS.

### Task 2: Add `.widget` wrapper contract audit

**Files:**
- Create: `competition/adp-kit/widget/native/audit-widget-contract.js`
- Test: `competition/adp-kit/widget/native/test-widget-contract-audit.js`

**Interfaces:**
- Consumes: exported `.widget` file.
- Produces: machine-readable `outerTemplateVars/defaultKeys/innerSchemaKeys/outerJsonSchemaKeys` differences and non-zero exit on drift.

- [ ] **Step 1:** Parse outer wrapper and base64 `encodedWidget`.
- [ ] **Step 2:** Detect empty/stale outer `template` and outer `jsonSchema` drift.
- [ ] **Step 3:** Add regression fixture expectations for the uploaded Schedule mixed-state export: outer V2 7 fields versus inner V3 21 fields.
- [ ] **Step 4:** Verify the audit fails on the mixed-state file for the expected reason.

### Task 3: Generate WidgetStable Workflow package

**Files:**
- Generate user artifact: `/mnt/data/01-多维课表查询-WidgetStable-可直接导入.zip`
- Generate user helper: `/mnt/data/Schedule-ContractSync-Zod.ts`
- Generate user helper: `/mnt/data/Schedule-ContractSync-JSONSchema.json`
- Generate audit: `/mnt/data/Schedule-ContractSync-audit.json`

**Interfaces:**
- Consumes: uploaded `export-01-多维课表查询-WidgetPilot-V1.3.zip` and canonical 21-field contract.
- Produces: new isolated WorkflowID, unchanged frozen business graph, rebuilt 21-field WidgetParam references.

- [ ] **Step 1:** Clone the exported V1.3 workflow JSON and assign a fresh WorkflowID/name `01-多维课表查询-WidgetStable`.
- [ ] **Step 2:** Replace only the WIDGET node's old 7-field WidgetParam with the canonical 21-field REFERENCE_OUTPUT params targeting `Widget数据适配-Schedule`.
- [ ] **Step 3:** Rebuild `NodeUI.content.inputs` to the same 21 keys and clear stale node error state.
- [ ] **Step 4:** Preserve WidgetID, ActionType, graph edges, NextNodeIDs, and all non-Widget node logic.
- [ ] **Step 5:** Update `workflows.xlsx`, `example_queries.xlsx`, and `variables.xlsx` WorkflowID fields with `artifact_tool`; preserve remaining workbook content.
- [ ] **Step 6:** Rezip exactly the six ADP export files at archive root.

### Task 4: Static import gate

**Files:**
- Validate: generated Workflow ZIP and helper Schema files.

**Interfaces:**
- Consumes: Task 3 artifacts.
- Produces: PASS/FAIL audit JSON with hashes and field-level checks.

- [ ] **Step 1:** Assert WorkflowWidgetInputs exactly equal canonical 21 fields.
- [ ] **Step 2:** Assert every reference points to the adapter NodeID and `Output.<field>`.
- [ ] **Step 3:** Assert no empty Reference NodeID/JsonPath and no OBJECT/ARRAY_OBJECT WidgetParam remain.
- [ ] **Step 4:** Assert `shownCount` type is INT end-to-end.
- [ ] **Step 5:** Assert all Edge endpoints exist and NextNodeIDs are represented by outgoing edges.
- [ ] **Step 6:** Inspect edited XLSX key ranges and confirm the new WorkflowID is synchronized.
- [ ] **Step 7:** Calculate SHA256 for final ZIP and helpers.

### Task 5: GitHub evidence and handoff

**Files:**
- Modify: `competition/adp-kit/reports/current-adp-checkpoint.md`
- Modify: `competition/adp-kit/reports/ChatGPT-project-handoff-current.md`
- Modify: `competition/adp-kit/reports/2026-08-12-schedule-widget-contract-split-root-cause.md`

**Interfaces:**
- Consumes: static Gate results.
- Produces: durable next-turn state.

- [ ] **Step 1:** Record the newly discovered `outer template = empty` fact and exact mixed-state contract.
- [ ] **Step 2:** Record generated artifact hash and exact one-time ADP steps.
- [ ] **Step 3:** Keep status as `SCHEDULE_CONTRACTSYNC_PACKAGE_READY` until real Tencent Runtime PASS.
- [ ] **Step 4:** Reconfirm PR #49 stays open/unmerged.

## Final ADP User Action

Only after static Gate PASS:

1. Open the existing Schedule Widget with WidgetID `23fbc659efe3482fab588d754e4420a4` and save the supplied 21-field Schema once so the live resource wrapper contract is synchronized.
2. Import `01-多维课表查询-WidgetStable-可直接导入.zip`.
3. Run exactly one acceptance query: `教师003第1周周一的课`.
4. Return the single Runtime result/export; no extra differential experiments unless this clean contract still fails.
