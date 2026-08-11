# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-12 02:15 +08:00

当前状态：

- `CORE_WORKFLOWS_FROZEN`
- `APP_ROUTING_CONTEXT_FROZEN`
- `WIDGET_V2_LOCAL_GATE_PASS`
- `ADP_WIDGET_NATIVE_TEMPLATE_PASS`
- `ADP_WIDGET_RUNTIME_SEED_CAPTURED`
- `ADP_WIDGET_OFFICIAL_TEMPLATE_RUNTIME_PASS`
- `ADP_WIDGET_RUNTIME_DIFFERENTIAL_TESTING`
- `ADP_WIDGET_NATIVE_RUNTIME_PENDING`
- `GITHUB_ACTIONS_INCLUDED_MINUTES_EXHAUSTED`

PR #49：保持 open / unmerged / 未正式发布。

## 冻结事实层

- 01 多维课表查询：冻结。
- 02 空教室规划 V7.2：真实多轮通过，冻结。
- 03 课程冲突比较 V5.1：self-compare / 赶场 / 01→03 handoff 真实通过，冻结。
- 04 今日校园计划 V1.1：核心/边界通过，冻结。
- 标准模式路由 + 模型输入上下文改写：冻结。
- 动态校园事实只来自 CampusTools；失败不得由模型补造。

## Widget 当前结论

六张 C 方案 Widget 已在 ADP 实机导入并出现独立 UI Preview：Schedule / Classroom / Conflict / Day Plan / Choice / Error。

Schedule Runtime 调试历史：

1. V1：CampusTools / Adapter / 展示判断成功，Widget Runtime 失败。
2. V1.1：发现 ARRAY_STRING 子参数结构问题。
3. V1.2：修复 ARRAY_STRING 后，Runtime 报 `460101 / convert widget view failed / __jsx in undefined`。
4. V1.3 RuntimeSafe：Schema 仅 STRING/INT，零 map/复杂对象，真实 Widget 导出 validity 全部 valid；Runtime 仍相同失败。
5. 用户确认 Schedule 节点从一开始就是“直接向后流转”；此前下发方式假设否证。
6. **最新：腾讯云官方模板 `基础表单澄清-DtR1y` 在最小工作流中真实 Runtime PASS。**

## 最新真实导出分析

用户上传：

- `export-00-节点格式种子-勿启用(4).zip`
- `基础表单澄清-DtR1y.widget`

解析确认官方模板成功节点：

- `NodeType=WIDGET`
- WidgetID=`5a3ac523bf7e46df8a5017fe243be40e`
- `ActionType=WIDGET_ACTION_NONE`
- 参数为固定 `USER_INPUT`
- `fields` 是真实 `ARRAY_OBJECT`

官方模板 Template 本身包含 `fields.map()`、三元表达式、Form、Input/Textarea、`sys.clarify`，Runtime 仍 PASS。

因此彻底否证以下作为“通用根因”的假设：

- `.map()`
- 三元 JSX
- ARRAY_OBJECT / 复杂 Schema
- `WIDGET_ACTION_NONE`
- 当前赛事空间 Widget Runtime 全局不可用

详细报告：

`competition/adp-kit/reports/2026-08-12-widget-official-template-runtime-pass.md`

## 当前最高优先 Gate：2×2 差分实验

已知 A：官方模板 + 固定 USER_INPUT = PASS。

已知 B：小序 Schedule + Code Adapter 引用 = FAIL。

只做两个最小实验：

### B1 官方模板 + 单一动态引用

`开始 → Code(输出 title STRING) → 官方基础表单 Widget → 结束`

仅 title 使用 `REFERENCE_OUTPUT`，fields 保持固定。

目的：验证动态引用以及自动生成 Workflow ZIP 中 WidgetParam 的引用序列化。

### B2 官方代码创建天气 + 固定输入

完全按腾讯官方 `127031` 天气 Widget 示例创建；全部手动固定输入；直接向后流转。

目的：验证“代码创建 Widget”链本身的 Runtime。

结果解释：

- B1 PASS + B2 PASS：平台、引用、代码创建均正常；问题只剩小序 Schedule 的具体 Template/参数合同。以官方天气基线渐进演化成 Schedule。
- B1 FAIL：优先调查 `REFERENCE_OUTPUT` / 自动构建 ZIP 的 WidgetParam 序列化；不要改 Widget UI。
- B1 PASS + B2 FAIL：代码创建链异常；生产路线改成“从官方模板复制后轻量改造”，同时准备腾讯云工单。
- 两者都 FAIL：再用纯手工 UI 引用做对照，区分 ZIP 自动构建器与平台本身。

## 官方文档原则

已深查：

- Widget 总览 `126973`
- 从模板创建 `127030`
- 代码创建 `127031`
- 导入 Widget `127033`
- 配置 Widget 节点 `126979`
- Widget 节点 `126990`
- Card `126981`
- ListView `126995`
- Button `127018`
- Action `127283`
- ADP-Widget SDK `129230`
- Agent 输出 Widget `127035`
- 工具调用直接输出 Widget `127036`

官方明确：代码创建与导入 Widget 都是受支持路径；工作流 Widget 需要输入结构一致，必要时 Code 转换；结果展示使用直接向后流转。

## 比赛主线并行策略

Widget 差分调试最多再做两轮高信息量实验，不允许无限打补丁。若仍不收敛，Widget 兼容问题转支线，同时继续：

32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟获奖型演示。

## GitHub Actions

Actions included minutes 已用 `3000 / 3000`。与 ADP Widget Runtime 无关。

当前使用 Codex / Kimi 本地执行测试、ZIP 构建、Playwright、Git Gate；必要时后续配置 self-hosted runner 或小额 Actions 预算。

## 新对话接力

先读：

1. `competition/adp-kit/reports/ChatGPT-project-handoff-current.md`
2. `competition/adp-kit/reports/current-adp-checkpoint.md`
3. `competition/adp-kit/widget/native/runtime-integration-runbook.md`
4. `competition/adp-kit/reports/2026-08-12-widget-official-template-runtime-pass.md`

新对话第一句：

```text
@GitHub 请先读取 competition/adp-kit/reports/ChatGPT-project-handoff-current.md、competition/adp-kit/reports/current-adp-checkpoint.md、competition/adp-kit/widget/native/runtime-integration-runbook.md，然后继续校园智序-小序 ADP 研发；不要重新设计已经冻结的 01–04。
```
