# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-12 19:15 +08:00

当前状态：

- `ADP_LOCAL_FINAL_CONVERGENCE_PASS`
- `ADP_FINAL_BUNDLE_COMPILED`
- `ADP_01_SCHEDULE_FINAL_GENERATED`
- `ADP_WEEK_TRANSPORT_OMITS_WEEKDAY_AND_DATE`
- `ADP_FINAL_ARTIFACT_GATE_65_65_PASS`
- `ADP_FINAL_RUNTIME_E2E_PENDING`
- `PUBLIC_READY_FAIL`
- `CORE_WORKFLOWS_FROZEN`
- `APP_ROUTING_CONTEXT_FROZEN`
- `WIDGET_V2_LOCAL_GATE_PASS`
- `ADP_WIDGET_NATIVE_TEMPLATE_PASS`
- `ADP_WIDGET_OFFICIAL_TEMPLATE_RUNTIME_PASS`
- `B2_WIDGET_BASELINE_PASS`
- `ADP_WIDGET_SCHEDULE_CONTRACT_SPLIT_CONFIRMED`
- `SCHEDULE_CONTRACTSYNC_PACKAGE_READY`
- `ADP_WIDGET_SCHEDULE_RUNTIME_PASS`
- `ADP_WIDGET_SCHEDULE_SYS_CHAT_TRIGGER_PASS`
- `ADP_WIDGET_ACTION_CONTRACT_LOCAL_PASS`
- `ADP_WIDGET_SCHEDULE_ACTION_E2E_PENDING`
- `ADP_WIDGET_NATIVE_RUNTIME_PENDING`
- `GITHUB_ACTIONS_INCLUDED_MINUTES_EXHAUSTED`

PR #49：保持 open / unmerged / 未正式发布。

## 冻结事实层

除非 80 条正式评测证明回归，不再改：

- 01 多维课表查询；
- 02 空教室规划 V7.2；
- 03 课程冲突比较 V5.1；
- 04 今日校园计划 V1.1；
- 标准模式 Agent 路由与模型输入上下文改写。

动态校园事实只来自 CampusTools；失败不得补造。

固定：`dataVersion=competition-demo-v1`，`dataHash=sha1:fefef4bf425b`。

## B2：正式 PASS

天气代码 Widget 已完成五方一致：

`TemplateVars = DefaultKeys = ZodSchemaKeys = JSONSchemaKeys = WorkflowWidgetInputs`

六字段固定 USER_INPUT，`开始 → B21 → 结束` 真实 Runtime PASS。

## Schedule ContractSplit：已修复

历史真实导出确认：旧 Schedule `.widget` outer wrapper / Workflow WidgetParam 仍是 V2 七字段，而 encodedWidget / Adapter 已是 RuntimeSafe V3 21 字段，导致预检查和 460101 调试混乱。

方案 A 保留 WidgetID：

`23fbc659efe3482fab588d754e4420a4`

Canonical RuntimeSafe V3 contract 固定 21 字段，`shownCount=INT`，其余 STRING。

生成并导入：

`01-多维课表查询-WidgetStable-可直接导入.zip`

WorkflowID：`5bf89039-74fd-580e-b1a8-3c3cabdf483f`

静态 Gate 19/19 PASS；CRC PASS；XLSX WorkflowID 同步 PASS。

## 2026-08-12 03:30+ 实机：Schedule Runtime 正式 PASS

用户按方案 A：

1. 在现有 Schedule Widget 保存 21 字段 Zod；
2. 导入 WidgetStable ZIP；
3. 输入 `教师003第1周周一的课`。

真实截图确认：

- `Widget数据适配-Schedule` 成功；
- `Widget展示判断` 成功；
- `小序-课表票据-WidgetStable` 成功；
- 原生卡片动态显示教师003、第1周周一、2 条课程、第5-6节/第7-8节、校区A/校区B；
- Widget 后继续到结束节点成功；
- 不再出现 `460101 / convert widget view failed / __jsx in undefined`。

正式标记：`ADP_WIDGET_SCHEDULE_RUNTIME_PASS`。

新上传 `小序-课表票据-V2(3).widget` 独立解析：

- SHA256 `9d5635a773ab056c3699b88f1379b67bd886280b06a25c0c2ee736230f2a67c3`
- WidgetID 保持不变；
- outer jsonSchema = RuntimeSafe V3 21 字段；
- encodedWidget Zod = 同 21 字段；
- Default = 同 21 字段；
- 三按钮均为 `sys.chat`。

outer `template` 仍为空字符串，但本轮 Runtime 实机成功，当前空间该状态不阻止 encodedWidget.view 正常渲染。

## sys.chat：触发链已 PASS，Action payload 合同待收口

用户点击 Schedule Widget 交互后，ADP 显示“已进行操作”并进入新的智能体轮次，因此可标记：

`ADP_WIDGET_SCHEDULE_SYS_CHAT_TRIGGER_PASS`

随后新的 01 查询返回：

- `INVALID_PARAM`
- `weekday 需为 1-7`
- 日期解析：`不支持的 dateText；请使用受控相对日期或 YYYY-MM-DD`

这不是 Widget Runtime 失败，而是 Action 文本进入 Agent 后，不满足 01 参数提取器 / CampusTools 的确定性日期合同。

当前 RuntimeSafe V3 Action 示例：

- `查看整周` → `查看教师003第1周整周课表`
- `换一天` → `换一天看看教师003的课表`
- `检查风险` → `检查教师003第1周周一是否存在时间冲突或跨校区赶场`

CampusTools 受控 `dateText` 只接受：今天/明天/后天、本周X/这周X/下周X、第N周周X、YYYY-MM-DD。`换一天` 不能作为机器执行日期。

详细：`2026-08-12-schedule-runtime-pass-action-contract.md`。

## Action Contract V1：本地 PASS

不要再改 Schedule Widget Schema / Template / Runtime。

目标：UI label 自然，`sys.chat payload.query` 使用 canonical utterance。

教师场景已固定：

- 查看整周：`查询教师003第1周的课表`
- 下一天：当前第1周周一 → `查询教师003第1周周二的课`
- 检查风险：`检查教师003第1周周一是否存在时间冲突或跨校区赶场`

实现：

1. `schedule-runtime-safe-v3-adapter.py` 成为 21 字段 Adapter 唯一源码；
2. Workflow ZIP generator 从该文件注入 CodeExecutor，旧路径只保留兼容入口；
3. Adapter 仅根据 verified CampusTools `resolvedEntity/query` 生成动作；
4. `换一天/当前范围/再看看` 等模糊词不进入 payload；
5. room/class/course 只生成冻结 01 支持的明确周/星期查询，不创建缺参 02/03；
6. 第 20 周周日固定回退第 20 周周六，不越学期。

新制品：

`output/competition-adp/01-多维课表查询-WidgetStable-ActionsV1-可直接导入.zip`

- WorkflowID：`f3961270-90a0-46d3-b86f-75a88a0c2ba8`
- SHA256：`ce5448911f20b562516cf0e03959078b51e43f83dafd0da623bc734caa90fb24`
- Artifact Gate：29/29 PASS
- Action Contract tests：teacher day/week、rollover、semester end、room/class/course 与 invalid guards PASS

正式标记：`ADP_WIDGET_ACTION_CONTRACT_LOCAL_PASS`。

尚未在腾讯 ADP 导入/点击验收，严格不得标记 `ADP_WIDGET_SCHEDULE_ACTION_E2E_PASS`。

详细：`2026-08-12-schedule-action-contract-v1-local-pass.md`。

## Schedule Actions V1.1：Week Scope Contract 本地 PASS

真实 ADP 已证明 DAY payload `查询教师003第1周周二的课` 可重新进入旧 01，并返回 `2026-09-01 verified EMPTY_RESULT`；整周 payload `查询教师003第1周的课表` 则暴露旧 01 的两个边界问题：optional `weekday=0` 未清空，以及显式“第N周”被重复写入 `date_text`。

V1.1 只修改 01 的参数提取 Prompt、日期输入守卫、查询参数归一化及其生成/测试：

- `week` 只接受 1–20，`weekday` 只接受 1–7；
- `week=1, weekday=0, time_scope=week` → `query_week=1, query_weekday=None`；
- 合法显式 week 时 `safe_date_text=""`；无合法 week 时保留明天/本周三/下周五及真正非法自然语言，继续由 CampusTools 结构化处理；
- Action Builder V1、WidgetID、Schedule 21 字段、Template/Schema/WidgetParam、CampusTools、结果核验、02/03/04 均未改变。

新制品：

`output/competition-adp/01-多维课表查询-WidgetStable-ActionsV1.1-可直接导入.zip`

- WorkflowID：`9272b9cb-c805-4fed-a300-1984a881a231`
- SHA256：`36c5f92c3d544d0fa97cd0609cf4a44d71e5edb99833d2e59dc95861fbf65ff6`
- Artifact Gate：35/35 PASS
- Week Scope regressions：7/7 PASS

当前 ADP 管理页 ActionsV1 未启用、原始 01 已启用，因此 `sys.chat` 落到旧 01 是预期平台行为。导入 V1.1 并完成真实整周 E2E 前，仍不得标记 `ADP_WIDGET_SCHEDULE_ACTION_E2E_PASS`。

详细：`2026-08-12-schedule-actions-v1.1-week-scope-local-pass.md`。

## 研发效率模式

用户明确要求停止碎片化试验。后续固定：

`用户批量导出 ADP 真实资源 → 本地 Contract Compiler 审计/生成 → 自动 Gate → 用户一次导入 → 少量端到端 Runtime`

下一工程目标：把 6 个 Widget 的 Schema / Adapter / WidgetParam / Action payload / NodeUI / ZIP 统一由单一合同源生成。

## 后续路线

Schedule Action E2E → 批量收口 02/03/04 + Choice/Error → 六卡 Runtime PASS → 32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟演示。
