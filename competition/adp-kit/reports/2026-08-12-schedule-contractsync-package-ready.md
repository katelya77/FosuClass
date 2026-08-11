# Schedule ContractSync — WidgetStable 导入包已生成

更新时间：2026-08-12 03:13 +08:00

## 状态

正式新增：

```text
SCHEDULE_CONTRACTSYNC_PACKAGE_READY
```

尚未标记 `ADP_WIDGET_SCHEDULE_RUNTIME_PASS`；必须等待用户在腾讯 ADP 做一次真实 Runtime 验收。

## 输入证据

用户上传：

- `小序-课表票据-V2(2).widget`
- `export-01-多维课表查询-WidgetPilot-V1.3.zip`

进一步解析发现比此前报告更深一层的 mixed-state：

- outer `template` = 空字符串；
- outer `jsonSchema` = 旧 V2 七字段；
- `encodedWidget.view` = RuntimeSafe V3 完整 Template；
- `encodedWidget.schema/defaultState` = RuntimeSafe V3 21 字段；
- Workflow WIDGET 节点 = 旧 V2 七字段。

因此此前自制 `.widget` 的 outer wrapper 与 encodedWidget 内层没有同步，是旧 V2 参数重新出现在 ADP 工作流节点中的直接来源。

## 方案 A

保留现有 Schedule WidgetID：

`23fbc659efe3482fab588d754e4420a4`

不改：

- 01 事实逻辑；
- CampusTools；
- 参数提取/日期解析/课表查询；
- 结果核验；
- Widget Adapter 算法；
- RuntimeSafe V3 UI Template；
- 工作流拓扑。

只把 WIDGET 节点合同统一为 RuntimeSafe V3 21 字段。

## Canonical Contract

21 字段：

`title,timeText,statusText,courseCountText,shownCount,listStatusText,item0PeriodText,item0CourseName,item0LocationText,item0MetaText,item1PeriodText,item1CourseName,item1LocationText,item1MetaText,action0Label,action0Message,action1Label,action1Message,action2Label,action2Message,footerText`

- `shownCount = INT / integer`
- 其余 = `STRING / string`

仓库单一真源：

`competition/adp-kit/widget/native/schedule-runtime-safe-v3-contract.json`

## 生成 Workflow

新 WorkflowID：

`5bf89039-74fd-580e-b1a8-3c3cabdf483f`

名称：

`01-多维课表查询-WidgetStable`

WIDGET 节点：

- NodeName：`小序-课表票据-WidgetStable`
- WidgetID：`23fbc659efe3482fab588d754e4420a4`
- ActionType：`WIDGET_ACTION_NONE`
- 21 个 WidgetParam 全部 `REFERENCE_OUTPUT`
- Reference NodeID 全部：`d3b9b581-ef24-46bc-9bac-742454377eac`（Widget数据适配-Schedule）
- JsonPath 全部：`Output.<field>`
- SubParams 全部 `[]`
- NodeUI inputs 同步为 21 字段
- 旧 `queryId/dataVersion/summary/items/actions` 已全部从 WIDGET 节点移除

## 生成文件

用户可下载：

- `01-多维课表查询-WidgetStable-可直接导入.zip`
- `Schedule-ContractSync-Zod.ts`
- `Schedule-ContractSync-JSONSchema.json`
- `Schedule-ContractSync-audit.json`

最终 ZIP SHA256：

`4f78b5c029b87c25e0ff9b676d7230bf2e9c8d1858d421fe8cfcd90179db2f66`

## 静态 Gate

最终执行 19 项检查，19/19 PASS：

- WidgetID 保持；
- ActionType 保持；
- WidgetParam keys/type 精确；
- 21 项引用全部指向 Adapter；
- 无空 NodeID/JsonPath；
- 无 OBJECT/ARRAY_OBJECT/ARRAY_STRING WIDGET 参数；
- SubParams 全空且合法；
- Adapter 完整提供 21 字段；
- shownCount=INT；
- NodeUI inputs 精确；
- 非 Widget 节点逐对象不变；
- Edge 不变；
- NextNodeIDs 不变；
- Edge endpoint 全存在；
- NextNodeIDs 均有对应 Edge；
- ZIP 正好六个根文件；
- workflow JSON 文件名与新 WorkflowID 对齐；
- XLSX WorkflowID 全部同步；
- ZIP CRC PASS。

## 仓库防回归工具

新增：

- `schedule-runtime-safe-v3-contract.json`
- `audit-widget-contract.js`
- `sync-native-widget-wrapper.js`
- `test-schedule-contractsync.js`
- `test-widget-wrapper-sync.js`

`package.json` 新增：

- `npm run test:widget-contract`
- `npm run widget:sync-wrapper`

并把 `test:widget-contract` 纳入 adp-kit `npm test`。

目的：以后 native `.widget` 若出现 outer template/schema 与 encodedWidget 漂移，应在本地构建阶段直接失败，而不是到 ADP Runtime 才发现。

## 用户下一步：只做一次 Bootstrap + 一次 Runtime

### 1. 现有 Schedule Widget 原地保存一次 Schema

在 WidgetID `23fbc659efe3482fab588d754e4420a4` 对应 Widget 的 Zod 模式粘贴 `Schedule-ContractSync-Zod.ts` 内容并保存。

B2 已在当前赛事空间证明：此保存路径会把 outer JSON Schema 与工作流新节点所需字段同步。

不要重新导入 `.widget` 创建新资源，方案 A 必须保留现有 WidgetID。

### 2. 导入 Workflow ZIP

导入：

`01-多维课表查询-WidgetStable-可直接导入.zip`

这是独立 WorkflowID，不覆盖 V1.3 Pilot。

### 3. 唯一 Runtime 验收

输入：

`教师003第1周周一的课`

若 PASS：标记 `ADP_WIDGET_SCHEDULE_RUNTIME_PASS`，立即推进 Schedule sys.chat → 03，而不再做 Schedule 小实验。

若仍出现历史 `460101`：保存一次 request_id/trace_id/错误即可。此时合同分裂已经消除，后续只研究下一层根因，不再回到 V2 Schema/ARRAY_OBJECT/map 等已排除路径。

## PR

PR #49 保持 open / unmerged；未发布正式应用。
