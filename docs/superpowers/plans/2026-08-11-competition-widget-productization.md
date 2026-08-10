# 校园智序 · 小序 Widget 产品化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改 01–04 冻结事实逻辑的前提下，建立统一 Widget Adapter，并把 schedule / classroom / conflict / day_plan / error / choice 六类结果升级为“校园任务单 / 时间票据”交互式产品体验。

**Architecture:** `CampusTools verified envelope → pure Widget Adapter → campus-widget/v2 ViewModel → ADP 原生 Widget / H5 fallback`。Adapter 只做字段映射、裁剪、标签和安全 `sys.chat` 动作生成；不做日期、实体、冲突、空教室或 visitor 业务推理。ADP 原生 Widget 私有序列化格式不得猜测；若仓库没有真实 seed，则先交付可验证的 Widget ViewModel、H5 fallback 和精确 ADP 映射说明，再通过一个真实 ADP Widget seed 完成自动构建。

**Tech Stack:** Node.js CommonJS、JSON Schema Draft-07、原生 HTML/CSS/JavaScript、腾讯云智能 ADP Widget、现有 CampusTools / competition-demo-v1。

## Global Constraints

- 01–04 已冻结；除评测发现回归外，不修改其确定性业务逻辑。
- 动态事实只来自 CampusTools verified envelope；Widget/Adapter 不推断课程、教室、冲突、日期或身份。
- `dataVersion` 必须为 `competition-demo-v1`；动态成功卡必须要求 `evidence.verified === true`。
- 比赛环境保持匿名；不得引入真实学校、学院、教师、学生、团队成员或指导教师身份。
- 不输出或存储 token、NodeID、VarBizID、系统 Prompt、内部 URL 等敏感实现细节到 Widget action message。
- 采用 C 方案：4 主 Widget（schedule/classroom/conflict/day_plan）+ 2 通用辅助 Widget（error/choice）。
- 统一视觉语言为“校园任务单 / 时间票据”；移动端 320–430px 优先，不使用常见 AI 紫色渐变聊天视觉。
- 每张主卡最多 3 个高价值动作；动作优先 `sys.chat`，以用户可理解的自然语言继续现有 Agent 路由与多轮上下文。
- Choice 使用等待用户操作语义；普通结果卡直接流转并保留 Markdown fallback。
- ADP 原生 Widget 私有结构不得手写猜测；没有真实 seed 时必须显式标记 `ADP_WIDGET_SEED_PENDING`。

---

## File Structure

- Create `competition/adp-kit/widget/adapter.js` — 六类 envelope → `campus-widget/v2` ViewModel 的纯函数适配层。
- Create `competition/adp-kit/widget/test-widget-adapter.js` — Adapter 单元测试与安全门禁。
- Modify `competition/adp-kit/widget/widget-schema.json` — 升级统一 ViewModel Schema 到 v2。
- Modify `competition/adp-kit/widget/generate-samples.js` — 样例必须经过 Adapter 生成，不再手工拼卡片事实。
- Modify `competition/adp-kit/widget/widget.js` — H5 fallback 按 4+2 卡片语义渲染 ViewModel。
- Modify `competition/adp-kit/widget/styles.css` — 时间票据视觉、筛选 chips、风险条、时间轴、动作区。
- Modify `competition/adp-kit/widget/README.md` — 原生 ADP / H5 fallback 双路径说明。
- Modify `competition/adp-kit/validate-kit.js` — 校验 v2 Schema、六卡样例、verified/action 安全约束。
- Modify `competition/adp-kit/package.json` — 将 Adapter 测试纳入 `npm test` 门禁。
- Create `competition/adp-kit/widget/adp-widget-mapping.md` — 六张原生 Widget 的字段、组件、Action、等待模式映射。
- Create `competition/adp-kit/widget/adp-widget-seed-requirements.md` — 若需 seed，只要求用户创建一个最小真实 Widget 并导出，后续由 Agent 自动生成其余模板。
- Modify `competition/adp-kit/reports/current-adp-checkpoint.md` — 记录 Widget 阶段真实完成/待人工事项。

---

### Task 1: 锁定 campus-widget/v2 ViewModel 与 Adapter 测试合同

**Files:**
- Create: `competition/adp-kit/widget/test-widget-adapter.js`
- Modify: `competition/adp-kit/package.json`

**Interfaces:**
- Consumes: 现有 CampusTools `query_schedule` / `find_available_classrooms` / `compare_schedules` / `generate_day_plan` envelope。
- Produces: 对 Task 2 的函数合同：`adaptScheduleResult(envelope, context)`, `adaptClassroomResult(envelope, context)`, `adaptConflictResult(envelope, context)`, `adaptDayPlanResult(envelope, context)`, `adaptErrorResult(envelope, context)`, `adaptChoiceResult(envelope, context)`。

- [ ] **Step 1: 写失败测试**

测试至少覆盖：

```js
const assert = require("assert");
const {
  adaptScheduleResult,
  adaptClassroomResult,
  adaptConflictResult,
  adaptDayPlanResult,
  adaptErrorResult,
  adaptChoiceResult,
} = require("./adapter");

assert.strictEqual(adaptScheduleResult(scheduleEnvelope, {}).schemaVersion, "campus-widget/v2");
assert.strictEqual(adaptScheduleResult(scheduleEnvelope, {}).cardType, "schedule");
assert.strictEqual(adaptClassroomResult(classroomEnvelope, {}).filters.some((x) => x.label === "容量≥60"), true);
assert.strictEqual(adaptConflictResult(selfCompareEnvelope, {}).title, "教师003 · 课程安排风险检查");
assert.strictEqual(adaptConflictResult(selfCompareEnvelope, {}).summary.rushWarningCount, 1);
assert.strictEqual(adaptDayPlanResult(dayPlanEnvelope, {}).cardType, "day_plan");
assert.strictEqual(adaptErrorResult(errorEnvelope, {}).success, false);
assert.strictEqual(adaptChoiceResult(choiceEnvelope, {}).interaction.waitForUser, true);
```

并断言所有成功动态卡：

```js
assert.strictEqual(view.evidence.verified, true);
assert.strictEqual(view.dataVersion, "competition-demo-v1");
assert(view.actions.length <= 3);
assert(view.actions.every((a) => a.type === "sys.chat"));
assert(view.actions.every((a) => !/token|nodeid|varbizid|authorization/i.test(JSON.stringify(a))));
```

- [ ] **Step 2: 将测试加入 package gate 并确认 RED**

`package.json` 的 `test` 链在 Widget 样例生成前增加：

```json
"node widget/test-widget-adapter.js"
```

预期：由于 `widget/adapter.js` 尚不存在，CI/本地执行失败于 `Cannot find module './adapter'`。

- [ ] **Step 3: 提交 RED 合同**

```bash
git add competition/adp-kit/widget/test-widget-adapter.js competition/adp-kit/package.json
git commit -m "test(competition): lock widget adapter contract"
```

---

### Task 2: 实现纯 Widget Adapter 与 v2 Schema

**Files:**
- Create: `competition/adp-kit/widget/adapter.js`
- Modify: `competition/adp-kit/widget/widget-schema.json`
- Test: `competition/adp-kit/widget/test-widget-adapter.js`

**Interfaces:**
- Consumes: Task 1 六个函数合同。
- Produces: `campus-widget/v2` ViewModel。

- [ ] **Step 1: 实现公共安全门禁**

`adapter.js` 必须提供：

```js
function assertVerifiedEnvelope(envelope) {
  if (!envelope || envelope.success === false) return;
  if (envelope.dataVersion !== "competition-demo-v1") throw new Error("Widget adapter rejected unexpected dataVersion");
  if (!envelope.evidence || envelope.evidence.verified !== true) throw new Error("Widget adapter rejected unverified dynamic result");
}
```

并提供统一 `baseViewModel(cardType, envelope)`：

```js
{
  schemaVersion: "campus-widget/v2",
  cardType,
  success,
  queryId,
  dataVersion,
  title,
  subtitle,
  timeText,
  filters: [],
  summary: {},
  items: [],
  actions: [],
  interaction: { waitForUser: false },
  evidence: { verified: Boolean(...) },
  error: null
}
```

- [ ] **Step 2: 实现 schedule/classroom/conflict/day_plan 四个主 Adapter**

约束：
- `schedule` 只裁剪工具 items，最多首屏 5 条，并产生 `查看整周 / 换一天 / 比较冲突` 等上下文动作。
- `classroom` 将 campus/date/period/building/capacity 转成 `filters` chips；空结果仍为 classroom 卡，提供放宽条件动作。
- `conflict` 读取 `summary.selfCompare` 切换标题；冲突和 `rushWarnings` 分开进入 summary/items，不重算。
- `day_plan` 读取工具已有 timeline/items，区分 lesson/gap/study/risk；不自行补课程。

- [ ] **Step 3: 实现 error/choice 两个辅助 Adapter**

- `error` 将工具 code 映射为人话恢复文案，但保留 `error.code` 供调试。
- `choice` 候选最多 5 个，`interaction.waitForUser=true`，每个候选 Action 使用 `sys.chat` 自然语言确认，不暴露内部 ID。

- [ ] **Step 4: 升级 `widget-schema.json`**

Schema 必须新增并约束：
- `schemaVersion` const `campus-widget/v2`
- `filters` array
- `summary` object
- `interaction.waitForUser` boolean
- `actions` maxItems 3，`type` 只允许 `sys.chat|sys.go_to_url|sys.download`
- 成功动态卡仍要求 `evidence.verified`

- [ ] **Step 5: 运行 Adapter 测试，确认 GREEN**

Run:

```bash
node competition/adp-kit/widget/test-widget-adapter.js
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add competition/adp-kit/widget/adapter.js competition/adp-kit/widget/widget-schema.json
git commit -m "feat(competition): add verified widget adapters"
```

---

### Task 3: 让样例与总门禁全部经过 Adapter

**Files:**
- Modify: `competition/adp-kit/widget/generate-samples.js`
- Modify: `competition/adp-kit/validate-kit.js`
- Generated: `competition/adp-kit/widget/sample-results.json`
- Generated: `competition/adp-kit/widget/sample-results.js`

**Interfaces:**
- Consumes: Task 2 Adapter。
- Produces: 六卡真实确定性样例和总门禁。

- [ ] **Step 1: 写/加强失败断言**

`validateInterfaces()` 追加：

```js
assert.strictEqual(schema.properties.schemaVersion.const, "campus-widget/v2");
CARD_TYPES.forEach((type) => {
  const sample = samples[type];
  assert.strictEqual(sample.schemaVersion, "campus-widget/v2");
  assert(sample.actions.length <= 3);
});
["schedule", "classroom", "conflict", "day_plan"].forEach((type) => {
  assert.strictEqual(samples[type].evidence.verified, true);
});
```

- [ ] **Step 2: 改 `generate-samples.js`**

真实 CampusTools envelope 继续由 `callTool()` 生成，但卡片必须通过：

```js
const adapter = require("./adapter");
const samples = {
  schedule: adapter.adaptScheduleResult(schedule, {...}),
  classroom: adapter.adaptClassroomResult(classroom, {...}),
  conflict: adapter.adaptConflictResult(conflict, {...}),
  day_plan: adapter.adaptDayPlanResult(dayPlan, {...}),
  choice: adapter.adaptChoiceResult(choiceEnvelope, {...}),
  error: adapter.adaptErrorResult(errorEnvelope, {...}),
};
```

不得再手写动态课程/教室事实。

- [ ] **Step 3: 运行**

```bash
node competition/adp-kit/widget/generate-samples.js
node competition/adp-kit/validate-kit.js
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add competition/adp-kit/widget/generate-samples.js competition/adp-kit/widget/sample-results.json competition/adp-kit/widget/sample-results.js competition/adp-kit/validate-kit.js
git commit -m "test(competition): validate widget v2 samples"
```

---

### Task 4: 升级 H5 fallback 为评委可读的 4+2 产品界面

**Files:**
- Modify: `competition/adp-kit/widget/widget.js`
- Modify: `competition/adp-kit/widget/styles.css`
- Modify: `competition/adp-kit/widget/index.html`
- Modify: `competition/adp-kit/widget/README.md`

**Interfaces:**
- Consumes: Task 2 的 `campus-widget/v2` ViewModel。
- Produces: 与 ADP 原生 Widget 同一信息架构的 H5 fallback。

- [ ] **Step 1: 渲染结构升级**

必须实现：
- Schedule：节次票据时间轴 + “还有 N 条”摘要。
- Classroom：顶部 filter chips + 教室容量/类型/楼栋 + 空结果恢复动作。
- Conflict：冲突红条与 rushWarnings 橙条分区；selfCompare 使用风险检查标题。
- Day Plan：纵向 lesson/gap/study/risk 时间轴。
- Choice：候选按钮列表。
- Error：恢复说明与动作。

- [ ] **Step 2: Action 事件合同**

H5 fallback 点击动作触发：

```js
{
  kind: "action",
  action: { id, type, label, message }
}
```

不得把整个 tool envelope 回传给 parent；只回传安全 Action ViewModel，减少数据泄露面。

- [ ] **Step 3: 视觉实现**

保留现有暖纸张/墨绿基线，增加：
- `.filter-chip`
- `.risk-band`
- `.conflict-band`
- `.timeline-*`
- `.result-count`
- `.more-summary`

不依赖外部字体/CDN。

- [ ] **Step 4: README 更新**

明确：
- H5 是 fallback / 演示，不替代 ADP 原生 Widget。
- 样例来自真实 CampusTools + Adapter。
- `sys.chat` 语义通过 action.message 与 ADP 原生 Action 对齐。

- [ ] **Step 5: 运行全 Widget gate**

```bash
node competition/adp-kit/widget/test-widget-adapter.js
node competition/adp-kit/widget/generate-samples.js
node competition/adp-kit/validate-kit.js
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add competition/adp-kit/widget/widget.js competition/adp-kit/widget/styles.css competition/adp-kit/widget/index.html competition/adp-kit/widget/README.md
git commit -m "feat(competition): productize campus task widget fallback"
```

---

### Task 5: 定义 ADP 原生 4+2 Widget 映射与最小 seed 工作流

**Files:**
- Create: `competition/adp-kit/widget/adp-widget-mapping.md`
- Create: `competition/adp-kit/widget/adp-widget-seed-requirements.md`

**Interfaces:**
- Consumes: `campus-widget/v2` ViewModel。
- Produces: 可由 Codex/Kimi 或人工在 ADP 中无歧义实现的六 Widget 映射。

- [ ] **Step 1: 写六卡组件映射**

每张卡必须列出：
- Widget 名称
- 入参字段
- 组件树
- 条件显示规则
- Action label/message/type
- 是否 `waitForUser`
- 工作流接入点
- Markdown fallback 行为

- [ ] **Step 2: 固化 Action 文案**

例如 Classroom：

```json
[
  {"id":"change-campus","type":"sys.chat","label":"换校区","message":"换个校区看看"},
  {"id":"change-time","type":"sys.chat","label":"改时段","message":"我想改一下查询时段"},
  {"id":"raise-capacity","type":"sys.chat","label":"容量≥60","message":"要能坐60人的"}
]
```

Action 只表达用户意图；具体参数仍由现有上下文层补齐。

- [ ] **Step 3: 定义 seed 获取策略**

如果 ADP 没有官方可直接生成的 Widget 文件格式，仅要求用户一次性创建并导出一个最小 Widget seed，至少包含：
- Text
- Badge/Tag（若平台有）
- Repeater/List
- Button + `sys.chat`
- 一个输入绑定
- 一个条件显示

导出后由 Agent 解析真实私有格式，并自动生成 6 个原生 Widget；不得要求用户手工配置六遍。

- [ ] **Step 4: Commit**

```bash
git add competition/adp-kit/widget/adp-widget-mapping.md competition/adp-kit/widget/adp-widget-seed-requirements.md
git commit -m "docs(competition): define native ADP widget mapping"
```

---

### Task 6: 全链门禁与研发检查点

**Files:**
- Modify: `competition/adp-kit/reports/current-adp-checkpoint.md`

**Interfaces:**
- Consumes: Tasks 1–5。
- Produces: Widget 产品化阶段的可恢复研发状态。

- [ ] **Step 1: 运行完整 ADP kit gate**

```bash
npm test --prefix competition/adp-kit
```

Expected:
- Widget Adapter tests PASS
- CampusTools tests PASS
- Golden PASS
- HTTP function local smoke PASS
- validate-kit PASS
- submission package validation PASS

- [ ] **Step 2: 更新检查点**

记录：
- Widget Adapter / Schema / H5 完成状态
- 六卡 Action 合同
- 是否已有真实 ADP Widget seed
- 若没有，明确 `ADP_WIDGET_SEED_PENDING`
- 不把“设计完成”写成“原生 Widget 已导入”

- [ ] **Step 3: Commit**

```bash
git add competition/adp-kit/reports/current-adp-checkpoint.md
git commit -m "docs(competition): record widget productization checkpoint"
```

- [ ] **Step 4: PR 状态确认**

确认 PR #49 仍：
- open
- 未 merge
- 未正式发布

---

## Post-Implementation ADP Acceptance

获得真实 seed 并生成原生 Widget 后，应用测试窗至少验收：

1. `教师003第1周周一的课` → Schedule 卡；点“比较冲突”后能进入 03。
2. `校区A 2026-09-03 下午有哪些空教室` → Classroom 卡，显示筛选 chips；点击“换校区”形成下一轮任务。
3. `教师003第1周周一跨校区来得及吗` → Conflict self-compare 风险卡，1 条橙色赶场提醒。
4. `帮我看看2026-09-04的安排` → Day Plan 时间轴卡。
5. 歧义实体 → Choice 卡等待用户选择后继续原任务。
6. `校区C，帮我安排2026-09-04` → Error 卡提供恢复动作，不伪造事实。

Widget 通过后才进入下一阶段：32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 比赛演示资产。
