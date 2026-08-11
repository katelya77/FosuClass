# 校园智序 · 小序 — ChatGPT Project 新对话接力主文件

更新时间：2026-08-12 03:13 +08:00

> 新对话优先读取本文件、`current-adp-checkpoint.md`、`2026-08-12-b2-zod-jsonschema-mismatch.md`、`2026-08-12-schedule-widget-contract-split-root-cause.md`、`2026-08-12-schedule-contractsync-package-ready.md` 与 `competition/adp-kit/widget/native/runtime-integration-runbook.md`。不要重新设计已冻结 01–04，不要重复 B2，也不要再做 Schedule V1.4/V1.5 猜测式实验。

## 新对话第一句

```text
@GitHub 请恢复校园智序·小序上下文。B2 已 Runtime PASS；Schedule 已确认 outer wrapper/encodedWidget/Workflow WidgetParam 合同分裂，并已生成 ContractSync WidgetStable 导入包。当前只等待用户对现有 Schedule Widget 保存一次 21字段 Zod，然后导入 WidgetStable ZIP 并做一次“教师003第1周周一的课”真实 Runtime。PASS 后立刻推进 sys.chat→03，不再继续 Schedule 小实验。
```

## 项目目标

腾讯云智能 ADP 赛事智能体：`校园智序 · 小序`。

比赛目标：真实校园价值、确定性可信事实、原生 ADP 深度利用、强交互 UI、多轮上下文、可解释安全、工程证据、量化评测、5 分钟获奖型演示。

目标链：

`自然语言 → Agent 路由 → 01/02/03/04 冻结工作流 → CampusTools → verified envelope → 原生 Widget → sys.chat → 下一工作流 → 原生评测`

## 冻结层

除非正式 80 条评测证明回归，不再改：

- 01 多维课表查询；
- 02 空教室规划 V7.2；
- 03 课程冲突比较 V5.1；
- 04 今日校园计划 V1.1；
- 标准模式 Agent 路由与模型输入上下文改写。

动态校园事实只能来自 CampusTools；失败不得模型补造。

固定：`dataVersion=competition-demo-v1`，`dataHash=sha1:fefef4bf425b`。

## Widget C 方案

4 主卡：Schedule / Classroom / Conflict / Day Plan。

2 辅助卡：Choice / Error。

统一视觉：校园任务单 / 时间票据；暖纸张、墨绿可信；红=冲突/错误，橙=赶场。

## B2 基线：正式 PASS

B2 天气代码 Widget 已完成：

`TemplateVars = DefaultKeys = ZodSchemaKeys = outer JSONSchemaKeys = WorkflowWidgetInputs`

六字段 USER_INPUT，`开始 → B21 → 结束` 真实 Runtime PASS。

当前赛事空间已实机证明本次路径：修改 Zod 保存后，outer JSON Schema 与新工作流节点输入可同步。只作为当前空间合同。

## Schedule 已确认根因

用户真实上传：

- `小序-课表票据-V2(2).widget`
- `export-01-多维课表查询-WidgetPilot-V1.3.zip`

真实解析：

### `.widget` outer wrapper

- `template` = 空字符串；
- `jsonSchema` = 旧 V2 七字段：`title,timeText,queryId,dataVersion,summary,items,actions`。

### `.widget` encodedWidget

`view/defaultState/schema` 已全部为 RuntimeSafe V3 21 个扁平字段，三项 validity 均 valid。

### V1.3 Workflow WIDGET

节点仍按旧 outer V2 七字段注册：

- `queryId/dataVersion` 引用为空；
- `items/actions` = ARRAY_OBJECT 且 `SubParams=[]`；
- 当前 ADP 因此预检查直接报错。

### Adapter

`Widget数据适配-Schedule` 已正确输出完整 V3 21 字段。

所以断点：

```text
CampusTools
→ Adapter(V3 21字段)             ✅
→ Workflow WidgetParam(旧V2)     ❌
→ encodedWidget(V3 21字段)       ✅
```

正式状态：`ADP_WIDGET_SCHEDULE_CONTRACT_SPLIT_CONFIRMED`。

## 方案 A：已经执行并生成包

用户已明确批准“按方案 A 执行”：保留现有 WidgetID `23fbc659efe3482fab588d754e4420a4`。

Canonical Schedule contract = RuntimeSafe V3 21 字段：

`title,timeText,statusText,courseCountText,shownCount,listStatusText,item0PeriodText,item0CourseName,item0LocationText,item0MetaText,item1PeriodText,item1CourseName,item1LocationText,item1MetaText,action0Label,action0Message,action1Label,action1Message,action2Label,action2Message,footerText`

- `shownCount=INT`
- 其余 STRING

新 Workflow：

- ID `5bf89039-74fd-580e-b1a8-3c3cabdf483f`
- Name `01-多维课表查询-WidgetStable`
- WidgetID 保持 `23fbc659efe3482fab588d754e4420a4`
- 21 个 WidgetParam 全部 REFERENCE_OUTPUT → `Widget数据适配-Schedule.Output.<field>`
- 旧 `queryId/dataVersion/summary/items/actions` 全部移除
- 非 Widget 节点/Edge/NextNodeIDs 与 V1.3 保持不变

用户文件：

- `01-多维课表查询-WidgetStable-可直接导入.zip`
- `Schedule-ContractSync-Zod.ts`
- `Schedule-ContractSync-JSONSchema.json`
- `Schedule-ContractSync-audit.json`

ZIP SHA256：

`4f78b5c029b87c25e0ff9b676d7230bf2e9c8d1858d421fe8cfcd90179db2f66`

静态 Gate：19/19 PASS；CRC PASS；XLSX WorkflowID 同步 PASS。

正式状态：`SCHEDULE_CONTRACTSYNC_PACKAGE_READY`，尚未标记 Runtime PASS。

## 仓库防回归工具

新增：

- `competition/adp-kit/widget/native/schedule-runtime-safe-v3-contract.json`
- `competition/adp-kit/widget/native/audit-widget-contract.js`
- `competition/adp-kit/widget/native/sync-native-widget-wrapper.js`
- `competition/adp-kit/widget/native/test-schedule-contractsync.js`
- `competition/adp-kit/widget/native/test-widget-wrapper-sync.js`

`competition/adp-kit/package.json` 新增 `test:widget-contract` 与 `widget:sync-wrapper`，合同测试已纳入 `npm test`。

以后不能只改 encodedWidget；必须检查 outer template/jsonSchema 与 inner view/schema 同步。

## 用户当前唯一操作

1. 打开**现有** Schedule Widget（WidgetID `23fbc659efe3482fab588d754e4420a4`）。
2. 在 Zod 模式粘贴 `Schedule-ContractSync-Zod.ts` 内容并保存一次。不要通过“导入 Widget”创建新 Widget，否则 WidgetID 会进入新的资源创建流程，偏离方案 A。
3. 导入 `01-多维课表查询-WidgetStable-可直接导入.zip`。
4. 只测试：`教师003第1周周一的课`。

若 PASS：写回 `ADP_WIDGET_SCHEDULE_RUNTIME_PASS`，立刻推进 Schedule `sys.chat` → 03。

若 FAIL：只收集这一次错误/request_id/trace_id；合同分裂已消除，不再回到 map/三元/ARRAY_OBJECT/WIDGET_ACTION_NONE/直接向后流转等已排除方向。

## 研发方式

用户明确要求停止“这测试一下、那测试一下”。后续模式固定：

`用户一次批量导出 → ChatGPT/Codex 批量解析/生成 → 静态 Gate → 用户一次导入/Runtime`

能自动生成 ZIP 就不让用户手填参数。

## GitHub

仓库：`katelya77/FosuClass`

分支：`feat/campusflow-adp-integration`

PR #49：保持 open / unmerged；正式评测收口前不发布正式应用。

## 后续比赛路线

Schedule PASS → sys.chat → 03 → 02/03/04 Widget Runtime → Choice/Error → 32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟演示。
