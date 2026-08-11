# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-12 02:57 +08:00

当前状态：

- `CORE_WORKFLOWS_FROZEN`
- `APP_ROUTING_CONTEXT_FROZEN`
- `WIDGET_V2_LOCAL_GATE_PASS`
- `ADP_WIDGET_NATIVE_TEMPLATE_PASS`
- `ADP_WIDGET_RUNTIME_SEED_CAPTURED`
- `ADP_WIDGET_OFFICIAL_TEMPLATE_RUNTIME_PASS`
- `ADP_WIDGET_SCHEMA_MODE_MISMATCH_FOUND`
- `B2_WIDGET_BASELINE_PASS`
- `SCHEDULE_EXPORTED_SCHEMA_AUDIT_PENDING`
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
3. 腾讯官方模板 `基础表单澄清-DtR1y` 在 `开始 → Widget → 结束` 最小链中真实 Runtime PASS；平台 Widget Runtime 不是全局故障。
4. 官方模板成功节点同样有 map / 三元 / ARRAY_OBJECT / `WIDGET_ACTION_NONE`，因此这些不能再作为通用根因。
5. B2 官方天气代码 Widget 在 Schema 修正后已完成五方合同一致 + 真实 Runtime PASS。

## B2 Schema / Runtime 闭环

初始 B2 的 Template/Default 使用：

`city / condition / temp / high / low / advice`

但初始真实导出的内部 Zod Schema 与 outer JSON Schema 都只有 `title`，导致 Preview `undefined` 与工作流只暴露 `title`。

修正 B2 的 Zod 后，用户新建最小链：

`开始 → B21 → 结束`

六字段全部固定 `USER_INPUT`，下发方式“直接向后流转”，输入 `测试`，2026-08-12 02:45:37 +08:00 实机 Runtime 全链绿色 PASS，耗时约 272 ms。

新上传 `B2(1).widget` 独立解析：

- SHA256 `69f38cae45a6ad9c213de634125d16b1a3a844206215dc784cbd4d0f4e41e841`
- WidgetID `6f073d3dc8544bd99bac13caa47b51b9`
- `schemaValidity/viewValidity/defaultStateValidity = valid`
- TemplateVars / DefaultKeys / ZodSchemaKeys / JSONSchemaKeys 均为六字段。

新上传 `export-B2.zip` 独立解析：

- SHA256 `c92fcf96b5c2a2720d4fafa5d3a4758eeaea5dbb1c7e8cf7cf7c8c057eb18b02`
- WorkflowID `888d0fa7-3af3-4920-bce9-07c41f6d7f32`
- Widget Node `B21`
- `ActionType=WIDGET_ACTION_NONE`
- `WidgetParam` 与 `NodeUI.content.inputs` 均严格为六字段
- 六项 `InputType=USER_INPUT`

最终：

```text
TemplateVars
= DefaultKeys
= ZodSchemaKeys
= JSONSchemaKeys
= WorkflowWidgetInputs
= {city, condition, temp, high, low, advice}
```

且 Preview PASS + Runtime PASS。

正式状态：`B2_WIDGET_BASELINE_PASS`。

详细证据：`competition/adp-kit/reports/2026-08-12-b2-zod-jsonschema-mismatch.md`

## 当前平台合同结论

- 腾讯公开 `127031` 仍以 JSON Schema 展示代码创建天气示例；公开 1759 文档未给出 Widget Zod 作者态优先级。
- 但在当前赛事空间本次 B2 保存路径中，修改 Zod 后，重新导出的内部 Zod 与 outer JSON Schema 已同步为同一组六字段。
- 该结论只作为当前赛事空间的实机合同，不外推到 ADP 全平台。
- `WIDGET_ACTION_NONE`、直接向后流转、固定 USER_INPUT、代码创建 Widget 本身均已被 B2 证明不是 Schedule 失败的通用根因。

## 当前最高优先 Gate：Schedule 真实导出 Schema 审计

禁止继续生成 Schedule V1.4/V1.5 Template 补丁。

下一步必须先取得当前 ADP 中**实际失败的 Schedule Widget 的真实导出 `.widget`**：

1. 优先导出 RuntimeSafe V3；
2. 如果 V2 与 RuntimeSafe V3 都仍在 ADP 中，建议两份都导出，便于差分；
3. 不需要手工抄 Schema/Template，直接上传导出文件即可。

随后由 ChatGPT/Codex 自动审计：

```text
TemplateVars
DefaultKeys
ZodSchemaKeys
JSONSchemaKeys
WorkflowWidgetInputs
```

并重点检查：

- Zod 与 outer JSON Schema 是否同步；
- Template 是否存在未声明变量；
- Default 是否漏字段/多字段；
- 工作流实际暴露字段是否与 Widget 导出一致；
- 类型是否一致，尤其 RuntimeSafe V3 的 `shownCount: integer`；
- 是否有历史 `title` 或其它残留 Schema 字段。

仓库中的 RuntimeSafe V3 源文件目前在静态层面三方看起来是一致的：

- `schedule-runtime-safe-v3-template.txt`
- `schedule-runtime-safe-v3-schema.json`
- `schedule-runtime-safe-v3-default.json`

但这**不能替代 ADP 真实导出审计**，因为 B2 已证明编辑器实际保存合同可能与我们本地源文件不同。

## 后续分支

### 若 Schedule 实际导出五方不一致

优先修 Schema 合同，不改 UI Template；保存后重新导出确认一致，再做 Runtime Pilot。

### 若 Schedule 实际导出五方完全一致

Schema mismatch 假设被排除。下一步做单变量高信息量差分，而不是继续猜测式删 UI。此时再决定 B1 `REFERENCE_OUTPUT` 实验或最小 Schedule 组件差分。

### B1

官方基础表单 + 单个 `REFERENCE_OUTPUT` 仍保留，用于验证动态引用与自动 Workflow ZIP 的 Reference 序列化；当前排在 Schedule 导出 Schema 审计之后。

## 比赛主线

Widget 调试只允许少量高信息量实验。若 Schedule 在 Schema 审计后仍不能快速收敛，Widget 转支线，主线立即继续：

32 QA → 80 条 ADP 原生应用评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟获奖型演示。

## GitHub Actions

Actions included minutes 已用 `3000 / 3000`，与 ADP Widget Runtime 无关。Codex / Kimi 本地继续承担测试、构建、ZIP 与 Gate。

## 新对话接力

先读：

1. `competition/adp-kit/reports/ChatGPT-project-handoff-current.md`
2. `competition/adp-kit/reports/current-adp-checkpoint.md`
3. `competition/adp-kit/reports/2026-08-12-b2-zod-jsonschema-mismatch.md`
4. `competition/adp-kit/widget/native/runtime-integration-runbook.md`

新对话优先事项：**B2 已 PASS，不再重复 B2；直接做失败 Schedule Widget 的真实导出 Schema 五方审计。**