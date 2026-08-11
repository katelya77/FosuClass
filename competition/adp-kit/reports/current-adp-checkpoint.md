# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-11 22:50 +08:00

当前状态：

- `CORE_WORKFLOWS_FROZEN`
- `APP_ROUTING_CONTEXT_FROZEN`
- `WIDGET_V2_LOCAL_GATE_PASS`
- `ADP_WIDGET_REAL_EXPORT_FORMAT_CAPTURED`
- `ADP_WIDGET_NATIVE_TEMPLATE_PASS`
- `ADP_WIDGET_RUNTIME_SEED_CAPTURED`
- `ADP_WIDGET_SCHEDULE_RUNTIME_DEBUGGING`
- `ADP_WIDGET_RUNTIME_SAFE_V3_READY`
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

来源：用户导出的 `export-00-节点格式种子-勿启用(3).zip`。

已捕获：

- `NodeType=WIDGET`
- Schedule WidgetID=`23fbc659efe3482fab588d754e4420a4`
- Choice WidgetID=`f540588933a4459cbe78a6fe99aa022c`
- Widget 参数结构在 `WidgetNodeData.WidgetParam`
- OBJECT / ARRAY_OBJECT / ARRAY_STRING 使用 `SubParams`
- ARRAY_STRING 平台硬规则：至少 1 个 STRING 子参数槽位；真实 Seed：`teachers/classes → item 0 → STRING`

## 4. Schedule Runtime 调试历史

### V1

CampusTools / Adapter / Widget展示判断成功，`小序-课表票据-V2` Runtime 失败。

### V1.1

将 summary/items/actions 顶层复杂引用扁平化后，ADP 在校验阶段明确报：

```text
teachers 参数为ARRAY_STRING类型，必须有一项子参数
classes 参数为ARRAY_STRING类型，必须有一项子参数
```

### V1.2 — 已真实运行，错误进一步收敛

生成物：

`01-多维课表查询-WidgetPilot-V1.2-ARRAY_STRING子参数修复版-可直接导入.zip`

SHA256：

`99e4081a5276d33caff9c70f395e809a6de7ac1754729a264d605ffbc459488f`

V1.2 已按真实 Seed 恢复 ARRAY_STRING 子参数结构；画布结构校验不再报 teachers/classes 错误。

真实调试输入：

`教师003第1周周一的课`

真实结果：

- CampusTools：成功；
- `Widget数据适配-Schedule`：成功；
- `Widget展示判断`：成功；
- `小序-课表票据-V2`：失败；
- 平台错误：

```text
460101-工作流运行异常: 获取Widget内容失败:
convert widget view failed: http request failed:
type:framework, code:122,
msg:client codec Unmarshal: rpc.toJsonViewResponse.Data:
ReadMapCB: expect { or n, but found ",
...
operator to search for '__jsx' in undefined
```

因此当前根因不再是参数槽位结构，而是 **Widget Template → JSON View 转换阶段**。

故障报告：

`competition/adp-kit/reports/2026-08-11-schedule-widget-runtime-v12-converter-failure.md`

## 5. RuntimeSafe V3 — 当前下一步

状态：`ADP_WIDGET_RUNTIME_SAFE_V3_READY`

新 Widget：

`小序-课表票据-RuntimeSafe-V3`

源码：

- `competition/adp-kit/widget/native/schedule-runtime-safe-v3-template.txt`
- `competition/adp-kit/widget/native/schedule-runtime-safe-v3-schema.json`
- `competition/adp-kit/widget/native/schedule-runtime-safe-v3-default.json`

V3 设计：

- Template 零 `.map()`；
- 零三元条件；
- 零动态 children 数组；
- Schema 仅 STRING / INT；
- 零 OBJECT / ARRAY_OBJECT / ARRAY_STRING；
- 2 个静态 ListViewItem；
- 3 个静态 sys.chat Button；
- 所有字符串拼接在 Adapter 完成，Template 只做简单变量绑定。

依据：腾讯云官方 `代码创建` 与 `ListView` 示例均采用静态组件树 + 简单变量绑定；`配置 Widget 节点` 要求运行时输入格式严格匹配；ADP 最终 Widget 协议由 JSON View 渲染。

下一 Gate：

1. 用户导入 `小序-课表票据-RuntimeSafe-V3.widget`；
2. Preview 正常；
3. 在禁用 00 Seed 工作流中拖入 V3 Widget，无需接线；
4. 导出 00 Seed ZIP；
5. 捕获平台分配的真实 RuntimeSafe V3 WidgetID / WidgetParam；
6. 自动生成 `01-多维课表查询-WidgetPilot-V1.3`；
7. 真实调试同一句；
8. 若成功，再进入 `sys.chat → Agent → 03` Action Gate。

在 V1.3 Runtime 真实成功前，不允许标记 `ADP_WIDGET_SCHEDULE_RUNTIME_PASS`。

## 6. 官方 ADP 文档原则

- Widget 概述 `126973`
- Card `126981`
- ListView `126995`
- 配置 Widget 节点 `126979`
- Widget 节点 `126990`
- Action `127283`
- 代码创建 `127031`
- ADP-Widget SDK `129230`

运行时原则：

- 输入结构/类型必须匹配；不一致先经 Code Adapter；
- Runtime 优先使用官方最保守语法子集；
- 结果卡直接向后流转；Choice 等待用户操作；
- `sys.chat` 作为新用户输入继续 Agent 路由；
- Widget 不承担事实计算。

## 7. 新对话接力

长期单一入口：

`competition/adp-kit/reports/ChatGPT-project-handoff-current.md`

新对话第一句：

```text
@GitHub 请先读取 competition/adp-kit/reports/ChatGPT-project-handoff-current.md、competition/adp-kit/reports/current-adp-checkpoint.md、competition/adp-kit/widget/native/runtime-integration-runbook.md，然后继续校园智序-小序 ADP 研发；不要重新设计已经冻结的 01–04。
```

## 8. 后续路线

Schedule Runtime + sys.chat → 02 Classroom Runtime → 03 Conflict Runtime → 04 Day Plan Runtime → Choice/Error → 32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟获奖型演示。

## 9. GitHub Actions

仍为账户 Billing / Spending Limit 阻塞，runner 未启动；不是代码测试失败。
