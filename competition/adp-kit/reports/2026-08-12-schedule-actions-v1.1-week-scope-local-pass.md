# Schedule Actions V1.1 / Week Scope Contract Fix — 本地 PASS

日期：2026-08-12（Asia/Shanghai）

## 真实 ADP 证据与根因

- Schedule Widget Runtime：PASS。
- `sys.chat` Trigger：PASS。
- Action Contract V1：本地 PASS。
- 点击“看周二”后，canonical payload `查询教师003第1周周二的课` 已真实重新进入 01，并返回 `2026-09-01 verified EMPTY_RESULT`，DAY 合同兼容。
- 点击“查看整周”后，01 返回 `INVALID_PARAM / weekday 需为 1-7`，日期解析同时返回“不支持的 dateText”。

根因有两个：

1. ADP 可把 optional INT 空值序列化为 `0`；旧“查询参数归一化”只做 `to_int`，导致整周 `weekday=0` 被继续传给 `query_schedule`。
2. 参数提取 Prompt 允许显式“第N周”同时进入 `week` 与 `date_text`，而日期解析直接读取原始 `date_text`，形成重复时间表示。

## V1.1 最小修复

- `week` 严格规范为 1–20，`weekday` 严格规范为 1–7；越界统一变为 `None`。
- 合法显式 `week` 且 `time_scope=week` 时，固定 `query_weekday=None`。
- 参数提取合同明确：仅第N周 → `week=N/time_scope=week/weekday=null/date_text=null`；第N周周X → `week=N/weekday=1-7/time_scope=day/date_text=null`。
- 在参数提取与 `get_academic_context` 之间新增小型 CODE_EXECUTOR“日期输入守卫”：合法显式教学周清空重复 `date_text`；没有合法显式 week 时原样保留日期文本。
- 日期解析 `dateText` 只引用 `日期输入守卫.Output.safe_date_text`。

未修改 CampusTools `resolveAcademicDate`、Schedule Widget、RuntimeSafe V3 21 字段、Widget Template/Schema/WidgetParam、WidgetID、ActionType、Action Builder、结果核验、02/03/04。

## 制品

- WorkflowName：`01-多维课表查询-WidgetStable-ActionsV1.1`
- WorkflowID：`9272b9cb-c805-4fed-a300-1984a881a231`
- ZIP：`output/competition-adp/01-多维课表查询-WidgetStable-ActionsV1.1-可直接导入.zip`
- SHA256：`36c5f92c3d544d0fa97cd0609cf4a44d71e5edb99833d2e59dc95861fbf65ff6`
- WidgetID：`23fbc659efe3482fab588d754e4420a4`

## 本地验证

- Action Contract V1：7 cases + 13 guards PASS。
- Week Scope Contract：7 regressions PASS。
- CampusTools：34/34 PASS；其中 `query_schedule weekday=0` 仍按冻结事实工具合同返回非法参数。
- Golden：33/33 PASS，verified=100%。
- `npm test --prefix competition/adp-kit`：PASS。
- Agent Foundation：42/42 PASS。
- Agent Regression：197/197 PASS。
- AI Competition：PASS。
- Final Convergence：PASS（含 120-case evaluation）。
- `git diff --check`：PASS。

Artifact Gate：35/35 PASS，覆盖 CRC、WorkflowID/XLSX 一致、唯一 NodeID、全部节点可达、Edge/NextNodeIDs、Reference NodeID、21/21 WidgetParam、`shownCount=INT`、WidgetID、ActionType、Action Contract 与 Week Scope 回归。

## 当前边界

ActionsV1 未在 ADP 启用，原始 01 已启用，因此当前 `sys.chat` 重新规划落到旧 01 是平台启用行为。V1.1 仍需用户导入并完成真实“查看整周”E2E；通过前不得标记 `ADP_WIDGET_SCHEDULE_ACTION_E2E_PASS`。

本轮未 push、未运行 GitHub Actions、未 merge PR #49、未发布 ADP 应用。
