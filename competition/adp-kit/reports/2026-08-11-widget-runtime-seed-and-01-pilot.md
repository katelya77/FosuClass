# ADP Widget Runtime Seed 与 01 Schedule Pilot

时间：2026-08-11 21:44 +08:00

## 1. 真实工作流 Widget Seed 已捕获

来源：用户从腾讯云智能 ADP 导出的：

`export-00-节点格式种子-勿启用(3).zip`

真实节点确认：

- `NodeType = WIDGET`
- Schedule WidgetID：`23fbc659efe3482fab588d754e4420a4`
- Choice WidgetID：`f540588933a4459cbe78a6fe99aa022c`
- 两个未接线 Seed 节点的 `ActionType = WIDGET_ACTION_NONE`
- Widget 入参位于 `WidgetNodeData.WidgetParam`
- OBJECT / ARRAY_OBJECT 使用 `SubParams` 注册结构
- Seed NodeUI 输出展示为 `Output / Output.Content`

抽象合同已落库：

`competition/adp-kit/widget/native/widget-node-seed-contract.json`

注意：本 Seed 还没有捕获 Choice 的“等待用户操作”非 NONE 枚举值，因此 Choice Runtime 仍保留实机 Gate。

---

## 2. 01 WidgetPilot 已生成

基线：

`01-多维课表查询-数组修复版-v2-修复450081.zip`

Pilot 名称：

`01-多维课表查询-WidgetPilot`

Pilot WorkflowID：

`578e7df1-6290-4218-82e9-cb16b165625a`

生成文件：

`01-多维课表查询-WidgetPilot-V1-可直接导入.zip`

SHA256：

`7e65f229eb73f6855432abae355d650382af9b2e5436d6c7ff45d4079bfa1238`

### 链路

```text
课表查询
→ 结果核验与呈现
→ Widget数据适配-Schedule
→ Widget展示判断
  ├─ route=widget → 小序-课表票据-V2 → 结束
  └─ else → 查询结果回复 → 结束
```

### Gate

Widget Adapter 只有在以下条件同时满足时才输出 `route=widget`：

- `success == true`
- `dataVersion == competition-demo-v1`
- `evidence.verified == true`
- `items` 非空

否则继续走冻结版本原有文本兜底。

Adapter 源码：

`competition/adp-kit/widget/native/schedule-runtime-adapter.py`

### Adapter 职责边界

只做：

- verified envelope → Widget ViewModel 转换；
- 最多 5 条课的展示裁剪；
- 基于已核验 query/resolvedEntity 生成标题、时间文案和安全 `sys.chat` 导航动作。

绝不做：

- 重新解析实体；
- 重新计算日期；
- 推测课程/教室/冲突；
- 在 CampusTools 失败后补造动态事实。

---

## 3. Pilot 静态验证已通过

生成时已执行：

- Python Adapter 语法编译：PASS
- 13/13 节点 START 可达：PASS
- `NextNodeIDs + Edge` 一致性：PASS
- 所有 `REFERENCE_OUTPUT.NodeID` 存在：PASS
- Schedule Widget 使用真实 Seed WidgetID：PASS
- 教师003第1周周一模拟：2 条课 + `sys.chat` “检查风险”：PASS
- `verified=false` 时强制 fallback：PASS
- `workflows.xlsx / example_queries.xlsx / parameters.xlsx` WorkflowId 一致：PASS
- ZIP CRC：PASS
- ADP 六文件合同：PASS

本轮修改正式 01：**无**。

---

## 4. 下一 Runtime Gate

导入 Pilot 后先不要启用，进入 Pilot 自身调试：

`教师003第1周周一的课`

预期：

- 原生 Schedule Widget 下发；
- 2 条课程；
- 已核验；
- 第5-6节 / 第7-8节；
- 校区A / 校区B；
- 不重复整段成功 Markdown；
- 第三个 Action 为 `检查风险`。

点击 `检查风险` 后，Action 文本应为：

`检查教师003第1周周一是否存在时间冲突或跨校区赶场`

在应用级 Runtime 中应继续路由到 03 self-compare。

只有真实 ADP Runtime + sys.chat 回流通过后，才允许标记：

`ADP_WIDGET_SCHEDULE_RUNTIME_PASS`

仍不得标记：

`ADP_WIDGET_NATIVE_PASS`
