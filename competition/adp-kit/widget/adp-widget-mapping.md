# 校园智序 · 小序 — ADP 原生 Widget 4+2 映射

## 总体规则

- 数据入口统一为 `campus-widget/v2` ViewModel。
- 01–04 的 CampusTools/事实节点不因为 Widget 改 UI 而重写。
- 动态成功卡仅在 `evidence.verified == true && dataVersion == competition-demo-v1` 时展示事实主体。
- 普通结果卡：Widget 展示后允许工作流继续走 Markdown fallback/结束；若 ADP 支持隐藏重复文本，则原生 Widget 成功时只保留一句简短文本说明。
- `choice`：等待用户操作；其他五类默认直接流转。
- 每张主卡最多 3 个主要动作。
- Action 优先 `sys.chat`，消息是自然语言意图，交给现有 Agent 路由和多轮上下文继续解析。
- 不把 token、NodeID、VarBizID、内部 URL、系统 Prompt 放进 Widget 入参或 Action message。

---

## 1. Schedule Widget — `校园课表票据`

### 入参

- `title`
- `subtitle`
- `timeText`
- `summary.totalCount`
- `summary.hiddenCount`
- `items[]`
  - `periodText`
  - `startTime`
  - `endTime`
  - `courseName`
  - `campusName`
  - `building`
  - `roomName`
  - `teachers[]`
  - `classes[]`
- `actions[]`
- `dataVersion`
- `queryId`
- `evidence.verified`

### 组件树

```text
Container / Card
├─ Header
│  ├─ Text: SCHEDULE / VERIFIED
│  ├─ Text: title
│  ├─ Text: timeText
│  └─ Tag/Badge: 已核验
├─ Repeater(items)
│  └─ Row
│     ├─ Text: periodText
│     ├─ Text: startTime–endTime
│     └─ Column
│        ├─ Text: courseName
│        ├─ Text: campusName · building · roomName
│        └─ Text: teachers / classes
├─ Conditional(hiddenCount > 0)
│  └─ Text: 还有 N 条，可查看整周
├─ Trust Row: dataVersion / queryId
└─ Action Row (最多3)
```

### 动作

- `查看整周` → `sys.chat` → `查看{entity}的整周课表`
- `换一天` → `sys.chat` → `换一天看看{entity}的课表`
- `比较冲突` → `sys.chat` → `把{entity}和另一个对象比较一下有没有冲突`
- 教室实体可将第三按钮替换为 `查空闲时段`。

### 接入

工作流 01：`结果核验与呈现` 后增加 `Widget Adapter` + `校园课表票据` Widget 节点。

---

## 2. Classroom Widget — `空教室筛选票据`

### 入参

- `title`
- `timeText`
- `filters[]`
- `summary.totalCount`
- `summary.hiddenCount`
- `summary.empty`
- `items[]`
  - `roomName`
  - `campusName`
  - `building`
  - `capacity`
  - `roomType`
  - `periodText`
- `actions[]`
- `dataVersion`
- `queryId`
- `evidence.verified`

### 组件树

```text
Card
├─ Header + 已核验
├─ Horizontal/Wrap Chips: filters[].label
├─ Conditional(summary.empty == false)
│  ├─ Counter: totalCount
│  └─ Repeater(items)
│     └─ Room Row: roomName / campus+building / capacity / roomType / periodText
├─ Conditional(summary.empty == true)
│  └─ Empty State: 没有满足全部条件的空闲教室
├─ Trust Row
└─ Action Row
```

### 动作

正常结果：
- `换校区` → `sys.chat` → `那校区B呢` 或 `那校区A呢`
- `改时段` → `sys.chat` → `我想改一下查询时段`
- 未有容量约束时：`容量≥60` → `sys.chat` → `要能坐60人的`
- 已有容量约束时：`放宽容量` → `sys.chat` → `放宽一下容量条件`

空结果：
- `放宽容量`
- `取消楼栋限制`
- `换时段`

### 评委展示点

`filters` 必须可视化，例如：

`校区B` `2026-09-03` `第3-4节` `B1` `容量≥60`

这是多轮累计状态最直观的证明。

### 接入

工作流 02：`结果核验与呈现` 后接 Adapter + `空教室筛选票据`。

---

## 3. Conflict Widget — `冲突与赶场风险票据`

### 入参

- `title`
- `timeText`
- `summary.conflictCount`
- `summary.hasConflict`
- `summary.selfCompare`
- `summary.rushWarningCount`
- `summary.firstBusySlots`
- `summary.secondBusySlots`
- `items[]`
- `rushWarnings[]`
- `actions[]`
- trusted fields

### 组件树

```text
Card
├─ Header + 已核验
├─ Status Band
│  ├─ 红: conflictCount > 0
│  ├─ 橙: conflictCount == 0 && rushWarningCount > 0
│  └─ 绿: 两者均为0
├─ Conditional(items.length > 0)
│  └─ 冲突列表（红色）
├─ Conditional(rushWarnings.length > 0)
│  └─ 赶场列表（橙色）
├─ Busy Summary
├─ Trust Row
└─ Action Row
```

### Self compare

当 `summary.selfCompare == true`：

- 标题必须是 `{entity} · 课程安排风险检查`
- 不允许 `{entity} vs {entity}`
- 忙碌课次只显示一次

### 动作

普通 A/B：
- `看第一方课表`
- `看第二方课表`
- `换对象比较`

Self compare：
- `查看当天课表`
- `检查整周`

全部用 `sys.chat`。

### 接入

工作流 03：`冲突结果核验与呈现` 后接 Adapter + 风险票据。

---

## 4. Day Plan Widget — `今日校园计划时间轴`

### 入参

- `title`
- `subtitle`
- `timeText`
- `summary.lessonCount`
- `summary.gapCount`
- `summary.studySuggestionCount`
- `summary.hasCrossCampus`
- `items[]`
  - `type`
  - `courseName`
  - `periodText`
  - `startTime`
  - `endTime`
  - `campusName`
  - `roomName`
  - `teachers[]`
  - `suggestion`
  - `studyRooms[]`
- `actions[]`
- trusted fields

### 组件树

```text
Card
├─ Header + 已核验
├─ 3 Metric Cells: 课程数 / 空档数 / 赶场状态
├─ Timeline Repeater(items)
│  ├─ lesson: 深墨绿节点
│  ├─ gap: 绿色节点 + studyRooms
│  ├─ study: 绿色建议
│  └─ risk: 橙色风险节点
├─ Trust Row
└─ Action Row
```

### 动作

- `看明天` → `那明天的安排呢`
- `找空教室` → `我空闲的时候有哪些空教室适合自习`
- `连续自习2节` → `那天想连续自习2节`

### 评委展示优先级

这是 5 分钟演示的主视觉卡，优先保证：时间线清晰 > 动作好用 > 装饰效果。

### 接入

工作流 04：`今日计划核验与呈现` 后接 Adapter + 时间轴 Widget。

---

## 5. Choice Widget — `候选确认卡`

### 入参

- `title`
- `subtitle`
- `items[]`
  - `key`
  - `name`
  - `type`
  - `description`
  - `action`
- `interaction.waitForUser`

### 组件树

```text
Card
├─ Header
├─ RadioGroup / Repeater Button
│  └─ name + type + description
└─ 可选“重新描述”按钮
```

### 行为

- Widget 节点设置为**等待用户操作**。
- 用户选择候选后执行 `item.action`。
- Action message 形如：`选择教师001，继续刚才的课表查询`。
- 不把内部实体 ID 放到用户消息。

### 接入

01/03 实体歧义分支优先；后续可复用到其他流程。

---

## 6. Error Widget — `任务恢复卡`

### 入参

- `title`
- `subtitle`
- `error.code`
- `error.message`
- `actions[]`
- `evidence.verified=false`

### 组件树

```text
Card
├─ Error Header
├─ Human-readable message
├─ 可信说明：未核验时不补造动态事实
└─ Recovery Actions
```

### 推荐恢复动作

- ENTITY_NOT_FOUND → `修改对象` / `重新查询`
- OUT_OF_RANGE → `查看学期范围` / `换日期`
- MISSING_PARAM / INVALID_PARAM → `修改条件` / `重新查询`
- TIMEOUT → `重新查询` / `修改条件`

错误码可以保留在调试数据中，但主视觉不突出工程码。

---

# 原生 Widget 验收矩阵

| 卡片 | 必测输入 | 必看结果 | 必测 Action |
|---|---|---|---|
| Schedule | 教师003第1周周一的课 | 2条课、已核验 | 比较冲突 |
| Classroom | 校区A 2026-09-03 下午有哪些空教室 | filters+房间 | 换校区 |
| Conflict | 教师003第1周周一跨校区来得及吗 | 0冲突+1赶场 | 查看当天课表 |
| Day Plan | 帮我看看2026-09-04的安排 | 课程+空档时间轴 | 连续自习2节 |
| Choice | 模糊实体测试 | 候选≤5 | 选择后继续原任务 |
| Error | 校区C，帮我安排2026-09-04 | 恢复卡，不造事实 | 修改条件 |

原生 Widget 实际导入并通过以上六项之前，不得把 `ADP_WIDGET_NATIVE_PASS` 写入检查点。
