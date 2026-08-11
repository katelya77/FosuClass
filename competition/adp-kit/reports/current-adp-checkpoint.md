# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-11 13:52 +08:00

当前状态：

- `CORE_WORKFLOWS_FROZEN`
- `APP_ROUTING_CONTEXT_FROZEN`
- `WIDGET_V2_LOCAL_GATE_PASS`
- `ADP_WIDGET_CODE_PILOT_READY`
- `GITHUB_ACTIONS_BILLING_BLOCKED`

PR #49：保持 open、未 merge、未正式发布。

---

## 1. 基础能力已全部冻结

- 01 多维课表查询：真实 ADP 调试通过，冻结。
- 02 空教室规划 V7.2：基础查询、两轮继承、五轮累计槽位真实 ADP 通过，冻结。
- 03 课程冲突比较 V5.1：整周、自比较去伪冲突、赶场去重、单教师 self-compare、01→03 handoff 均真实 ADP 通过，冻结。
- 04 今日校园计划 V1.1：核心 5 条 + 边界 5 条真实 ADP 通过，冻结。

应用级：

- 标准模式；
- 01/02/03/04 启用；
- 模型输入上下文改写开启；
- 角色指令 V2.1；
- 02 五轮累计上下文真实通过；
- 03 单教师赶场真实通过；
- 01→03 handoff 真实通过。

除非后续基准评测发现回归，不再修改 01–04 的确定性业务逻辑。

---

## 2. ADP 工作流导入包永久规则

1. `Nodes[].NextNodeIDs` 与顶层 `Edge` 必须同时更新；
2. `REFERENCE_OUTPUT.Reference.NodeID` 必须存在；
3. 被引用节点必须位于消费节点真实上游路径；
4. START 到所有业务节点必须可达；
5. 能只改 workflow JSON 就不改已经通过 ADP 导入的 XLSX；
6. 参数提取输出、Tool 输出 Schema、NodeUI output 必须同时注册；
7. 顶层 `parameters.xlsx` 的 `ParameterParentId` 保持空值；
8. 每次生成 ZIP 执行 CRC、节点可达性、引用上游性、XLSX/ID 不变量校验。

---

## 3. Widget V2 代码层：本机 Gate 已通过

采用 C 方案：

- Schedule
- Classroom
- Conflict
- Day Plan
- Choice
- Error

统一视觉：`校园任务单 / 时间票据`。

核心链路：

`CampusTools verified envelope → widget/adapter.js → campus-widget/v2 ViewModel → ADP 原生 Widget / H5 fallback`

已经完成：

- `widget/adapter.js` 六类适配器；
- 动态成功结果强制 `competition-demo-v1 + evidence.verified=true`；
- Action 最多 3 个，仅允许 `sys.chat / sys.go_to_url / sys.download`；
- `widget-schema.json` 升级 `campus-widget/v2`；
- 样例由真实 CampusTools 生成，不手写动态事实；
- H5 fallback 完成 4+2 产品化视觉；
- Classroom filters、Conflict 红色冲突/橙色赶场、Day Plan 时间轴、Choice、Error 均完成；
- H5 事件只回传安全 Action，不回传完整工具 envelope。

### 本机真实验证

Kimi Code 在 Windows 本机完成：

- Adapter tests：PASS；
- 六类 sample generation：PASS；
- `validate-kit.js`：PASS；
- Playwright 390×844 / 430×932 / 768×1024 × 六卡：PASS，无横向溢出；
- assets manifest：78 files 一致；
- `npm test --prefix competition/adp-kit`：PASS；
- Golden：33/33；
- submission scan：findings=0 / credentialCandidates=0；
- `git diff --check`：PASS。

提交：

- `c2f9b27d` test(competition): verify widget v2 productization
- `4ac9e611` docs(competition): mark widget v2 local gate pass

因此：`WIDGET_V2_LOCAL_GATE_PASS`。

---

## 4. GitHub Actions 状态

轻量 Widget CI 与原有 CI 均未获得 runner：

- `steps=[]`
- `runner_id=0`

GitHub annotation 明确为账户 Billing / Spending Limit 阻塞，并非代码执行失败。

状态：`GITHUB_ACTIONS_BILLING_BLOCKED`。

不得将红灯解释为代码失败，也不得为此修改业务代码。

---

## 5. ADP 原生 Widget 路线已更新：不再强制 Seed

2026-08-11 重新核对腾讯云 ADP 官方文档后，确认当前平台支持：

- Widget 开发 → 新建 Widget → **代码创建**；
- 直接编辑 `Template / Schema / Default`；
- Template 可绑定变量；
- Widget 节点可引用前序节点结构化输出；
- Widget 下发支持“直接向后流转 / 等待用户操作”；
- Action 官方支持 `sys.chat / sys.go_to_url / sys.download`；
- 平台也支持导入 `.widget`，但比赛主版本不猜未验证的文件外层封装。

因此原 `ADP_WIDGET_SEED_PENDING` 已降级为备用方案，主状态改为：

`ADP_WIDGET_CODE_PILOT_READY`

备用说明：

`widget/adp-widget-seed-requirements.md`

---

## 6. 当前 Pilot：小序-课表票据

已在仓库加入：

- `widget/native/schedule-template.txt`
- `widget/native/schedule-schema.json`
- `widget/native/schedule-default.json`
- `widget/native/native-schedule-pilot-runbook.md`

目标：先用 ADP 官方“代码创建”完成 `小序-课表票据-Pilot`。

Pilot 先只验证 Default Preview：

- Schedule 视觉；
- 数组列表；
- `已核验`状态；
- `sys.chat` Action 结构；
- Template / Schema / Default 真实兼容性。

Preview 通过后，再复制 01 为测试副本：

`01-多维课表查询-WidgetPilot`

只增加薄层：

`结果核验与呈现 → Widget数据适配 → Widget → 原回复/结束`

不改 CampusTools、日期解析、实体解析和现有事实逻辑。

### Pilot 通过条件

1. Default Preview 正常；
2. 工作流真实查询可出现原生 Schedule Widget；
3. `教师003第1周周一的课` 事实与冻结 01 一致；
4. 至少一个 `sys.chat` Action 能继续当前对话；
5. `比较冲突` 能进入 03 比较/澄清链路。

通过后标记：

`ADP_WIDGET_SCHEDULE_PILOT_PASS`

六张全部真实 ADP 验收后才允许：

`ADP_WIDGET_NATIVE_PASS`

---

## 7. Widget 后续路线

Schedule Pilot 通过后：

1. 基于已验证原生语法生成 Classroom；
2. 生成 Conflict；
3. 生成 Day Plan；
4. 生成 Choice（等待用户操作）；
5. 生成 Error；
6. 接入 01–04 测试副本并做应用级真实验收；
7. 验收通过后再切换正式 01–04 的展示末端。

之后立即进入：

1. 32 组标准 QA 导入 + 来源展示精修；
2. 80 条 ADP 原生基准评测；
3. 角色指令多提示词 A/B；
4. 匿名 / 提示注入 / 越权红队；
5. 多模态输入（图片只提取查询条件，动态事实仍由 CampusTools 核验）；
6. Test Release；
7. 5 分钟获奖型演示脚本、演示数据和最终提交资产。

PR #49 继续保持 open、未 merge、未正式发布。
