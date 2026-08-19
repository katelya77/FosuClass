# R51 — Campus Mission Orchestration 设计文档

> 阶段：R51（目标完成型校园任务编排）
> 日期：2026-08-19
> 仓库分支：`feat/campusflow-adp-integration`（PR #49，保持 OPEN / UNMERGED）
> 基线 HEAD：`4f7d6d14e146e47a9701bd378385fb66b6c40b1a`

## 0. 背景

当前系统行为是「请求 → 单意图 → 单工具 → 单结果 → 结束」。腾讯真机演示暴露了四个真实问题：

- **A. dynamic slot 变化但复用旧结果**：第二轮改变 weekday/week 等动态槽位时，Main 直接截取第一轮整周结果回答，没有 fresh tool call。
- **B. 工具参数枚举首次调用错误**：`entityType` 传中文「教师」，工具只接受 `teacher/class/room/course`，先失败再修正，浪费 reasoning round。
- **C. 可被工具缩小的歧义过早澄清**：课程名有歧义时直接追问用户，没有先走实体解析。
- **D. 过程性自述泄漏**：输出中出现「我认为/现在调用/因此应该」等编排自述，Agent/Tool/MissionState 名称进入用户可见内容。

R51 的核心升级不是「调用更多工具」，而是 **Completion Awareness**：系统持续判断「用户最初的目标是否真正完成」，禁止「调用一个工具后默认任务完成」。

## 1. 架构约束（不变）

- 4 Agent：Main / Schedule / Risk / Insight。
- 13 个 CampusTools、14 个 bindings（SSOT = `r50.1/agent-tool-bindings.json`）。
- Main = 0 CampusTools；`campus_academic_context` 是现有共享工具关系（schedule + risk）。
- Main → Child → Main；**禁止 Child → Child**。
- Tool Direct Result = OFF；动态校园事实只能来自 CampusTools。
- R50.4 unified Widget 视觉冻结；dataset / runtime 确定性事实层不无理由修改。
- **不新增 Agent**；除非测试证明现有 13 工具无法完成目标，否则**不新增 CampusTool**。

## 2. 禁止 Case / 关键词硬编码

生产 Prompt、Mission Core、Router **不得出现**「如果用户说 XXX 就执行 A→B→C」。禁止以固定关键词、固定句式、固定教师编号、固定日期、固定测试 Prompt、固定 Top1 实体作为路由逻辑。

路由必须抽象为：

```
Goal → Capability → Dependency → Required Inputs → Produced Facts → Completion Criteria
```

测试允许出现具体自然语言样例；**生产策略不得依赖测试字符串**。

## 3. Mission Contract（内部协议，不展示给用户）

保持最小、通用、可测试。

```js
// GoalSpec —— Main 从自然语言解析出的结构化目标描述（内部协议）
{
  goalFamily,          // 结构化目标族（见 §6），不是句式
  userOutcome,         // 用户语言残留（仅展示，不做路由依据）
  target:   { entityType?, entityRef? },      // 已解析实体引用
  temporalScope: { kind: "explicit"|"inherited"|"history", weekStart?, weekEnd?, weekday?, date?, periodStart?, periodEnd? },
  constraints: { campus?, building?, capacity?, duration?, count?, whatIf?, needSpace? },
  selection: { metric?, position?, topN?, sort? },   // ranking 槽位
}

// MissionGoal
{ goalFamily, userOutcome, constraints, completionCriteria }

// MissionStep
{ capability, domain, requires, produces, status, slotSnapshot }

// MissionState
{
  goal,                      // MissionGoal
  steps,                     // MissionStep[]
  completedCapabilities,     // Set<capabilityId>
  availableFacts,            // Map<factKey, FactRecord{capability, slots, resultRef, verified}>
  unresolvedRequirements,    // [{ kind: "entity"|"temporal"|"value", missing }]
  activeEntity,              // 当前选中实体
  temporalScope,             // 已确定时间范围
  rankingSelection,          // { selectedEntity, position, window }
  status,                    // pending | in_progress | needs_clarification | complete | failed
}
```

- MissionState 只保留「完成当前目标真正需要」的状态；不复制整个历史 Tool Result；不引入大量 domain-specific 字段。
- MissionState 属于内部协议，**不展示给用户**。

## 4. Capability Registry（13 能力）

Capability 抽象现有工具能力，`capability → tool` 映射派生自现有 SSOT/OpenAPI，不新增工具：

| capability | domain | 绑定 tool（现有 13 工具之一） | produces |
|---|---|---|---|
| ENTITY_RESOLUTION | schedule | campus_entity_search | resolvedEntities |
| TEMPORAL_RESOLUTION | schedule/risk | campus_academic_context | temporalScopeExplicit |
| SCHEDULE_DETAIL | schedule | campus_schedule_query | scheduleFacts |
| SCHEDULE_RANGE | schedule | campus_schedule_range_query | scheduleFacts(range) |
| DAY_PLANNING | risk | campus_day_plan | dayPlanFacts |
| SPACE_DISCOVERY | schedule | campus_classroom_search | spaceFacts |
| COMMON_AVAILABILITY | schedule | campus_common_free_time_query | availabilityFacts |
| GROUP_PLANNING | schedule | campus_group_plan | groupPlanFacts |
| RISK_CHECK | risk | campus_risk_check | riskFacts |
| RESCHEDULE_SIMULATION | risk | campus_reschedule_feasibility | rescheduleSimFacts |
| CAMPUS_OVERVIEW | insight | campus_overview | overviewFacts |
| TEACHER_LOAD_RANKING | insight | campus_teacher_load_query | rankingFacts(ordered) |
| SPACE_UTILIZATION_RANKING | insight | campus_room_utilization_query | spaceUtilFacts |

每个 capability 声明 `requires` / `produces`。Planner 依据依赖边排序，**不依赖任何句式**。

## 5. Planner（确定性）

输入 GoalSpec，输出 MissionStep[]（拓扑序）：

1. 由 goalFamily → 基础 capability 集合（capability.fulfills 映射）。
2. 若任一必需 capability 的实体引用未解析且可解析 → 前置插入 ENTITY_RESOLUTION。
3. 若时间语义非 explicit 且目标需要时间 → 前置插入 TEMPORAL_RESOLUTION；仍无法确定 → 记为 unresolvedRequirement（→ Clarify，**绝不静默默认 week=1**）。
4. 按 requires/produces 依赖做稳定拓扑排序（capability id 决胜）。
5. 生成 completionCriteria（由 goalFamily + constraints 结构化派生）。

三个目标族（capability composition，非固定语句 Case）：

- **teaching_assurance**：`SCHEDULE_DETAIL|SCHEDULE_RANGE → RISK_CHECK`（+ `SPACE_DISCOVERY` 若 needSpace；+ `RESCHEDULE_SIMULATION` 若 whatIf）。
- **collaboration_planning**：`ENTITY_RESOLUTION → COMMON_AVAILABILITY → SPACE_DISCOVERY → ranked plan`。
- **campus_operations_insight**：`TEACHER_LOAD_RANKING|CAMPUS_OVERVIEW → (选中 position) → SCHEDULE_DETAIL → (可选 RISK_CHECK)`。

任何自然语言只要目标语义相同 → 相同或等价 Mission DAG。

## 6. 结构化 Goal Families（内部枚举，非句式）

goalFamily 是内部结构化枚举，由 Main 从自然语言解析得到（Prompt 提供语义判定原则，不绑定句式）：

`schedule_inquiry / schedule_range_inquiry / day_planning / space_inquiry / common_availability / group_planning / risk_inquiry / reschedule_simulation / ranking_inquiry / overview_inquiry / space_utilization_inquiry / entity_query / teaching_assurance / collaboration_planning / campus_operations_insight`

组合族（composition families）由 planner 展开为 capability 序列；单族直接映射。

## 7. Completion Evaluator（确定性 / contract-driven）

- `criteria` = 目标必须 produced 的 factKey 集合（由 goalFamily + constraints 派生，结构化，非字符串匹配）。
- 规则：
  - 全部 criteria 满足 → `complete`（task_done）。
  - 仍有下一步 capability 且输入齐备 → `in_progress`。
  - 必需输入缺失/歧义且无法被 resolver 缩窄 → `needs_clarification`。
  - 必需 capability 返回 EMPTY/ERROR 且无可恢复路径 → `failed`（受控错误）。
- 例如 collaboration 目标只得到 COMMON_AVAILABILITY 时：criteria 仍含 spaceFacts（+candidate plan），不得 COMPLETE。

## 8. FreshFactPolicy / FreshToolCallGuard（问题 A）

**规则**：若当前用户改变任何动态查询槽位（week / weekRange / weekday / date / periodStart / periodEnd / campus / building / room / capacity / entity / metric / sort / topN / target），必须触发 fresh capability execution。历史结果只用于 reference resolution / entity inheritance / temporal inheritance，**不能代替新的动态 Tool query**。

- 实现：`freshToolRequired(querySlots, availableFacts)` —— 比较 querySlots 与任一可用 fact 的 slotSnapshot；任一动态槽位不一致 → fresh。
- 槽位清单派生自 13 个 operation 的 OpenAPI input schema（不是手工清单）。
- 单纯解释型 follow-up（无槽位变化）→ 可复用 verified result。

## 9. ToolCallPreflight / Canonical Slot Normalizer（问题 B）

- 在工具调用前确定性校验 / 规范化参数；允许值**从现有 OpenAPI operation contract 派生**（components.schemas.*Input 的 enum）。
- 别名表（`data/canonical-aliases.json`）：`教师→teacher / 班级→class / 教室→room / 课程→course` 等，**每一项目标值必须在 OpenAPI enum 中存在**（测试断言）。
- 非法值：在 Tool 调用前 fail-closed（返回 INVALID_PARAM），**不先发送一次错误请求**。
- 可选字段空缺：不澄清、不伪造、按契约缺省透传。

## 10. Resolve before Clarify（问题 C）

缺失/歧义输入是否可被现有 capability 确定性缩小：

1. 工具仍返回多个实质候选 → CLARIFY（由 Main 唯一出口）。
2. 工具无结果 → CLARIFY / 受控错误。
3. required value 不存在于任何可解析上下文 → CLARIFY。
4. 用户必须作出主观选择 → CLARIFY。

只有上述情形才向用户澄清。允许 `Main → Schedule(entity_resolution) → Main → Risk`，仍然禁止 `Schedule → Risk`。

## 11. MissionState 生命周期（问题 D 之外的隔离）

- `NEW_TASK`：清旧 domain-local pending，fresh state。
- `FOLLOW_UP`：继承最小必要状态（activeEntity 若同实体引用、相对时间、ranking selection）；**不继承**已完成 capability 的 slotSnapshot（新动态槽位仍触发 fresh）。
- 输出隔离：最终用户可见内容 = 结果优先 / 简洁 / 必要解释 / 下一步行动。**不展示** Agent 名称、Tool 名称、transfer_to、task_done、MissionState JSON、内部推理过程。

## 12. Ranking / Temporal 冻结规则（继续生效）

- metric 语义 ≠ position 语义；Top1 = ordered items[0]，并列不导致「Top1 不唯一」；只有明确多对象才进多对象逻辑。
- Ranking drill-down 携带 selected entity + selected position + 有效 ranking/detail window；overview 聚合 count **不是** academic week。
- explicit > mission inherited > compatible history；禁止 silent week=1；相对时间经 Temporal Semantic Core，Mission 只引用其确定性解析结果。

## 13. Widget（R50.4 冻结视觉主体）

R50.4 unified Widget 视觉不变。只允许 Mission-aware action copy：根据已完成能力生成下一步 `sys.chat`（检查风险 / 看空档 / 找教室 / 看下一周 / 查看某排位对象课表）。动作一律 `type=sys.chat`，payload 只允许自然语言 query；禁止塞内部 Mission / entity id / JSON。

## 14. Prompt 架构（bounded mission patch）

`competition/adp-kit/r51/prompts/` 成为 **R51 runtime prompt source**（≠ 旧 R50 巨型 Shared compiler output；旧规范文档保留为 engineering reference，不全文注入 Runtime Prompt）。

预算：Main ≤ 5K 字符；Schedule / Risk / Insight ≤ 4K 字符。内容重点：

- Main：Goal understanding / Mission planning / Completion awareness / reference resolution / resolve-before-clarify / routing / stale context escape。
- Child：capability boundary / tool choice / preflight / fresh call / result contract / return Main。

禁止大量固定示例；禁止测试字符串进入生产 Prompt。

## 15. 测试策略（TDD）

新增独立 R51 suite（`r49-ma/tests/test-r51-*.js`），至少覆盖：

A. Mission planner · B. Completion evaluator · C. FreshToolCallGuard · D. Preflight normalizer · E. Resolve-before-clarify · F. Cross-domain mission · G. Ranking drill-down（stable position with ties）· H. Mission state isolation · I. Prompt architecture（Main=0 CampusTools / 字符预算 / no case hardcoding / no internal protocol leakage）· J. Widget action（sys.chat only / semantic payload only）。

外加：**Paraphrase / 泛化门禁**（≥8 goal families × 8 paraphrases ≥ 64 条）与 **E2E Mission Matrix**（13 行）。

## 16. 范围与发布纪律

- 默认 NO DEPLOY：本轮改动（mission core / prompts / tests / contracts / adapters / docs / console bundle）不触发 CloudBase 部署。
- PR #49 保持 OPEN / UNMERGED；不 merge、不 publish ADP。
- 不覆盖 unrelated commit `4f7d6d14`。