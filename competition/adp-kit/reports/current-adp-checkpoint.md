# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-11 21:44 +08:00

当前状态：

- `CORE_WORKFLOWS_FROZEN`
- `APP_ROUTING_CONTEXT_FROZEN`
- `WIDGET_V2_LOCAL_GATE_PASS`
- `ADP_WIDGET_REAL_EXPORT_FORMAT_CAPTURED`
- `ADP_WIDGET_NATIVE_TEMPLATE_PASS`
- `ADP_WIDGET_RUNTIME_SEED_CAPTURED`
- `ADP_WIDGET_SCHEDULE_PILOT_READY`
- `ADP_WIDGET_NATIVE_RUNTIME_PENDING`
- `GITHUB_ACTIONS_BILLING_BLOCKED`

PR #49：保持 open、未 merge、未正式发布。

---

## 1. 基础能力：全部冻结

- 01 多维课表查询：真实 ADP 调试通过，冻结。
- 02 空教室规划 V7.2：基础查询、两轮继承、五轮累计槽位真实 ADP 通过，冻结。
- 03 课程冲突比较 V5.1：整周、自比较去伪冲突、赶场去重、单教师 self-compare、01→03 handoff 均真实 ADP 通过，冻结。
- 04 今日校园计划 V1.1：核心 5 条 + 边界 5 条真实 ADP 通过，冻结。

应用级：标准模式；01/02/03/04 启用；模型输入上下文改写开启；角色指令 V2.1；02 五轮累计上下文、03 单教师赶场和 01→03 handoff 均真实通过。

除非后续基准评测发现回归，不再修改 01–04 的确定性业务逻辑。

---

## 2. Widget V2 代码层：本机 Gate 已通过

采用 C 方案：Schedule / Classroom / Conflict / Day Plan / Choice / Error。

统一视觉：`校园任务单 / 时间票据`。

核心链路：

`CampusTools verified envelope → widget/adapter.js → campus-widget/v2 ViewModel → ADP 原生 Widget / H5 fallback`

Kimi Code 已在 Windows 本机真实验证：

- Adapter tests：PASS；
- 六类 sample generation：PASS；
- `validate-kit.js`：PASS；
- Playwright 390×844 / 430×932 / 768×1024 × 六卡：PASS，无横向溢出；
- assets manifest：78 files 一致；
- `npm test --prefix competition/adp-kit`：PASS；
- Golden：33/33；
- submission scan：findings=0 / credentialCandidates=0；
- `git diff --check`：PASS。

状态：`WIDGET_V2_LOCAL_GATE_PASS`。

---

## 3. ADP 原生 Widget：真实导出格式已获得

用户通过腾讯云智能 ADP “代码创建”建立并导出 `小序-课表票据-Pilot.widget`。

真实 `.widget` 外层：

- `version`
- `name`
- `template`
- `jsonSchema`
- `outputJsonPreview`
- `encodedWidget`

`encodedWidget` Base64 解码后包含：

- `name`
- `id`
- `view`
- `defaultState`
- `states`
- `schema`
- `schemaValidity`
- `viewValidity`
- `defaultStateValidity`

用户 seed SHA256：

`addc40092b8378a5a86025debe3d1226245d88a942f22858e2eee3adca383348`

状态：`ADP_WIDGET_REAL_EXPORT_FORMAT_CAPTURED`。

---

## 4. 六张 V2 原生 Widget：腾讯云 ADP 实机导入/预览通过

已真实导入：

1. `小序-课表票据-V2`
2. `小序-空教室票据-V2`
3. `小序-冲突赶场票据-V2`
4. `小序-今日校园计划-V2`
5. `小序-候选确认-V2`
6. `小序-任务恢复-V2`

用户截图确认：

- Widget 列表缩略图六张视觉不再相同；
- Schedule 详情 Preview 能正常显示暖纸张/墨绿“校园任务单”样式；
- Schedule Preview 显示教师003、第1周周一、两门课程、节次、校区/教室、已核验状态、三个按钮；
- Classroom / Conflict / Day Plan / Choice / Error 列表缩略图均出现独立 UI；
- 原 `Campus Task Widget` 占位预览问题已关闭。

因此允许标记：

`ADP_WIDGET_NATIVE_TEMPLATE_PASS`

注意：此状态只证明 `.widget` 原生模板导入/预览成功；尚未证明工作流动态结构化数据能驱动 Widget，也未证明 `sys.chat` Action 在真实应用对话中回流成功。

在真实 Runtime Gate 完成前，不得写：

`ADP_WIDGET_NATIVE_PASS`

---

## 5. 官方 ADP 文档已纳入运行时设计

用户指定参考：

`https://cloud.tencent.com/document/product/1759/126981`

并扩展核对腾讯云 Widget / 工作流官方文档：

- Widget 概述 `126973`
- Card `126981`
- 配置 Widget 节点 `126979`
- Widget 节点 `126990`
- Widget Action `127283`
- Button `127018`
- ListView `126995`
- ListViewItem `126994`

运行时原则：

1. Widget 节点输入必须来自前序结构化输出；类型不一致时先用代码节点转换；
2. 结果展示卡使用“直接向后流转”；
3. Choice 使用“等待用户操作”；
4. 需要 Agent 继续感知和路由的交互必须使用 `sys.chat`；
5. Widget 只做 UI/交互，不复制 CampusTools 事实算法。

详细 Runbook：

`competition/adp-kit/widget/native/runtime-integration-runbook.md`

---

## 6. 工作流 Widget Runtime Seed：已捕获

状态：`ADP_WIDGET_RUNTIME_SEED_CAPTURED`

来源：

`export-00-节点格式种子-勿启用(3).zip`

用户在禁用的 00 Seed 工作流中放置：

- `小序-课表票据-V2`
- `小序-候选确认-V2`

未接正式业务后直接导出。

真实字段确认：

- `NodeType = WIDGET`
- Schedule WidgetID = `23fbc659efe3482fab588d754e4420a4`
- Choice WidgetID = `f540588933a4459cbe78a6fe99aa022c`
- Seed 中两个未接线 Widget 的 `ActionType = WIDGET_ACTION_NONE`
- Widget 入参保存在 `WidgetNodeData.WidgetParam`
- OBJECT / ARRAY_OBJECT 结构使用 `SubParams`
- NodeUI 输出展示 `Output / Output.Content`

抽象合同：

`competition/adp-kit/widget/native/widget-node-seed-contract.json`

仍未捕获：Choice “等待用户操作”对应的非 NONE ActionType。该项只影响 Choice Runtime Gate，不阻塞 Schedule 结果卡 Pilot。

---

## 7. 01 Schedule WidgetPilot：已生成，等待 ADP Runtime 实测

状态：`ADP_WIDGET_SCHEDULE_PILOT_READY`

Pilot：

`01-多维课表查询-WidgetPilot`

WorkflowID：

`578e7df1-6290-4218-82e9-cb16b165625a`

导入包：

`01-多维课表查询-WidgetPilot-V1-可直接导入.zip`

SHA256：

`7e65f229eb73f6855432abae355d650382af9b2e5436d6c7ff45d4079bfa1238`

链路：

```text
课表查询
→ 结果核验与呈现
→ Widget数据适配-Schedule
→ Widget展示判断
  ├─ route=widget → 小序-课表票据-V2 → 结束
  └─ else → 查询结果回复 → 结束
```

Adapter Gate：只有 `success=true + competition-demo-v1 + evidence.verified=true + items非空` 才下发 Widget；其他结果保持冻结版本旧文本兜底。

Adapter 源码：

`competition/adp-kit/widget/native/schedule-runtime-adapter.py`

生成时已静态验证：

- Adapter Python 语法：PASS；
- 13/13 节点 START 可达：PASS；
- `NextNodeIDs + Edge`：PASS；
- Reference NodeID：PASS；
- 教师003第1周周一模拟：2 课 + 安全 `sys.chat`：PASS；
- `verified=false` 强制 fallback：PASS；
- XLSX WorkflowId 一致：PASS；
- ZIP CRC / 六文件合同：PASS。

下一实机输入：

`教师003第1周周一的课`

必须出现原生 Schedule Widget，且不重复整段成功 Markdown。

教师场景第三个按钮调整为更强演示路径：

`检查风险`

Action：

`检查教师003第1周周一是否存在时间冲突或跨校区赶场`

应用级点击后应进入 03 self-compare。

只有 Runtime + Action 真实通过后标记：

`ADP_WIDGET_SCHEDULE_RUNTIME_PASS`

---

## 8. 后续 Widget Runtime 扩展

Schedule Runtime 通过后，按顺序：

1. 捕获/获得 Classroom / Conflict / Day Plan 的真实 WidgetID；
2. 自动生成 02 Classroom WidgetPilot；
3. 自动生成 03 Conflict WidgetPilot；
4. 自动生成 04 Day Plan WidgetPilot；
5. Choice 获取“等待用户操作”真实 ActionType 后接歧义分支；
6. Error 接工具失败 / 非法条件 / 学期范围外恢复分支。

六卡动态数据 + Action 全部真实 ADP 通过后才允许：

`ADP_WIDGET_NATIVE_PASS`

---

## 9. ADP 工作流导入包永久规则

1. `Nodes[].NextNodeIDs` 与顶层 `Edge` 必须同时更新；
2. `REFERENCE_OUTPUT.Reference.NodeID` 必须存在；
3. 被引用节点必须位于消费节点真实上游路径；
4. START 到所有业务节点必须可达；
5. 能只改 workflow JSON 就不改已经通过 ADP 导入的 XLSX；如果必须创建独立 WorkflowID，则只最小修改 `workflows/example_queries/parameters.xlsx` 的 WorkflowId/元数据；
6. 参数提取输出、Tool 输出 Schema、NodeUI output 必须同时注册；
7. 顶层 `parameters.xlsx` 的 `ParameterParentId` 保持空值；
8. 每次生成 ZIP 执行 CRC、节点可达性、引用上游性、XLSX/ID 不变量校验。

---

## 10. GitHub Actions

仍为账户 Billing / Spending Limit 阻塞，runner 未启动，并非代码测试失败。

状态：`GITHUB_ACTIONS_BILLING_BLOCKED`。

---

## 11. Widget Runtime 之后

1. 32 组标准 QA 导入 + 来源展示精修；
2. 80 条 ADP 原生基准评测；
3. 角色指令多提示词 A/B；
4. 匿名 / 提示注入 / 越权红队；
5. 多模态输入（图片只提取查询条件，动态事实仍由 CampusTools 核验）；
6. Test Release；
7. 5 分钟获奖型演示脚本、演示数据和最终提交资产。

PR #49 继续保持 open、未 merge、未正式发布。