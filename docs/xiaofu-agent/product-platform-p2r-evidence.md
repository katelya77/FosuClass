# 小佛助手产品平台 P2R 运行时证据

> 日期：2026-07-30
> 分支：`codex/xiaofu-agent-product-platform`（基线 `295c5820`，P3 之后）
> 范围：plan.steps 受约束真实消费、fallback eligibility 单一分类、outcome-aware 性能指标（R3.7）、文档修正。
> 验收规格：`specs/xiaofu-agent-product-platform/p2r-acceptance.md`。
> 前置证据：`product-platform-p2-evidence.md`（P2 本体验证，本文修正其过时表述）。

## 1. 结论

P2R 关闭了 P2 遗留的三处真实性缺口：

1. **plan.steps 真实消费**：trial/dev strict_model_first 下，模型 Decision 的意图级计划骨架经 Schema 校验与 Manifest 五因子交集后真实影响 resolvedPlan；planBuilder 只做规范化/补全/拒绝/受控降级，不再无条件丢弃合规模型计划。Trace 区分 `proposedPlan`（模型提议，仅计数与 Skill ID）与 `resolvedPlan`（实际执行）及改写原因。
2. **fallback 单一分类**：`packages/provider-runtime/src/fallbackEligibility.js` 是 Provider Runtime、Decision、Response 三处共用的唯一 retryability 分类；只依据显式 code 枚举表与数值 HTTP 状态区间表，禁止 message 正则模糊匹配。配置类 fail fast 且给后台可操作原因；临时性错误每 Turn 至多一次 fallback，共享总 Deadline 不重置。
3. **outcome-aware 指标**：`packages/provider-runtime/src/metrics.js` 重写为低基数标签桶（stage × outcome × executionPolicy × usedFallback × providerClass × taskComplexity × environment），success-only 与 all-runs P50/P95 分离，fallback/non-fallback 分离，warm-up 样本计数但不入统计，首事件延迟独立成桶并经生产 diagnostics 透出。

## 2. plan.steps 受约束消费（验收 §1）

实现链路：

```text
Decision Provider 输出 plan 骨架（仅允许引用发布态 Skill）
  -> decisionContract Schema 校验（步骤上限 8、未知 skillId 拒绝、禁 Tool 字段）
  -> deterministicPlanner.expandModelSkeleton
       逐步经 Manifest 五因子 allowedSet 过滤 + validatePlan 校验
       planBuilder 补全受约束执行细节（Tool 由 Skill 的 planBuilder 决定，模型不得指定）
       改写/拒绝记录 MODEL_STEP_* 原因码（planSchema.ADJUSTMENT_REASON_CODES）
  -> 执行计划与 RunEvent/Trace 一致
```

- `planSchema.js` 新增 `PLAN_SOURCES` / `ADJUSTMENT_REASON_CODES` 枚举；`planSource` 区分 `model_skeleton` / `deterministic` / `deterministic_fallback` 等来源。
- 模型计划失效（骨架为空、步骤全被过滤、校验失败）只进受控降级：planner 层软失败由 `agentKernel` 兜底重定，decision 层失败由 decisionService 受控降级，均记录原因码。
- Trace：`decision` 阶段 `proposedPlan`（stepCount + skillIds，仅 `decisionSource === "model"` 时出现）；`skill_tool` 阶段 `resolvedPlan` / `planSource` / `planAdjustmentReasons`（仅 trial/dev；public 由发射侧 fail-closed 门控 + `createAgentPlatform` 剥离列表双保险）。
- public deterministic 路径位级不变；adaptive 快路径真实记录 `deterministic_adaptive` 来源。

测试：`tools/test-agent-plan-skeleton.js`（8 组：合规骨架影响 resolvedPlan、非法工具名拒绝、Schema 不匹配安全降级、planBuilder 不无条件覆盖、public 零外部调用且 trace 无新字段、adaptive 真实路径记录、受控降级原因、执行计划与 Trace 一致）。

## 3. fallback eligibility 单一分类（验收 §2）

`classifyFallbackEligibility(error)` 返回 `{failureClass, fallbackEligible, failFast, reason, reasonCode, httpStatus}`：

- **fail fast（不 fallback）**：`invalid_model`、`provider_bad_request`、Schema/请求体类（`DECISION_*`、`INVALID_PROVIDER_*`、`PROVIDER_STRUCTURED_OUTPUT_INVALID`）、401/403（`auth`）、400/404/422/其他确定性 4xx、配置类（`NOT_CONFIGURED` 链耗尽后、`DECISION_PROVIDER_UNAVAILABLE`、`PROVIDER_REQUIRED`）、策略/Guardrail 拒绝、取消、未枚举码（默认 `unknown` fail fast）。
- **fallback 候选（共享账本，至多一次）**：timeout（`PROVIDER_TIMEOUT`/`ECONNABORTED`/`ETIMEDOUT`/408）、network（`ECONNRESET`/`ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`/`ERR_NETWORK`）、429（`rate_limited`）、5xx（`server_error`）。
- **skipped（推进下一 Provider 但不消耗账本）**：熔断、未注册、方法不支持、预算耗尽、租约耗尽；链内 `NOT_CONFIGURED`（见 §6 有意偏差）。
- **数值状态归一**：`normalizeHttpStatus` 沿 cause 链取第一个合法状态码（`error.status` 与 `error.response.status` 错位只此一处归一）；`PROVIDER_CHAIN_EXHAUSTED` 聚合包装经 `resolveProviderRootCause` 落到根因。
- **通用传输码让位**：axios 粗粒度码（`ERR_BAD_REQUEST` 覆盖全部 4xx、`ERR_BAD_RESPONSE` 覆盖全部 5xx）命中且带合法数值状态时，状态区间表优先（401/403→`auth`、429→`rate_limited`）；业务显式码仍 code 优先。本条为独立审查发现 Important 后修复（真实 axios 401 此前被误标 `bad_request`）。
- **适配器层去模糊匹配**：`deepseekProvider.classifyHttpError`（deepseek/cloudbase-openai/custom-openai 三个 OpenAI 兼容适配器共用）删除 `/timeout|超时/i` message 正则，只按 code 枚举与真实 400 响应体细分；其余 4xx 原样透传 axios 码，由共享分类用数值状态表精确归一。同为审查 Important 修复。
- **记录字段**：`intendedProvider`、`actualFirstProvider`、`fallbackPath`、`failureClass`、`fallbackReason`、`remainingFallbackBudget` 随阶段产物透传至 Trace（trial/dev）与 Runtime ledger；public 客户端 Trace 剥离。
- **配置类 fail fast**：Decision/Response catch 中 `failureClass === "config"` 统一抛出后台可操作中文原因，不包装成降级成功。

测试：`tools/test-agent-fallback-eligibility.js`（分类表、适配器分类器、Runtime fail fast/eligible/无第三次 fallback、Decision eligible/schema 受控降级/config fail fast、Response 委托共享分类）。

## 4. outcome-aware 指标（验收 §3）

标签枚举（`metrics.js` 集中定义 `METRIC_LABEL_VALUES`，未知键/值抛 `METRICS_LABEL_INVALID`，warm-up 同样先校验）：

| 标签 | 取值 |
|---|---|
| outcome | ok / degraded / failed / cancelled / timeout（兼容别名 success→ok） |
| executionPolicy | deterministic / strict_model_first / adaptive |
| usedFallback | false / true（false 不进桶键） |
| providerClass | mock / external / none |
| taskComplexity | simple / multi_tool（runtime 将产物 multi 归一为 multi_tool） |
| environment | public / trial / dev |

- 每桶双序列：success-only（outcome=ok）与 all-runs；`summary()[stage].count` 保持旧语义（全部样本，warm-up 除外），`p50Ms/p95Ms` 切换为 **success-only** 序列，all-runs 口径在 `allRuns.{p50Ms,p95Ms}`；fallback/non-fallback 分离序列；`degraded` 独立计数不混入成功或失败；`failureCount = failed + timeout`（timeout 拆分前并入 failed，口径变化见 §6）。
- 标签来源：`agentRuntime` 各 record 点的 `degraded`/`usedFallback`/`providerClass` 全部从阶段产物透传（`decision.decisionSource === "deterministic_fallback"`、`fallbackPath > 1`、`response.fallback/partialCompletion/status`、`actualFirstProvider` 等），不做字符串猜测；`STAGE_TIMEOUT`/`DEADLINE_EXCEEDED` 映射 timeout outcome。
- ledger：`noteFailure()` 归档 `failureClass`/`fallbackReason`/`remainingBudget`（末次观测值优先，缺省派生 `maxFallbacks - fallbacksUsed`）。
- 首事件延迟：`agentRunEventService` 的 `firstEventLatencyMs` 经 `createRunHandlers` 记录 `firstEvent` 桶（带 environment 标签），`platformComposition` 创建唯一共享 `platformMetrics` 并注入 Runtime 与 RunHandlers，`getDiagnostics()` 透出 `firstEventLatency`。可观测性记录包 try/catch，不改变执行路径。
- 六阶段计时口径不变：createRun、decision、tool、verification、response、total。

## 5. 性能证据两套口径（验收 §4）

### 5a. Runtime overhead baseline（本地受控 Mock，可复现）

来源：`node tools/test-agent-performance-budget.js`（本次运行，本机 Windows、Node v24.15.0、无外部网络、受控 Mock Provider 固定 1–4ms 延迟、固定 workload、warm-up 样本隔离）：

| 项目 | 结果 | 门槛 |
|---|---:|---:|
| 首个持久真实 RunEvent | 1 ms | ≤500 ms |
| 简单 Turn P95（success-only） | 79 ms | ≤6 s |
| 多工具 Turn P95（success-only） | 78 ms | ≤12 s |
| Run 硬上限 | 15,000 ms | ≤15 s |

- 同时输出 all-runs P50/P95、fallback/non-fallback 分离、simple/multi_tool 分离、warm-up 计数；测试断言这些口径存在且互相隔离。
- 数字只证明本项目运行时开销与预算机制，**不含真实 Provider 网络时延**；是否 Mock：是。
- 硬上限由 `test-agent-deadline-runtime.js` 以可控延迟 Provider 证明生效（Deadline/AbortSignal/阶段租约/fallback 共享账本/取消传播/keep-alive 复用）。

### 5b. Real-provider end-to-end latency

**not verified**。本会话未获授权使用真实 Provider 凭据执行 staging probe；按治理规则第 3 条，凭据可用时须以预算与调用上限单独执行，且证据只记录 Provider 类型、结果、延迟与错误分类。Mock 数字不得冒充 staging-live。

## 6. 有意偏差与口径变化（提交前已确认）

1. **链内 NOT_CONFIGURED 按 skipped 处理**：多 Provider 链允许跳过未配置节点到达已配置节点（`test:ai-competition` 锁定的故障转移语义），不消耗 fallback 账本；链耗尽后根因为 config 时由 Decision/Response fail fast。单 Provider（或同 Provider）未配置链必然耗尽到 config 根因，不会被误标为降级成功。
2. **`summary().p50Ms/p95Ms` = success-only**：失败/取消/降级不再混入头部延迟；全部既有消费方（provider-runtime-contracts、deadline-runtime、platform-admin、admin diagnostics）只断言 count/数值类型，兼容性由测试锁定。`count` 保持全样本旧语义。
3. **`failureCount` 含 timeout**：timeout 从 failed 拆分为独立 outcome 与计数；degraded 永不算失败。
4. **run 路径早期阶段缺 environment 标签**：`request.runtimeMode` 只在 chat 路径存在，run 路径 response/total 从响应产物的权威 runtimeMode 取值，更早阶段诚实省略（不伪造）；firstEvent 桶始终带 environment（来自 agentRuntimeDecision）。如需逐阶段 environment，须把 runtimeDecision 穿进更早阶段产物，超出 P2R 范围。
5. **公共剥离列表扩展**：`createAgentPlatform` public Trace 剥离新增 7 字段（failureClass/fallbackReason/remainingFallbackBudget + proposedPlan/resolvedPlan/planSource/planAdjustmentReasons），与发射侧门控构成双保险；`stageTrace` skill_tool 门控改为 fail-closed（仅 trial/dev 白名单）。

## 7. 文档修正（验收 §5）

- tasks.md：R4.5/R4.6 已于文档阶段（2026-07-30）改归 P6（tasks.md:33 注释），保留原编号、不标完成、注明依赖 P6b。
- `modelPlanner.js`：文件头标注 compatibility-only / deprecated candidate。生产不可达性核实：decisionService 所有可达规划路径均返回 decisionContract（含 deterministic_fallback），agentKernel 始终以 `unifiedDecision=true` 走 deterministicPlanner；配置类 fail fast 在规划前抛出；guard/记忆早退不进规划。`planner/index.js` 与 `observationLoop.js:60` 的 useModelPlanner 分支仅为旧协议/兼容测试保留；全部为静态 require，无隐藏动态引用。
- `understandingService.js`：模型版 `understand()` 标注 deprecated candidate——唯一生产侧入口 `understandingCoordinator.runUnderstanding` 已无任何调用方；`deterministicResult` 继续为 decisionService 生产在用，不受影响。
- 退役门槛（P6b 完成、旧量归零、新 Runtime 全覆盖、对照测试、release-gate 绿）达成前不删除、不重构。
- `product-platform-p2-evidence.md`：修正 §4 fallback 表述（单一分类）、§5 指标口径（success-only）与基准数字，并指向本文。

## 8. 测试证据

P2R 新增/扩展测试已注册进 `test:agent-platform-p2`（`test:agent-plan-skeleton`、`test:agent-fallback-eligibility`）。本阶段提交前完整本地结果：

- `node tools/test-agent-plan-skeleton.js`：PASS；
- `node tools/test-agent-fallback-eligibility.js`：PASS（含审查修复回归：axios 401/403→auth、429→rate_limited、message 含 timeout 的非超时错误不误标）；
- `node tools/test-agent-strict-decision.js`：PASS；
- `node tools/test-agent-performance-budget.js`：PASS（双序列、fallback 分离、warm-up 隔离、标签基数拒绝、free text 拒绝）；
- `node tools/test-agent-deadline-runtime.js`、`node tools/test-provider-runtime-contracts.js`：PASS；
- `npm run test:agent-platform-p2`：PASS；
- `npm run test:agent-foundation` / `test:agent-regression` / `test:ai-competition` / `test:agent-final-convergence`：EXIT=0；
- `npm run test:agent-phase2` / `test:agent-phase3`：all passed；
- `npm run test:agent-release-gate`：见本文件所在提交前的最终运行记录（本机无 Docker daemon，Docker smoke 按既有规则跳过，不表述为容器已验证）；
- `npm run test:no-ai-secret-committed`：随 release-gate 执行。

独立代码审查（explore 子代理，全量未提交 diff）：结论 APPROVE-WITH-NITS，0 Critical；2 Important（axios 粗粒度码遮蔽状态表、适配器残留 message 正则）已修复并补回归测试；其余 nit 中双保险剥离、fail-closed 门控、warm-up 校验顺序、`node:assert` 一致性已采纳，未采纳项（PROVIDER_NOT_REGISTERED 归 config 类、非 Provider 阶段失败入 ledger 的诊断噪音、NOT_CONFIGURED 预算注释）经评估为无行为影响，记录于此。

Draft PR CI 仍需独立重跑全部门禁及 Docker smoke；本地结果不替代 CI 与 staging-live 证据。

## 9. 验证层级

| 层级 | 状态 |
|---|---|
| 代码 | 已完成并接入生产 Composition Root（platformComposition 共享 metrics） |
| mock | 通过本地分类/骨架/性能/故障契约 |
| staging | not verified（无获授权凭据；§5b） |
| 容器 | P2R 不重复声称；多架构与 standalone 属于 P5 |
| CloudBase | 未部署 |
| 微信体验版 | 未上传 |
| 真机 | 未验证 |
| 生产 | 未部署 |

## 10. 提交与回滚

P2R 独立提交：`fix(agent): close P2 decision and fallback truth gaps`（本文件随该提交）。回滚 `git revert` 该提交即可恢复 P2 行为；不涉及数据库、Release Pack、记忆数据或生产发布。
