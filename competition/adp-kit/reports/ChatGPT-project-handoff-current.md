# 校园智序 · 小序 — ChatGPT Project 新对话接力主文件

更新时间：2026-08-12 02:48 +08:00

> 这是 FosuClass Project 内新对话继续研发的单一接力入口。新对话先读本文件，再读 `current-adp-checkpoint.md`、`2026-08-12-b2-zod-jsonschema-mismatch.md` 与 `competition/adp-kit/widget/native/runtime-integration-runbook.md`。不要仅依赖聊天历史。

## 新对话第一句

```text
@GitHub 请先读取 competition/adp-kit/reports/ChatGPT-project-handoff-current.md、competition/adp-kit/reports/current-adp-checkpoint.md、competition/adp-kit/reports/2026-08-12-b2-zod-jsonschema-mismatch.md、competition/adp-kit/widget/native/runtime-integration-runbook.md，然后继续校园智序-小序 ADP 研发；不要重新设计已经冻结的 01–04。优先完成 B2 Zod Schema 修正与 Runtime 实机验证。
```

## 项目目标

腾讯云智能 ADP 赛事智能体：`校园智序 · 小序`。

目标链：

`自然语言 → 标准模式 Agent 路由 → 01/02/03/04 确定性工作流 → CampusTools → verified envelope → 原生 Widget → sys.chat → 下一工作流 → 原生评测`

比赛设计以评委/领导视角优先：真实校园价值、可信事实、交互完成度、工程证据、量化评测、5 分钟故事化演示。

## 冻结层

除非后续基准评测发现回归，不再改事实逻辑：

- 01 多维课表查询：冻结。
- 02 空教室规划 V7.2：五轮累计条件真实 ADP 通过，冻结。
- 03 课程冲突比较 V5.1：self-compare、赶场去重、01→03 handoff 真实通过，冻结。
- 04 今日校园计划 V1.1：核心/边界真实通过，冻结。
- 标准模式应用路由 + 模型输入上下文改写：冻结。
- 动态校园事实只能来自 CampusTools；失败时模型不得补造。
- `dataVersion=competition-demo-v1`，`dataHash=sha1:fefef4bf425b`。

## Widget C 方案

4 主卡 + 2 辅助卡：Schedule / Classroom / Conflict / Day Plan / Choice / Error。

统一视觉：校园任务单 / 时间票据；暖纸张、墨绿可信状态；红=时间冲突，橙=跨校区赶场。

六张 V2 `.widget` 已在腾讯云 ADP 实机导入并出现独立 UI Preview：`ADP_WIDGET_NATIVE_TEMPLATE_PASS`。

Kimi Code 本机 Widget V2 Gate 已通过：Adapter tests、6 类样例、validate-kit、Playwright 3 viewport、完整 `npm test --prefix competition/adp-kit`、Golden 33/33、安全扫描均 PASS。

## Schedule Runtime 调试结论

- V1：CampusTools / Adapter / Widget展示判断成功，Widget Runtime 失败。
- V1.1：发现 ARRAY_STRING 子参数结构错误。
- V1.2：修复后 Runtime 报 `460101 / convert widget view failed / __jsx in undefined`。
- V1.3 RuntimeSafe：Schema 仅 STRING/INT、零 map/复杂对象，Runtime 仍同样失败。
- Schedule 节点一直为“直接向后流转”。
- 腾讯官方模板 `基础表单澄清-DtR1y` 在最小工作流中真实 Runtime PASS，因此平台 Runtime 不是全局故障。
- 官方模板成功节点本身也有 map / 三元 / ARRAY_OBJECT / `WIDGET_ACTION_NONE`，因此这些都不是通用根因。

## 2026-08-12 最新关键发现：Zod / JSON Schema 模式错位

用户创建官方天气示例 B2 后，Preview 出现：

- 城市为空；
- 温度 `undefined°C`；
- high/low `undefined°C`；
- 工作流 Widget 节点只暴露 `title` 一个输入。

用户此前上传真实 `B2.widget`。

实际解析确认：

- Template 确实引用 `city / condition / temp / high / low / advice`；
- Default 也确实包含这 6 个字段；
- 但真正导出的外层 `jsonSchema` 只有 `title`；
- `encodedWidget` 内部真正保存的 Schema 是 Zod：

```ts
import { z } from "zod"
const widgetSchema = z.object({ "title": z.string() }).strict()
export default widgetSchema;
```

因此 B2 的 `undefined` 不是天气 Template Runtime 失败，而是 **Schema 根本没有声明 Template 使用的 6 个变量**。

详细报告：

`competition/adp-kit/reports/2026-08-12-b2-zod-jsonschema-mismatch.md`

## 2026-08-12 02:48 官方文档复核后的重要修正

本轮重新联网读取腾讯云智能体开发平台 Widget 官方文档：

- Widget 总览 `126973`
- 从模板创建 `127030`
- 代码创建 `127031`
- 导入 Widget `127033`
- 配置 Widget 节点 `126979`
- Widget 节点 `126990`
- Widget Action `127283`
- ADP-Widget SDK `129230`
- Agent 输出 Widget
- 工具调用直接输出 Widget

官方公开合同确认：

1. Schema 用于规范 Template 中引入变量的数据结构。
2. Default 为 Template 变量提供默认数据。
3. 工作流 Widget 输入的数据结构必须与 Widget 需要的输入变量一致；不一致会导致无法正常渲染。
4. 结果展示型 Widget 使用“直接向后流转”。
5. 需要 Agent 感知用户点击并继续推理/路由时使用 `sys.chat`。
6. 工具结果直接输出 Widget 同样要求工具输出结构与 Widget 输入合同一致。

但有一个必须保留的边界：

- 当前公开 `127031` 代码创建天气示例仍明确展示 **JSON Schema**，并声明 `city / condition / temp / high / low / advice` 六个字段。
- 本轮在腾讯云 `1759` 官方文档范围搜索 `Zod` / `z.object`，未找到公开的 Widget Zod 作者态说明。
- 用户当前赛事空间 UI 却已经实际出现 `Zod / JSON Schema` 两种模式；此前真实 B2 导出内部 `schema` 是 Zod、外层同时还有 `jsonSchema`。

因此：

> 不得把“Zod 是腾讯 ADP 平台全局唯一 Schema 真源”写成官方既定事实。

当前最严谨的工程结论是：

> **对用户当前赛事空间的 B2，暂时把 Zod 作为最小实机修正入口；保存并重新导出后，再验证 Zod 与 outer jsonSchema 是否同步。**

这是本空间的待验证合同假设，不外推到全部 ADP 环境。

## 当前唯一最高优先 Gate：B2 Zod 修正

在 B2 的 Zod 模式中完整配置：

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

Default 保持：

```js
{
  city: "深圳",
  condition: "阴",
  temp: "14",
  high: "18",
  low: "10",
  advice: "建议穿着毛衣或厚外套，外出时携带雨具，关注气温变化。"
}
```

Template 不改，继续用腾讯官方天气示例。

保存后，为避免把旧工作流节点是否缓存旧 Schema 引入实验，**新建最小工作流并重新拖入 B2**：

`开始 → B2 → 结束`

要求：

1. Preview 不得再出现 `undefined`；
2. 新 B2 节点必须暴露 `city / condition / temp / high / low / advice` 六变量；
3. 六变量全部使用固定“输入”值，不用 REFERENCE_OUTPUT；
4. 下发方式“直接向后流转”；
5. 输入 `测试` 做真实 Runtime；
6. 若 PASS，立即重新导出 B2 `.widget`。

## B2 真正 PASS 的五方合同

重新导出后必须检查：

```text
TemplateVars
DefaultKeys
ZodSchemaKeys
JSONSchemaKeys
WorkflowWidgetInputs
```

五方全部严格等于：

```text
{city, condition, temp, high, low, advice}
```

只有 **五方一致 + Runtime PASS** 才允许标记：

`B2_WIDGET_BASELINE_PASS`

本轮 GitHub 代码搜索未发现 `B2.widget` 已提交到仓库，本轮新对话也没有新的 B2 二进制附件可直接再次解析；因此当前 B2 二进制结构沿用此前真实上传文件且已落库的解析证据。待 B2 Runtime 后重新导出，再做第二次独立解析。

## 修正 B2 后的下一步

### 若 B2 Runtime PASS

优先重新审计小序 Schedule V2/V3 的 **实际导出 Schema 五方集合**，看是否同样存在“Template/Default 很丰富，但真实保存的 Zod/outer jsonSchema/工作流输入未完整同步”的问题。在审计完成前，禁止继续 V1.4/V1.5 Template 打补丁。

随后再做 B1：官方基础表单 + 单一动态 `REFERENCE_OUTPUT`，验证动态引用/自动 ZIP 序列化。

### 若 B2 Runtime FAIL

保存 request_id / trace_id / 时间 / 完整错误；此时才有资格判断代码创建 Widget Runtime 兼容链存在问题。

## 用户工具与研发方式

用户拥有 Codex、Kimi Code。

后续策略：

- 重复代码、测试、ZIP 构建、Playwright、Git Gate 优先交给 Codex/Kimi；
- 用户在 ADP 只做必须的真实导入、一次性 Seed 捕获、真实调试；
- ChatGPT 负责架构、根因分析、实现提示词、验收合同和版本收敛；
- 所有真实状态、失败根因必须写回 GitHub。

## GitHub Actions

Actions included minutes 已用 `3000 / 3000`，与 ADP Widget Runtime 无关。

当前 Codex / Kimi 本地可继续完成测试和构建；PR #49 保持 open / unmerged。

## 永久 ADP ZIP 规则

- `NextNodeIDs` 与顶层 `Edge` 同步；
- Reference NodeID 存在且位于真实上游；
- START 到所有业务节点可达；
- Code/Tool/参数提取输出 Schema 与 NodeUI 注册同步；
- `parameters.xlsx` 顶层 `ParameterParentId` 为空；
- 每版执行 CRC / 可达性 / 引用 / XLSX-ID 校验；
- WIDGET 的复杂类型 `SubParams` 必须符合真实平台合同；
- Widget Schema 必须与 Template 实际使用变量、Default、工作流输入一致；当前调试额外审计 Zod/outer jsonSchema 两种表示；
- 当前空间同时有 Zod / JSON Schema 模式，必须检查真实导出而不能只看编辑器 UI；
- 未有实机证据前，不把 Preview PASS 当 Runtime PASS。

## Runtime 通过后的路线

Schedule Runtime 基线 → Schedule sys.chat → 02 Classroom Runtime → 03 Conflict Runtime → 04 Day Plan Runtime → Choice/Error → 32 QA → 80 条应用评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟获奖型演示。

## GitHub

仓库：`katelya77/FosuClass`

分支：`feat/campusflow-adp-integration`

PR：#49，保持 open / unmerged；正式评测收口前不发布应用。
