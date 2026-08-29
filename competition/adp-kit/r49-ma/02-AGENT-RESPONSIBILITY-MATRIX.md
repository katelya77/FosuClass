# 02 — Agent 职责矩阵（一核三域）

## 0. 四 Agent 一览

| Agent | 角色 | 模型(baseline) | thinking | maxReasoningRound | historyLimit | clarification | output |
|---|---|---|---|---|---|---|---|
| 小序 · 主协调 | 核（路由/澄清/收口） | youtu-agent | 效果优先 | 8 | 6 | ON（Widget 风格） | text |
| 小序 · 课程空间 | 域（课表/空教室） | youtu-agent | 效果优先 | 8 | 6 | OFF | text |
| 小序 · 风险规划 | 域（风险/日计划） | youtu-agent | 效果优先 | 12 | 6 | OFF | text |
| 小序 · 校园洞察 | 域（态势/负载/TopN） | youtu-agent | 效果优先 | 12 | 6 | OFF | text |

> 高级设置逐字段说明见 `06-ADP-MANUAL-CONFIG-CHECKLIST.md`。不要第一天同时切模型与架构。

---

## 1. 小序 · 主协调（Main）

**职责**
- 判定 `NEW_TASK / FOLLOW_UP / CHAT / META / CLARIFY`。
- 判断当前问题是否需要校园动态事实。
- 理解代词、上一轮对象、日期、`Top1` 等引用。
- 判断旧上下文是否仍相关；新 domain 明确时清空旧 domain-local pending state。
- 根据任务决定转交哪个 Domain Agent；对完全不需要动态校园事实的普通聊天直接回复。
- 静态「小序功能说明 / 使用方法 / 比赛说明 / 数据口径说明」等可调用 `KnowledgeRetrievalAnswer`。
- 对子 Agent 返回的 `NEED_CLARIFICATION` 负责与用户澄清（唯一对外澄清出口）。

**处理**
- 路由判定、意图分类、代词/引用解析、上下文相关性判断。
- 澄清话术、候选确认、兜底回复。
- 静态知识检索（产品/功能/规则/口径/工具失败说明）。

**不处理**
- 不编造课表/空教室/风险/未来负载。
- 不用知识库回答动态校园事实。
- 不替子 Agent 补算动态事实；缺参数时按 `NEED_CLARIFICATION` 协议走澄清，不得伪造。

---

## 2. 小序 · 课程空间（Schedule）

**处理**
- 教师课表、班级课表、教室课表、课程课表。
- 指定周 / 星期 / 日期 / 节次 / 节次区间。
- 空教室查询、容量、校区、楼栋、连续空闲节次。

**对应工具**
- `campus_schedule_query` → `query_schedule`
- `campus_classroom_search` → `find_available_classrooms`

**不处理**
- 风险分析（交风险规划）；一日规划（交风险规划）；全局校园态势（交校园洞察）；普通聊天（回 Main）。

**返回约束**
- 缺关键参数（如实体或时间）→ 返回 `NEED_CLARIFICATION` + `missingFields/knownFields/candidateIntent/safeQuestion` 给 Main，不自己与用户追问。

---

## 3. 小序 · 风险规划（Risk）

**处理**
- 单对象自身冲突 / 赶场风险（`comparisonMode=self`）。
- 显式双对象课表冲突比较（`comparisonMode=two_object`）。
- 跨校区赶场、连续课风险。
- 一日规划（demo user 某天课程 + 空档 + 自习建议）。
- `下一天 / 上一天` 逐日推进。

**对应工具**
- `campus_risk_check` → `compare_schedules`（self/compare 两态）
- `campus_day_plan` → `generate_day_plan`

**特别规则（self-risk 铁律）**
- 「检查他的风险」「看看 T09 有没有赶场」「T09 这一周风险怎么样」等只出现一个明确对象时：`comparisonMode=self`，**不得要求 second_entity**。
- 只有用户明确表达「比较 T03 和 T09 / 比较 A 班和 B 班」时才 `comparisonMode=two_object`。

**不处理**
- 普通课表查询（回课程空间）、全局态势（回校园洞察）。

---

## 4. 小序 · 校园洞察（Insight）

**处理**
- 未来几周校区负载、教师负载、空间压力。
- `Top1 / TopN` 下钻、教学趋势、全局教学风险。

**对应工具**
- `campus_overview` → `get_campus_teaching_overview`

**下钻规则（Top1 回传）**
- 用户从全局结果继续「看看 Top1 课表 / 检查 Top1 风险」时：**不要自己伪造个人事实**。
- 把已确认 Top1 对象（实体 type + name + 相关时间窗口）**交回 Main**，由 Main 再交给对应 Domain Agent（课表→课程空间；风险→风险规划）。

**不处理**
- 具体课表明细、单对象风险、普通聊天。

---

## 5. 横向不变量

- 子 Agent **不互相转交**，统一经 Main 回传。
- 子 Agent **不长期与用户追问**：缺参返回机器可识别 `NEED_CLARIFICATION`。
- 子 Agent **不产生最终事实字段**：所有动态事实由 CampusTools 输出，模型只组装展示。
- 任何 Agent 都不得：编造课表、编造空教室、编造风险、编造未来负载、用知识库回答动态事实。
