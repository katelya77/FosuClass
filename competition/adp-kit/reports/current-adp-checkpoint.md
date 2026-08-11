# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-12 03:03 +08:00

当前状态：

- `CORE_WORKFLOWS_FROZEN`
- `APP_ROUTING_CONTEXT_FROZEN`
- `WIDGET_V2_LOCAL_GATE_PASS`
- `ADP_WIDGET_NATIVE_TEMPLATE_PASS`
- `ADP_WIDGET_OFFICIAL_TEMPLATE_RUNTIME_PASS`
- `B2_WIDGET_BASELINE_PASS`
- `ADP_WIDGET_SCHEDULE_CONTRACT_SPLIT_CONFIRMED`
- `ADP_ONE_CLICK_BUNDLE_DESIGN_PENDING`
- `ADP_WIDGET_NATIVE_RUNTIME_PENDING`
- `GITHUB_ACTIONS_INCLUDED_MINUTES_EXHAUSTED`

PR #49：保持 open / unmerged / 未正式发布。

## 冻结层

- 01 多维课表查询：冻结。
- 02 空教室规划 V7.2：真实多轮通过，冻结。
- 03 课程冲突比较 V5.1：self-compare / 赶场 / 01→03 handoff 真实通过，冻结。
- 04 今日校园计划 V1.1：核心/边界通过，冻结。
- 标准模式路由 + 模型输入上下文改写：冻结。
- 动态校园事实只来自 CampusTools；失败不得补造。
- `dataVersion=competition-demo-v1`，`dataHash=sha1:fefef4bf425b`。

## B2：正式 PASS

B2 天气代码 Widget 已完成：

```text
TemplateVars
= DefaultKeys
= ZodSchemaKeys
= JSONSchemaKeys
= WorkflowWidgetInputs
= {city, condition, temp, high, low, advice}
```

并且 Preview PASS + `开始 → B21 → 结束` Runtime PASS。

当前赛事空间已实机证明：本次保存路径中修改 Zod 后 outer JSON Schema 会同步，并传播到新拖入的 Workflow Widget 输入。该结论仅用于当前赛事空间，不外推 ADP 全平台。

详细证据：`competition/adp-kit/reports/2026-08-12-b2-zod-jsonschema-mismatch.md`

## Schedule：合同分裂根因已确认

本轮用户上传：

- `小序-课表票据-V2(2).widget`
- `export-01-多维课表查询-WidgetPilot-V1.3.zip`

实际解析确认当前 Schedule 是“V2 外壳 + RuntimeSafe V3 内核”的混合态。

### `.widget` outer jsonSchema

仍为旧 V2 7 字段：

```text
{title, timeText, queryId, dataVersion, summary, items, actions}
```

其中包含 OBJECT / ARRAY_OBJECT。

### `.widget` encodedWidget 内部

实际 `view / defaultState / schema` 已经是 RuntimeSafe V3 的 21 个扁平 STRING/INT 字段：

```text
{title,timeText,statusText,courseCountText,shownCount,listStatusText,
 item0PeriodText,item0CourseName,item0LocationText,item0MetaText,
 item1PeriodText,item1CourseName,item1LocationText,item1MetaText,
 action0Label,action0Message,action1Label,action1Message,
 action2Label,action2Message,footerText}
```

三项 validity 都是 `valid`。

### V1.3 Workflow Widget 节点

节点虽然名为 `小序-课表票据-RuntimeSafe-V3`，WidgetID 仍为：

`23fbc659efe3482fab588d754e4420a4`

但 `WidgetParam` / NodeUI inputs 仍按旧 V2 outer schema 注册：

```text
{title,timeText,queryId,dataVersion,summary,items,actions}
```

并且：

- `queryId` / `dataVersion` 引用为空；
- `items` / `actions` 为 `ARRAY_OBJECT` 且 `SubParams=[]`；
- 因此 ADP 当前预检查直接提示：`items/actions 必须有一项子参数`。

### Adapter

`Widget数据适配-Schedule` 已经正确输出 RuntimeSafe V3 的完整 21 个 Widget 字段。

所以真正断点是：

```text
CampusTools
→ Adapter(V3 21字段)            ✅
→ Workflow WidgetParam(旧V2)    ❌
→ encodedWidget(V3 21字段)      ✅
```

正式状态：

`ADP_WIDGET_SCHEDULE_CONTRACT_SPLIT_CONFIRMED`

详细报告：`competition/adp-kit/reports/2026-08-12-schedule-widget-contract-split-root-cause.md`

## 禁止继续的方式

不再：

- 连续生成 V1.4/V1.5/V1.6；
- 让用户手填大量 Widget 参数；
- 继续把 map / 三元 / ARRAY_OBJECT / WIDGET_ACTION_NONE / 直接向后流转当通用根因；
- Preview PASS 直接当 Runtime PASS；
- 分别手工维护 outer Schema、inner Schema、Adapter、Workflow WidgetParam。

## 新研发模式：一次导出 → 自动生成 → 一次导入验收

下一阶段设计一个统一的 `ADP Contract Compiler / One-click Import Bundle`：

```text
用户一次导出真实 ADP .widget + workflow ZIP
        ↓
自动解析真实平台序列化合同
        ↓
canonical manifest（单一真源）
        ↓
生成一致的 .widget
+ Workflow WidgetParam / NodeUI / Reference
+ ZIP 元数据
        ↓
自动静态 Gate
        ↓
用户只导入并做一次真实 Runtime
```

Schedule 先作为首个落地案例。成功后同一生成器扩展到 Classroom / Conflict / Day Plan / Choice / Error。

## 当前设计目标

Schedule canonical contract 以 RuntimeSafe V3 的 21 字段为准：

- outer JSON Schema / encodedWidget schema / Default / Template 变量一致；
- Adapter 输出与 Widget 字段一致；
- Workflow WidgetParam 从 canonical contract 自动生成，不再保留 `summary/items/actions`；
- 所有 REFERENCE_OUTPUT 自动指向 `Widget数据适配-Schedule.Output.<field>`；
- `shownCount` 全链为 INT，其余当前字段为 STRING；
- NodeUI inputs 自动同步；
- ActionType 继续使用已验证可行的 `WIDGET_ACTION_NONE`；
- 结果卡继续“直接向后流转”。

## 比赛主线

Widget 收口后：Schedule → sys.chat → 03 → 02/03/04 Runtime → Choice/Error → 32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟演示。

若统一合同方案仍不能在少量实机验收内收敛，Widget 转支线，不无限阻塞比赛主线。

## GitHub Actions

Actions included minutes 已用 `3000 / 3000`；与 ADP Runtime 无关。Codex / Kimi 本地继续承担构建、测试、ZIP 与 Gate。
