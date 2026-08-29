# 腾讯 ADP 工作流创建/导入 `10013 add vectors failed` 事件记录

时间：2026-08-14 21:57 +08:00

## 结论

当前证据已足以将问题从 CampusFlow 05 ZIP / Widget / WorkflowID / example_queries 合同中排除。故障发生在腾讯 ADP 当前赛事空间的工作流创建/导入后端向量注册阶段，前端 `CreateWorkflow` 请求返回 HTTP 500，业务错误：

```text
FailedOperation
code: 10013
msg: add vectors failed
```

状态：`ADP_WORKFLOW_VECTOR_REGISTRATION_INCIDENT = CONFIRMED`

这不等价于已证明“腾讯全局服务故障”。当前仍需最小差分实验区分：

1. 当前应用级 index/metadata 异常；
2. 当前赛事空间/tenant 级 vector service/index 异常；
3. 更大范围平台服务异常。

## 已复现路径

以下互相独立路径均得到同一业务码：

- 手动创建最基础工作流；
- 再次手动创建最基础工作流；
- 导入旧的、此前可用的工作流；
- 导入 Fresh WorkflowID + 0 条 `example_queries` 的 ImportSafe 05 ZIP；
- 2026-08-14 21:57 浏览器 Network 中 `POST /cgi/capi?cmd=CreateWorkflow` 明确返回 HTTP 500。

## Request IDs

```text
27cb7ec0-a0d8-45eb-898b-4a7aba7b6db8
ab970d03-f50b-44bf-833c-e78850b2fb16
cfb54f6b-5800-4319-b78a-08b4dafc2071
f445841a-ee93-45d7-8764-d3b389c22c09
bd0198e0-3631-4d03-984b-8af0137a4d94
```

## 因果判断

腾讯 ADP 官方文档说明：创建工作流时填写工作流名称与描述，并建议在描述中提供可触发该工作流的自然语言示例，以帮助模型理解何时调用工作流。结合后端错误文本 `add vectors failed`，可以合理判断 CreateWorkflow 会在创建流程中写入用于语义路由/检索的向量数据。

因此即使 `example_queries.xlsx` 为 0 行，工作流名称/描述等元数据仍可能进入向量注册流程；这解释了为什么 Fresh ID + NoVectors 仍然会在 `CreateWorkflow` 失败。

## 已排除

当前不应继续把以下因素作为主要根因：

- 05 Widget Template / Schema / Default；
- 05 Workflow Graph；
- `example_queries.xlsx` 是否有数据行；
- 旧 WorkflowID 冲突；
- ZIP 表头；
- R3 Hash lock；
- 01～04 已存在工作流的运行时结构。

## 当前保全策略

- 不删除已成功导入且可运行的 01～04 R3。
- 不反复生成 R4/R5 ZIP 试错。
- 不正式发布 ADP，不 merge PR #49。
- 平台恢复前，继续执行既有 01～04 Runtime E2E、应用 Router、107-case/80-case 评测、比赛演示链和答辩材料。

## 下一步最小差分实验

只做两次，不做更多：

### Experiment A — 同赛事空间、全新空白应用

在同一个“大赛专用空间”中新建一个最小测试应用，仅创建一个空白工作流。

- 若同样 `10013`：问题至少上升到赛事空间/tenant 级；
- 若成功：当前“校园智序-小序”应用自身 workflow vector index/metadata 更可疑。

### Experiment B — 若用户拥有另一个可用空间

在另一个空间中创建同样的最小工作流。

- 另一空间成功、赛事空间失败：锁定赛事空间/tenant；
- 两边都失败：平台/账号级异常概率显著上升。

完成 A 后即可联系腾讯技术支持，不需要等待 B。

## 支持工单要点

提交上述 Request IDs，并明确：

- 手动创建与 ZIP 导入均失败；
- Fresh WorkflowID + 0 example queries 仍失败；
- HTTP endpoint：`POST /cgi/capi?cmd=CreateWorkflow`；
- HTTP status：500；
- business code：10013；
- message：`add vectors failed`；
- 已存在的 01～04 R3 仍可运行，故障集中在 create/import write path。
