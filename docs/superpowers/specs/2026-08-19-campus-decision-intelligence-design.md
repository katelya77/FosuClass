# Campus Decision Intelligence 设计（2026-08-19）

分支：`feat/campusflow-adp-integration`（不合并、不发布、不部署）。
前置：CSF — Campus Steward Foundation（`competition/adp-kit/csf/2026-08-19-csf-campus-steward-foundation-report.md`）。

## 0. 定位

在 R51 Mission 编排之上增加一层**确定性决策核心**（Decision Core）。
它只读取结构化 `MissionState` / `ConstraintProfile` / verified facts（`availableFacts` + `toolResults`），
**绝不读取原始 query 做关键词路由**，绝不生成模型凭空候选，绝不无证据生成推荐理由。

决策层不新增 Agent、不新增 CampusTool、不改绑定（4 Agent / 13 tools / 14 bindings 不变）、
不改知识库作为动态事实源、不改现有 Widget 契约（复用 `campus-result-unified-v1` result-card）。

## 1. 决策范围（eligibility）

只有「天然需要从多个候选里收口出推荐」的目标族进入 Decision Core：

| goalFamily | 候选来源（verified facts） | 收口变体（Widget） |
|---|---|---|
| `collaboration_planning` | groupPlanFacts → availabilityFacts → spaceFacts | `collaboration` |
| `reschedule_simulation` | rescheduleSimFacts | `reschedule` |
| `teaching_assurance` | spaceFacts（needSpace）→ riskFacts | `risk` |
| `campus_operations_insight` | rankingFacts | `ranking` |

其余目标族（`schedule_inquiry` / `schedule_range_inquiry` / `day_planning` / `space_inquiry` /
`common_availability` / `group_planning` / `risk_inquiry` / `ranking_inquiry` / `overview_inquiry` /
`space_utilization_inquiry` / `entity_query`）保持**直接查询**，`decide()` 返回 `eligible: false` 透传，
不强行进入决策。

## 2. 模块划分（`competition/adp-kit/r51/decision/`）

- `constraint-profile.js` — `ConstraintProfile`（hard / soft / exclusions）规范化、校验、`fromGoalSpec`。
- `candidate-source.js` — 从 verified facts / `toolResults` 提取规范化候选（含 `toolRank` 保留）。
- `evaluator.js` — 确定性候选评估（hard 过滤 / soft 计分 / exclusions；**hard 0 次静默放宽**）。
- `ranking.js` — 稳定排序（soft score → toolRank → id 码元序 → 原始输入序；tie stable）。
- `alternatives.js` — 推荐 + 备选（`topN`）；无候选 → 无推荐、无备选、绝不虚构。
- `explainability.js` — 可核验理由（理由只来自 evidence + 约束；no evidence → no reason）。
- `next-best-action.js` — 下一步动作（基于 Mission 完成缺口 + 决策结果）。
- `authority-action.js` — 授权感知动作（L3 只确认，不自动执行）。
- `controller.js` — Mission Decision Controller（eligibility 判定 + 编排）。
- `outcome-synthesizer.js` — DecisionBundle → 现有 Envelope + WidgetViewModel + PublicDecisionReceipt。
- `receipt.js` — 脱敏公开 receipt 生成（无内部协议 / queryId / dataHash / tool name / entity id）。
- `index.js` — 公开导出。

冻结契约：`competition/showcase/contracts/public-decision-receipt.schema.json`（Demo Director 本轮只冻结此接口）。

## 3. 规范化候选（Candidate）

```js
{
  id: string,               // 稳定身份
  label: string,            // 用户可见名
  attributes: object,       // 工具返回的数值/枚举属性（证据来源）
  toolRank: number|null,    // 工具已有排名（ranking 工具保留；其余 null）
  evidence: { factKey, toolName, verified, resultRef },
  sourceIndex: number,      // 原始输入顺序（稳定兜底）
}
```

提取适配器（`candidate-source.js`）：
- `fromRanking(raw, meta)` — `items[].rank` → `toolRank`，entity.name → label。
- `fromAvailability(raw, meta)` — 空闲时段 item（weekday / periodStart / freePeriodCount / roomCount…）。
- `fromSpace(raw, meta)` — 教室 item（capacity / campus / building / type…）。
- `fromGroupPlan(raw, meta)` — 排优方案 item。
- `fromReschedule(raw, meta)` — 调课可行性 item（checks 折叠为 conflictCount / feasible）。

## 4. ConstraintProfile

```js
{
  hard:       [{ id, field, op, value, description }],   // op ∈ eq/neq/gte/lte/in/nin
  soft:       [{ id, field, weight, direction, description }], // direction ∈ asc/desc/prefer-value/prefer-set
  exclusions: [{ id, field, op, value, description }],   // op ∈ eq/in
}
```

`fromGoalSpec(goalSpec)` 确定性映射：
- `goalSpec.constraints` → hard / exclusions（`minCapacity→capacity gte`、`campus→campus eq`、`building→building eq`、`excludeBuilding→building nin`）。
- `goalSpec.preferences` → soft（`preferEarlier`、`preferLarger`、`preferSameCampus`、`preferWeekdays`）。

**hard 不自动放宽**：评估期任何 hard 违反 → 候选进入 infeasible（保留违反清单），绝不静默放行。

## 5. 评估 / 排序 / 备选

评估（`evaluator.js`）：对每个候选计算
`{ hardSatisfied, hardViolations[], excluded, exclusionViolations[], softScore, softContributions[] }`。
`softScore` = Σ weight × direction 贡献（确定性数值规则，无模型）。

排序（`ranking.js`）：feasible 候选按
`softScore desc → toolRank asc → label/id 码元序 → sourceIndex asc`。
- **无额外证据（softScore 全为 0/相等）时 toolRank 保持**（ranking 工具原排名不漂移）。
- tie 稳定（同 softScore 同 toolRank 按码元序 + 原始序）。

备选（`alternatives.js`）：
- `recommendation` = feasible[0]；`alternatives` = feasible[1..topN]（默认 topN=3，含推荐共 3）。
- `no candidates → no invented alternatives`：空候选 → recommendation null、alternatives []、`decision: "no_viable_option"`。

## 6. 可核验解释（explainability）

每个理由条目：`{ kind, text, source }`，其中 `source` 是
`{ constraintId: string, attribute: string, factKey: string }` 对象。
- 理由**只能**从证据（候选 attributes，来自 verified 工具结果）与约束评估结果构造。
- `no evidence → no reason`：候选 `evidence.verified !== true` → 空理由；推荐无理由时 summary 不虚构因果。
- `verified` 语义沿用 existing：`verified: true` + 「已核验」措辞只在有工具事实支撑时出现。

## 7. 下一步 / 授权

`next-best-action.js`：按 Mission 完成缺口（缺 criteria fact）→ 下一能力 sys.chat 动作；
若已收口 → 精细化偏好 / 确认动作。动作恒 `{ type:"sys.chat", label, payload:{query} }`。

`authority-action.js`：复用 `r51/mission/authority.js`。
- L0/L1/L2 → 动作照常；L3 → 仅「确认」动作（`requiresConfirm: true`），不自动执行任何写操作。

## 8. Mission 集成（controller）

`decide({ missionState, toolResults, goalSpec })`：
1. `isDecisionEligible(goalFamily)`；非 eligible → `{ eligible:false }` 透传。
2. 从 verified facts 提取候选（无候选 → 仍产出 bundle，但 `decision:"no_viable_option"`，不虚构）。
3. `profileFromGoalSpec` → evaluate → rank → alternatives → reasons → nextAction → authority。
4. `outcome-synthesizer` → envelope + viewModel + receipt。

## 9. Widget 投影（复用现有 result-card）

`outcome-synthesizer.js` 复用 `r50.2/widget/view-model.js` 的 `projectViewModel`（result-card 路径）。
收口变体按 §1 映射；sections 承载「推荐 / 理由 / 备选」；actions 承载「下一步」。
全部 `sys.chat`，payload 仅 `{ query }`。**不新增 Widget，用户可见名仍为「小序-校园智序结果卡」。**

## 10. PublicDecisionReceipt（脱敏）

只含：`receiptVersion`、`decisionId`（内容哈希，非内部协议）、`recommendation`（label + reasons）、
`alternatives`（label + reasons）、`nextAction`（label + query）、`verified`、`decision`（结果态）。
禁止：entity id、tool name、queryId / dataHash / dataVersion / evidence / computedAt / 内部 URL / 授权内部字段。
冻结于 `competition/showcase/contracts/public-decision-receipt.schema.json`。

## 11. 双轨评测扩展

`evaluation/dual-track/judge.js` 增 `scoreDecisionBundle(bundle)`（复用 A/B 轨 + hard gate 规则），
新增 `decision-testset.json` + `r49-ma/tests/test-decision-evaluation-dual-track.js`。
Decision A 轨全部检查项通过才判业务通过；safety / no_contradiction 仍为清零 hard gate。
Widget 不可渲染仍 ≠ 业务失败：仅呈现失败时保留 A 轨业务分并标记 presentation issue。

## 12. 禁止清单（不变）

不新增 Agent / CampusTool；Main 不绑定 CampusTools；Child → Child 禁止；
模型不造候选；无证据不造理由；hard 不静默放宽；L3 不自动执行；
不为测试问句写 if/keyword case；用户界面不显示研发版本号；不改知识库为动态事实源。

## 13. Runtime Activation 与 Oracle Closure（2026-08-20）

`r51/decision/intrinsic-constraints.js` 是 intrinsic system constraints 的唯一真源。Controller 与 dual-track Judge 均调用 `buildAuthoritativeIntrinsicConstraints({ goalFamily })`；bundle profile 不能恢复、删除、降级或覆盖系统约束。canonical intrinsic 集合生成稳定 SHA-256 fingerprint，Controller 记录，Judge 从可信结构化 context 独立重算；缺失、语义改变、重复 ID、冲突重复或 fingerprint 不一致均 fail closed。

Decision Runtime 不新增工具。`mcp/campus-tools-mcp/src/agent-tools.js` 在六个既有多候选 handler（空教室、教师负载、共同空闲、利用率、调课模拟、群体方案）的 verified envelope 返回前调用 `r51/decision/runtime-activation.js`。Decision Engine 在候选仍位于可信服务端 handler 时执行；模型不能提交 raw candidate JSON 并自称 verified。原始 facts/items 原样保留，新增可选脱敏 `decision` 字段；简单课表查询保持直接事实查询。

`decision` 公开字段仅包含 status、preferred、alternatives、reasons、tradeoffs、nextActions、PublicDecisionReceipt 与现有 result-card。不得包含 resultRef、queryId、dataHash、fingerprint、内部 evaluation、Agent/Tool 名称。actions 仅 `sys.chat` + `{ query }`。跨域 Mission 由 Main 使用 Child 返回的 authoritative decision/receipt 协调，不由模型重新排序。

部署边界只有 competition HTTP Function `campusflowAdpTools`；OpenAPI 仍为 13 operations，仅六个既有 operation 增加 `decisionPreferences` 输入和 `decision` 输出。ADP 插件需刷新 schema，Agent/Tool/binding 数量不变，正式 ADP 不发布。
