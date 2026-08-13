# 校园智序 · 小序 — ADP 原生 Widget 运行时接入 Runbook

更新时间：2026-08-11 21:44 +08:00

## 当前真实状态

六张 V2 Widget 已在腾讯云智能 ADP 中真实导入成功，列表缩略图与详情预览均能显示不同 UI：

1. `小序-课表票据-V2`
2. `小序-空教室票据-V2`
3. `小序-冲突赶场票据-V2`
4. `小序-今日校园计划-V2`
5. `小序-候选确认-V2`
6. `小序-任务恢复-V2`

Compiler 集成状态（不等同 Runtime PASS）：

- Schedule：`RUNTIME_SAFE_V3_ACTIVE_RICH_V4_PENDING`
- Classroom：`FINAL_COMPILER_INTEGRATED`
- Conflict：`FINAL_COMPILER_INTEGRATED`
- DayPlan：`FINAL_COMPILER_INTEGRATED`
- Choice / Error：`RECOVERY_COMPILER_INTEGRATED`
- 腾讯 ADP 六卡 Runtime E2E：`PENDING_USER_TENCENT_ADP_EXECUTION`

已标记：

- `ADP_WIDGET_NATIVE_TEMPLATE_PASS`
- `ADP_WIDGET_RUNTIME_SEED_CAPTURED`
- `ADP_WIDGET_SCHEDULE_PILOT_READY`

仍不得标记 `ADP_WIDGET_NATIVE_PASS`；必须等真实工作流动态数据渲染 + `sys.chat` Action 回流通过。

---

## 官方 ADP 约束

官方文档：

- Widget 概述：https://cloud.tencent.com/document/product/1759/126973
- Card：https://cloud.tencent.com/document/product/1759/126981
- 配置 Widget 节点：https://cloud.tencent.com/document/product/1759/126979
- Widget 节点：https://cloud.tencent.com/document/product/1759/126990
- Action：https://cloud.tencent.com/document/product/1759/127283
- Button：https://cloud.tencent.com/document/product/1759/127018
- ListView：https://cloud.tencent.com/document/product/1759/126995
- ListViewItem：https://cloud.tencent.com/document/product/1759/126994

硬规则：

1. Widget 输入必须引用前序结构化输出；类型不一致先代码节点转换。
2. 结果展示型 Widget 使用直接向后流转语义。
3. 需要确认/选择的 Widget 使用等待用户操作。
4. 需要 Agent 感知点击并继续路由时使用 `sys.chat`。
5. Widget 只负责展示/交互，不承担 CampusTools 事实计算。
6. Card / ListView / ListViewItem / Button 不复制业务规则。

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

任何 Adapter 都不得重新计算日期、重新解析实体、推测校园事实或暴露 token / NodeID / VarBizID / 系统 Prompt。

---

# Gate B0 — 工作流 Widget Seed：已完成

用户导出：

`export-00-节点格式种子-勿启用(3).zip`

真实捕获：

- `NodeType = WIDGET`
- Schedule WidgetID = `23fbc659efe3482fab588d754e4420a4`
- Choice WidgetID = `f540588933a4459cbe78a6fe99aa022c`
- `WidgetNodeData.WidgetParam` 为入参结构
- OBJECT / ARRAY_OBJECT 通过 `SubParams` 注册
- NodeUI 输出展示 `Output / Output.Content`
- 两个未接线 Seed 的 `ActionType = WIDGET_ACTION_NONE`

合同文件：

`competition/adp-kit/widget/native/widget-node-seed-contract.json`

仍未捕获 Choice 等待用户操作的非 NONE 枚举值；这不阻塞 Schedule Pilot。

---

# Gate B1 — 01 Schedule Runtime Pilot：包已生成

正式 01 保持冻结。

Pilot：

`01-多维课表查询-WidgetPilot`

WorkflowID：

`578e7df1-6290-4218-82e9-cb16b165625a`

导入包：

`01-多维课表查询-WidgetPilot-V1-可直接导入.zip`

SHA256：

`7e65f229eb73f6855432abae355d650382af9b2e5436d6c7ff45d4079bfa1238`

运行链路：

```text
课表查询
→ 结果核验与呈现
→ Widget数据适配-Schedule
→ Widget展示判断
  ├─ route=widget → 小序-课表票据-V2 → 结束
  └─ else → 查询结果回复 → 结束
```

Adapter 输出：

- `route`
- `title`
- `timeText`
- `queryId`
- `dataVersion`
- `summary`
- `items`
- `actions`

Adapter Gate：

- `success == true`
- `dataVersion == competition-demo-v1`
- `evidence.verified == true`
- `items` 非空

四项全部满足才允许展示 Widget；否则沿用旧文本兜底。

历史兼容入口：

`competition/adp-kit/widget/native/schedule-runtime-adapter.py`

当前唯一 canonical Adapter 源码：

`competition/adp-kit/widget/native/schedule-runtime-safe-v3-adapter.py`

Workflow ZIP generator 必须从 canonical 文件注入 CodeExecutor，禁止再手工维护另一份 Adapter 实现。

### Pilot 实机验收

先在 Pilot 自身调试：

`教师003第1周周一的课`

必须：

- 原生 Schedule 卡出现；
- 2 条课；
- 已核验；
- 第5-6节 / 第7-8节；
- 校区A / 校区B；
- 不重复输出整段成功 Markdown。

教师场景第三 Action 当前优化为：

`检查风险`

Action 文本：

`检查教师003第1周周一是否存在时间冲突或跨校区赶场`

应用级验收时点击后必须：

- `sys.chat` 触发；
- Action 文本进入当前会话；
- Agent 路由到 03 self-compare；
- 不丢教师003 / 第1周 / 周一。

只有整条通过才标记：

`ADP_WIDGET_SCHEDULE_RUNTIME_PASS`

---

# Gate B2 — 4 主卡 Runtime

Classroom / Conflict / Day Plan 的真实 WidgetID 已登记，compiler 已自动生成：

1. 02 → `小序-空教室票据-V2`
2. 03 → `小序-冲突赶场票据-V2`
3. 04 → `小序-今日校园计划-V2`

结果展示卡统一采用直接流转语义。

重点验收：

- 02 五轮累计条件保持正确，并由 filters 可视化；
- 03 self-compare 不出现 `教师003 vs 教师003`；
- 03 一条赶场只显示一次；
- 04 时间轴展示课程 + gap + studyRooms；
- Widget 化不得改变 CampusTools 返回事实。

上述均为本地 compiler / artifact gate 已通过；腾讯 ADP 动态渲染与 Action 回流仍需按 `ADP-RUNTIME-E2E-CHECKLIST.md` 验收。

---

# Gate B3 — 2 辅助卡 Runtime

## Choice

用于歧义实体。

真实 Choice Widget 已接入 02/03/04 recovery 分支；候选 Action 使用 `sys.chat`，选择后继续原任务。Runtime 仍待实机验收。

## Error

工具失败 / 非法条件 / 学期范围外走恢复卡。

默认采用结果展示/恢复动作；不得在未核验状态生成动态事实。

真实 Error Widget 已接入 02/03/04 recovery 与 03 pre-tool `MISSING_PARAM` 分支；Runtime 仍待实机验收。

---

# Gate B4 — Schedule Rich V4 Side-by-side Pilot

- RuntimeSafe V3 保持绑定真实 WidgetID `23fbc659efe3482fab588d754e4420a4`，继续作为 01 Final 可回滚基线。
- Rich V4 使用独立 `items[]` Adapter；WEEK / DAY / DATE 不截断，Action payload 使用完整 Action Protocol V2。
- Rich V4 `widgetId = null`，策略为 `FAIL_CLOSED_REAL_TENCENT_EXPORT_ONLY`。
- 在获得 `小序-课表票据-Rich-V4-Pilot.widget` 的真实腾讯导出前，不生成 Pilot Workflow、不覆盖 V3、不伪造 ID。
- 最少用户操作见 `NEEDS_USER_RICH_V4_WIDGET_EXPORT.md`。

---

# 最终 Widget Runtime 验收矩阵

| 卡 | 输入 | 预期 | Action |
|---|---|---|---|
| Schedule | 教师003第1周周一的课 | 2课 + 已核验 | 检查风险 → 03 self-compare |
| Classroom | 校区A 2026-09-03 下午有哪些空教室 | filters + 房间 | 换校区 |
| Conflict | 教师003第1周周一跨校区来得及吗 | 0伪冲突 + 1赶场 | 查看当天课表 |
| Day Plan | 帮我看看2026-09-04的安排 | 课程 + 空档时间轴 | 连续自习2节 |
| Choice | 模糊实体 | 候选确认 | 选择后继续 |
| Error | 非法日期/对象/工具错误 | 恢复卡 | 修改条件/重试 |

六卡动态数据与 Action 全部真实 ADP 通过后，才允许：

`ADP_WIDGET_NATIVE_PASS`

然后进入 32 QA → 80 条应用评测 → Prompt A/B → 安全红队 → 多模态 → Test Release。
