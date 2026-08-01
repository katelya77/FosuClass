# ADR-0008: Engine Adapter Contract with Registry-Controlled Selection

## Status

Accepted

## Context

平台化要求 Engine 可插拔（未来接入 OpenAI Agents SDK / Pi Agent Core 等实验引擎），但同时存在三条硬约束：

1. 在线语义请求的决策核心必须保持单一权威——不允许不同 package 各定义一套"Engine 接口"最终分叉；
2. 现有 Fosu Runtime 必须继续是唯一默认 Engine，实验引擎不得拖累 P3–P7 核心链、release-gate 与生产兼容性；
3. public 模式外部 Provider 调用恒为 0，任何 Engine 不得绕过 Guardrail 自建 Provider/Tool/Memory 通道。

若不加约束地"面向接口编程"，典型失败模式是：包装类不被生产入口真实调用（宣称接入实际旁路）、实验引擎自带状态源（第二套会话/工具/事件模型）、能力假设（调用方假定流式/恢复/取消可用而引擎并不支持）。

## Decision

1. **单一权威契约**：`AgentEngineAdapter` 唯一定义在 `packages/agent-runtime/src/engine/agentEngine.js`（contractVersion `agent-engine.v1`）。任何其他 package 不得出现相似接口定义。
2. **薄委托形状**：`execute` 的输入输出与生产执行链同形（`{request, configSnapshot, signal, emit, stages}` → `{runId, configVersion, deadlineAt, artifacts, ui, platformTrace}`）。Adapter 只附加引擎元数据、能力声明与生命周期；不改变执行语义、不复制业务状态。Engine 不得创建第二套 Tool 协议 / Memory 存储 / RunEvent / UI Schema / Provider 配置 / Guardrail / Run 状态机。
3. **能力声明显式化**：11 个能力键（streaming/resume/cancel/structuredDecision/toolCalling/memory/rag/actionReceipt/uiSchema/parallelTools/providerFallback）未声明一律 false；调用未声明能力抛 `AGENT_ENGINE_CAPABILITY_UNSUPPORTED`，禁止静默忽略。resume 由 Run 协议层 cursor 重放承担、SSE 流式未实装，故当前实现如实声明 `supportsResume=false`、`supportsStreaming=false`。
4. **Registry 受控选择**：`createEngineRegistry` 提供服务端受控注册与解析（defaultEngine / experimental 标记 / environment scope / feature flag）。public 与 trial/dev 默认均为 `fosu-runtime`；experimental 引擎仅在显式 flag + 允许环境下可按 engineId 选择且不得设为默认；未携带 conformance metadata 的引擎不得设为默认。`resolve` 在单次执行开始发生一次——在途 Run 绑定 Engine 版本，不因后台配置变化切换；引擎不可用抛 coded error，不静默切换伪装原引擎。
5. **Trace 证明接线**：执行结果 `platformTrace.engine` 记录 intendedEngine/actualEngine/engineVersion/conformanceVersion/fallbackPath/outcome（不含 Provider 名、密钥、隐藏推理）；失败路径以 `error.engineTrace` 上抛。生产接线真实性由 `tools/test-agent-platform-production-wiring.js` 的持久断言锁定。
6. **conformance 语义诚实**：运行时引擎自带声明恒为 `self-declared`；`suite-verified` 只出现在 conformance suite（`tools/test-agent-engine-conformance.js`，suiteVersion `p7a-conformance-1`）的运行证据中，不写进代码或配置。
7. **实验引擎延期**：P7b（OpenAI Agents SDK JS）/ P7c（Pi Agent Core）deferred——仅交付研究文档与契约映射（`docs/xiaofu-agent/engine-adapter-research.md`），不添加依赖、不写空 Adapter、不设永远关闭的 feature flag。重启门槛：P3–P7a 全部完成、release-gate 全绿、双部署 smoke、真机验收无 Critical/Important、依赖与许可证审计通过、用户再次明确授权；实现后必须通过同一 conformance suite 且不成为默认 Engine。

## Consequences

- 可插拔接缝真实存在并被生产调用（Trace 可证），未来实验引擎有明确、可实现的接缝，且无法绕过统一 Tool/Memory/RAG/Guardrail/RunEvent。
- 实验引擎的隔离成本前置到契约层（能力声明 + conformance suite），避免"先接入后失控"。
- 代价：生产链增加一层薄委托（可忽略的函数调用开销）；capability 声明必须随实现演进保持诚实更新（suite 中有一致性校验防漂移）。
- standalone 平台与生产共用同一通用包装（`createRuntimeEngine`，参数化 engineId），不产生第二套 Engine 实现。
