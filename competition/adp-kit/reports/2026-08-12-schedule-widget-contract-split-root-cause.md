# Schedule Widget — 外层/内层 Schema 合同分裂根因

更新时间：2026-08-12 03:03 +08:00

## 结论

用户本轮上传并实际解析：

- `小序-课表票据-V2(2).widget`
- `export-01-多维课表查询-WidgetPilot-V1.3.zip`

当前 Schedule 不是单纯的 Runtime JSX 兼容问题，而是已经确认存在 **Widget 合同分裂（contract split）**：

> `.widget` 外层 `jsonSchema` 仍是旧 V2 的 7 字段复杂结构，但 `encodedWidget` 内部的 `view / defaultState / schema` 已经是 RuntimeSafe V3 的 21 字段扁平结构；对应工作流 Widget 节点又继续按旧外层 7 字段生成 `WidgetParam`。

因此当前 ADP 画布上的 Widget 节点不是在调用 RuntimeSafe V3 的真实 21 字段合同，而是在用旧 V2 的 `summary/items/actions` 合同调用一个内部已经改成 RuntimeSafe V3 的 Widget。

这比此前的 `map / 三元 / ARRAY_OBJECT / WIDGET_ACTION_NONE / 直接向后流转` 假设具有更高解释力，后续禁止继续通过修改 Template 猜测修复。

---

## 1. 用户实机错误与导出结构完全一致

ADP 当前画布预检查直接提示：

```text
引用的内容为空；
items 参数为 ARRAY_OBJECT 类型，必须有一项子参数；
actions 参数为 ARRAY_OBJECT 类型，必须有一项子参数。
```

实际导出的 V1.3 工作流 Widget 节点：

- NodeName：`小序-课表票据-RuntimeSafe-V3`
- WidgetID：`23fbc659efe3482fab588d754e4420a4`
- ActionType：`WIDGET_ACTION_NONE`
- 但 `WidgetParam` 仍然只有旧 V2：
  - `title`
  - `timeText`
  - `queryId`
  - `dataVersion`
  - `summary`
  - `items`
  - `actions`

其中：

- `queryId` / `dataVersion` 的 REFERENCE_OUTPUT NodeID/JsonPath 为空；
- `summary` 仍为 OBJECT；
- `items` / `actions` 仍为 ARRAY_OBJECT，且 `SubParams=[]`；
- NodeUI inputs 也仍注册为旧 V2 的字段。

所以 ADP 当前报错不是随机行为，而是与导出合同严格一致。

---

## 2. 当前 `.widget` 是明确的“V2 外壳 + V3 内核”

实际解析 `小序-课表票据-V2(2).widget`：

### outer `jsonSchema`

仍然是旧 V2 共 7 个顶层字段：

```text
{
  title,
  timeText,
  queryId,
  dataVersion,
  summary,
  items,
  actions
}
```

其中存在 OBJECT / ARRAY_OBJECT / ARRAY_STRING 等复杂结构。

### encodedWidget 内部

- `id = 23fbc659efe3482fab588d754e4420a4`
- `schemaValidity = valid`
- `viewValidity = valid`
- `defaultStateValidity = valid`

但内部 Schema / Default 已经全部变成 RuntimeSafe V3 的 21 个扁平字段：

```text
{
  title,
  timeText,
  statusText,
  courseCountText,
  shownCount,
  listStatusText,
  item0PeriodText,
  item0CourseName,
  item0LocationText,
  item0MetaText,
  item1PeriodText,
  item1CourseName,
  item1LocationText,
  item1MetaText,
  action0Label,
  action0Message,
  action1Label,
  action1Message,
  action2Label,
  action2Message,
  footerText
}
```

集合差异：

```text
outer only:
  queryId, dataVersion, summary, items, actions

inner only:
  statusText, courseCountText, shownCount, listStatusText,
  item0*, item1*, action0*, action1*, action2*, footerText
```

因此 `.widget` 文件自身已经不满足 B2 实验建立的“外层 jsonSchema 与内部 Schema 同步”合同。

---

## 3. Adapter 实际已经是正确的 RuntimeSafe V3 输出

V1.3 工作流中的 `Widget数据适配-Schedule` 代码节点实际输出：

- `route`
- 以及完整 21 个 RuntimeSafe V3 Widget 字段。

`shownCount` 为 INT，其余 Widget 字段为 STRING。

也就是说：

```text
CampusTools
→ Adapter(RuntimeSafe V3 21字段)   ✅
→ Widget节点(旧V2 7字段)           ❌
→ encodedWidget(V3 21字段)         ✅
```

真正断裂发生在 **Adapter → Workflow WidgetParam → Widget outer Schema** 这一层。

---

## 4. B2 基线提供了工作模式对照

同日 B2 天气 Widget 已完成真实 Runtime PASS，且重新导出确认：

```text
TemplateVars
= DefaultKeys
= ZodSchemaKeys
= outer JSONSchemaKeys
= WorkflowWidgetInputs
```

B2 还证明：在当前赛事空间保存流程中，修正 Zod 后 outer `jsonSchema` 会同步为同一字段集合，随后新拖入的 Workflow Widget 节点也会暴露同一字段集合。

Schedule 当前恰好违反这一已验证合同。

---

## 5. 新根因状态

正式新增：

```text
ADP_WIDGET_SCHEDULE_CONTRACT_SPLIT_CONFIRMED
```

当前不得把以下因素作为首要根因继续试错：

- map
- 三元表达式
- ARRAY_OBJECT 本身
- WIDGET_ACTION_NONE
- 直接向后流转
- Widget Runtime 服务全局故障

当前第一修复目标是：

> 重新建立单一 canonical Schedule Widget 数据合同，并让 `.widget` outer/inner Schema、Default、Template、Adapter 输出、Workflow WidgetParam、NodeUI inputs 全部由同一合同生成，不再手工分别维护。

---

## 6. 后续研发方式调整

用户已明确要求停止低效率的反复小实验。

后续改为：

```text
用户一次导出真实 ADP 资源
        ↓
ChatGPT / Codex 自动解析合同
        ↓
生成 canonical manifest
        ↓
自动生成/修复 .widget + workflow ZIP
        ↓
静态 Gate（Schema / NodeID / Reference / Edge / XLSX / CRC）
        ↓
用户只负责导入 + 一次真实 Runtime 验收
```

后续不再要求用户手工填写大量 Widget 参数，也不继续生成无合同依据的 V1.4/V1.5/V1.6。

## 7. 当前下一步

先设计并确认“ADP Contract Compiler / One-click Import Bundle”方案：

- 以本轮真实 Schedule `.widget` + V1.3 Workflow ZIP 作为源格式；
- 以 B2 PASS 导出作为正确序列化参考；
- canonical contract 以 RuntimeSafe V3 21字段为准；
- 生成 Schedule 的一致性 Widget 与 Workflow ZIP；
- 成功后同一生成器扩展到 Classroom / Conflict / Day Plan / Choice / Error。

PR #49 继续保持 open / unmerged；正式收口前不发布应用。
