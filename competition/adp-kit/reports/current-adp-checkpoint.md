# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-12 03:13 +08:00

当前状态：

- `CORE_WORKFLOWS_FROZEN`
- `APP_ROUTING_CONTEXT_FROZEN`
- `WIDGET_V2_LOCAL_GATE_PASS`
- `ADP_WIDGET_NATIVE_TEMPLATE_PASS`
- `ADP_WIDGET_OFFICIAL_TEMPLATE_RUNTIME_PASS`
- `B2_WIDGET_BASELINE_PASS`
- `ADP_WIDGET_SCHEDULE_CONTRACT_SPLIT_CONFIRMED`
- `SCHEDULE_CONTRACTSYNC_PACKAGE_READY`
- `ADP_WIDGET_SCHEDULE_RUNTIME_PENDING`
- `ADP_WIDGET_NATIVE_RUNTIME_PENDING`
- `GITHUB_ACTIONS_INCLUDED_MINUTES_EXHAUSTED`

PR #49：保持 open / unmerged / 未正式发布。

## 冻结事实层

除非 80 条正式评测证明回归，不再改：

- 01 多维课表查询；
- 02 空教室规划 V7.2；
- 03 课程冲突比较 V5.1；
- 04 今日校园计划 V1.1；
- 标准模式 Agent 路由与模型输入上下文改写。

动态校园事实只来自 CampusTools；失败不得补造。

固定：`dataVersion=competition-demo-v1`，`dataHash=sha1:fefef4bf425b`。

## B2：正式 PASS

天气代码 Widget 已完成五方一致：

`TemplateVars = DefaultKeys = ZodSchemaKeys = JSONSchemaKeys = WorkflowWidgetInputs`

六字段固定 USER_INPUT，`开始 → B21 → 结束` 真实 Runtime PASS。

因此当前赛事空间本次保存路径可采用：修改 Zod → 保存 → outer JSON Schema 与新工作流节点输入同步。只作为当前空间实机合同。

## Schedule：根因已确认

用户上传真实：

- `小序-课表票据-V2(2).widget`
- `export-01-多维课表查询-WidgetPilot-V1.3.zip`

进一步解析确认 `.widget` 本身是 mixed-state：

- outer `template` = 空字符串；
- outer `jsonSchema` = 旧 V2 七字段 `title/timeText/queryId/dataVersion/summary/items/actions`；
- `encodedWidget.view/defaultState/schema` = RuntimeSafe V3 21 个扁平 STRING/INT 字段；
- V1.3 Workflow WIDGET 节点仍按旧 V2 七字段注册；
- 上游 `Widget数据适配-Schedule` 已正确输出 V3 21 字段。

当前断点：

```text
CampusTools
→ Adapter(V3 21字段)             ✅
→ Workflow WidgetParam(旧V2)     ❌
→ encodedWidget(V3 21字段)       ✅
```

这精确解释当前 ADP 预检查：`queryId/dataVersion` 引用为空、`items/actions` ARRAY_OBJECT 无 SubParams。

详细：`2026-08-12-schedule-widget-contract-split-root-cause.md`。

## 方案 A 已执行：Schedule ContractSync

保留现有 WidgetID：

`23fbc659efe3482fab588d754e4420a4`

Canonical contract 固定 RuntimeSafe V3 21 字段：

`title,timeText,statusText,courseCountText,shownCount,listStatusText,item0PeriodText,item0CourseName,item0LocationText,item0MetaText,item1PeriodText,item1CourseName,item1LocationText,item1MetaText,action0Label,action0Message,action1Label,action1Message,action2Label,action2Message,footerText`

其中 `shownCount=INT`，其余 STRING。

新 Workflow：

- WorkflowID：`5bf89039-74fd-580e-b1a8-3c3cabdf483f`
- Name：`01-多维课表查询-WidgetStable`
- WIDGET Node：`小序-课表票据-WidgetStable`
- WidgetID 保持不变
- ActionType=`WIDGET_ACTION_NONE`
- 21 个 WidgetParam 全部 `REFERENCE_OUTPUT`
- 全部指向 `Widget数据适配-Schedule.Output.<field>`
- 旧 `queryId/dataVersion/summary/items/actions` 已移除
- 非 Widget 节点、Edge、NextNodeIDs 保持 V1.3 不变

生成包：

`01-多维课表查询-WidgetStable-可直接导入.zip`

SHA256：

`4f78b5c029b87c25e0ff9b676d7230bf2e9c8d1858d421fe8cfcd90179db2f66`

静态 Gate：19/19 PASS；ZIP CRC PASS；XLSX WorkflowID 已同步。

详细：`2026-08-12-schedule-contractsync-package-ready.md`。

## 防回归工程化

新增：

- `widget/native/schedule-runtime-safe-v3-contract.json`
- `widget/native/audit-widget-contract.js`
- `widget/native/sync-native-widget-wrapper.js`
- `widget/native/test-schedule-contractsync.js`
- `widget/native/test-widget-wrapper-sync.js`

`package.json` 新增 `test:widget-contract` 与 `widget:sync-wrapper`，并把合同测试纳入 adp-kit `npm test`。

以后 native `.widget` 必须检查 outer wrapper 与 encodedWidget 是否同步，禁止再产出 V2 外壳/V3 内核。

## 用户现在只做两步 + 一次 Runtime

1. 打开现有 Schedule Widget（WidgetID `23fbc659efe3482fab588d754e4420a4`），Zod 模式粘贴本轮生成的 `Schedule-ContractSync-Zod.ts` 内容并保存一次。不要重新导入 Widget 创建新资源。
2. 导入 `01-多维课表查询-WidgetStable-可直接导入.zip`。
3. 唯一验收：`教师003第1周周一的课`。

若 PASS：标记 `ADP_WIDGET_SCHEDULE_RUNTIME_PASS`，立即推进 Schedule `sys.chat` → 03，不再做 Schedule 小实验。

若 FAIL：只保存该次完整错误/request_id/trace_id；合同分裂已消除，不再回到 V2 Schema、ARRAY_OBJECT、map、三元、WIDGET_ACTION_NONE 等已排除路径。

## 后续路线

Schedule PASS → sys.chat → 03 → 02/03/04 Widget Runtime → Choice/Error → 32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟演示。
