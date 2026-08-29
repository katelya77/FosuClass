# 校园智序 · 小序 — ChatGPT Project 接力

更新时间：2026-08-14 22:00 +08:00

## 必须继承的状态

```text
01_04_R3_TENCENT_WORKFLOW_DEBUG_PASS
05_CAMPUS_OVERVIEW_REAL_EXPORT_BOUND
05_REAL_WIDGET_ID = 876474681d584d95b4a99da929dfb3b1
ADP_WORKFLOW_VECTOR_REGISTRATION_INCIDENT = CONFIRMED
APPLICATION_HERO_CHAIN = PENDING_USER_RUNTIME_E2E
PR_49 = OPEN / UNMERGED
```

## 已完成

- 真实 05 `.widget` 的文件 Hash、encoded ID、Schema、DefaultState 与 validity 已 fail-closed 校验。
- Runtime Registry 已扩展为七类 Widget；`competition-demo-v1 / sha1:fefef4bf425b` 与 33 Golden facts 未修改。
- 01～04 R3 已成功存在于腾讯赛事空间并可继续 Runtime 调试。
- 05 的新建/重新导入目前不是制品问题，而被腾讯当前工作流创建/导入写链阻断。

## 2026-08-14 平台写链事件

多条独立路径均返回：

```text
POST /cgi/capi?cmd=CreateWorkflow
HTTP 500
FailedOperation
code: 10013
msg: add vectors failed
```

已复现：

- 手动新建最基础工作流；
- 重复手动新建；
- 导入旧的此前可用工作流；
- 导入 Fresh WorkflowID + 0 `example_queries` 的 05 ImportSafe 包。

因此不要继续修改 Widget、Workflow Graph、Excel header、WorkflowID 或 example queries 来猜测规避该错误。

已记录 Request IDs 与完整分析：

`competition/adp-kit/reports/2026-08-14-adp-workflow-vector-service-incident.md`

注意：当前只能确认“当前工作流创建/导入后端向量注册失败”，尚未证明腾讯全局故障。下一次只做一个高信息量差分实验：在同一赛事空间的新空白应用中创建最小工作流；成功则当前应用 index/metadata 可疑，失败则至少上升到赛事空间/tenant 级。

## 主线调整

平台恢复前：

1. 保留 01～04 R3，不删除、不重新导入。
2. 继续 01～04 Runtime E2E、上下文继承、Action、跨 Workflow handoff。
3. 继续应用 Router、量化评测、安全红队、5 分钟 Hero Demo 打磨。
4. 不正式发布 ADP，不 merge PR #49。
5. 平台写链恢复后再完成 05 最终 Bound/激活。
