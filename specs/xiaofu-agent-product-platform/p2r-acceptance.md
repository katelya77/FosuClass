# P2R 验收标准：Decision 计划真实性、fallback 分类与性能指标回补

> tasks.md P2R 章节验收细则。P2R 完成前不得开始 P4。提交：`fix(agent): close P2 decision and fallback truth gaps`。Evidence：`docs/xiaofu-agent/product-platform-p2r-evidence.md`。

## 1. plan.steps 受约束真实消费

- 目标语义：Decision Provider 输出意图级计划骨架 → Schema 校验 → Manifest 五因子交集 → 解析为允许的 Skill/Tool → planBuilder 补全受约束执行细节 → 执行。
- plan.steps 必须在受约束范围内真实影响最终计划；planBuilder 可规范化/补全/拒绝/降级，但不得无条件丢弃模型计划后重定全部步骤。
- 模型不得绕过 Manifest、权限、Schema、Guardrail；public deterministic 继续确定性计划；adaptive 记录本 Turn 实际路径（模型计划 vs 快路径）。
- Trace 区分 proposedPlan / resolvedPlan 及拒绝或改写原因；不展示隐藏推理。
- 测试：strict 下合规 plan.steps 影响 resolvedPlan；不允许的工具名被拒绝；Schema 不匹配步骤被拒绝或安全降级；planBuilder 不无条件覆盖合规计划；public 不调外部 Provider；adaptive 真实记录路径；模型计划失效只进受控降级；执行计划与 RunEvent/Trace 一致。

## 2. fallback eligibility 单一分类

- 默认不 fallback：invalid_model、provider_bad_request、Schema/请求体错误、401/403、Provider 配置缺失、不支持的模型或参数、本地 Guardrail 拒绝、其他确定性不可重试 4xx。
- 可 fallback 候选（分类表明确决定，禁模糊字符串匹配）：Provider 超时、连接失败、部分 429、部分 5xx、熔断/临时不可用。
- 单一 retryability/fallback eligibility 分类函数；Provider Runtime、Decision、Response 共用；每 Turn 至多一次 fallback；共享总 Deadline（不重置 15s）。
- 记录 intendedProvider、actualFirstProvider、fallbackProvider、failureClass、fallbackReason、remainingBudget；配置类错误 fail fast 并给后台可操作原因；不可重试错误不得包装成降级成功。
- 测试：invalid_model/bad_request/401/403 不 fallback；timeout 与 5xx 按策略可 fallback 一次；429 按明确策略；无第三次 fallback；Deadline 不重置；错误分类与 Trace 一致。

## 3. outcome-aware 性能指标（R3.7）

- 低基数字段：stage、outcome（success/failed/cancelled/degraded）、executionPolicy、usedFallback、providerClass（安全标识）、taskComplexity（simple/multi_tool）、environment。禁止用户 ID、conversationId、完整 model 名等高基数标签。
- 同时提供：success-only P50/P95；all-runs P50/P95；fallback/non-fallback 分离；cancelled 不混入成功；failed/degraded 独立计数；首事件延迟独立统计；运行时可复现（非离线手工脚本）。
- 六阶段计时：createRun、decision、tool、verification、response、total。

## 4. 性能证据两套口径（与 execution-governance 对齐）

- Runtime overhead baseline（本地可交付）：受控 Mock/固定延迟 Stub、固定 workload；报告 success-only 与 all-runs P50/P95、simple/multi_tool、fallback 分离、首事件延迟、样本数、warm-up、并发度、环境、Node 版本、commit SHA、是否 Mock。
- Real-provider end-to-end latency：项目已配置凭据可用时按治理规则第 3 条执行 staging probe（预算与调用上限）；不可用则标 not verified。
- 目标保持：首 RunEvent ≤500ms；简单 P95≤6s；多工具 P95≤12s；硬上限 ≤15s（Deadline/AbortSignal/阶段预算/fallback 总预算测试，含可控延迟 Provider 证明硬上限生效）。
- 防虚假：不只跑一次、warm-up 不入统计、不只报最快、失败取消不混入 success-only、客户端渲染不计入服务端、不用固定 sleep 冒充阶段完成、无高基数标签、Mock 延迟不标真实网络、不达标不放宽阈值、不删慢样本。

## 5. 文档修正（随 P2R 或文档阶段落定）

- tasks.md：R4.5/R4.6 映射改归 P6（保留原编号与历史来源，不标完成，注明依赖 P6b）。
- 旧 modelPlanner/understandingService：标记 compatibility-only / deprecated candidate；核实无生产调用、仅兼容测试/旧协议可达、无隐藏动态 require；退役门槛（P6b 完成、旧量归零、新 Runtime 全覆盖、对照测试、release-gate 绿）达成前不删不重构。

## 6. 提交边界

包含：plan.steps 消费、fallback 分类、R3.7 指标、对应测试、P2 evidence 修正、阶段追踪文档。不含：P3 记忆、P4 热发布、P5/P6、旧 Planner 删除、无关重构。
