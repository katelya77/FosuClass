# 校园智序 · 小序 — ADP 原生 Widget 运行时接入 Runbook

更新时间：2026-08-11

## 当前真实状态

六张 V2 Widget 已在腾讯云智能 ADP 中真实导入成功，列表缩略图与详情预览均能显示不同的 UI：

1. `小序-课表票据-V2`
2. `小序-空教室票据-V2`
3. `小序-冲突赶场票据-V2`
4. `小序-今日校园计划-V2`
5. `小序-候选确认-V2`
6. `小序-任务恢复-V2`

因此可以标记：

`ADP_WIDGET_NATIVE_TEMPLATE_PASS`

但此状态**只代表原生模板导入/预览通过**，还不能写成 `ADP_WIDGET_NATIVE_PASS`。后者必须等真实工作流动态数据渲染 + `sys.chat` Action 回流通过。

---

## 官方 ADP 约束（运行时接入必须遵守）

腾讯云官方文档：

- Widget 概述：https://cloud.tencent.com/document/product/1759/126973
- Card：https://cloud.tencent.com/document/product/1759/126981
- 配置 Widget 节点：https://cloud.tencent.com/document/product/1759/126979
- Widget 节点：https://cloud.tencent.com/document/product/1759/126990
- Action：https://cloud.tencent.com/document/product/1759/127283
- Button：https://cloud.tencent.com/document/product/1759/127018
- ListView：https://cloud.tencent.com/document/product/1759/126995
- ListViewItem：https://cloud.tencent.com/document/product/1759/126994

运行时硬规则：

1. Widget 节点输入变量必须引用前序节点结构化输出；结构或类型不一致时，应先经过代码节点适配。
2. 结果展示型 Widget 使用“直接向后流转”。
3. 需要用户确认/选择的 Widget 使用“等待用户操作”。
4. 希望用户点击后让 Agent 感知并继续路由时，必须使用 `sys.chat`；其 payload 会作为新的用户输入进入当前对话上下文。
5. Widget 是对话中的功能单元，不承担 CampusTools 事实计算。
6. Card/ListView/ListViewItem/Button 只负责展示与交互，不复制业务规则。

---

## 运行时总体架构

```text
用户自然语言
  ↓
标准模式 Agent 路由
  ↓
01 / 02 / 03 / 04 已冻结工作流
  ↓
CampusTools deterministic tool
  ↓
success + competition-demo-v1 + evidence.verified=true
  ↓
Widget Adapter（代码节点，仅做结构转换）
  ↓
ADP 原生 Widget
  ↓
用户点击 sys.chat Action
  ↓
作为新用户输入进入同一对话
  ↓
Agent 再次路由 / 跨工作流 handoff
```

任何 Widget Adapter 都不得：

- 重新计算日期；
- 重新解析实体；
- 推测课程/教室/冲突；
- 生成未由 CampusTools 返回的动态事实；
- 暴露 token、NodeID、VarBizID、系统 Prompt。

---

# Gate B1 — 先做 01 Schedule Runtime Pilot

正式 01 保持冻结，不直接修改。

复制测试副本：

`01-多维课表查询-WidgetPilot`

推荐成功分支：

```text
课表查询 / 查询结果核验
  ↓
Widget数据适配-Schedule
  ↓
小序-课表票据-V2
  ↓
结束
```

错误、歧义、空结果分支先沿用旧回复逻辑；不要为了第一张 Pilot 一次改完 Choice/Error。

### Adapter 输出合同

必须输出 Widget Schema 所需的顶层字段：

- `title: string`
- `timeText: string`
- `queryId: string`
- `dataVersion: string`
- `summary: object`
- `items: array<object>`
- `actions: array<object>`

来源必须是 `query_schedule` 的 verified envelope。

### Schedule Widget 节点

选择：

`小序-课表票据-V2`

下发方式：

`直接向后流转`

逐字段引用 `Widget数据适配-Schedule` 的对应输出。

### Pilot 验收

输入：

`教师003第1周周一的课`

必须：

- 路由 01-WidgetPilot；
- 原生 Schedule 卡出现；
- 显示 2 条课；
- 已核验；
- 第5-6节 / 第7-8节；
- 校区A / 校区B；
- 不再重复输出整段 Markdown 课表。

然后点击：

`比较冲突`

必须：

- `sys.chat` 被触发；
- Action 文本进入当前会话；
- Agent 能继续路由到 03；
- 不丢教师003 / 第1周周一上下文。

只有这一整条通过，才能标记：

`ADP_WIDGET_SCHEDULE_RUNTIME_PASS`

---

# Gate B2 — 捕获真实 Widget 工作流节点格式

为了继续保持“用户只做一次，Agent 后续批量自动生成”的工作方式，不手工给 01–04 重复配置 Widget 节点。

建立或复用测试工作流：

`00-Widget节点格式种子-勿启用`

在里面至少加入两个 Widget 节点：

1. `小序-课表票据-V2`，下发方式=`直接向后流转`；
2. `小序-候选确认-V2`，下发方式=`等待用户操作`。

不要求接入正式业务；目标是获得腾讯云 ADP V2_6 对以下内容的真实序列化：

- Widget 节点 `NodeType` / NodeUI；
- Widget ID / Widget 引用字段；
- 输入变量映射结构；
- “直接向后流转”字段；
- “等待用户操作”字段；
- 输出变量结构；
- Edge / NextNodeIDs。

保存后导出工作流 ZIP，保持原始文件不改名，交给 Agent。

Agent 后续必须先解析真实 seed，再自动生成：

- 01 Schedule WidgetPilot；
- 02 Classroom WidgetPilot；
- 03 Conflict WidgetPilot；
- 04 DayPlan WidgetPilot；
- Choice/Error 分支增强包。

仍执行既有 ADP ZIP 永久规则：`NextNodeIDs + Edge + 上游引用 + START 可达 + XLSX 不变量 + CRC` 全部校验。

---

# Gate B3 — 4 主卡 Runtime

Schedule 通过后按顺序：

1. 02 → `小序-空教室票据-V2`
2. 03 → `小序-冲突赶场票据-V2`
3. 04 → `小序-今日校园计划-V2`

结果展示卡统一：`直接向后流转`。

重点验收：

- 02 五轮累计条件仍正确，并由 filters 可视化；
- 03 self-compare 不出现 `教师003 vs 教师003`；
- 03 一条赶场只显示一次；
- 04 时间轴能展示课程 + gap + studyRooms；
- 任何 Widget 化不得改变 CampusTools 返回事实。

---

# Gate B4 — 2 辅助卡 Runtime

## Choice

用于歧义实体。

下发方式：`等待用户操作`。

候选 Action 使用 `sys.chat`，选择后继续原任务。

## Error

工具失败 / 非法条件 / 学期范围外等走恢复卡。

下发方式：默认 `直接向后流转`；如果未来增加表单修改条件，再单独评估等待模式。

不得在未核验状态生成动态事实。

---

# 最终 Widget Runtime 验收矩阵

| 卡 | 输入 | 预期 | Action |
|---|---|---|---|
| Schedule | 教师003第1周周一的课 | 2课 + 已核验 | 比较冲突 → 03 |
| Classroom | 校区A 2026-09-03 下午有哪些空教室 | filters + 房间 | 换校区 |
| Conflict | 教师003第1周周一跨校区来得及吗 | 0伪冲突 + 1赶场 | 查看当天课表 |
| Day Plan | 帮我看看2026-09-04的安排 | 课程 + 空档时间轴 | 连续自习2节 |
| Choice | 模糊实体 | 候选确认 | 选择后继续 |
| Error | 非法日期/对象/工具错误 | 恢复卡 | 修改条件/重试 |

六卡动态数据与 Action 全部真实 ADP 通过后，才允许：

`ADP_WIDGET_NATIVE_PASS`

然后进入 32 QA → 80 条应用评测 → Prompt A/B → 安全红队 → 多模态 → Test Release。