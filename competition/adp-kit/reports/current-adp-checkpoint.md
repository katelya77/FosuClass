# 校园智序 · 小序 — 当前 ADP 检查点

更新时间：2026-08-14 22:00 +08:00

当前阶段：`CampusFlow ADP R5 / Final Application Convergence + Platform Write Incident`

## 真实 ADP 状态

- 01～04 R3：腾讯当前赛事空间导入、画布与调试启动均已通过，状态为 `TENCENT_WORKFLOW_DEBUG_PASS`。
- 05 CampusOverview：真实腾讯导出已解析并绑定 WidgetID `876474681d584d95b4a99da929dfb3b1`；既有 05 版本可保留，但新的工作流创建/导入当前被平台 `10013 add vectors failed` 阻断。
- 七类 Widget runtime registry：`Schedule / Classroom / Conflict / DayPlan / Choice / Error / CampusOverview`，均为非空、唯一、32 位真实环境 ID。
- Application Hero Chain：尚未由用户在腾讯应用层完整执行，状态必须保持 `PENDING_USER_RUNTIME_E2E`。
- PR #49 保持 `OPEN / UNMERGED`；不得正式 ADP 发布或生产部署。

## 当前平台事件

2026-08-14 21:57 已通过多条独立路径确认：

```text
POST /cgi/capi?cmd=CreateWorkflow
HTTP 500
FailedOperation
code: 10013
msg: add vectors failed
```

手动创建、旧工作流导入、Fresh WorkflowID + 0 `example_queries` 的 ImportSafe ZIP 均复现相同错误，因此当前主因不再指向 CampusFlow ZIP/Widget/WorkflowID/example_queries，而是工作流创建/导入后端的向量注册写入链路。

状态：`ADP_WORKFLOW_VECTOR_REGISTRATION_INCIDENT = CONFIRMED`

这尚不等价于“腾讯全局服务故障”；下一最小 Gate 是在同赛事空间的全新空白应用创建一个最小工作流，用于区分“当前应用级”与“赛事空间/tenant 级”故障。

事件报告：`competition/adp-kit/reports/2026-08-14-adp-workflow-vector-service-incident.md`

## 最终应用边界

- active target：`01-多维课表查询-R3 / 02-空教室规划-R3 / 03-课程冲突比较-R3 / 04-今日校园计划-R3 / 05-校园教学态势`。
- excluded：历史 01～04、`01-多维课表查询-Final_9332`、`00-节点格式种子-勿启用` 与所有旧中间版本。
- `schedule_risk_check` 只进入 03；校园总体态势与整体压力优先进入 05；具体空教室进入 02。
- `competition-demo-v1 / sha1:fefef4bf425b` 保持不变；05 准备期 2026-08-25～08-30 必须为 0 课。

## 当前保全策略

- 不删除已成功导入且可运行的 01～04 R3。
- 不继续通过生成 R4/R5 ZIP 猜测规避 `10013`。
- 平台写链恢复前，主线转为 01～04 Runtime E2E、应用 Router、跨 Workflow handoff、量化评测与比赛演示。
- 平台恢复后再完成 05 最终 Bound/激活收口。

下一 Gate：

1. 同赛事空间新建空白测试应用并只创建一个最小工作流；
2. 向腾讯技术支持提交已记录 Request IDs；
3. 并行执行 01～04 Runtime E2E，未完成前不得标记 Application E2E PASS。
