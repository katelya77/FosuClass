# 校园智序 · 小序 — ChatGPT Project 新对话接力主文件

更新时间：2026-08-12 02:59 +08:00

> 这是 FosuClass Project 内新对话继续研发的单一接力入口。新对话先读本文件，再读 `current-adp-checkpoint.md`、`2026-08-12-b2-zod-jsonschema-mismatch.md` 与 `competition/adp-kit/widget/native/runtime-integration-runbook.md`。不要仅依赖聊天历史。

## 新对话第一句

```text
@GitHub 请先读取 competition/adp-kit/reports/ChatGPT-project-handoff-current.md、competition/adp-kit/reports/current-adp-checkpoint.md、competition/adp-kit/reports/2026-08-12-b2-zod-jsonschema-mismatch.md、competition/adp-kit/widget/native/runtime-integration-runbook.md，然后继续校园智序-小序 ADP 研发。B2 已真实 Runtime PASS，不要重复 B2；当前优先审计失败 Schedule Widget 的真实 ADP 导出 Schema 五方合同。
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

## Schedule Runtime 历史结论

不要重走以下死路：

- V1：CampusTools / Adapter / Widget展示判断成功，Widget Runtime 失败。
- V1.1：发现 ARRAY_STRING 子参数结构问题。
- V1.2：修复后 Runtime 报 `460101 / convert widget view failed / __jsx in undefined`。
- V1.3 RuntimeSafe：Schema 仅 STRING/INT、零 map/复杂对象，Runtime 仍相同错误。
- Schedule 节点一直为“直接向后流转”。
- 腾讯官方模板 `基础表单澄清-DtR1y` 在最小工作流中真实 Runtime PASS。
- 官方模板本身也有 map / 三元 / ARRAY_OBJECT / `WIDGET_ACTION_NONE`。

因此 map、三元、ARRAY_OBJECT、WIDGET_ACTION_NONE、直接向后流转都不能再作为通用根因。

## B2 天气基线：已正式 PASS

### 初始问题

初始 B2 的 Template/Default 使用六字段：

`city / condition / temp / high / low / advice`

但真实导出内部 Zod Schema 与 outer JSON Schema 都只有 `title`，所以 Preview 出现 `undefined`，工作流只暴露 `title`。

### 修正实验

用户只修改 B2 的 Zod Schema 为六字段，保持腾讯官方天气 Template 与 Default，不手工同时改 JSON Schema；随后新建最小工作流：

`开始 → B21 → 结束`

六字段全部固定 `USER_INPUT`，下发方式“直接向后流转”。

### 实机结果

2026-08-12 02:45:37 +08:00，输入 `测试`：

- Preview 正常显示深圳 / 阴 / 14°C / 18°C / 10°C / 穿衣建议；
- 新 B21 节点只暴露六个正确字段；
- Runtime 全链绿色 PASS；
- 耗时约 272 ms；
- request_id 截图显示 `MSGNDYU2XZ-8163319233`。

### 新导出 `B2(1).widget`

- SHA256 `69f38cae45a6ad9c213de634125d16b1a3a844206215dc784cbd4d0f4e41e841`
- WidgetID `6f073d3dc8544bd99bac13caa47b51b9`
- `schemaValidity/viewValidity/defaultStateValidity = valid`

独立解析：

```text
TemplateVars
= DefaultKeys
= ZodSchemaKeys
= JSONSchemaKeys
= {city, condition, temp, high, low, advice}
```

### 新导出 `export-B2.zip`

- SHA256 `c92fcf96b5c2a2720d4fafa5d3a4758eeaea5dbb1c7e8cf7cf7c8c057eb18b02`
- WorkflowID `888d0fa7-3af3-4920-bce9-07c41f6d7f32`
- Widget Node `B21`
- WidgetID 与 `.widget` 一致
- `ActionType=WIDGET_ACTION_NONE`
- `WidgetParam` 与 `NodeUI.content.inputs` 都严格为六字段
- 六项均 `InputType=USER_INPUT`

因此最终五方：

```text
TemplateVars
= DefaultKeys
= ZodSchemaKeys
= JSONSchemaKeys
= WorkflowWidgetInputs
= {city, condition, temp, high, low, advice}
```

并且 Preview PASS + Runtime PASS。

正式标记：`B2_WIDGET_BASELINE_PASS`。

详细报告：`competition/adp-kit/reports/2026-08-12-b2-zod-jsonschema-mismatch.md`

## 当前 Zod / JSON Schema 平台合同

官方公开 `127031` 仍以 JSON Schema 展示代码创建天气示例；当前公开 1759 文档没有说明 Widget Zod 作者态优先级。

但本次 B2 真实导出证明：

> 在用户当前赛事空间、本次保存路径中，修改 Zod 后，内部 Zod Schema 与 outer JSON Schema 会同步为同一字段合同，并正确传播到新拖入的工作流 Widget 输入。

只把它作为当前赛事空间的实机合同，不外推成腾讯 ADP 全平台规则。

B2 同时排除了以下 Schedule 通用根因：

- 代码创建 Widget 本身；
- 固定 USER_INPUT；
- `WIDGET_ACTION_NONE`；
- “直接向后流转”；
- 当前空间 Widget Runtime 服务全局异常。

## 当前唯一最高优先 Gate：Schedule 真实导出 Schema 五方审计

不要立即修改 Schedule Template，也不要生成 V1.4/V1.5。

需要用户在腾讯 ADP 中做的唯一必要人工动作：

1. 导出当前**实际报 460101 的 Schedule Widget** 的 `.widget` 文件，优先 RuntimeSafe V3；
2. 如果 V2 和 RuntimeSafe V3 都仍存在，最好两份都直接导出上传；
3. 不需要手工复制 Schema / Template / Default。

ChatGPT/Codex 收到后自动审计：

```text
TemplateVars
DefaultKeys
ZodSchemaKeys
JSONSchemaKeys
WorkflowWidgetInputs
```

重点：

- Zod 和 outer JSON Schema 是否同步；
- Template 是否有漏声明变量；
- Default 是否多/漏字段；
- 工作流最终暴露字段是否一致；
- 类型是否一致，尤其 RuntimeSafe V3 的 `shownCount` integer；
- 是否残留历史 `title` 或其它异常字段。

仓库静态 RuntimeSafe V3 当前已有：

- `competition/adp-kit/widget/native/schedule-runtime-safe-v3-template.txt`
- `competition/adp-kit/widget/native/schedule-runtime-safe-v3-schema.json`
- `competition/adp-kit/widget/native/schedule-runtime-safe-v3-default.json`

静态三方看起来一致，但 **不能据此认为 ADP 实际保存合同一致**；B2 已证明必须以平台真实导出为准。

### 若 Schedule 导出五方不一致

只修 Schema 合同，不改 UI Template；保存 → 重新导出 → 五方一致后再 Runtime。

### 若 Schedule 导出五方完全一致

排除 Schema mismatch。随后只做一个高信息量单变量实验，优先决定 B1 `REFERENCE_OUTPUT` 差分或 Schedule 组件差分，禁止连续删模板猜根因。

## B1

官方基础表单 + 单一 `REFERENCE_OUTPUT` 仍有价值，用于验证动态引用与自动 Workflow ZIP Reference 序列化；当前排在 Schedule 实际导出 Schema 审计之后。

## 研发方式

- ChatGPT：架构、根因、决策、提示词、验收、版本收敛；
- Codex / Kimi：批量代码、测试、ZIP 构建、Widget 审计、Playwright、Git Gate；
- 用户：只做腾讯 ADP 必须人工完成的导入/导出、拖节点、真实 Runtime、截图。

## 比赛主线

Widget 只做少量高信息量实验。Schedule 在 Schema 审计后若仍不能快速收敛，Widget 转支线，主线继续：

32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟获奖型演示。

## GitHub

仓库：`katelya77/FosuClass`

分支：`feat/campusflow-adp-integration`

PR：#49，正式评测收口前保持 open / unmerged，不正式发布应用。

GitHub Actions included minutes 已用 `3000 / 3000`，与腾讯 ADP Runtime 无关。