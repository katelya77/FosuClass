# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-12 02:46 +08:00

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

## 2026-08-12 新发现：B2 的 Zod / JSON Schema 模式错位

用户此前上传真实 `B2.widget`。解析结果：

- Template 引用：`city / condition / temp / high / low / advice`；
- Default 也包含这 6 个字段；
- 但真实保存/导出的 Schema 只有 `title`；
- 内部 Schema 为 Zod：`z.object({ title: z.string() }).strict()`；
- 外层 `jsonSchema` 也只包含 `title`；
- 因此 Preview 出现 `undefined`，工作流 Widget 节点只暴露 `title`，完全符合实际 Schema。

这说明当前赛事空间 Widget 编辑器已经存在 `Zod / JSON Schema` 两种 Schema 表达。B2 当前状态不能用于判断“代码创建 Runtime 是否正常”，因为它的数据合同本身没有正确建立。

详细报告：

`competition/adp-kit/reports/2026-08-12-b2-zod-jsonschema-mismatch.md`

## 2026-08-12 02:46 官方文档二次复核

重新联网核对腾讯云 1759 Widget 官方文档后，结论修正为：

- `126973` 明确：Schema 规范 Template 引入变量；Default 为变量提供默认数据。
- `127031` 当前公开的“代码创建”天气示例仍使用 **JSON Schema**，并声明 `city / condition / temp / high / low / advice` 六个必填 string 字段。
- `126979` / `126990` 明确：工作流 Widget 输入数据结构必须与 Widget 所需格式一致，否则无法正常渲染；结果展示卡使用“直接向后流转”。
- `127283` 明确：需要 Agent 感知点击并继续推理/路由时使用 `sys.chat`。
- 在当前腾讯云 `1759` 官方文档范围搜索 `Zod` / `z.object`，未找到公开的 Widget Zod 作者态说明。

因此禁止再把“Zod 是 ADP 平台全局唯一真源”作为已证实事实。当前正确表述是：

> 用户当前赛事空间的真实 B2 导出内部 `schema` 为 Zod、外层同时有 `jsonSchema`。对 B2 应暂时把 **Zod 作为最小实机修正入口**，随后必须通过重新导出确认 Zod 与 outer jsonSchema 是否同步。

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

Default 保留 6 个天气字段，Template 不修改。

为保持本轮只有一个实验变量，保存 B2 后 **新建最小工作流并重新拖入 B2 节点**，不要复用旧节点：

`开始 → B2 → 结束`

验收：

1. Preview 不再出现 `undefined`；
2. 新 B2 节点暴露 6 个输入变量；
3. 六项全部使用固定“输入”值，不使用引用；
4. 下发方式“直接向后流转”；
5. 输入 `测试` 做真实 Runtime。

### Gate Z2 — 若 B2 Runtime PASS

立即重新导出 B2，并审计：

```text
TemplateVars
DefaultKeys
ZodSchemaKeys
JSONSchemaKeys
WorkflowWidgetInputs
```

五方必须都等于：

```text
{city, condition, temp, high, low, advice}
```

五方一致 + Runtime PASS 后，才标记 `B2_WIDGET_BASELINE_PASS`。

随后优先审计小序 Schedule V2/V3 的真实导出 Schema 五方集合。在完成这个审计前，禁止继续 V1.4/V1.5 Template 补丁。

### 若 B2 Runtime FAIL

保存 request_id / trace_id / 时间 / 完整错误；此时才有资格判断代码创建 Widget Runtime 兼容链存在问题。

### Gate B1

官方基础表单 + 单一 `REFERENCE_OUTPUT` 的 B1 差分实验仍有价值，但优先级下降到 Z1/Z2 之后。

## 当前 B2 文件状态

本轮 GitHub 代码搜索未发现 `B2.widget` 已提交到仓库；本轮新对话也没有新的 B2 二进制附件可直接再次解析。因此当前解析证据沿用此前真实上传并已写入报告的结果。待 B2 Runtime 后重新导出，再做第二次独立解析。

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
