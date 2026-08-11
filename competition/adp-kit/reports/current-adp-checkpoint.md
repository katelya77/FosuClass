# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-12 02:32 +08:00

当前状态：

- `CORE_WORKFLOWS_FROZEN`
- `APP_ROUTING_CONTEXT_FROZEN`
- `WIDGET_V2_LOCAL_GATE_PASS`
- `ADP_WIDGET_NATIVE_TEMPLATE_PASS`
- `ADP_WIDGET_RUNTIME_SEED_CAPTURED`
- `ADP_WIDGET_OFFICIAL_TEMPLATE_RUNTIME_PASS`
- `ADP_WIDGET_SCHEMA_MODE_MISMATCH_FOUND`
- `ADP_WIDGET_ZOD_SCHEMA_AUDIT_PENDING`
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

## Widget 已证实事实

1. 六张 C 方案 Widget 已在 ADP 实机导入并出现独立 UI Preview。
2. Schedule Runtime V1-V1.3：CampusTools / Adapter / 判断均成功，但自定义 Schedule Widget Runtime 报 `460101 / convert widget view failed / __jsx in undefined`。
3. 腾讯官方模板 `基础表单澄清-DtR1y` 在 `开始 → Widget → 结束` 最小链中真实 Runtime PASS；因此平台 Widget Runtime 服务不是全局故障。
4. 官方模板成功节点同样是 `ActionType=WIDGET_ACTION_NONE`，Template 也包含 map / 三元 / ARRAY_OBJECT，因此这些都不能再作为通用根因。

## 2026-08-12 02:32 新发现：B2 的 Zod / JSON Schema 模式错位

用户上传真实 `B2.widget`。解析结果：

- Template 引用：`city / condition / temp / high / low / advice`；
- Default 也包含这 6 个字段；
- 但真实保存/导出的 Schema 只有 `title`；
- 内部 Schema 为 Zod：`z.object({ title: z.string() }).strict()`；
- 外层 `jsonSchema` 也只包含 `title`；
- 因此 Preview 出现 `undefined`，工作流 Widget 节点只暴露 `title`，完全符合实际 Schema。

这说明当前赛事空间 Widget 编辑器已经存在 `Zod / JSON Schema` 两种 Schema 表达，而官方 `127031` 文档仍主要展示 JSON Schema 示例。B2 当前状态不能用于判断“代码创建 Runtime 是否正常”，因为它的数据合同本身没有正确建立。

详细报告：

`competition/adp-kit/reports/2026-08-12-b2-zod-jsonschema-mismatch.md`

## 当前最高优先 Gate

### Gate Z1 — 修正 B2 的 Zod Schema

在 B2 的 **Zod** 模式中明确配置：

```ts
import { z } from "zod";

const widgetSchema = z.object({
  city: z.string(),
  condition: z.string(),
  temp: z.string(),
  high: z.string(),
  low: z.string(),
  advice: z.string(),
}).strict();

export default widgetSchema;
```

然后：

1. Default 保留 6 个字段；
2. Preview 必须不再出现 `undefined`；
3. 工作流 Widget 节点必须暴露 6 个输入变量；
4. 全部固定 USER_INPUT；
5. `开始 → B2 → 结束` Runtime 实机测试。

### Gate Z2 — 若 B2 PASS

立刻重新导出 B2，确认实际 `.widget` 内 Zod / outer jsonSchema 同步为 6 字段；然后重新审计小序 Schedule V2/V3 的 **真实导出 Zod Schema**。在完成这个审计前，禁止继续 V1.4/V1.5 Template 补丁。

### Gate B1

官方基础表单 + 单一 `REFERENCE_OUTPUT` 的 B1 差分实验仍有价值，但优先级下降到 Z1 之后。

## 官方文档原则

已深查：

- Widget 总览 `126973`
- 从模板创建 `127030`
- 代码创建 `127031`
- 导入 Widget `127033`
- 配置 Widget 节点 `126979`
- Widget 节点 `126990`
- Action `127283`
- ADP-Widget SDK `129230`

官方明确：Schema 用于规定 Template 变量的数据结构，Default 负责提供对应变量的默认值；工作流 Widget 输入必须与 Schema 一致。

## 比赛主线并行策略

Widget Schema/Runtime 调试只做高信息量差分，不无限打补丁。若 Runtime 仍未收敛，Widget 转支线，同时推进：

32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟获奖型演示。

## GitHub Actions

Actions included minutes 已用 `3000 / 3000`，与 ADP Widget Runtime 无关。当前 Codex / Kimi 本地执行测试、构建和 Git Gate。

## 新对话接力

先读：

1. `competition/adp-kit/reports/ChatGPT-project-handoff-current.md`
2. `competition/adp-kit/reports/current-adp-checkpoint.md`
3. `competition/adp-kit/widget/native/runtime-integration-runbook.md`
4. `competition/adp-kit/reports/2026-08-12-b2-zod-jsonschema-mismatch.md`

新对话第一句：

```text
@GitHub 请先读取 competition/adp-kit/reports/ChatGPT-project-handoff-current.md、competition/adp-kit/reports/current-adp-checkpoint.md、competition/adp-kit/reports/2026-08-12-b2-zod-jsonschema-mismatch.md、competition/adp-kit/widget/native/runtime-integration-runbook.md，然后继续校园智序-小序 ADP 研发；不要重新设计已经冻结的 01–04。优先完成 B2 Zod Schema 修正与 Runtime 实机验证。
```
