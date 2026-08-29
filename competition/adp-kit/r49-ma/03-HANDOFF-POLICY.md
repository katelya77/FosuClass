# 03 — Handoff Policy（转交策略）

## 0. 目标

Multi-Agent 协同必须可预测、可回归、可回滚。转交只走中心化路径，且每个转交都携带**结构化状态信封**，禁止靠模型记忆传递上下文。

## 1. 转交路径（第一阶段固定）

```
用户 → Main
Main → Schedule   （课表/空教室）
Main → Risk       （风险/日计划）
Main → Insight    （态势/负载/TopN）
Schedule/Risk/Insight → Main   （必须回传）
Main → 用户
```

- 只允许 `Main → Child` 与 `Child → Main`。
- **禁止** `Child → Child` 横向自由转交。
- 平台对话流转策略：**每个新 Turn 重新由主 Agent 接管**。

## 2. Handoff 信封（Main → Child）

```
{
  "handoffId": "h-<ts>-<rand>",
  "targetAgent": "schedule | risk | insight",
  "turnType": "NEW_TASK | FOLLOW_UP",
  "domain": "schedule | classroom | risk | day_plan | overview",
  "needsCampusFacts": true,
  "comparisonMode": "none | self | two_object",
  "explicitSlots": { ... 本轮用户明确给出的槽位 ... },
  "inheritedSlots": { ... 已确认且兼容的继承槽位 ... },
  "dropSlots": [ ... 需要清除的旧 domain-local pending state ... ],
  "activeEntity": { "type": "teacher", "name": "T09" } | null,
  "activeTime": { "week": 1 } | { "date": "2026-09-03" } | null,
  "windowContext": { "rankingWindow": {"weekStart":1,"weekEnd":4} | null, "detailWindow": {"weekStart":1,"weekEnd":4} | null, "academicWeek": 1 | null },
  "referenceTarget": "none | active_entity | top1_entity | previous_result",
  "staleContextEscaped": true | false,
  "rankContext": { "sourceTool": "campus_teacher_load_query", "sourceDomain": "teacher_load", "list": "teacherLoadTop", "rankingWindow": {"weekStart":1,"weekEnd":4} | null, "selectedRank": null | 1 | 2 | 3, "entities": [result[0], result[1], result[2]] } | null,
  "source": "SYS.UserQuery | SYS.RewriteQuery | ChatHistory | resolved"
}
```

- `explicitSlots`（本轮显式）> `inheritedSlots`（上轮 confirmed）> `ChatHistory`。冲突时 explicit 覆盖。
- `dropSlots`：Main 判定新任务不属于旧 domain 时，把旧 domain-local pending state 列入清除列表，随信封一起发出，子 Agent 不得再引用。
- `rankContext`：insight 回传的排位上下文，**source-aware**——`sourceTool` 记录本轮真实产生排名的工具（教师负载排名 =
  `campus_teacher_load_query`；不允许写死为 `campus_overview`；若未来其他排名由别的工具返回，如实记录真实工具）。
  跨域下钻只继承 `selectedRank` 对应实体，**不得**继承 overview 聚合状态（见 §6.1、§6.2）。

## 3. 回传信封（Child → Main）

```
{
  "handoffId": "h-...",
  "status": "SUCCESS | NEED_CLARIFICATION | NO_RESULT | ERROR",
  "result": { ... 结构化结果，含 facts/summary/actions ... },
  "missingFields": [ ... 仅 NEED_CLARIFICATION ... ],
  "knownFields": { ... },
  "candidateIntent": "schedule_week | ...",
  "safeQuestion": "给 Main 用于对用户澄清的一句话（子 Agent 不直接追问用户）",
  "toolCalls": [ { "tool": "campus_risk_check", "mode": "self", "params": {...}, "evidence": {...} } ],
  "evidence": { "dataVersion": "competition-demo-v2", "dataHash": "...", "verified": true }
}
```

## 4. NEED_CLARIFICATION 协议（子 Agent 不得追问用户）

子 Agent 缺关键参数时**只回状态**，不直接向用户提问：

| 字段 | 说明 |
|---|---|
| `status=NEED_CLARIFICATION` | 机器可识别 |
| `missingFields` | 缺哪些槽位（如 entityName / weekday） |
| `knownFields` | 已确认的槽位 |
| `candidateIntent` | 候选意图，供 Main 选择 |
| `safeQuestion` | 由 Main 转述给用户的澄清问题（可用 Clarification Widget） |

**为什么**：让 Main 作为唯一澄清出口，才能在任何时刻对新 turn 重新接管并 escape 旧的 pending clarification。若子 Agent 自行追问，会重新制造「suspended old workflow 污染新任务」的 P0 场景。

## 5. Stale Context Escape（转交层兜底）

只要满足以下任一条件，Main **必须**清除旧 domain-local state 并以 NEW_TASK 处理：

1. 用户新问题明显属于另一业务域（如从 risk 切到 classroom / overview）。
2. 用户给出了与旧任务冲突的新实体 / 新日期 / 新校区。
3. 上一轮是「要求提供第二比较对象」的澄清态，而本轮输入不含比较语义 → 立即 escape 并清空 `second_entity pending + risk-local state`。
4. 上一轮工作流处于 suspended / pending 状态。

**典型例**：
- 上轮：risk 澄清「请提供第二个比较对象」；本轮：`校区A 2026-09-03 下午有哪些空教室` → Main 判 NEW_TASK(classroom)，`staleContextEscaped=true`，`dropSlots=["second_entity_pending","risk_local_state"]`。
- 上轮：day_plan(2026-09-04)；本轮：`下一天呢` → FOLLOW_UP，`activeTime.date=2026-09-05`（`generate_day_plan` 按 date 推进，不用模型自算）。

## 6. Top1 下钻转交

- Insight 返回本轮真实 `Top1`（实体 type+name+窗口 + rankContext）。
- 用户「看 Top1 课表」→ Insight 把 Top1 交回 Main → Main 转 Schedule(`campus_schedule_query`)。
- 用户「检查 Top1 风险」→ Main 转 Risk(`campus_risk_check`, mode=self, entity=Top1)。
- Insight **不得**代答个人课表/风险明细，只交回对象。

### 6.1 Top1/Top2/Top3 排位语义（R49.3 position 语义 + R49.4.1 source-aware）

- **Top1 = 排名工具真实有序结果 [0]、Top2 = [1]、Top3 = [2]（position 语义）。**
- 教师负载 TopN 排名工具 = `campus_teacher_load_query`（当前教师负载窗口排名的唯一动态真源）；
  `rankContext.sourceTool` 记录真实产生排名的工具，不得写死为 `campus_overview`。
- 业务指标并列（lessonOccurrences/periodUnits 相同）**不构成**「Top1 不唯一」；即使并列，
  `[0]` 仍唯一确定（底层稳定排序：lessonOccurrences DESC → periodUnits DESC → teacherName zh-CN tie-break）。
- FOLLOW_UP 排位引用 → 直接落实体，**NO CLARIFICATION**（参考实现 `tools/rank-semantics.js resolveRank`）：
  - `Top1 / 第一名 / 最高那个 / 排第一那个` → rank=1 → `[0]`
  - `Top2 / 第二名 / 第二个` → rank=2 → `[1]`
  - `Top3 / 第三名` → rank=3 → `[2]`
- 明确**多对象**短语（「把并列第一两位都给我看看」「比较这两位」「他们」「并列第一的两个」）→ 多对象逻辑，
  不得压缩为 Top1（`isMultiObjectRequest` 先于 rank 别名判定）。
- 排位实体来自本轮排名工具真实有序结果；**禁止硬编码 教师009**。

### 6.2 跨域下钻窗口策略（R49.4 硬性要求）

- 信封携带 `windowContext: { rankingWindow, detailWindow, academicWeek }`：
  - insight 排名窗口 = `rankingWindow`（如 `{weekStart:1, weekEnd:4}`），可继承为下钻窗口；
  - 「看Top1课表」→ `detailWindow = rankingWindow`（如 1..4）→ Schedule 调 `campus_schedule_range_query`（逐周展开）；
  - 「只看第一周」→ `detailWindow = 1..1` → Schedule 调 fresh `campus_schedule_query`（week=1）；
  - 「检查Top1风险」未给任何周次/日期 → **Main 澄清时间窗口**，绝不静默 week=1。
- `overviewWindow.count` **绝不等于 academicWeek**；跨域下钻只继承 `rankingWindow/detailWindow` 与选中实体，
  `dropSlots` 必须包含 overview-local state（如 `["overviewWindow", "overview_local_filters"]`）。
- 示例（CASE D 标准链，R49.4.1）：
  - T1「未来四周教师负载最高的是谁」→ Insight(`campus_teacher_load_query`，weekStart=1, weekEnd=4) → rankingWindow=1..4
  - T2「看Top1课表」→ Schedule：entity=排名结果[0]，detailWindow=1..4 → `campus_schedule_range_query`，NO_CLARIFICATION
  - T3「只看第一周」→ Schedule：detailWindow=1..1 → fresh `campus_schedule_query`(week=1)，NO_CLARIFICATION
  - T4「检查Top1风险」（无时间）→ Main 澄清时间窗口（week/date），不得静默 week=1

## 7. 转交失败处理

- Child 无响应/超时 → Main 提示「校园工具暂时不可用」，**不**用模型生成动态事实兜底。
- Child 返回 ERROR → Main 如实说明，不补造。
- 无匹配 Agent → Main 走 Clarification 或兜底，不猜路由。
