# B2 Widget — Zod / JSON Schema 模式不一致实机发现

更新时间：2026-08-12 02:44 +08:00

## 用户实机现象

用户按腾讯云官方 `127031` 天气 Widget 示例创建 B2，但预览中 `city / condition / temp / high / low / advice` 均表现为 `undefined`；工作流节点右侧只暴露 `title` 一个输入变量。

用户此前上传真实导出：`B2.widget`。

## 对 `B2.widget` 的既有实际解析

外层：

- `name = B2`
- `jsonSchema` 仅定义 `title: string`

`encodedWidget` 解码后：

- `view` 确实引用 `city / condition / temp / high / low / advice`
- `defaultState` 确实包含上述 6 个天气字段
- 但 `schema` 实际是 Zod：

```ts
import { z } from "zod"

const widgetSchema = z.object({ "title": z.string() }).strict()

export default widgetSchema;
```

- `schemaValidity = valid`
- `viewValidity = valid`
- `defaultStateValidity = valid`

## 2026-08-12 02:44 官方文档复核

本轮重新联网核对腾讯云智能体开发平台官方文档：

- `126973` Widget 总览：Schema 用于规范 Template 中引入变量的数据类型/格式；Default 为 Template 变量提供默认数据。
- `127031` 代码创建：截至本轮抓取，天气示例仍明确使用 **JSON Schema**，并完整声明 `city / condition / temp / high / low / advice` 六个必填 string 字段，同时 Default 也提供同六字段。
- `126979` 配置 Widget 节点：官方明确要求上一节点输出结构必须与 Widget 所需输入变量格式一致，否则无法正常渲染；结果展示 Widget 使用“直接向后流转”。
- `126990` Widget 节点：输入变量支持固定输入/前序引用，变量类型由 Widget 合同决定；结果展示可直接向后流转。
- `127283` Widget Action：需要 Agent 感知并继续路由时使用 `sys.chat`。
- `127033` 导入 Widget：导入后仍可编辑 Template / Schema / Default。
- `129230` ADP-Widget SDK：Widget 最终以前端 JSON 配置进行渲染；该 SDK 文档不定义编辑器 Zod/JSON Schema 的作者态优先级。

本轮在腾讯云 `1759` 官方文档范围检索 `Zod` / `z.object`，未找到公开的 Widget Zod Schema 使用说明。因此：

> **不能把“Zod 是腾讯 ADP 平台全局唯一 Schema 真源”写成官方事实。**

当前更准确的表述是：

> **在用户当前赛事空间的真实 B2 导出中，`encodedWidget.schema` 实际保存为 Zod，而外层同时存在 `jsonSchema`。因此 B2 的下一步应把 Zod 作为当前空间的最小实机修正入口，并通过重新导出验证 Zod 与 outer jsonSchema 是否同步。**

这是一个待实机验证的平台合同假设，不外推到全部 ADP 空间。

## 结论

B2 当前真正保存/导出的 Schema 只有 `title`，因此天气 Template 中其余变量未进入 Widget 数据合同，预览显示 `undefined` 是符合导出事实的。

这不是腾讯官方天气示例本身 Runtime 失败，也不能把 B2 当前状态作为“代码创建 Widget Runtime FAIL”的证据。

官方文档与当前 UI/导出的关系目前应理解为：

- 官方公开文档仍以 JSON Schema 作为代码创建示例；
- 当前赛事空间编辑器已经暴露 Zod / JSON Schema 两种模式；
- 当前 B2 导出内部 schema 为 Zod、外层还有 jsonSchema；
- 两种表示之间谁是平台全局 canonical source 尚无官方公开证据；
- 对 B2 最可靠的方法是只做一个最小变量：**修正 Zod → 保存 → 新建最小工作流节点 → Runtime → 重新导出 → 四方集合审计**。

## Gate Z1 — B2 最短可靠修复

在 B2 的 **Zod** 模式中完整替换为：

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

Template 暂不修改，继续使用腾讯官方天气示例。

保存后不要复用旧的 B2 工作流节点，直接新建一个最小工作流并重新拖入 B2，以避免把“旧节点是否缓存旧 Schema”引入本轮实验变量：

`开始 → B2 → 结束`

验收顺序：

1. Preview 中 `city / condition / temp / high / low / advice` 全部有值，不再出现 `undefined`。
2. 新拖入的 B2 工作流节点暴露 6 个输入：`city / condition / temp / high / low / advice`。
3. 六个字段全部使用固定“输入”值，不使用任何 REFERENCE_OUTPUT。
4. 下发方式使用“直接向后流转”。
5. 以输入 `测试` 运行真实 Runtime。
6. Runtime PASS 后立即重新导出 B2 `.widget`。
7. 对导出文件做集合审计：

```text
TemplateVars
DefaultKeys
ZodSchemaKeys
JSONSchemaKeys
WorkflowWidgetInputs
```

真正 PASS 条件：

```text
TemplateVars
= DefaultKeys
= ZodSchemaKeys
= JSONSchemaKeys
= WorkflowWidgetInputs
= {city, condition, temp, high, low, advice}
```

只有满足上述五方一致 + Runtime PASS，才标记 `B2_WIDGET_BASELINE_PASS`。

## 后续决策

- B2 PASS：优先审计 Schedule V2 / RuntimeSafe V3 的真实导出 Schema 五方集合，禁止先改 Template。
- B2 FAIL：保留 request_id / trace_id / 完整错误 / 时间；此时才把“代码创建 Widget Runtime 兼容链”提升为有效假设。
- B1（官方基础表单 + 单个 REFERENCE_OUTPUT）继续保留，但排在 B2 Z1 之后。

## 当前文件可得性

本轮 GitHub 仓库代码搜索未发现 `B2.widget` 已提交到 `katelya77/FosuClass`。本轮对话也没有新的 `B2.widget` 二进制附件可直接再次解析，因此本报告中的 B2 二进制结构沿用此前真实上传文件的已落库解析证据；待本轮 Runtime 后重新导出的 B2 上传/提交后再做第二次独立解析。