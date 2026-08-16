# R49 04 — 执行路由策略（Execution Routing Policy）

> 阶段：R49 设计/审计阶段 — DESIGN DRAFT
> 范围：Execution Policy Router 决策表 + 三层边界 + 知识库审计结论 + 与角色指令的关系

---

## 1. 路由目标

- 把每个 TurnState 只送到 8 个目标之一：01 / 02 / 03 / 04 / 05 / Knowledge / General LLM / Clarification。
- 一次只路由一个目标（禁止多工作流并行抢答）；动态事实一律进 01~05 / CampusTools。
- 路由依据：TurnState（turnType + domain + explicitSlots + comparisonMode + needsCampusFacts），不再直接裸文本路由。

## 2. 路由决策表

| 信号（domain / turnType / slots） | 目标 | 补充 |
|---|---|---|
| domain=schedule，单实体，查课表/占用 | 01 | 实体为 class/teacher/room/course |
| domain=classroom，找空教室/自习空间/容量/连续节次 | 02 | campus/date/period 必填不足 → Clarification |
| domain=risk，comparisonMode=self | 03 | 单实体风险；禁问第二对象 |
| domain=risk，comparisonMode=two_object | 03 | 显式双对象 |
| domain=day_plan，第一人称一天规划 | 04 | visitor 固定；日期可空 |
| domain=overview，未来几周整体态势 | 05 | 窗口固定常量 |
| domain=knowledge，META / 静态产品知识 | Knowledge | 小序能干什么/教学周怎么算/功能示例 |
| domain=chat，闲聊/概念解释 | General LLM | 你好/什么叫跨校区赶场（概念） |
| needsCampusFacts=true 但 slots 不足 | Clarification | 缺什么问什么，一次只问最小集 |

## 3. canonical intent 映射（对齐既有 intentRouting）

`workflows/application-config.json` intentRouting 继续作为底层映射，R49 补充：

| canonical intent | 路由 | 说明 |
|---|---|---|
| schedule_day / schedule_week / schedule_choose_day | 01 | Widget sys.chat 的 intentHint 优先 |
| schedule_risk_check | 03 | **必须进 03，不得被多轮上下文拉回 01**（role-instruction 已要求，保持） |
| classroom_find | 02 | — |
| day_plan | 04 | — |
| campus_overview | 05 | — |
| stable_knowledge | Knowledge | — |
| 无匹配 | fallback | 应用兜底 |

## 4. 三层边界（知识 / 工作流 / 聊天）

| 用户说法 | 归类 | 去向 | 是否调用 CampusTools |
|---|---|---|---|
| 小序能干什么 | STATIC | Knowledge | 否 |
| 教学周怎么算 | STATIC | Knowledge | 否 |
| T09第1周周三有什么课 | DYNAMIC | 01 | 是 |
| 校区A明天下午有哪些空教室 | DYNAMIC | 02 | 是 |
| 你好 | CHAT | General LLM | 否 |
| 什么叫跨校区赶场 | STATIC/概念 | Knowledge / General LLM | 否 |

禁止项：知识库/LLM 回答动态事实；为了「显得智能」对概念问题调用 CampusTools。

## 5. 知识库审计结论（7 篇仓库内 + 08 缺失项）

仓库 `competition/adp-kit/knowledge/` 实际有 7 篇 + taxonomy.json；**08-功能导航与演示问题-R45.md 不在仓库**（R48 HANDOFF 提到它为 8 篇之一，需用户从腾讯控制台补取或重建）。

| 文档 | 审计发现 | 风险级 |
|---|---|---|
| 01-产品能力与使用边界 | 仍写 v1 规模（2 校区/8 教师/16 课程/22 教室）；实际 v2 为 3 校区/12 教师/36 教室 | P1 事实冲突 |
| 02-课表查询参数与实体识别规则 | 实体别名规则与 01 extractPrompt 一致 | 低 |
| 03-教学周日期节次和自然语言时间规则 | 与 get_academic_context 一致；仅写 v1 头 | P2（版本注释） |
| 04-数据版本核验和防幻觉机制 | 仍写 v1（R47 已要求同步 v2） | **P1** |
| 05-匿名评审隐私与安全规范 | 稳定 | 低 |
| 06-工具失败空结果和歧义处理 | 稳定；与恢复卡语义一致 | 低 |
| 07-校园任务智能体常见问题 | Q3 数据规模仍写 v1；Q2 四类任务未含 05 态势 | P1 事实冲突 |
| 08-功能导航与演示问题-R45.md | **缺失**（仓库无此文件）；「功能示例」入口依赖它展开玩法 | P1 缺口 |

**结论**：知识库存在「v1 vs v2 事实冲突」与「08 缺失」，需要在实施阶段同步修订；但动态事实绝不能由知识库直接回答——上述修订只改静态描述，不改查询语义。

## 6. 与角色指令（role-instruction.txt）的关系

- role-instruction 的路由优先级、边界（「今天有课吗」→04、「A班今天有课吗」→01 等）继续有效。
- R49 把其中「多轮上下文」口头规则升级为结构化 TurnState 判定；**prompt 只作辅助兜底，不再作为唯一状态层**。
- 新增一条：Widget sys.chat 若携带 intent 字段，路由必须优先按 canonical intent（含 schedule_risk_check→03）。

## 7. 不做什么

- 不重排 01~05 内部分支契约；不改 excludedFromRouting 清单。
- 不新增第 6 个动态工作流；Knowledge/General LLM 复用现有应用知识库与兜底分支。
- 不改 application-config 的欢迎语/示例（如需新增示例在实施阶段评审）。