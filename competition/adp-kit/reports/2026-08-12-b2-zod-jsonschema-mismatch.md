# B2 Widget — Zod / JSON Schema 模式不一致实机发现

更新时间：2026-08-12 02:32 +08:00

## 用户实机现象

用户按腾讯云官方 `127031` 天气 Widget 示例创建 B2，但预览中 `city / condition / temp / high / low / advice` 均表现为 `undefined`；工作流节点右侧只暴露 `title` 一个输入变量。

用户上传真实导出：`B2.widget`。

## 对 `B2.widget` 的实际解析

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

## 结论

当前赛事空间的 Widget 编辑器已经提供 `Zod / JSON Schema` 两种 Schema 表达模式，但腾讯官方 `127031` 文档仍以 JSON Schema 示例为主。

B2 当前真正保存/导出的 Schema 只有 `title`，因此天气 Template 中其余变量未进入 Widget 数据合同，预览显示 `undefined` 是符合导出事实的。

这不是腾讯官方天气示例本身 Runtime 失败，也不能把 B2 当前状态作为“代码创建 Widget Runtime FAIL”的证据。

## 下一步

为避免模式错位，当前项目后续优先把 **Zod 作为当前空间的实际 Schema 单一真源**：

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

随后确认：

1. Preview 不再出现 `undefined`；
2. 工作流 Widget 节点暴露 6 个天气输入变量；
3. 全部固定 USER_INPUT；
4. `开始 → B2 → 结束` Runtime 实机通过。

若 B2 修正后 PASS，则优先重新审计小序 Schedule V2/V3 的 **实际导出 Zod Schema**，而不是继续改 Template。