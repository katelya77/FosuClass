# R51 — Campus Mission Orchestration 实施计划

> 日期：2026-08-19
> 分支：`feat/campusflow-adp-integration`（PR #49 保持 OPEN / UNMERGED）
> 基线：`4f7d6d14`
> 方式：TDD（每个模块先测试后实现），设计文档见 `docs/superpowers/specs/2026-08-19-r51-campus-mission-orchestration-design.md`

## 任务

### T1. Mission 核心（`competition/adp-kit/r51/mission/`）

- [ ] T1.1 `model.js`：MissionGoal / MissionStep / MissionState / GoalSpec 定义 + 校验 + 转换（NEW_TASK / FOLLOW_UP 隔离）。
- [ ] T1.2 `capabilities.js`：13 能力注册表（domain / tool / requires / produces / fulfills），tool 绑定与 `r50.1/agent-tool-bindings.json` 一致，不新增工具。
- [ ] T1.3 `planner.js`：GoalSpec → MissionStep[] 确定性规划（拓扑序 + 前置 ENTITY/TEMPORAL_RESOLUTION + completionCriteria）。
- [ ] T1.4 `completion.js`：contract-driven Completion Evaluator。
- [ ] T1.5 `fresh-guard.js`：FreshToolCallGuard（槽位快照比较，槽位清单派生自 OpenAPI input schemas）。
- [ ] T1.6 `preflight.js`：ToolCallPreflight / Canonical Slot Normalizer（enum 派生 + 别名表 + fail-closed）。
- [ ] T1.7 `resolve-before-clarify.js`：RESOLVE / CLARIFY 决策。
- [ ] T1.8 `widget-actions.js`：Mission-aware sys.chat action 生成。
- [ ] T1.9 `data/canonical-aliases.json`：实体类型中文别名 → 规范 enum（测试断言目标值 ∈ OpenAPI enum）。
- [ ] T1.10 `r51/README.md`：mission core 用法与运行期边界（核心为可执行规范，运行期由 LLM 执行等价契约）。

### T2. R51 测试套件（`r49-ma/tests/test-r51-*.js`，TDD：先写测试 → RED → 实现 → GREEN）

- [ ] T2.1 `test-r51-mission-planner.js`（A）
- [ ] T2.2 `test-r51-completion-evaluator.js`（B）
- [ ] T2.3 `test-r51-fresh-tool-call-guard.js`（C）
- [ ] T2.4 `test-r51-tool-preflight.js`（D）
- [ ] T2.5 `test-r51-resolve-before-clarify.js`（E）
- [ ] T2.6 `test-r51-cross-domain-mission.js`（F）
- [ ] T2.7 `test-r51-ranking-drilldown.js`（G）
- [ ] T2.8 `test-r51-mission-state-isolation.js`（H）
- [ ] T2.9 `test-r51-prompt-architecture.js`（I）
- [ ] T2.10 `test-r51-widget-actions.js`（J）
- [ ] T2.11 `test-r51-paraphrase-matrix.js`（≥64 条泛化门禁）
- [ ] T2.12 `test-r51-e2e-mission-matrix.js`（13 行 E2E）

### T3. Runtime Prompt（`competition/adp-kit/r51/prompts/`，新 canonical source）

- [ ] T3.1 `main-orchestrator.r51.md` ≤ 5K 字符
- [ ] T3.2 `schedule-space.r51.md` ≤ 4K 字符
- [ ] T3.3 `risk-planning.r51.md` ≤ 4K 字符
- [ ] T3.4 `campus-insight.r51.md` ≤ 4K 字符
- [ ] T3.5 `README.md`：R51 prompt source ≠ 旧 R50 编译器输出；运行期配置映射说明。

### T4. 文档与产物

- [ ] T4.1 `competition/adp-kit/r51/R51-CONSOLE-CUTOVER.md`（一次性 Console Cutover，Widget 切到 小序-校园智序结果卡-R504）。
- [ ] T4.2 `competition/adp-kit/r51/R51-MISSION-E2E-MATRIX.md`（13 行矩阵文档）。
- [ ] T4.3 `reports/current-adp-checkpoint.md` 更新 R51 状态。
- [ ] T4.4 `competition/adp-kit/r51/2026-08-19-r51-final-report.md` 最终报告。

### T5. 门禁（按顺序提速执行）

1. R51 focused tests（T2 全部）。
2. mission semantic tests。
3. prompt architecture gate（T2.9）。
4. R50.4 widget compatibility（test-r50-2b-widget-contract + view-model）。
5. r49-ma / R50 regression。
6. `node r50/build-agent-prompts.js --check` + prompt-candidate-gate。
7. privacy/security 相关既有测试。
8. `git diff --check`。
9. 统一全量：agent-foundation / agent-regression / ai-competition / final-convergence / adp-kit npm chain / release-relevant CI gates。
10. 出现 transient → 先 isolated rerun，不立即重构。

### T6. Git

- [ ] 合理粒度 commit + push `feat/campusflow-adp-integration`。
- [ ] 验证 PR #49 OPEN / UNMERGED。
- [ ] 不覆盖 unrelated commit `4f7d6d14`；不 merge；不 publish ADP；不 deploy CloudBase。

## 完成定义

- R51 mission core 全模块 + 12 个测试文件全 GREEN。
- 字符预算：Main ≤ 5K、children ≤ 4K 全部满足。
- Paraphrase 门禁 ≥ 64 条通过。
- E2E Mission Matrix 13 行全部通过。
- 既有回归（r49-ma、R50、widget、compiler、root gates）不引入新失败。
- 文档齐全；最终执行报告返回全部要求的字段。