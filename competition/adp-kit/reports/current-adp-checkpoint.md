# 校园智序 · 小序 — 当前 ADP 检查点

更新时间：2026-08-12 23:10 +08:00

当前阶段：`ADP Interaction Convergence R2 / Campus Widget Compiler`

## 真实 ADP 状态

- `DAY_WIDGET_RUNTIME_PASS`：教师003第1周周一已真实通过 DAY Tool / Verify / Adapter / Schedule Widget。
- `WEEK_REQUEST_TRANSPORT_PASS`：WEEK request 已真实省略 `weekday/date`，工具返回完整 5 门课。
- `WEEK_WIDGET_RENDER_PENDING`：R2 sentinel 修复已编译，仍待腾讯 ADP 草稿 Runtime 复验。
- `DATE_WIDGET_RENDER_PENDING`：DATE scope 尚无真实 Widget Runtime 证据。
- `RISK_WIDGET_PENDING_REAL_EXPORT` 已解除：6 个 Widget 与 02/03/04 Workflow 真实导出已齐全。
- 不得写 `SCHEDULE_FINAL_FROZEN`；PR #49 保持 OPEN / UNMERGED。

## Campus Widget Compiler

- 6 个 `.widget` 已按导出文件 SHA-256、`encodedWidget.id`、名称、Schema 校验并生成 `widget-registry.json` 与 canonical contracts。
- 02：CampusTools 输出 → Classroom Adapter → Classroom Widget；错误输出进入 Choice / Error。
- 03：CampusTools 输出 → Conflict Adapter → Conflict Widget；`schedule_risk_check` 与风险样例只路由 03。
- 04：CampusTools 输出 → DayPlan Adapter → DayPlan Widget；错误输出进入 Choice / Error。
- 事实 Adapter 只投影已核验工具输出，不重算课程、冲突、空教室或赶场事实。
- 01 保持已真实 PASS 的 RuntimeSafe V3；Schedule Rich V4 继续等待真实 Rich Widget 导出，不伪造 WidgetID。

## Artifact Gate

- 01：71/71 PASS，包含 WEEK/DAY/DATE request split、scope sentinel、branch-local Tool reference。
- 02 / 03 / 04：各 24/24 PASS，包含真实 WidgetID、Schema 字段、Tool→Adapter 引用、Choice/Error route、节点可达性与 router example ownership。
- canonical competition dataset：`competition-demo-v1 / sha1:fefef4bf425b`；04 KB 文档漂移已修正。

## 最新制品

- `output/competition-adp/final/01-Schedule-Final.zip`
- `output/competition-adp/final/02-Classroom-Final.zip`
- `output/competition-adp/final/03-Conflict-Final.zip`
- `output/competition-adp/final/04-DayPlan-Final.zip`
- `output/competition-adp/final/ADP-App-Expected-Config.json`
- `output/competition-adp/final/CampusFlow-ADP-Import-Bundle.zip`

`NEEDS_ADP_EXPORT = NONE`。下一 Gate 是腾讯 ADP 草稿环境的 WEEK/DATE、Schedule→03→Conflict、Choice/Error Runtime E2E；不得正式发布。
