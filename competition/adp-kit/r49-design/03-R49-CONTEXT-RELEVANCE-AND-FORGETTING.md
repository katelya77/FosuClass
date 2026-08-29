# R49 03 — 上下文相关性与遗忘（Context Relevance & Forgetting）

> 阶段：R49 设计/审计阶段 — DESIGN DRAFT
> 核心主张：不做「所有历史全部继承」，做 Relevant Context Selection + 明确的遗忘规则

---

## 1. 问题定义

现状（R48 复验 + R49 CASE 1）同时存在两类相反故障：

| 故障 | 现象 | 根因方向 |
|---|---|---|
| 继承不足 | `只看周三` 丢 T03；`下一天呢` 进恢复卡；`大于60人的呢` 重问校区 | 顶层没有把上轮 confirmed state 转为可复用槽位 |
| 继承过度 | 03 的 pending 追问污染 `校区A空教室`、`未来四周最忙` | 旧 domain lock / pending clarification 未清空 |

R49 必须用一个「相关性选择 + 遗忘」模型同时解决两类问题。

---

## 2. Relevant Context Selection（RCS）

### 2.1 选择原则

1. 只继承**最近一次已确认**且**与本轮 domain 兼容**的槽位。
2. 相关片段从 `SYS.ChatHistory` 中按「命中实体/时间/domain」选择，而不是把 8 轮全文都喂给路由。
3. 每轮输出三组槽位：`explicitSlots`（本轮新值）/ `inheritedSlots`（继承值）/ `dropSlots`（丢弃值）。

### 2.2 历史窗口 A/B 方案

| 方案 | 窗口 | 优点 | 风险 |
|---|---|---|---|
| A | 8 轮（现状 contextTurns=8） | 覆盖长链条（05→01→03） | 旧任务残留概率高；token 消耗大；正是 stale 污染的温床 |
| B（推荐首试） | 6 轮 | 覆盖演示所需最长链（约 4~5 轮），残留更少 | 超长链（>6 轮）尾部遗忘 |

**A/B 判定标准**：用 R48 矩阵（A~G）与 R49 13 用例跑真机；若 6 轮无法覆盖 `05→看Top1课表→看他的风险→那周三呢`（4 轮链）即回退 8 轮。结论：**窗口按需截取相关片段，而非单纯轮数**——即「相关片段优先，窗口长度兜底」。

---

## 3. 继承规则（FOLLOW_UP only）

只有 `turnType=FOLLOW_UP` 且 domain 兼容时允许继承：

| 槽位 | 继承条件 | 示例 |
|---|---|---|
| entity（type+name+alias） | 本轮无新实体 | T09 整周 → `周三呢` 继承 T09 |
| week | 本轮无新周次 | `下一周呢` 覆盖 week=2 |
| weekday | 本轮无新星期 | `改第5-6节` 保留 weekday |
| date | 本轮无新日期 | 04 `下一天呢` date+1 |
| campus | 本轮无新校区 | 02 `大于60人的呢` 保留 B 校区 |
| period_scope / capacity | 本轮未修改 | `改第7-8节` 只覆盖节次 |

## 4. 覆盖规则（新值胜出）

| 本轮出现 | 动作 |
|---|---|
| 明确新实体 | 覆盖旧实体；若旧实体是另一个人的课表，同时清理其引用 |
| 明确新日期/新周次 | 覆盖旧时间；不合并 |
| 明确新 domain | 清空旧 domain-local state（03 的 second_entity、04 的 preferred_*、02 的楼栋等） |
| 代词（他/该/这位/它） | 仅当 `continuationConfidence` 高（≥0.7）时解析到 active_entity；否则 Clarification |

## 5. 遗忘规则（Forgetting）

1. **NEW_TASK 自动丢弃不兼容 domain state**（硬测试 B/C）。
2. pending clarification 只存活到下一轮；下一轮若是新任务 → 丢弃（Stale Escape）。
3. ENTITY_NOT_FOUND / 工具失败 / 模型猜测值 → 一律不继承。
4. 每轮只保留「最近一次已确认」状态；多轮同一槽位以最新为准。
5. `referenceTarget=top1_entity` 只在 05 本轮输出中有效，轮次结束后失效。

## 6. 首轮无历史保护（硬测试 F）

- 新 session 第一句 `只看周三` → 无 active_entity → 必须 Clarification（追问对象），**禁止伪造实体**。
- 新 session 第一句 `下一天呢` → 无日期上下文 → 追问目标日期/对象。

## 7. 存储边界（明确禁止项）

| 机制 | 结论 |
|---|---|
| 长期记忆 / long-term memory | 不使用：短期 task state 不得用长期记忆解决（application-config `longTermMemory: false` 保持） |
| `APP.*` 变量 | 不作为 session-local 临时任务状态（02 V7/03 V5 结论沿用：仍不使用 `APP.task_state_json`） |
| `SYS.*` 系统变量 | 唯一允许的会话作用域输入（UserQuery / RewriteQuery / ChatHistory） |
| Widget 按钮 payload | 视为「新 root turn 的完整消息」，不承载内部状态 |

## 8. 与 01~05 内部 contextPolicy 的关系

- 01~05 各自 `contextPolicy`（只继承同任务已确认字段）继续生效，R49 不修改。
- R49 的 RCS 在 00 层先把「该继承什么、该丢什么」算好，01~05 只消费结果；两层规则一致（新值覆盖旧值、切换清空），不存在互相矛盾。