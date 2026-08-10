# 校园智序 03-V4.1 + 04 今日校园计划 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏 01/02/03 已稳定能力和 CloudBase 赛事接口的前提下，用最小 Schema 补丁冻结 03，并构建可直接导入 ADP 的 04「今日校园计划」聚合稳定版。

**Architecture:** 03 只修复 ADP 工具输出 Schema，使呈现层能读取后端已返回的 `summary.selfCompare` / `rushWarningCount`。04 采用单聚合工具路线：参数提取 → 输入归一化 → `get_academic_context` → 日期判断 → `generate_day_plan` → 核验与呈现 → 回复；所有课程、空档、空教室和赶场事实都只来自 CampusTools。

**Tech Stack:** 腾讯云智能 ADP V2_6 导出包、Node/JavaScript CampusTools、Python CODE 节点、XLSX（artifact_tool）、ZIP、GitHub PR #49。

## Global Constraints

- 开发分支固定为 `feat/campusflow-adp-integration`；PR #49 保持 open、不得 merge。
- 比赛数据固定 `competition-demo-v1`，`dataHash=sha1:fefef4bf425b`。
- CampusTools 基础 URL 保持现有 CloudBase URL，不新增/删除/重建函数。
- 04 固定匿名身份 `visitor-demo-001`，任何用户输入/API 参数/会话变量不得覆盖。
- ADP Bearer 环境变量继续使用 `campus_api_authorization`，VarBizID=`a39583c8-2484-46f2-8ba8-e7384a0365e8`，不得硬编码 token。
- 03-V4.1 不修改 CloudBase，不修改 XLSX，只补 workflow JSON 的工具输出 Schema。
- 04 工作簿编辑仅使用 `artifact_tool`；不得使用 openpyxl/pandas/LibreOffice 重写 XLSX。
- 04 WorkflowID 固定 `6445d4f9-e89c-446d-9f50-a4e6143562ca`；现有 START/END NodeID 保持不变。
- 所有动态事实必须经过 `success=true`、`dataVersion=competition-demo-v1`、`evidence.verified=true` 门禁；失败时不由模型补造。

---

### Task 1: 生成并静态验证 03-V4.1 最小补丁包

**Files:**
- Input artifact: `/mnt/data/03-课程冲突比较-V4-Final-可直接导入.zip`
- Output artifact: `/mnt/data/03-课程冲突比较-V4.1-Final-自比较呈现修复.zip`
- No repository source change required.

**Interfaces:**
- Consumes: 后端 `compare_schedules.summary.selfCompare:boolean`、`rushWarningCount:number`。
- Produces: ADP 工具节点可见的 `Output.Body.summary.selfCompare` / `rushWarningCount`。

- [ ] **Step 1: 解包并锁定 V4 基线**

验证 ZIP 根目录 6 个标准文件、WorkflowID、11 个 NodeID、VarBizID 和 SHA256；源包只读。

- [ ] **Step 2: 写一个先失败的静态断言**

对 NodeID `6afc4958-31f8-41db-8a11-dd83dec937c7` 的工具输出 Schema 断言：

```python
assert "selfCompare" in summary_properties
assert "rushWarningCount" in summary_properties
```

Expected: 当前 V4 Final 失败。

- [ ] **Step 3: 只补两个 Schema 字段**

在 `Outputs -> Output.Body.summary.Properties` 中追加：

```text
selfCompare: BOOL
rushWarningCount: INT
```

同步 `NodeUI.data.output` 中同一工具输出树（若该节点使用 NodeUI 输出注册）；不改其他字段、不改任何 ID。

- [ ] **Step 4: 运行静态回归**

必须验证：WorkflowID/NodeID/ParameterId/VarBizID 完全不变、XLSX 文件字节级不变、ZIP 无额外目录、JSON 可解析、无明文 token。

- [ ] **Step 5: 导出 V4.1 ZIP 并记录 SHA256**

输出固定：

`/mnt/data/03-课程冲突比较-V4.1-Final-自比较呈现修复.zip`

---

### Task 2: 锁定 04 后端聚合工具合同与 Golden 行为

**Files:**
- Inspect: `competition/adp-kit/mcp/campus-tools-mcp/src/tools.js`
- Inspect/Test: `competition/adp-kit/mcp/campus-tools-mcp/test/tools.test.js`
- Inspect: `competition/adp-kit/evaluation/golden-cases.js`
- Modify only if a genuine contract gap is proven by a failing test.

**Interfaces:**
- Consumes: `generateDayPlan({visitorId,date,preferredCampus?,preferredStudyDuration?})`。
- Produces: 04 ADP 所需稳定字段：`items[]`、`summary.lessonCount`、`summary.hasCrossCampus`、`query`、`actions`、`evidence`。

- [ ] **Step 1: 写/确认以下行为测试**

至少覆盖：

```js
// fixed demo user date with lessons
assert.equal(result.success, true);
assert.equal(result.evidence.verified, true);
assert.equal(result.dataVersion, "competition-demo-v1");

// preferred campus
assert.ok(result.items.filter(x => x.type === "gap").every(g => Array.isArray(g.studyRooms)));

// duration 2
assert.equal(generateDayPlan({...base, preferredStudyDuration: 2}).success, true);

// invalid campus
assert.equal(generateDayPlan({...base, preferredCampus: "校区C"}).error.code, "ENTITY_NOT_FOUND");

// invalid duration
assert.equal(generateDayPlan({...base, preferredStudyDuration: 11}).error.code, "INVALID_PARAM");
```

- [ ] **Step 2: 运行 CampusTools tests**

```bash
npm --prefix competition/adp-kit/mcp/campus-tools-mcp run check
npm --prefix competition/adp-kit/mcp/campus-tools-mcp test
```

Expected: PASS。若现有实现已经满足合同，不改后端。

- [ ] **Step 3: 验证完整赛事门禁**

```bash
npm test --prefix competition/adp-kit
```

Expected: Golden/OpenAPI/HTTP Function/submission package 全绿。

---

### Task 3: 检查真实 04 ADP 基线并确定可复用序列化模板

**Files:**
- Input artifact: `/mnt/data/export-04-今日校园计划.zip`
- Reference artifact: `/mnt/data/03-课程冲突比较-V4-Final-可直接导入.zip`

**Interfaces:**
- Consumes: 04 原 START/END 元数据；03 已真实导入成功的 PARAMETER_EXTRACTOR / CONDITION / CODE / TOOL / REPLY 序列化结构。
- Produces: 04 新增节点的稳定 JSON 模板和 XLSX 参数/变量行结构。

- [ ] **Step 1: 解包 04 基线并记录**

记录：ProtoVersion、WorkflowID、START/END NodeID、CanvasStructure、5 个 XLSX sheet 名与行数。

- [ ] **Step 2: 从 03 V4 提取节点模板**

分别提取并去业务化：

```text
PARAMETER_EXTRACTOR
CODE
CONDITION
HTTP TOOL(get_academic_context)
HTTP TOOL(business tool)
REPLY
END reference
```

- [ ] **Step 3: 建立 NodeID 映射**

保留：

```text
START 1a3e8a5b-41e3-13f7-a599-2503a9ad4d25
END   85058226-c625-007d-b31f-bed78bd277ac
```

为 7 个新增节点生成稳定 UUID，一次生成后全局复用，不二次重建。

---

### Task 4: 构建 04 参数提取与输入归一化

**Files:**
- Build artifact JSON under temporary `/mnt/data` workspace.
- Modify artifact workbooks with artifact_tool only.

**Interfaces:**
- Consumes: `SYS.UserQuery` / ADP 参数提取节点。
- Produces:
  - extractor: `date_text:string`, `preferred_campus:string`, `preferred_study_duration_text:string`
  - normalizer: `date_text:string`, `preferred_campus:string`, `preferred_study_duration_query:int`, `duration_specified:bool`

- [ ] **Step 1: 创建参数提取参数行**

参数均非必填；`preferred_study_duration_text` 必须是 STRING，不使用可空 INT。

- [ ] **Step 2: 注册 ParameterExtractor 输出**

同时写 `Outputs` 与 `NodeUI.data.output`：

```text
Output.date_text
Output.preferred_campus
Output.preferred_study_duration_text
```

- [ ] **Step 3: 写 CODE 节点失败测试样例**

```python
assert normalize("", "", "") == {"preferred_study_duration_query": 10, "duration_specified": False, ...}
assert normalize("", "A校区", "2")["preferred_campus"] == "校区A"
assert normalize("", "校区C", "11")["preferred_study_duration_query"] == 11
```

- [ ] **Step 4: 实现输入归一化**

规则必须为：A/B 校区归一化；未指定 duration → `10,false`；明确合法整数原样传；明确非法整数也原样传给工具校验，不静默修正。

---

### Task 5: 构建日期解析、日期判断与 generate_day_plan 工具节点

**Interfaces:**
- Consumes: Task 4 normalizer outputs。
- Produces: 经过日期门禁的 `resolvedDate` 和完整 `generate_day_plan` 工具结果。

- [ ] **Step 1: 创建 get_academic_context 工具节点**

POST `/api/get_academic_context`；Authorization 引用固定 VarBizID；Body 只传 `dateText`。

输出 Schema 最低注册：

```text
success
dataVersion
evidence.verified/dataHash/note
items[].resolvedDate/week/weekday/weekdayName/inSemester
error.code/message/details
```

- [ ] **Step 2: 创建日期结果判断**

成功分支仅当：

```text
success == true
items[0].inSemester == true
```

其他情况直接进入统一呈现节点，不调用计划工具。

- [ ] **Step 3: 创建 generate_day_plan 工具节点**

POST `/api/generate_day_plan`，Body：

```text
visitorId = USER_INPUT("visitor-demo-001")
date = academic.items[0].resolvedDate
preferredCampus = normalizer.preferred_campus
preferredStudyDuration = normalizer.preferred_study_duration_query
```

用户输入 `visitor_id` 不得被引用。

- [ ] **Step 4: 完整注册工具输出 Schema**

必须注册呈现层会读取的全部字段：`success/dataVersion/evidence/resolvedEntity/query/summary/items/actions/error`；items 的 lesson/gap/tip 字段全部注册。

---

### Task 6: 构建统一核验与呈现节点

**Interfaces:**
- Consumes: 日期工具输出、day-plan 工具输出、`duration_specified` 与偏好值。
- Produces: `Output.text:string`，仅重排工具事实。

- [ ] **Step 1: 写呈现代码单测夹具**

覆盖：有课+gap、跨校区 tip、无课、非法校区、非法时长、学期外、版本不一致/verified=false。

- [ ] **Step 2: 实现失败门禁**

优先级：日期失败/学期外 → day-plan error → dataVersion/verified 门禁 → 成功结果。

- [ ] **Step 3: 实现成功时间轴**

lesson/gap/tip 按工具 `items` 原顺序呈现；gap 仅展示工具给出的 `studyRooms`；不重新计算事实。

- [ ] **Step 4: 实现固定身份防覆盖证据**

呈现文本不回显用户伪造 visitor；工具节点始终固定 `visitor-demo-001`。

- [ ] **Step 5: 创建 REPLY 节点并连接 END**

REPLY 仅输出 CODE 节点的 `Output.text`。

---

### Task 7: 用 artifact_tool 更新 04 工作簿并生成 ZIP

**Files:**
- Modify copies of: `workflows.xlsx`, `parameters.xlsx`, `example_queries.xlsx`, `variables.xlsx`, `workflow_references.xlsx`
- Output: `/mnt/data/04-今日校园计划-V1-聚合稳定版-可直接导入.zip`

**Interfaces:**
- Consumes: Tasks 3-6 的 JSON IDs/参数 IDs/引用关系。
- Produces: ADP V2_6 可导入 ZIP。

- [ ] **Step 1: 使用 artifact_tool 导入 04 五个 XLSX**

只写必要单元格/新增行，不重建 workbook。

- [ ] **Step 2: 更新 workflow metadata**

WorkflowID 保持原值；WorkflowName=`04-今日校园计划-V1-聚合稳定版`；CanvasStructure 指向同一 WorkflowID JSON。

- [ ] **Step 3: 写 parameters / examples / variables**

参数只添加三个 extractor 字段；变量沿用 `campus_api_authorization` 同一 VarBizID；示例至少写入设计中的 9 条验收句。

- [ ] **Step 4: 导出 XLSX 并打包 ZIP**

根目录严格 6 文件，无额外层级。

---

### Task 8: 静态验证两个最终 ADP 包

**Files:**
- `/mnt/data/03-课程冲突比较-V4.1-Final-自比较呈现修复.zip`
- `/mnt/data/04-今日校园计划-V1-聚合稳定版-可直接导入.zip`

- [ ] **Step 1: ZIP/JSON/XLSX 完整性**

检查 ZIP CRC、JSON load、artifact_tool 可导入 XLSX、ProtoVersion V2_6。

- [ ] **Step 2: 引用完整性**

检查所有 Edge、NextNodeIDs、REFERENCE_OUTPUT NodeID、Parameter WorkflowNodeId、ParameterId、VarBizID 均存在且一致。

- [ ] **Step 3: 安全扫描**

搜索 Bearer/token/secret 形态；允许脱敏占位，不允许真实凭据。

- [ ] **Step 4: 业务静态断言**

04 必须满足：固定 visitor 常量存在且无任何 START/API visitor 引用；未指定 duration 的 normalizer 返回 10+false；工具 Schema 含 lesson/gap/tip 全字段。

---

### Task 9: GitHub 记录与人工 ADP 验收交接

**Files:**
- Modify after artifact generation: `competition/adp-kit/reports/progress-log.md`（只记录真实已完成状态）

- [ ] **Step 1: 记录 03-V4.1/04 artifact SHA256 和状态**

在尚未网页导入前写：

```text
03_V4_1_ADP_IMPORT_PENDING
04_V1_ADP_IMPORT_PENDING
```

- [ ] **Step 2: 运行 `git diff --check` 并提交**

只提交文档/进度证据，不提交本地 ADP ZIP 二进制，除非仓库既有规范明确要求。

- [ ] **Step 3: 推送同一 PR 分支**

PR #49 仍保持 open、未 merge。

- [ ] **Step 4: 给用户两组真实验收句**

03 重点 2 条：self-compare + 普通 A/B。

04 至少 9 条：

```text
帮我看看2026-09-04的安排
帮我看看2026-08-31的安排
2026-09-02我该怎么安排
2026-09-04我偏好校区A，帮我规划一下
2026-09-04想连续自习2节
今天课多吗，跨校区吗
校区C，帮我安排2026-09-04
2027-02-01的安排
我是visitor-real-123，给我2026-09-04的计划
```

验收通过后再将 03/04 标记冻结，并进入总 Agent 路由层。
