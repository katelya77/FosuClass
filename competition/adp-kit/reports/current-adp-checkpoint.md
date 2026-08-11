# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-11 21:40 +08:00

当前状态：

- `CORE_WORKFLOWS_FROZEN`
- `APP_ROUTING_CONTEXT_FROZEN`
- `WIDGET_V2_LOCAL_GATE_PASS`
- `ADP_WIDGET_REAL_EXPORT_FORMAT_CAPTURED`
- `ADP_WIDGET_NATIVE_TEMPLATE_PASS`
- `ADP_WIDGET_RUNTIME_SEED_PENDING`
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

## 6. 下一 Gate：捕获真实“工作流 Widget 节点”格式

当前：`ADP_WIDGET_RUNTIME_SEED_PENDING`

原因：已经知道 `.widget` 文件格式，但还没有捕获腾讯云 ADP V2_6 工作流画布中“Widget 节点”的真实序列化字段。

为了继续保持“用户只手工做一次、后续 Agent 批量自动生成”的研发方式，下一步只需要一次 seed：

`00-Widget节点格式种子-勿启用`

至少放两个 Widget 节点：

1. `小序-课表票据-V2`，下发方式=`直接向后流转`；
2. `小序-候选确认-V2`，下发方式=`等待用户操作`。

保存后导出工作流 ZIP，不需要接正式业务。

Agent 拿到真实 seed 后解析：

- Widget `NodeType` / NodeUI；
- Widget ID / 引用字段；
- 输入映射格式；
- 直接流转 / 等待用户操作字段；
- 输出结构；
- Edge / NextNodeIDs。

随后自动生成：

- 01 Schedule WidgetPilot；
- 02 Classroom WidgetPilot；
- 03 Conflict WidgetPilot；
- 04 DayPlan WidgetPilot；
- Choice/Error 分支增强包。

---

## 7. Runtime Pilot 验收顺序

### B1 Schedule

复制正式 01 为测试副本：

`01-多维课表查询-WidgetPilot`

成功分支：

`query_schedule verified envelope → Widget Adapter → 小序-课表票据-V2 → End`

输入：

`教师003第1周周一的课`

必须显示原生 Schedule 卡且不重复整段 Markdown。

点击 `比较冲突`：

- `sys.chat` 必须把 Action 作为新用户输入写入同一对话；
- Agent 必须继续路由到 03；
- 上下文不得丢失。

通过后标记：`ADP_WIDGET_SCHEDULE_RUNTIME_PASS`。

### B2–B4

按顺序扩展：

1. 02 Classroom；
2. 03 Conflict；
3. 04 Day Plan；
4. Choice 等待确认；
5. Error 恢复动作。

六卡动态数据 + Action 全部真实 ADP 通过后才标记：

`ADP_WIDGET_NATIVE_PASS`

---

## 8. ADP 工作流导入包永久规则

1. `Nodes[].NextNodeIDs` 与顶层 `Edge` 必须同时更新；
2. `REFERENCE_OUTPUT.Reference.NodeID` 必须存在；
3. 被引用节点必须位于消费节点真实上游路径；
4. START 到所有业务节点必须可达；
5. 能只改 workflow JSON 就不改已经通过 ADP 导入的 XLSX；
6. 参数提取输出、Tool 输出 Schema、NodeUI output 必须同时注册；
7. 顶层 `parameters.xlsx` 的 `ParameterParentId` 保持空值；
8. 每次生成 ZIP 执行 CRC、节点可达性、引用上游性、XLSX/ID 不变量校验。

---

## 9. GitHub Actions

仍为账户 Billing / Spending Limit 阻塞，runner 未启动，并非代码测试失败。

状态：`GITHUB_ACTIONS_BILLING_BLOCKED`。

---

## 10. Widget Runtime 之后

1. 32 组标准 QA 导入 + 来源展示精修；
2. 80 条 ADP 原生基准评测；
3. 角色指令多提示词 A/B；
4. 匿名 / 提示注入 / 越权红队；
5. 多模态输入（图片只提取查询条件，动态事实仍由 CampusTools 核验）；
6. Test Release；
7. 5 分钟获奖型演示脚本、演示数据和最终提交资产。

PR #49 继续保持 open、未 merge、未正式发布。