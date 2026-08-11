# B2 Widget — Zod / JSON Schema 模式不一致与基线闭环

更新时间：2026-08-12 02:55 +08:00

## 初始问题

用户按腾讯云官方 `127031` 天气 Widget 示例创建 B2。初始实机现象：

- Preview 中城市为空，`temp/high/low` 出现 `undefined`；
- 工作流 Widget 节点只暴露 `title` 一个输入变量。

对初始真实导出 `B2.widget` 的解析确认：

- Template 使用 `city / condition / temp / high / low / advice`；
- Default 也包含上述 6 个字段；
- `encodedWidget.schema` 却是 Zod `z.object({ title: z.string() }).strict()`；
- outer `jsonSchema` 同样只定义 `title`。

因此初始 B2 不是“代码创建 Widget Runtime FAIL”的有效证据，而是 Template / Default / Schema 合同不一致。

## 官方文档边界

2026-08-12 复核腾讯云智能体开发平台 1759 Widget 官方文档：

- `126973`：Schema 规范 Template 引入变量的数据类型/格式；Default 为变量提供默认数据；
- `127031`：公开天气示例仍以 JSON Schema 声明 `city / condition / temp / high / low / advice` 六个字段；
- `126979` / `126990`：工作流 Widget 输入结构必须匹配 Widget 数据合同；结果展示卡可“直接向后流转”；
- `127283`：需要 Agent 感知点击并继续推理/路由时使用 `sys.chat`。

当前公开 1759 文档中没有找到 Widget Zod 作者态优先级的正式说明，因此不能外推“Zod 是 ADP 全平台唯一真源”。

## Gate Z1/Z2 实机结果：PASS

用户在当前赛事空间 B2 的 Zod 模式中将 Schema 修正为：

```ts
import { z } from 'zod';

const widgetSchema = z
  .object({
    city: z.string(),
    condition: z.string(),
    temp: z.string(),
    high: z.string(),
    low: z.string(),
    advice: z.string(),
  })
  .strict();

export default widgetSchema;
```

并保持腾讯官方天气 Template 与 6 字段 Default。

实机观察：

1. Preview 已正确显示：深圳 / 阴 / 14°C / 18°C / 10°C / 穿衣建议，无 `undefined`；
2. 新拖入工作流的 Widget 节点暴露且仅暴露 6 个输入：`city / condition / temp / high / low / advice`；
3. 六项均为固定 `USER_INPUT`；
4. 下发方式为“直接向后流转”；
5. 最小链 `开始 → B21 → 结束`，输入 `测试`，真实 Runtime 全链绿色 PASS；
6. 实机时间：`2026-08-12 02:45:37 +08:00`，耗时约 `272 ms`；
7. 截图中 request_id 显示为 `MSGNDYU2XZ-8163319233`。

## 对新导出 `B2(1).widget` 的独立解析

上传文件：`B2(1).widget`

- bytes: `4248`
- SHA256: `69f38cae45a6ad9c213de634125d16b1a3a844206215dc784cbd4d0f4e41e841`
- WidgetID: `6f073d3dc8544bd99bac13caa47b51b9`
- `schemaValidity = valid`
- `viewValidity = valid`
- `defaultStateValidity = valid`

字段集合：

```text
TemplateVars     = {advice, city, condition, high, low, temp}
DefaultKeys      = {advice, city, condition, high, low, temp}
ZodSchemaKeys    = {advice, city, condition, high, low, temp}
JSONSchemaKeys   = {advice, city, condition, high, low, temp}
```

outer `jsonSchema.required` 同样包含上述 6 字段，`additionalProperties=false`。

这证明：**至少在当前赛事空间、本次 B2 保存路径中，修改 Zod 后，重新导出的内部 Zod Schema 与 outer JSON Schema 已同步为同一组六字段。**

注意：该结论仅证明当前空间的实际行为，不宣称腾讯 ADP 所有空间/版本都以 Zod 为全局 canonical source。

## 对 `export-B2.zip` 的独立解析

上传文件：`export-B2.zip`

- bytes: `36124`
- SHA256: `c92fcf96b5c2a2720d4fafa5d3a4758eeaea5dbb1c7e8cf7cf7c8c057eb18b02`
- WorkflowID: `888d0fa7-3af3-4920-bce9-07c41f6d7f32`
- Widget Node: `B21`
- WidgetID: `6f073d3dc8544bd99bac13caa47b51b9`
- `ActionType = WIDGET_ACTION_NONE`

工作流 `WidgetParam` 与 `NodeUI.content.inputs` 均严格包含：

```text
city
condition
temp
high
low
advice
```

六项的 `Input.InputType` 均为 `USER_INPUT`，固定值分别为：深圳 / 阴 / 14 / 18 / 10 / 穿衣建议。

因此第五方成立：

```text
WorkflowWidgetInputs = {advice, city, condition, high, low, temp}
```

## 五方合同最终判定

```text
TemplateVars
= DefaultKeys
= ZodSchemaKeys
= JSONSchemaKeys
= WorkflowWidgetInputs
= {city, condition, temp, high, low, advice}
```

并且：

```text
Preview = PASS
Runtime = PASS
```

正式标记：

`B2_WIDGET_BASELINE_PASS`

## 新的高置信结论

B2 已证明以下事项不是当前 Schedule Runtime 失败的通用根因：

- 代码创建 Widget 本身；
- `WIDGET_ACTION_NONE`；
- “直接向后流转”；
- 固定 `USER_INPUT`；
- 当前赛事空间的 Widget Runtime 服务。

B2 还证明：当前空间中 Zod 修正后能够产出同步的 outer JSON Schema 与工作流 6 字段输入。

因此 Schedule 下一步禁止继续 V1.4/V1.5 Template 猜测式打补丁。

## 下一 Gate：Schedule 真实导出 Schema 审计

优先获取当前 ADP 中**实际失败的 Schedule Widget 的真实 `.widget` 导出**（优先 RuntimeSafe V3；若 V2 与 V3 都仍存在，则两份都导出）。

对每份实际导出做：

```text
TemplateVars
DefaultKeys
ZodSchemaKeys
JSONSchemaKeys
WorkflowWidgetInputs
```

并检查：

- Zod/outer JSON Schema 是否完整同步；
- 工作流节点是否暴露同一字段集合；
- 字段类型是否严格一致（尤其 `shownCount` integer 与 string 字段）；
- 是否存在 Template 使用但 Schema/Default/Workflow 未声明的变量；
- 是否存在 Schema 声明但 Template 不使用的异常字段。

只有完成这一步，才决定 Schedule 是“修 Schema 合同”还是进入下一高信息量 Runtime 差分实验。

B1（官方基础表单 + 单个 `REFERENCE_OUTPUT`）仍保留，但当前排在 Schedule 实际导出 Schema 审计之后。