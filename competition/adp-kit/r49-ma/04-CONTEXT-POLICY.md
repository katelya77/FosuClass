# 04 — Context Policy（上下文策略）

## 0. 原则

不设计「所有历史全部继承」。需要的是 **Relevant Context Selection**：只继承与当前任务兼容、且已被确认的槽位；新任务自动丢弃不兼容 domain state。

## 1. 数据优先级（固定顺序）

1. **本轮显式用户输入**（最高，绝不覆盖）
2. **当前 RewriteQuery / 当前完整意图**（SYS.RewriteQuery）
3. **上轮 confirmed active state**（同任务兼容槽位）
4. **与本轮相关的 ChatHistory**（相关性选择后）
5. **缺失**（→ 澄清，不伪造）

**铁律**：旧 history 绝不覆盖本轮明确新任务；明确新实体/新日期/新 domain 覆盖旧值。

## 2. 继承规则

| 场景 | 行为 |
|---|---|
| `FOLLOW_UP` 同域继续 | 继承 compatible slots（实体、时间等），本轮新值覆盖旧值 |
| `NEW_TASK` 新业务域 | **自动 drop** 不兼容 domain state（如 risk pending → classroom） |
| 明确新实体 | 覆盖旧实体 |
| 明确新日期 | 覆盖旧日期 |
| 明确新 domain | 清理旧 domain-local state |
| 代词（他/它/这个） | 仅当 `continuationConfidence` 足够高才解析；置信不足则澄清 |
| 首轮无历史 | 「只看周三」不得伪造实体 → 必须澄清对象 |
| `Top1` | 引用上一轮 campus_overview 结果中的真实 Top1（= teacherLoadTop[0]，position 语义），由 Insight 回传，不凭记忆 |
| `Top2` | = teacherLoadTop[1]；`Top3` = teacherLoadTop[2]；排位别名映射见 `tools/rank-semantics.js` |
| overviewWindow | **聚合窗口**（`{ kind: "future_weeks", count: 4 }`），**绝不继承为 activeTime.week**；跨域下钻 drop |

## 3. Stale Context Escape（硬触发条件）

满足任一即 **NEW_TASK + 清空旧 domain-local pending state**：

1. 新问题明显属于另一业务域。
2. 新实体/新日期/新校区与旧任务冲突。
3. 上一轮处于「要求提供第二比较对象」澄清态，本轮无比较语义。
4. 上一轮工作流 suspended / pending。

**明确禁止**：旧 history（尤其 pending clarification / risk-local state）覆盖本轮明确新问题。

## 4. 会话状态纪律

- **不用长期记忆解决短期 task state**：短期槽位只存在于当前 turn 的 handoff 信封与平台会话上下文，不写入长期记忆。
- **不把 APP.* 当 session-local 临时任务状态**：临时任务状态只由 Main 在本轮信封中维护，不经 APP.* 变量。
- 仅 `SYS.UserQuery / SYS.RewriteQuery / SYS.ChatHistory` 为会话作用域输入。

## 5. 6 轮 vs 8 轮历史 A/B

| 方案 | 优点 | 风险 |
|---|---|---|
| 6 轮（推荐 baseline） | 上下文更聚焦，stale 污染窗口更小；与 historyLimit=6 一致 | 超长链可能丢失较早引用 |
| 8 轮 | 更长的跨任务引用 | 增大 stale/pending 污染概率；token 开销高 |

- **第一阶段采用 6 轮**，与四个 Agent 的 `historyLimit=6` 对齐。
- 当 13 核心 case + R48 A~G 全绿后，可做 6 vs 8 单变量 A/B（见 `07-MODEL-AB-PLAN.md`），以回归矩阵为准。

## 6. 代词与引用解析（Main 职责）

- 「他/他的」：解析到 activeEntity（上轮 confirmed 实体）；无 activeEntity 或置信不足 → 澄清。
- 「周三呢/下一周呢/下一天呢」：解析到 activeTime（周/日）推进；day_plan 的「下一天」用 `generate_day_plan` 的 date 推进，不模型自算。
- 「Top1」：解析到 insight 回传的 Top1 实体（position 语义：teacherLoadTop[0]，即使指标并列也唯一确定）。
- 「Top2/第二名/第二个」→ teacherLoadTop[1]；「Top3/第三名」→ teacherLoadTop[2]。
- **多对象短语**（「他们」「这两位」「并列第一的两个」「两位都给我看看」）→ 多对象语义，不得压缩为 Top1。
- **overviewWindow 隔离**：「未来四周」的 4 是聚合窗口 count，解析为 `overviewWindow={kind:"future_weeks",count:4}`，
  跨域下钻（insight→schedule/risk）时作为 overview-local state **drop**；用户未显式给教学周时下钻周次
  `drilldownAcademicWeek=1`，绝不把 count 写成 week。
- 解析失败或首轮无历史 → `NEED_CLARIFICATION`，不伪造。
