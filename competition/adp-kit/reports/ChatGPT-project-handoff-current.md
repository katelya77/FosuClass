# 校园智序 · 小序 — ChatGPT Project 新对话接力主文件

更新时间：2026-08-12 03:03 +08:00

> 新对话优先读取本文件、`current-adp-checkpoint.md`、`2026-08-12-b2-zod-jsonschema-mismatch.md`、`2026-08-12-schedule-widget-contract-split-root-cause.md` 与 `competition/adp-kit/widget/native/runtime-integration-runbook.md`。不要重新设计已冻结的 01–04，也不要重复 B2。

## 新对话第一句

```text
@GitHub 请恢复 FosuClass 校园智序·小序项目上下文。B2 已真实 Runtime PASS；Schedule 当前已确认是 outer V2 Schema / inner RuntimeSafe V3 Schema / Workflow WidgetParam 三方合同分裂。不要继续小步猜测式测试，直接推进 ADP Contract Compiler / One-click Import Bundle，让用户一次导出、ChatGPT/Codex 自动生成、用户一次导入验收。
```

## 项目与比赛目标

腾讯云智能 ADP 赛事智能体：`校园智序 · 小序`。

目标不是堆功能，而是形成获奖级闭环：真实校园价值、确定性事实、原生 ADP 深度利用、强交互 UI、多轮上下文、可解释安全、工程证据、量化评测、5 分钟高质量演示。

目标链：

`自然语言 → Agent 路由 → 01/02/03/04 冻结工作流 → CampusTools → verified envelope → 原生 Widget → sys.chat → 下一工作流 → 原生评测`

## 冻结事实层

除非 80 条正式评测证明回归，不再改：

- 01 多维课表查询；
- 02 空教室规划 V7.2；
- 03 课程冲突比较 V5.1；
- 04 今日校园计划 V1.1；
- 标准模式 Agent 路由与模型输入上下文改写；
- 动态校园事实只来自 CampusTools，失败不得由模型补造。

固定：

- `dataVersion=competition-demo-v1`
- `dataHash=sha1:fefef4bf425b`

## Widget C 方案

4 主卡：Schedule / Classroom / Conflict / Day Plan。

2 辅助卡：Choice / Error。

统一视觉：校园任务单 / 时间票据；暖纸张、墨绿可信状态；红=冲突/错误，橙=赶场风险。

六张 V2 已真实导入 ADP 并有独立 Preview。

## 已排除的死路

Schedule V1–V1.3 曾出现 `460101 / convert widget view failed / __jsx in undefined`。

但已经真实证明下列不是通用根因：

- Widget Runtime 服务全局故障；
- map；
- 三元表达式；
- ARRAY_OBJECT 本身；
- `WIDGET_ACTION_NONE`；
- “直接向后流转”；
- 代码创建 Widget 本身；
- 固定 `USER_INPUT`。

官方基础表单 Widget 最小链 Runtime PASS；B2 天气代码 Widget 也 Runtime PASS。

## B2：已正式 PASS

初始 B2 Template/Default 用六字段，但真实 Schema 只有 `title`。

用户只修改 Zod 为：

`city / condition / temp / high / low / advice`

保存后：

- Preview 正常；
- 新工作流节点暴露同六字段；
- 六字段固定 `USER_INPUT`；
- `开始 → B21 → 结束` Runtime 全绿；
- 重新导出确认内部 Zod 与 outer JSON Schema 同步为六字段；
- 工作流 `WidgetParam` / NodeUI inputs 也是同六字段。

正式状态：`B2_WIDGET_BASELINE_PASS`。

当前赛事空间可采用的实机合同：本次保存路径中修改 Zod 后 outer JSON Schema 会同步，并传播到新拖入的 Widget 节点。只用于当前空间，不外推 ADP 全平台。

详细：`competition/adp-kit/reports/2026-08-12-b2-zod-jsonschema-mismatch.md`

## Schedule 最新根因：合同分裂已确认

2026-08-12 03:03 用户上传：

- `小序-课表票据-V2(2).widget`
- `export-01-多维课表查询-WidgetPilot-V1.3.zip`

实际解析得到：

### 1. `.widget` outer jsonSchema 仍是旧 V2

```text
{title,timeText,queryId,dataVersion,summary,items,actions}
```

### 2. `encodedWidget` 内部已是 RuntimeSafe V3 21字段

```text
{title,timeText,statusText,courseCountText,shownCount,listStatusText,
 item0PeriodText,item0CourseName,item0LocationText,item0MetaText,
 item1PeriodText,item1CourseName,item1LocationText,item1MetaText,
 action0Label,action0Message,action1Label,action1Message,
 action2Label,action2Message,footerText}
```

内部 `view / defaultState / schema` 都属于 V3，validity 全 valid。

### 3. Workflow Widget 节点仍按旧 outer V2 生成

节点名虽然是 `小序-课表票据-RuntimeSafe-V3`，WidgetID 仍为：

`23fbc659efe3482fab588d754e4420a4`

但 `WidgetParam` / NodeUI inputs 仍是：

```text
{title,timeText,queryId,dataVersion,summary,items,actions}
```

其中：

- `queryId` / `dataVersion` 引用为空；
- `items` / `actions` 是 ARRAY_OBJECT 且 `SubParams=[]`；
- 当前 ADP 画布因此直接预检查报：items/actions 必须有一项子参数。

### 4. Adapter 其实已经是正确 V3

`Widget数据适配-Schedule` 已输出完整 21 字段。

所以当前真实断点：

```text
CampusTools
→ Adapter(V3 21字段)            ✅
→ Workflow WidgetParam(旧V2)    ❌
→ encodedWidget(V3 21字段)      ✅
```

正式状态：`ADP_WIDGET_SCHEDULE_CONTRACT_SPLIT_CONFIRMED`。

详细：`competition/adp-kit/reports/2026-08-12-schedule-widget-contract-split-root-cause.md`

## 用户对研发方式的最新要求

用户明确不接受继续“这测试一下、那测试一下”的低效率流程。

后续目标是：

```text
用户一次导出真实 ADP 包
        ↓
ChatGPT / Codex 自动识别平台序列化
        ↓
一键设计并生成可导入包
        ↓
用户直接导入
        ↓
只做一次必要的真实 Runtime 验收
```

不要让用户手填几十项参数；能自动生成 ZIP 就自动生成。

## 下一阶段：ADP Contract Compiler / One-click Import Bundle

核心设计原则：所有 Widget/Workflow 数据合同只有一个 canonical manifest，由生成器派生：

- Widget Zod / JSON Schema；
- Default；
- Template 变量校验；
- Adapter Output Schema；
- Workflow `WidgetParam`；
- REFERENCE_OUTPUT NodeID / JsonPath；
- `SubParams`；
- NodeUI inputs；
- ZIP / XLSX 元数据；
- 静态 Gate。

Schedule 首先使用 RuntimeSafe V3 的 21 字段作为 canonical contract，不再保留旧 V2 的 `summary/items/actions` Widget 输入。

成功后同一生成链扩展到 Classroom / Conflict / Day Plan / Choice / Error。

## GitHub 规则

仓库：`katelya77/FosuClass`

分支：`feat/campusflow-adp-integration`

PR：#49。

保持 open / unmerged；正式评测收口前不发布正式应用。

GitHub Actions included minutes 已用 `3000 / 3000`，与 ADP Runtime 无关；本地 Codex/Kimi 继续跑构建和 Gate。

## 比赛后续路线

Widget 合同统一后：

Schedule Runtime → Schedule `sys.chat` → 03 → 02/03/04 Runtime → Choice/Error → 32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟演示。

若统一合同方案仍不能在少量实机验收内收敛，Widget 转支线，不无限阻塞比赛主线。
