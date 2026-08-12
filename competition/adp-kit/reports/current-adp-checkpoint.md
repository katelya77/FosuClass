# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-12 20:30 +08:00

当前阶段：`ADP Interaction Convergence R2`

## 真实腾讯 ADP 事实

- `DAY_WIDGET_RUNTIME_PASS`：`教师003第1周周一的课` 已真实贯通 DAY Tool、Verify、Adapter、Schedule Widget，正确显示 2026-08-31 两门课与 `verified=true / competition-demo-v1`。
- `WEEK_REQUEST_TRANSPORT_PASS`：点击“查看整周”已真实走 WEEK 独立 Tool，request Body 省略 `weekday/date`，工具返回完整 5 门课；不再出现 `INVALID_PARAM weekday 需为1-7`。
- `WEEK_WIDGET_RENDER_PENDING`：Tool Output 的 optional INT `weekday=0` 是 RESPONSE sentinel；旧 Adapter 会 fallback，整周仍只有文本。
- `DATE_WIDGET_RENDER_PENDING`：DATE scope 还没有真实 Widget Runtime 证据。
- `RISK_WIDGET_PENDING_REAL_EXPORT` 已解除资源阻塞：Conflict.widget 与 03 Workflow ZIP 已收到并记录真实 ID/哈希；`Schedule → 检查风险 → 03 → 原生 Conflict Widget` 仍待 compiler 集成和 ADP Runtime。
- PR #49 保持 OPEN / UNMERGED；未部署、未正式 ADP 发布、未修改 repository visibility。

不得标记 `SCHEDULE_FINAL_FROZEN`。

## R2 本地实现

1. 保留已真实 PASS 的 WEEK/DAY/DATE request transport split，不回退万能 Tool Node。
2. `Verify-{scope}` 与 `Adapter-{scope}` 显式接收固定 `transport_scope`、`academic_body`、branch-local `tool_body`。
3. WEEK 仅在已经路由为 WEEK 时把 Tool Output `weekday=0` 规范化为 omitted；DAY 的 `weekday=0` 继续 fail closed；DATE 从 `academic_body` 取日期、教学周与星期。
4. WEEK 文本与 Widget `timeText` 固定为 `第N周 · 整周`，禁止 `星期0 / 周0 / weekday=0`。
5. compiler `clone_branch()` 同时重写原 DAY Tool NodeID；Artifact Gate 对六个 Verify/Adapter 分支执行 branch-local 语义检查。原制品 4 处 RED，修复后 Final ZIP 71/71 GREEN。
6. Action Protocol V2 已定义 `schedule_day / schedule_week / schedule_choose_day / schedule_risk_check`；每个 payload 保留完整 `query`，Agent system routing contract 改为 intent-first/query-fallback。
7. RuntimeSafe 卡的第二动作改为“选择日期”，文本 fallback 为 `【小序操作:选择课表日期】教师003|第1周`。没有把 Choice WidgetID 伪造进 01。
8. `schedule-rich-v4/` 已准备 Template、Zod、JSON Schema、Default、DAY/WEEK samples 与 contract tests；`widgetId=null`，暂不替换线上 RuntimeSafe WidgetID。

## 最新制品

- `output/competition-adp/final/01-Schedule-Final.zip`
- `output/competition-adp/final/CampusFlow-ADP-Import-Bundle.zip`
- Final Artifact Gate：71/71 PASS
- 编译输出确定性：连续两次 SHA-256 相同

## 真实导出库存

本轮所需资源已全部收到：Classroom / Conflict / DayPlan / Choice / Error Widget，以及 02 / 03 / 04 Workflow ZIP。真实 WidgetID 与 SHA-256 记录于 `widget/native/real-adp-export-catalog.json`；`NEEDS_ADP_EXPORT` 当前为空。

这些资源“已收到”不等于“已完成 Runtime”：Classroom/Conflict/DayPlan/Choice/Error 均待统一 Campus Widget Contract Compiler 集成与腾讯 ADP 草稿验证。

## 下一步真实 ADP Gate

只需导入新 `01-Schedule-Final.zip`，无需手改 Workflow 节点，依次验证：DAY、查看整周、选择日期文本回流、检查风险路由、DATE Widget。随后再推进 03 Conflict 原生卡 compiler。
