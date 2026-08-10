# 03 课程冲突比较 V4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 03-课程冲突比较收口为 V4 Final：支持“第 N 周”整周比较、修复同实体自比较的伪冲突与重复赶场，同时保持现有单日/指定星期/指定节次行为和确定性证据链不变。

**Architecture:** CampusTools 继续作为课程事实的唯一确定性来源。整周语义在 `compare_schedules` 边界把 ADP 的 `weekday=0` 仅对本工具规范化为“未指定星期”，底层 `resolveTimeRange` 仍保持严格校验；同实体比较在工具层完成 lesson 自配对跳过、镜像冲突去重和赶场去重。ADP 只做最小参数/呈现适配，不增加 7 次循环调用。

**Tech Stack:** Node.js >=18、CommonJS、`node:test`、CampusTools MCP/REST、CloudBase HTTP Function、ADP V2.6 工作流 ZIP/Excel 序列化格式。

## Global Constraints

- 只使用 `competition-demo-v1` 赛事匿名数据；不得读取或修改佛课小表生产课程数据。
- 动态课程事实只来自 CampusTools；生成模型不得补造课程、冲突、教室或赶场事实。
- `dataVersion` 必须继续为 `competition-demo-v1`，结果只有在 `success=true` 且 `evidence.verified=true` 时才能进入成功呈现。
- `weekday=0` 的兼容只允许发生在 `compare_schedules` 入口，不改变其他工具对 `weekday` 的严格 1-7 校验。
- 不合并 PR #49，不发布 ADP 正式版本，不部署佛课小表生产环境，不开始 04 今日校园计划。
- CloudBase 只允许对现有 `campusflowAdpTools` 做 code-only update；函数 ID、环境变量和 `CAMPUS_API_TOKEN` 保持不变。
- ADP V4 必须建立在当前已调试成功的 03-V3-全新ID修复版上，尽量保留节点 ID、连接与授权序列化，避免再次触发 450081/引用节点不存在。

---

## File Structure

**权威源码 / 测试**
- Modify: `competition/adp-kit/mcp/campus-tools-mcp/src/tools.js` — `compare_schedules` 的整周兼容、自比较、去重和摘要字段。
- Modify: `competition/adp-kit/mcp/campus-tools-mcp/test/tools.test.js` — V4 行为回归测试。
- Modify: `competition/adp-kit/evaluation/golden-cases.js` — 锁定整周、自比较、房间和课程比较 Golden cases。
- Regenerate: `competition/adp-kit/evaluation/golden-results.json` — 经人工审阅后接受新的确定性输出。
- Modify: `competition/adp-kit/workflows/workflow-definitions.js` — 03 的时间语义与 self-compare 呈现规范。
- Regenerate: `competition/adp-kit/workflows/workflow-specs.json`
- Regenerate: `competition/adp-kit/workflows/03-课程冲突比较.md`
- Regenerate if TOOL_DEFS description changes: `competition/adp-kit/openapi/campus-tools.openapi.json`

**CloudBase 部署包（由权威源码同步生成，不手改）**
- Regenerate: `competition/adp-kit/cloudfunctions/campusflowAdpTools/src/tools.js`
- Verify: `competition/adp-kit/cloudfunctions/sync-campusflow-function.js --check`
- Extend smoke: `competition/adp-kit/cloudfunctions/test-http-function.js` only if a REST-level regression is needed beyond `tools.test.js`.

**提交包同步**
- Regenerate: `competition/submission-package/**` through the existing build/validate pipeline; do not hand-edit generated submission files.

**ADP V4 导入工件**
- Input: 当前已在平台调试成功的 `03-课程冲突比较-V3-全新ID修复版` 导出 ZIP。
- Output (local artifact, not production-published): `03-课程冲突比较-V4-Final-可直接导入.zip`。
- Preserve: 原 V3 的 WorkflowID/节点引用关系/Bearer 环境变量引用序列化；只改比较参数归一化和结果呈现所需单元格。

---

### Task 1: 用失败测试锁定整周与 self-compare 语义

**Files:**
- Modify: `competition/adp-kit/mcp/campus-tools-mcp/test/tools.test.js`
- Test: `competition/adp-kit/mcp/campus-tools-mcp/test/tools.test.js`

**Interfaces:**
- Consumes: `callTool("compare_schedules", params)`。
- Produces: 对 V4 期望行为的回归合同，供 Task 2 实现。

- [ ] **Step 1: 新增整周比较测试**

在 `compare_schedules` 测试段新增：

```js
test("compare_schedules: weekday=0 仅在本工具兼容为整周", () => {
  const env = callTool("compare_schedules", {
    firstType: "room",
    firstName: "A1-101",
    secondType: "room",
    secondName: "A1-102",
    week: 1,
    weekday: 0,
  });
  assert.equal(env.success, true);
  assert.equal(env.query.week, 1);
  assert.equal(env.query.weekday, null);
  assert.ok(env.items.every((item) => item.weekday >= 1 && item.weekday <= 7));
});
```

- [ ] **Step 2: 新增“0 不能污染其他工具”的严格性测试**

```js
test("query_schedule: weekday=0 仍为非法参数", () => {
  const env = callTool("query_schedule", {
    entityType: "teacher",
    entityName: "教师001",
    week: 1,
    weekday: 0,
  });
  assert.equal(env.success, false);
  assert.equal(env.error.code, "INVALID_PARAM");
});
```

- [ ] **Step 3: 新增 self-compare 不与自身 lesson 配对的测试**

```js
test("compare_schedules: 同实体不产生相同 lessonId 的伪冲突", () => {
  const env = callTool("compare_schedules", {
    firstType: "teacher",
    firstName: "教师003",
    secondType: "teacher",
    secondName: "教师003",
    week: 1,
    weekday: 1,
  });
  assert.equal(env.success, true);
  assert.equal(env.summary.selfCompare, true);
  assert.equal(
    env.items.some((item) => item.first.lessonId === item.second.lessonId),
    false,
  );
});
```

- [ ] **Step 4: 新增 self-compare 赶场去重测试**

```js
test("compare_schedules: 同实体赶场提醒唯一", () => {
  const env = callTool("compare_schedules", {
    firstType: "teacher",
    firstName: "教师003",
    secondType: "teacher",
    secondName: "教师003",
    week: 1,
  });
  assert.equal(env.success, true);
  const keys = env.rushWarnings.map((item) =>
    `${item.entity}|${item.weekday}|${item.from.lessonId}|${item.to.lessonId}`,
  );
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(env.summary.rushWarningCount, env.rushWarnings.length);
});
```

- [ ] **Step 5: 运行测试确认当前实现失败**

Run:

```bash
npm --prefix competition/adp-kit/mcp/campus-tools-mcp test
```

Expected: 至少 `weekday=0` 整周兼容、`summary.selfCompare` 或相同 lesson 自配对断言失败；已有测试不得出现无关回归。

- [ ] **Step 6: Commit 测试合同**

```bash
git add competition/adp-kit/mcp/campus-tools-mcp/test/tools.test.js
git commit -m "test: lock conflict workflow v4 semantics"
```

---

### Task 2: 实现 compare_schedules V4 最小后端改动

**Files:**
- Modify: `competition/adp-kit/mcp/campus-tools-mcp/src/tools.js`
- Test: `competition/adp-kit/mcp/campus-tools-mcp/test/tools.test.js`

**Interfaces:**
- Consumes: 现有 `compareSchedules(params)`、`resolveTimeRange(params)`、`lessonDisplay()`。
- Produces: `summary.selfCompare:boolean`、`summary.rushWarningCount:number`；整周时 `query.weekday === null`；普通消费者保持兼容。

- [ ] **Step 1: 在 compareSchedules 内构造专用时间输入**

在调用 `resolveTimeRange` 前加入只作用于本工具的适配：

```js
const timeParams = { ...(params || {}) };
if (Number(timeParams.weekday) === 0) delete timeParams.weekday;
const tr = resolveTimeRange(timeParams);
if (tr.error) return tr.error;
```

不要修改 `resolveTimeRange()` 的全局规则。

- [ ] **Step 2: 建立 selfCompare 判定**

```js
const selfCompare = r1.resolvedEntity.type === r2.resolvedEntity.type
  && r1.resolvedEntity.id === r2.resolvedEntity.id;
```

- [ ] **Step 3: 跳过同一 lesson 自身配对并去除镜像重复**

冲突双循环中，在时间重叠判断前增加：

```js
if (selfCompare && a.lessonId === b.lessonId) continue;
```

对 self-compare 使用稳定 pair key：

```js
const conflictKeys = new Set();
const leftId = String(a.lessonId || "");
const rightId = String(b.lessonId || "");
const pairKey = selfCompare
  ? [leftId, rightId].sort().join("::")
  : `${leftId}::${rightId}`;
if (conflictKeys.has(pairKey)) continue;
conflictKeys.add(pairKey);
```

这样允许“两条不同 lesson 真正重叠”继续被识别，但 A↔B/B↔A 只输出一次。

- [ ] **Step 4: self-compare 只做一次赶场检测，并做稳定去重**

替换当前两次无条件 `detectRush`：

```js
detectRush(busy1, r1.resolvedEntity.name);
if (!selfCompare) detectRush(busy2, r2.resolvedEntity.name);

const rushSeen = new Set();
const dedupedRushWarnings = rushWarnings.filter((item) => {
  const key = `${item.entity}|${item.weekday}|${item.from.lessonId}|${item.to.lessonId}`;
  if (rushSeen.has(key)) return false;
  rushSeen.add(key);
  return true;
});
```

后续返回 `rushWarnings: dedupedRushWarnings`。

- [ ] **Step 5: 补齐 query 与 summary 合同**

```js
env.query = {
  week: tr.week,
  weekday: tr.weekday == null ? null : tr.weekday,
  date: tr.date || null,
};
env.summary = {
  conflictCount: conflicts.length,
  firstBusySlots: busy1.length,
  secondBusySlots: busy2.length,
  hasConflict: conflicts.length > 0,
  selfCompare,
  rushWarningCount: dedupedRushWarnings.length,
};
```

- [ ] **Step 6: 更新 TOOL_DEFS 文案但不改变 schema**

将 `compare_schedules` 描述明确为“支持指定周整周，weekday 可省略”；保持 `weekday` schema 仍为 `minimum:1, maximum:7`，因为 `0` 是 ADP 兼容输入，不是公开合同中的合法星期。

- [ ] **Step 7: 运行工具测试**

Run:

```bash
npm --prefix competition/adp-kit/mcp/campus-tools-mcp run check
npm --prefix competition/adp-kit/mcp/campus-tools-mcp test
```

Expected: 全部 PASS；特别是 query_schedule 的 `weekday=0` 仍失败，而 compare_schedules 的 `weekday=0` 成功并解释为整周。

- [ ] **Step 8: Commit 实现**

```bash
git add competition/adp-kit/mcp/campus-tools-mcp/src/tools.js competition/adp-kit/mcp/campus-tools-mcp/test/tools.test.js
git commit -m "fix: support whole-week conflict comparisons"
```

---

### Task 3: 锁定 Golden、OpenAPI 与 Cloud Function 同步

**Files:**
- Modify: `competition/adp-kit/evaluation/golden-cases.js`
- Regenerate: `competition/adp-kit/evaluation/golden-results.json`
- Regenerate: `competition/adp-kit/openapi/campus-tools.openapi.json`
- Regenerate: `competition/adp-kit/cloudfunctions/campusflowAdpTools/src/tools.js`
- Regenerate: `competition/submission-package/**`

**Interfaces:**
- Consumes: Task 2 的 `compare_schedules` 输出。
- Produces: source-hash 锁定的 Golden、与权威源码一致的 HTTP Function 部署包与提交包。

- [ ] **Step 1: 保留并明确 4 个核心 Golden 冲突用例**

确认/补充 `golden-cases.js` 至少包含：

```js
conflict("conflict-teacher001-002-week1", {
  firstType: "teacher", firstName: "教师001",
  secondType: "teacher", secondName: "教师002",
  week: 1,
}),
conflict("conflict-teacher003-self-week1-mon", {
  firstType: "teacher", firstName: "教师003",
  secondType: "teacher", secondName: "教师003",
  week: 1, weekday: 1,
}),
conflict("conflict-course-math-english-week1", {
  firstType: "course", firstName: "高等数学A",
  secondType: "course", secondName: "大学英语A",
  week: 1,
}),
conflict("conflict-room-a1-101-a1-102-week1", {
  firstType: "room", firstName: "A1-101",
  secondType: "room", secondName: "A1-102",
  week: 1,
}),
```

- [ ] **Step 2: 先跑 Golden evaluator，确认旧 Golden 因 source hash 或预期变化失败**

```bash
npm --prefix competition/adp-kit run eval:golden
```

Expected: 在源码改变而 Golden 尚未接受时失败，证明门禁有效。

- [ ] **Step 3: 人工审阅 4 个冲突用例输出后接受 Golden**

```bash
node competition/adp-kit/evaluation/generate-golden-results.js --accept-reviewed
npm --prefix competition/adp-kit run eval:golden
```

Expected: Golden 全部 PASS，`dataHash` 仍为 `sha1:fefef4bf425b`。

- [ ] **Step 4: 重新生成 OpenAPI 与工作流说明**

```bash
node competition/adp-kit/openapi/generate-openapi.js
node competition/adp-kit/workflows/generate-workflows.js
```

- [ ] **Step 5: 同步 Cloud Function 部署包**

```bash
node competition/adp-kit/cloudfunctions/sync-campusflow-function.js
node competition/adp-kit/cloudfunctions/sync-campusflow-function.js --check
```

Expected: `HTTP Function 部署包与 CampusTools 权威源一致`。

- [ ] **Step 6: 运行本地 HTTP smoke**

```bash
node competition/adp-kit/cloudfunctions/test-http-function.js
```

Expected: health、401、确定性工具 smoke 全部通过。

- [ ] **Step 7: 跑整个 competition/adp-kit 门禁**

```bash
npm test --prefix competition/adp-kit
```

Expected: CampusTools、Golden、OpenAPI、HTTP Function、submission-package、manifest 全绿。

- [ ] **Step 8: Commit 生成物**

```bash
git add competition/adp-kit competition/submission-package
git commit -m "test: refresh conflict v4 golden artifacts"
```

---

### Task 4: 更新 03 工作流规格，固定整周与 self-compare 呈现

**Files:**
- Modify: `competition/adp-kit/workflows/workflow-definitions.js`
- Regenerate: `competition/adp-kit/workflows/workflow-specs.json`
- Regenerate: `competition/adp-kit/workflows/03-课程冲突比较.md`

**Interfaces:**
- Consumes: `compare_schedules.summary.selfCompare`、`rushWarningCount`、`query.weekday`。
- Produces: ADP V4 的参数语义和最终回复规范。

- [ ] **Step 1: 更新 03 timePolicy**

明确：

```text
“第N周”只给 week，不指定 weekday，表示整周；不得默认周一。ADP 内部若以 0 表示未指定 weekday，工具入口会仅对 compare_schedules 规范化为整周。
```

- [ ] **Step 2: 更新 branch/result policy**

加入 self-compare 呈现要求：

```text
summary.selfCompare=true 时使用“<实体> · 课程安排风险检查”，忙碌课次只显示一次；不得使用“A vs A”标题；rushWarnings 只展示工具已去重结果。
```

- [ ] **Step 3: 更新 03 samples**

至少加入：

```text
比较A1-101和A1-102第1周的占用冲突
比较高等数学A和大学英语A第1周的时间冲突
教师003和教师003第1周周一是否存在冲突或跨校区赶场
教师001和教师002第1周是否存在冲突
```

- [ ] **Step 4: 重新生成并检查工作流文档**

```bash
node competition/adp-kit/workflows/generate-workflows.js
node competition/adp-kit/workflows/generate-workflows.js --check
```

Expected: 无漂移。

- [ ] **Step 5: Commit 工作流规格**

```bash
git add competition/adp-kit/workflows
git commit -m "docs: finalize conflict workflow v4 contract"
```

---

### Task 5: 赛事 CloudBase code-only 更新与公网回归

**Files:**
- Deploy source: `competition/adp-kit/cloudfunctions/campusflowAdpTools/**`
- No production files modified.

**Interfaces:**
- Consumes: Task 3 已同步且通过测试的函数部署包。
- Produces: 原 URL/原函数 ID 上新的 V4 compare_schedules 语义。

- [ ] **Step 1: 部署前记录函数与环境变量快照**

记录函数 ID、状态和全部现有环境变量；尤其保存 `CAMPUS_API_TOKEN` 的存在性与值哈希/逐值一致性比对信息，不在日志打印真实 token。

- [ ] **Step 2: 只执行 campusflowAdpTools code-only update**

使用仓库当前已验证的 CloudBase CLI 登录态和既有部署方式，不删除、不重建函数，不轮换 token。

- [ ] **Step 3: 公网 smoke — 整周房间比较**

POST `/api/compare_schedules`：

```json
{
  "firstType": "room",
  "firstName": "A1-101",
  "secondType": "room",
  "secondName": "A1-102",
  "week": 1,
  "weekday": 0
}
```

Expected: HTTP 200、`success=true`、`query.weekday=null`、`evidence.verified=true`、`dataHash=sha1:fefef4bf425b`。

- [ ] **Step 4: 公网 smoke — self compare**

POST：

```json
{
  "firstType": "teacher",
  "firstName": "教师003",
  "secondType": "teacher",
  "secondName": "教师003",
  "week": 1,
  "weekday": 1
}
```

Expected: `summary.selfCompare=true`；`items` 中不存在 `first.lessonId===second.lessonId`；`rushWarnings` 无重复。

- [ ] **Step 5: 公网 smoke — 负向严格性**

调用 `/api/query_schedule` 并传 `weekday=0`。

Expected: `success=false` 且 `error.code=INVALID_PARAM`，证明兼容没有污染其他工具。

- [ ] **Step 6: 部署后环境变量对比**

确认部署前后函数 ID 未变，全部环境变量逐值一致，无 token 请求仍返回 401。

---

### Task 6: 从已验证 V3 导出包生成 03-V4 Final ADP ZIP

**Files:**
- Input artifact: 已成功调试的 `03-课程冲突比较-V3-全新ID修复版` ADP 导出 ZIP。
- Output artifact: `03-课程冲突比较-V4-Final-可直接导入.zip`

**Interfaces:**
- Consumes: V3 的真实 WorkflowID、节点 ID、变量引用、环境变量 Bearer 序列化。
- Produces: 可导入 ADP V2.6 且不触发 450081/引用节点不存在的 V4 工作流。

- [ ] **Step 1: 解包并建立结构基线**

读取 ZIP 内：

```text
workflows.xlsx
workflow_references.xlsx
variables.xlsx
parameters.xlsx
example_queries.xlsx
```

先保存 sheet 名、行数、WorkflowID、NodeID、引用 VarBizID 的基线摘要；不重建整个工作簿。

- [ ] **Step 2: 只修改“比较输入归一化/冲突查询参数归一化”相关代码单元格**

保持现有内部 `weekday=0` 表达即可；后端 V4 已在 `compare_schedules` 入口兼容，因此 ADP 不再通过复杂 Excel 条件引用尝试省略字段。

要求：

```text
第N周 -> week=N, weekday=0
第N周周X -> week=N, weekday=1..7
具体日期 -> date=YYYY-MM-DD
```

不得把整周改成周一。

- [ ] **Step 3: 只修改结果核验与呈现代码单元格**

逻辑要求：

```text
if summary.selfCompare:
  标题 = “<实体> · 课程安排风险检查”
  忙碌课次只显示一次
else:
  标题 = “A vs B · 课程冲突比较”

冲突、赶场、dataVersion、verified 全部读取工具返回值；不得在呈现层重新推断事实。
```

- [ ] **Step 4: 修改示例问题但不改节点引用**

加入 Task 4 的 4 个核心验收句；保留至少一个指定日期+节次的旧回归句。

- [ ] **Step 5: ZIP 结构静态校验**

验证：

```text
所有 XLSX 均可由 openpyxl 打开
无公式错误/非法 sheet 引用
所有引用 NodeID/WorkflowID 在对应表内存在
环境变量 VarBizID 与 V3 基线完全一致
没有新增明文 token
ZIP 根目录结构与 V3 一致
```

- [ ] **Step 6: 导入 ADP 测试环境，不覆盖当前 V3**

新名称：`03-课程冲突比较-V4-Final`；先以新的工作流实例导入测试，不发布。

---

### Task 7: ADP 六条验收与冻结 03

**Files:**
- No production code change unless a test exposes a real defect.
- Update after success: `competition/adp-kit/reports/progress-log.md`。

**Interfaces:**
- Consumes: Task 5 公网 V4 CampusTools + Task 6 V4 ADP ZIP。
- Produces: 03-V4 Final 验收证据和冻结状态。

- [ ] **Step 1: 整周房间比较**

```text
比较A1-101和A1-102第1周的占用冲突
```

Expected: 不出现 `weekday 需为 1-7`，比较范围为整周。

- [ ] **Step 2: 整周课程比较**

```text
比较高等数学A和大学英语A第1周的时间冲突
```

Expected: 整周单次工具调用，成功或确定性空结果均为合法结果。

- [ ] **Step 3: self-compare**

```text
教师003和教师003第1周周一是否存在冲突或跨校区赶场
```

Expected: 标题为“教师003 · 课程安排风险检查”；不把同一 lesson 与自己计为冲突；赶场不重复。

- [ ] **Step 4: 普通整周教师比较**

```text
教师001和教师002第1周是否存在冲突
```

Expected: 保持 A vs B 正常比较格式。

- [ ] **Step 5: 指定星期+节次回归**

```text
比较2025级A班和2025级B班第1周周五下午的课程冲突
```

Expected: 与 V3 已验证行为一致。

- [ ] **Step 6: 实体错误回归**

```text
比较教师099和教师001第1周的课程冲突
```

Expected: `ENTITY_NOT_FOUND`/建议由工具返回；不得生成模型猜测课程事实。

- [ ] **Step 7: 记录每条验收证据**

每条保存：工作流状态、`compare_schedules` 请求 body、工具响应、`dataVersion`、`dataHash`、`evidence.verified`、最终回复。

- [ ] **Step 8: 全仓关键门禁**

```bash
npm test --prefix competition/adp-kit
git diff --check
```

Expected: PASS。

- [ ] **Step 9: 更新 progress log 并提交**

在 `competition/adp-kit/reports/progress-log.md` 记录 V4 已通过 6/6 ADP 验收、线上 `dataHash=sha1:fefef4bf425b`、未发布/未合并/未改生产。

```bash
git add competition/adp-kit/reports/progress-log.md
git commit -m "docs: freeze conflict workflow v4"
```

---

## Plan Self-Review

- Spec coverage: 已覆盖整周语义、`weekday=0` 隔离兼容、self-compare 自配对跳过、镜像去重、赶场去重、summary 字段、ADP 呈现、Golden、CloudBase code-only、6 条验收和生产隔离。
- Placeholder scan: 无 TBD/TODO；唯一外部输入为用户已经存在并已调试成功的 V3 ADP 导出包，这是实施必需工件而非未定义需求。
- Type consistency: `summary.selfCompare:boolean`、`summary.rushWarningCount:number`、`query.weekday:number|null` 在后端、ADP 规格和验收中一致。
- Scope: 本计划只完成 03 V4 Final，不包含 04。
