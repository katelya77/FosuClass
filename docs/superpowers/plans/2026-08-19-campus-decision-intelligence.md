# Campus Decision Intelligence 计划（2026-08-19）

TDD：先写失败测试，再实现。批次内 RED→GREEN；批次间全量回归。
设计真源：`docs/superpowers/specs/2026-08-19-campus-decision-intelligence-design.md`。

## Global Constraints

- Decision Core 只读取结构化 `MissionState` / constraints / verified facts，不读取原始 query 做关键词路由。
- 不新增 Agent、不新增 CampusTool、不修改 4 Agent / 13 tools / 14 bindings；Main 不绑定 CampusTools，禁止 Child → Child。
- 不由模型或测试问句分支生成候选；no evidence → no reason；no candidates → no invented alternatives。
- hard constraint 绝不静默放宽；L3 只确认，不自动执行。
- 复用 `campus-result-unified-v1` result-card，动作仅 `sys.chat` 且 payload 仅 `{ query }`；用户界面不显示研发版本号。
- `PublicDecisionReceipt` 只允许公开脱敏字段，不得包含 entity id、tool name、queryId、dataHash、dataVersion、evidence、computedAt、内部 URL 或授权内部字段。
- 不修改 `knowledge/current/` 作为动态事实源；不 publish ADP，不 deploy CloudBase，不 merge PR #49。
- TDD：每个实现任务必须保留 RED（测试先失败）和 GREEN（实现后通过）证据。

## Task 1: ConstraintProfile（`test-decision-constraint-profile.js`）

- [x] `r51/decision/constraint-profile.js`：`normalizeProfile` / `validateProfile` / `profileFromGoalSpec`。
- [x] hard / soft / exclusions 三类结构；非法 op / direction / weight fail-closed。
- [x] 非法 profile 不进入评估。

## Task 2: 候选提取 + 评估（`test-decision-evaluator.js`）

- [x] `r51/decision/candidate-source.js`：fromRanking / fromAvailability / fromSpace / fromGroupPlan / fromReschedule；保留 toolRank。
- [x] `r51/decision/evaluator.js`：hard 过滤（违反→infeasible，0 次静默放宽）、exclusions、soft 计分确定性。

## Task 3: 稳定排序 + 备选（`test-decision-ranking-alternatives.js`）

- [x] `r51/decision/ranking.js`：softScore→toolRank→码元序→原始序；tie stable；无额外证据 toolRank 保持。
- [x] `r51/decision/alternatives.js`：recommendation + alternatives(topN)；无候选→无推荐无备选。

## Task 4: 可核验解释 + 动作（`test-decision-explainability.js`、`test-decision-actions.js`）

- [x] `r51/decision/explainability.js`：理由只来自 evidence + 约束；no evidence → no reason。
- [x] `r51/decision/next-best-action.js`：完成缺口→下一能力；已收口→精细化/确认。
- [x] `r51/decision/authority-action.js`：L3 只确认（requiresConfirm），L0-L2 照常。

## Task 5: Mission 控制器 + 合成（`test-decision-controller.js`、`test-decision-outcome-receipt.js`）

- [x] `r51/decision/controller.js`：eligibility（simple schedule 透传）；collaboration/reschedule/teaching_assurance → DecisionBundle。
- [x] `r51/decision/outcome-synthesizer.js`：复用 `view-model.projectViewModel`（result-card）；sections=推荐/理由/备选；actions=下一步。
- [x] `r51/decision/receipt.js` + `competition/showcase/contracts/public-decision-receipt.schema.json`：脱敏公开 receipt；schema 校验。

## Task 6: 双轨评测扩展 + E2E（`test-decision-evaluation-dual-track.js`、`test-decision-e2e.js`）

- [x] `evaluation/dual-track/judge.js` 增 `scoreDecisionBundle`；`decision-testset.json`。
- [x] E2E：同候选同约束→稳定；hard 0 次静默放宽；no evidence→no reason；no candidates→no alternatives；soft 可解释差异；tool rank 保持；tie 稳定；L3 只确认。

## Task 7: 全量验证 + 提交

- [x] focused（decision 新测试 + 受影响旧测试）→ r49-ma 全量回归 → `git diff --check`。
- [x] `competition/showcase/contracts/public-decision-receipt.schema.json` 冻结路径核对。
- [x] 提交（合理粒度）→ 不 push（未获明确要求）→ PR #49 OPEN/UNMERGED 验证 → 报告。

验证注记：Decision 专项、受影响 Widget、r49-ma 全量、`competition/adp-kit npm test`、
根目录四项 Agent 门禁均通过。资产清单在起始基线已不同步，且本分支新增/修改了纳入清单的
dual-track 资产；已用权威脚本重建并通过一致性门禁。旧版 `test-r50-2b-widget-contract.js`
仍保留起始基线已存在的 v5/v6 断言漂移，未改测试掩盖。

完成判据：决策稳定 / hard 0 次静默放宽 / no evidence no reason / no candidates no alternatives /
soft 可解释差异 / tool rank 保持 / tie 稳定 / L3 只确认 / simple schedule 直接查询 /
collaboration / reschedule / teaching_assurance 得到 DecisionBundle / Widget 契约全通过 /
4 Agent / 13 tools / 14 bindings 不漂移。
