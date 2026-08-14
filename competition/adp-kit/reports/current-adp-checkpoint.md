# 校园智序 · 小序 — 当前 ADP 检查点

更新时间：2026-08-14 20:00 +08:00

当前阶段：`CampusFlow ADP R5 / Final Application Convergence`

## 真实 ADP 状态

- 01～04 R3：腾讯当前赛事空间导入、画布与调试启动均已通过，状态为 `TENCENT_WORKFLOW_DEBUG_PASS`。
- 05 CampusOverview：真实腾讯导出已解析并绑定 WidgetID `876474681d584d95b4a99da929dfb3b1`，状态为 `REAL_EXPORT_BOUND / READY_FOR_TENCENT_RUNTIME`。
- 七类 Widget runtime registry：`Schedule / Classroom / Conflict / DayPlan / Choice / Error / CampusOverview`，均为非空、唯一、32 位真实环境 ID。
- Application Hero Chain：尚未由用户在腾讯应用层完整执行，状态必须保持 `PENDING_USER_RUNTIME_E2E`。
- PR #49 保持 `OPEN / UNMERGED`；不得正式 ADP 发布或生产部署。

## 最终应用边界

- active：`01-多维课表查询-R3 / 02-空教室规划-R3 / 03-课程冲突比较-R3 / 04-今日校园计划-R3 / 05-校园教学态势-R1`。
- excluded：历史 01～04、`01-多维课表查询-Final_9332`、`00-节点格式种子-勿启用` 与所有旧中间版本。
- `schedule_risk_check` 只进入 03；校园总体态势与整体压力优先进入 05；具体空教室进入 02。
- `competition-demo-v1 / sha1:fefef4bf425b` 保持不变；05 准备期 2026-08-25～08-30 必须为 0 课。

## 最新制品

- `output/competition-adp/r5/01-多维课表查询-R3-Bound.zip`
- `output/competition-adp/r5/02-空教室规划-R3-Bound.zip`
- `output/competition-adp/r5/03-课程冲突比较-R3-Bound.zip`
- `output/competition-adp/r5/04-今日校园计划-R3-Bound.zip`
- `output/competition-adp/r5/05-校园教学态势-R1-Bound.zip`
- `output/competition-adp/r5/CampusFlow-ADP-R5-Final-Pack.zip`

下一 Gate：按 `ADP-R5-RUNTIME-E2E-CHECKLIST.md` 完成腾讯应用级 Router、Widget Action 与跨 Workflow Hero Chain；未完成前不得标记 Application E2E PASS。
