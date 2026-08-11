# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-12 01:09 +08:00

当前状态：

- `CORE_WORKFLOWS_FROZEN`
- `APP_ROUTING_CONTEXT_FROZEN`
- `WIDGET_V2_LOCAL_GATE_PASS`
- `ADP_WIDGET_REAL_EXPORT_FORMAT_CAPTURED`
- `ADP_WIDGET_NATIVE_TEMPLATE_PASS`
- `ADP_WIDGET_RUNTIME_SEED_CAPTURED`
- `ADP_WIDGET_SCHEDULE_RUNTIME_DEBUGGING`
- `ADP_WIDGET_RUNTIME_ARCHITECTURE_RECHECK`
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

## 2. Widget 视觉层

C 方案：Schedule / Classroom / Conflict / Day Plan / Choice / Error。

统一视觉：校园任务单 / 时间票据。

Kimi Code 本机真实 Gate 已通过：Adapter tests、六类样例、validate-kit、Playwright 三 viewport、完整 `npm test --prefix competition/adp-kit`、Golden 33/33、submission 安全扫描均 PASS。

六张 V2 `.widget` 已在腾讯云 ADP 实机导入并显示独立原生 UI Preview：`ADP_WIDGET_NATIVE_TEMPLATE_PASS`。

## 3. Runtime Seed 与当前关键缺口

来源：用户导出的 `export-00-节点格式种子-勿启用(3).zip`。

已捕获：

- `NodeType=WIDGET`
- Schedule WidgetID=`23fbc659efe3482fab588d754e4420a4`
- Choice WidgetID=`f540588933a4459cbe78a6fe99aa022c`
- Widget 参数结构位于 `WidgetNodeData.WidgetParam`
- OBJECT / ARRAY_OBJECT / ARRAY_STRING 使用 `SubParams`
- ARRAY_STRING 必须至少包含 1 个 STRING 子参数槽位
- **Seed 中两个 Widget 节点均未完成正式运行配置，捕获到 `ActionType=WIDGET_ACTION_NONE`**

腾讯云官方文档明确要求 Widget 节点配置“Widget 下发方式”：直接向后流转 / 等待用户操作。我们尚未捕获“直接向后流转”的真实平台枚举值。

## 4. Schedule Runtime 调试结论

### V1

CampusTools / Adapter / Widget展示判断成功，Widget Runtime 失败。

### V1.1

为了诊断复杂结构进行扁平化时触发确定 Schema 错误：`teachers/classes ARRAY_STRING 必须有一项子参数`。

### V1.2

恢复 ARRAY_STRING 子槽位后，结构错误消失，但 Runtime 报：

```text
460101 ... convert widget view failed ...
code:122 ... operator to search for '__jsx' in undefined
```

### V1.3 RuntimeSafe — 已真实失败

用户已按要求把现有 `小序-课表票据-V2` 原地替换为 RuntimeSafe V3，并上传重新导出的 `小序-课表票据-V2(1).widget`。

解析该真实导出文件确认：

- WidgetID 仍为 `23fbc659efe3482fab588d754e4420a4`
- Template 已真实保存为 RuntimeSafe V3
- Schema 仅 STRING / INT
- 零 `.map()`
- 零 OBJECT / ARRAY_OBJECT / ARRAY_STRING
- 仅静态 ListViewItem + 简单变量绑定 + 3 个 sys.chat Button
- `schemaValidity=viewValidity=defaultStateValidity=valid`

V1.3 真实调试仍返回与 V1.2 完全相同的：

```text
460101
convert widget view failed
code:122
operator to search for '__jsx' in undefined
```

因此：**“复杂 JSX / 复杂 Schema 是主要根因”的假设已经被实机否证。禁止继续堆 V1.4/V1.5 Template 补丁。**

故障报告：

`competition/adp-kit/reports/2026-08-12-schedule-widget-runtime-v13-identical-converter-failure.md`

## 5. 当前唯一优先 Gate：验证 Widget 下发方式

下一步不改 Template、不改 Adapter、不改 CampusTools，只做一个单变量实验：

1. 在现有 `01-多维课表查询-WidgetPilot-V1.3` 打开 `小序-课表票据-RuntimeSafe-V3` 节点；
2. 找到“Widget 下发方式”；
3. 明确选择“直接向后流转”；
4. 保存；
5. 重新调试 `教师003第1周周一的课`。

若 PASS：根因锁定为自动生成节点继承了未配置 Seed 的 `WIDGET_ACTION_NONE`。

若仍 FAIL：导出这份已经人工配置“直接向后流转”的 V1.3 ZIP，捕获真实 ActionType 枚举；随后使用腾讯云官方最小静态 Widget（Card + Title + Text，固定输入）建立独立 Runtime 基线，以判断是自定义 Widget 转换问题，还是当前空间/平台 Widget Runtime 服务问题。

## 6. 官方 ADP 文档原则

重点文档：

- Widget 概述 `126973`
- Card `126981`
- ListView `126995`
- 配置 Widget 节点 `126979`
- Widget 节点 `126990`
- Action `127283`
- Button `127018`
- 代码创建 `127031`
- ADP-Widget SDK `129230`

已确认：

- Widget 节点必须配置输入变量和 Widget 下发方式；
- 结果展示型 Widget 应选择“直接向后流转”；
- Choice 应选择“等待用户操作”；
- Widget 输入结构/类型必须与上游匹配，不一致先用 Code Adapter；
- `sys.chat` payload 会作为新用户输入进入当前会话；
- Preview PASS 不等于 Runtime PASS；
- Widget 只负责 UI/交互，不承担校园事实计算。

## 7. 新对话接力

长期单一入口：

`competition/adp-kit/reports/ChatGPT-project-handoff-current.md`

在 FosuClass Project 新对话首句：

```text
@GitHub 请先读取 competition/adp-kit/reports/ChatGPT-project-handoff-current.md、competition/adp-kit/reports/current-adp-checkpoint.md、competition/adp-kit/widget/native/runtime-integration-runbook.md，然后继续校园智序-小序 ADP 研发；不要重新设计已经冻结的 01–04。
```

## 8. 后续路线

先建立 Schedule Widget Runtime 最小可靠基线，再进入：Schedule sys.chat → 02 Classroom Runtime → 03 Conflict Runtime → 04 Day Plan Runtime → Choice/Error → 32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟获奖型演示。

## 9. GitHub Actions

仍为账户 Billing / Spending Limit 阻塞，runner 未启动；不是代码测试失败。