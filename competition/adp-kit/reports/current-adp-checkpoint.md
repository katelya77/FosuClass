# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-11 22:28 +08:00

当前状态：

- `CORE_WORKFLOWS_FROZEN`
- `APP_ROUTING_CONTEXT_FROZEN`
- `WIDGET_V2_LOCAL_GATE_PASS`
- `ADP_WIDGET_REAL_EXPORT_FORMAT_CAPTURED`
- `ADP_WIDGET_NATIVE_TEMPLATE_PASS`
- `ADP_WIDGET_RUNTIME_SEED_CAPTURED`
- `ADP_WIDGET_SCHEDULE_RUNTIME_DEBUGGING`
- `ADP_WIDGET_NATIVE_RUNTIME_PENDING`
- `GITHUB_ACTIONS_BILLING_BLOCKED`

PR #49：保持 open、未 merge、未正式发布。

## 1. 冻结基础能力

- 01 多维课表查询：真实 ADP 通过，冻结。
- 02 空教室规划 V7.2：五轮累计条件真实 ADP 通过，冻结。
- 03 课程冲突比较 V5.1：self-compare、赶场去重、01→03 handoff 真实通过，冻结。
- 04 今日校园计划 V1.1：核心/边界真实 ADP 通过，冻结。
- 应用标准模式路由 + 模型输入上下文改写：冻结。
- 动态事实只来自 CampusTools；失败时不得由模型补造。

## 2. Widget V2 代码/视觉层

C 方案：Schedule / Classroom / Conflict / Day Plan / Choice / Error。

统一视觉：校园任务单 / 时间票据。

Kimi Code 本机真实 Gate 已通过：Adapter tests、六类样例、validate-kit、Playwright 三 viewport、完整 `npm test --prefix competition/adp-kit`、Golden 33/33、submission 安全扫描均 PASS。

六张 V2 `.widget` 已在腾讯云 ADP 实机导入并显示独立原生 UI Preview：`ADP_WIDGET_NATIVE_TEMPLATE_PASS`。

## 3. Runtime Seed

用户导出 `export-00-节点格式种子-勿启用(3).zip`，已捕获：

- `NodeType=WIDGET`
- Schedule WidgetID=`23fbc659efe3482fab588d754e4420a4`
- Choice WidgetID=`f540588933a4459cbe78a6fe99aa022c`
- Widget 参数结构在 `WidgetNodeData.WidgetParam`
- OBJECT / ARRAY_OBJECT / ARRAY_STRING 使用 `SubParams`
- **ARRAY_STRING 平台硬规则：至少 1 个 STRING 子参数槽位。真实 Seed 形式为 `teachers/classes → item 0 → STRING`。**

## 4. Schedule Runtime 当前真实状态

### V1

`01-多维课表查询-WidgetPilot`

真实输入：`教师003第1周周一的课`

结果：CampusTools / Adapter / Widget展示判断均成功，最终 `小序-课表票据-V2` Runtime 失败并显示“系统运行异常”。

### V1.1

为了排查复杂 OBJECT / ARRAY_OBJECT 顶层直引，改为 summary/items/actions 原子字段映射。

用户导入后 ADP 直接给出结构错误：

`teachers 参数为ARRAY_STRING类型，必须有一项子参数，classes 参数为ARRAY_STRING类型，必须有一项子参数`

这不是新的业务错误，而是 V1.1 为诊断时删除 ARRAY_STRING 子槽位导致的确定 Schema 错误。

### V1.2 — 当前待实机验证

生成物：

`01-多维课表查询-WidgetPilot-V1.2-ARRAY_STRING子参数修复版-可直接导入.zip`

SHA256：

`99e4081a5276d33caff9c70f395e809a6de7ac1754729a264d605ffbc459488f`

修复：

- 复制真实 Seed 的 ARRAY_STRING 子参数结构；
- item0/item1 的 teachers/classes 均恢复 `item 0 STRING`；
- Adapter 输出 `item0_teacher0/item0_class0/item1_teacher0/item1_class0`，动态保留首教师/首班级；
- summary/items/actions 继续使用 V1.1 原子化映射；
- 正式 01 不修改。

本地验证：

- RED：V1.1 有 4 个 ARRAY_STRING 缺子参数；
- GREEN：V1.2 四个均有 1 个 STRING 子槽位；
- Adapter 教师/班级保真模拟 PASS；
- START 可达 PASS；
- Reference NodeID PASS；
- XLSX WorkflowID 一致 PASS；
- ZIP CRC / 六文件合同 PASS。

下一实机 Gate：

1. 导入 V1.2；
2. 画布不能再出现 ARRAY_STRING 结构红错；
3. 调试 `教师003第1周周一的课`；
4. 如果 Widget Runtime 成功，进入应用级 sys.chat Action Gate；
5. 如果 Runtime 仍失败，必须展开失败 Widget 节点获取 Error + 输入变量实际值 + 耗时，不再猜。

## 5. 官方 ADP 文档原则

- Widget 概述 `126973`
- Card `126981`
- 配置 Widget 节点 `126979`
- Widget 节点 `126990`
- Action `127283`
- Button `127018`

运行时原则：输入结构/类型必须匹配；类型不一致先经 Code Adapter；结果卡直接向后流转；Choice 等待用户操作；`sys.chat` 作为新用户输入继续 Agent 路由；Widget 不承担事实计算。

## 6. 新对话接力

长期单一入口：

`competition/adp-kit/reports/ChatGPT-project-handoff-current.md`

在 FosuClass Project 新对话首句：

```text
@GitHub 请先读取 competition/adp-kit/reports/ChatGPT-project-handoff-current.md、competition/adp-kit/reports/current-adp-checkpoint.md、competition/adp-kit/widget/native/runtime-integration-runbook.md，然后继续校园智序-小序 ADP 研发；不要重新设计已经冻结的 01–04。
```

## 7. 后续路线

Schedule Runtime + sys.chat → 02 Classroom Runtime → 03 Conflict Runtime → 04 Day Plan Runtime → Choice/Error → 32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟获奖型演示。

## 8. GitHub Actions

仍为账户 Billing / Spending Limit 阻塞，runner 未启动；不是代码测试失败。