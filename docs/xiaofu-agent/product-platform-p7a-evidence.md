# P7a Evidence — Engine Adapter Contract and Fosu Conformance

日期：2026-08-01 ｜ 分支：codex/xiaofu-agent-product-platform ｜ 提交：`refactor(agent): introduce engine adapter contract`

## 1. 范围与决策边界

- 本阶段只交付 **P7a**：AgentEngineAdapter 单一权威契约、Engine Registry、Fosu Engine 真实生产接线、conformance suite、实验 Adapter 研究文档。
- P7b（OpenAI Agents SDK JS Adapter）与 P7c（Pi Agent Core Adapter）：**deferred / not implemented**（重启门槛见 tasks.md 与研究文档）；未添加任何 SDK 依赖、未写空 Adapter、未设永远关闭的 feature flag。
- Fosu Runtime 继续是唯一默认 Engine；public 与 trial/dev 默认均 `fosu-runtime`。

## 2. 契约（单一权威）

`packages/agent-runtime/src/engine/agentEngine.js`（包入口导出，通用层零 Fosu 依赖）：

- `createAgentEngine(definition)`：engineId/engineVersion/conformance.suiteVersion 强制；capabilities 11 键归一化（未声明一律 false）；resume↔supportsResume 一致性校验；execute 结果归一化校验（缺 runId/artifacts/platformTrace → `AGENT_ENGINE_RESULT_INVALID`）；缺省 resume/cancel 明确抛 `AGENT_ENGINE_CAPABILITY_UNSUPPORTED`（不静默忽略）。
- `assertEngineCapability`：未声明能力明确拒绝；未知能力键 `AGENT_ENGINE_CAPABILITY_UNKNOWN`。
- `engineTraceMetadata`：intendedEngine/actualEngine/engineVersion/contractVersion/conformanceVersion/fallbackPath/outcome——无 Provider 名、无密钥、无隐藏推理。
- 引擎对象冻结且仅暴露契约方法（execute/resume/cancel/readiness/health/shutdown），无旁路工具/记忆/RAG 通道。
- conformance.status 语义：运行时引擎自带声明永远 `self-declared`；`suite-verified` 只出现在 conformance suite 的证据输出，不由引擎自身声称（运行时不伪造测试状态）。

## 3. Engine Registry（服务端受控选择）

`packages/agent-runtime/src/engine/engineRegistry.js`：

- register（重复注册拒绝）/ setDefault（未注册、experimental、缺 conformance 均拒绝）/ resolve / diagnostics。
- experimental 引擎仅在 `featureFlags.allowExperimentalEngines === true` 且 environment ∈ experimentalEnvironments（默认仅 dev）时可经显式 engineId 选择；不得设为默认。
- environment 归一化（未知值按 public 处理，不放大权限）。
- resolve 在单次执行开始时发生一次：在途 Run 不因配置变化切换引擎；Engine 不可用抛 coded error，不静默切换伪装原引擎。
- 当前生产与 standalone 均无实验引擎注册；`allowExperimentalEngines: false`。

## 4. Fosu Engine 真实生产接线（Trace 证明）

薄 Adapter：`server/src/services/ai/engine/fosuEngine.js`（通用包装 `apps/agent-server/src/createRuntimeEngine.js` 参数化；standalone 平台共用同一包装、engineId `standalone-runtime`，无第二套实现）。

生产链（本机真实执行验证，非 mock）：

```text
agentService.chat → platformComposition.getPlatform().executeTurn
  → createAgentPlatform.executeTurn → engineRegistry.resolve → fosu-runtime.execute
  → runtime.executeTurn（原六阶段管线，行为不变）
```

真实执行输出（public 模式「我今天有什么课？」确定性链）：

```json
platformTrace.engine = {
  "intendedEngine": "fosu-runtime",
  "actualEngine": "fosu-runtime",
  "engineVersion": "0.1.0",
  "contractVersion": "agent-engine.v1",
  "conformanceVersion": "p7a-conformance-1",
  "fallbackPath": null,
  "outcome": "success"
}
diagnostics.engines.defaultEngineId = "fosu-runtime"
```

- 失败路径：`error.engineTrace`（outcome=failed/cancelled）随原错误上抛。
- public 裁剪层保留 engine 元数据（无敏感字段），Provider/计划来源等既有裁剪不变。
- 未提供 engineRegistry 时 `createAgentPlatform` 保持旧直调行为（向后兼容既有测试与嵌入式装配）。

## 5. Conformance suite（22 项，suiteVersion p7a-conformance-1）

执行：`node tools/test-agent-engine-conformance.js`（真实 Engine 路径：registry → engine → runtime；平台级项经 platform/runHandlers 全装配）。

| # | 用例 | 路径层级 | 结果 |
| --- | --- | --- | --- |
| 1 | 纯文本只读 Skill 经 engine 执行成功 | engine 轻量链 | PASS |
| 2 | 只读 Tool 经 engine 执行成功 | engine 轻量链 | PASS |
| 3 | Tool 只经统一 Tool Registry（无旁路通道） | engine 轻量链（引擎静态面 + stages.skillTool 唯一工具入口） | PASS |
| 4 | Tool Schema 校验 | engine 轻量链（TOOL_ARGS_INVALID 传播 + 无副作用） | PASS |
| 5 | Tool 权限拒绝 | engine 轻量链（coded 传播 + classifyRunError 归 internal） | PASS |
| 6 | Memory Context 可读不可越权（输入不可变） | engine 轻量链（阶段交接深冻结、调用方对象不被冻结） | PASS |
| 7 | RAG 经统一接口 | engine 轻量链（注入检索函数计数 + 引擎无 rag 属性） | PASS |
| 8 | RunEvent 顺序合法（sequence 严格递增） | engine 轻量链（sequence 1..N、eventId 唯一、类型合法） | PASS |
| 9 | UI Schema 合法 | engine 轻量链（正例重校验 + 任意组件负例拒绝） | PASS |
| 10 | Verification ok===true 才通过 | engine 轻量链 + platformComposition 全装配（真 statusFromResult 归 failed） | PASS |
| 11 | Deadline 生效 | engine 轻量链（STAGE_TIMEOUT / DEADLINE_EXCEEDED，时长受控） | PASS |
| 12 | AbortSignal / cancel 生效 | engine 轻量链（中途 abort → ABORTED + run.cancelled + 零副作用） | PASS |
| 13 | Provider 超时准确分类 | engine 轻量链（failureClass=timeout、classifyRunError→provider） | PASS |
| 14 | fallback ≤1 | engine 轻量链（真 providerAttemptLedger：唯一受控 fallback + 预算耗尽如实失败） | PASS |
| 15 | configVersion 整个 Run 稳定 | engine 轻量链（事件/result/platformTrace/traceSink 四处一致） | PASS |
| 16 | ActionReceipt 幂等 | runHandlers 链（platformComposition 全装配：同 idempotencyKey 去重、执行链不二次进入） | PASS |
| 17 | 不输出隐藏推理 | platform 轻量装配（递归键扫描 result+events+engine 元数据） | PASS |
| 18 | 不泄露密钥与敏感记忆 | platform 轻量装配 + 投毒 emit（协议 sanitize 剥除） | PASS |
| 19 | public 外部 Provider 调用为 0 | platformComposition 全装配（agentService.chat + 回环桩计数恒 0） | PASS |
| 20 | strict_model_first 首个真实 Decision 来源正确 | platformComposition 全装配（trial + 回环桩 DecisionContract V2，decisionSource=model） | PASS |
| 21 | Engine 异常不破坏 Run 最终状态（error.engineTrace） | platform 轻量装配（engineTrace outcome=failed + 后续 Run 不受污染） | PASS |
| 22 | 重连后可恢复事件和结果 | runHandlers 链（platformComposition 全装配：cursor 重放稳定 + 终态结果可恢复） | PASS |

suite 运行汇总：`agent-engine-conformance: pass=22 fail=0`，末尾输出
`conformance-evidence: {"suite":"p7a-conformance-1","engineId":"fosu-runtime","status":"suite-verified","checks":22,"pass":22,"fail":0}`（EXIT=0，stdout 证据不落盘、不写回引擎声明；引擎自身 conformance.status 恒为 self-declared）。文件名命中 regression runner `test-agent-*` 自动发现，已在 runner 同环境（`AI_AGENT_ENABLED=false AI_EXECUTION_POLICY=adaptive`）复跑 pass=22 fail=0。suite 只经真实 Engine 路径（registry → engine → runtime 真对象），未只 mock Adapter 方法。

## 6. 契约层单测

| 命令 | 结果 |
| --- | --- |
| `node tools/test-agent-engine-contract.js` | PASS 27/27（形状校验/能力门控/归一化/Registry 选择策略/environment 归一化/diagnostics） |
| `node tools/test-agent-platform-production-wiring.js` | PASS（既有生产接线无回归） |
| `node tools/test-agent-platform-http.js` | PASS |
| `node tools/test-agent-runtime-lifecycle.js` | PASS 5/5 |
| `node tools/test-agent-platform-contracts.js` | PASS 7/7 |
| `node tools/test-agent-p5b-standalone.js` | PASS（standalone 同一 Engine 模型接线） |
| `npm run test:agent-platform-p7a`（release-gate 新段） | PASS：contract 27/27 + conformance 22/22 + production-wiring（段已登记入 `tools/run-agent-release-gate.js` STEPS） |
| `npm run test:agent-platform-p1` | PASS 26 项（P7a 接线后 release-gate P1 段回归零失败） |

## 7. 实验 Adapter 研究（P7b/P7c deferred）

`docs/xiaofu-agent/engine-adapter-research.md`（270 行，调研日期 2026-08-01，全部事实带 npm registry / 官方文档一手来源，未确认项如实列 §5）：

- **P7b（OpenAI Agents SDK JS）**：`@openai/agents` 0.14.2（MIT，trusted publisher + SLSA）；19 行 API 映射表（execute→Runner.run、AbortSignal 原生支持、Sessions→Memory Context 适配、tracing→RunEvent 差异、stream 三类事件→capabilities 声明）；缺口 G1–G7（SDK 自带会话/会话状态策略数据出域须禁用、trace 格式差异等）；最小只读 Skill 验收计划 6 步；重启门槛 8 项。
- **P7c（Pi Agent Core）**：调研对象如实确认——Inflection 无开源「Pi Agent Core」，按 npm 真实包建模（`@mariozechner/pi-agent-core` 0.73.1 deprecated → `@earendil-works/pi-agent-core` 0.83.0，MIT）；有利安全事实：底座不内置工具（read/bash/edit/write 在上层 pi-coding-agent），依赖层面可强制隔离；安全隔离设计 S1–S4 + 宿主能力隔离测试 T1–T4；`pi-ai` 捆绑 5 厂商 SDK 的闭包风险已记录。
- **共同接缝**：capabilities 预期声明对照表、conformance suite 复用、experimental 注册方式、如实表述模板（允许说/禁止说）。
- 辩证性修正：仓库根 package.json license 实为 ISC 且无 LICENSE 文件（原任务描述误为 MIT），文档如实标注，兼容性结论不受影响。
- 两 Adapter **未实现、未加依赖、未写空 Adapter**；状态 deferred / not implemented。

## 8. 如实边界

- Engine 层 capabilities 如实声明：supportsStreaming=false（SSE 未实装，微信侧 cursor polling 为权威）、supportsResume=false（resume 由 Run 协议层 cursor 重放承担，P6a）、supportsParallelTools=false（当前串行执行）、supportsCancel=true（经 execute 内 AbortSignal 传播，无独立 runId 级 cancel 句柄）。
- conformance "suite-verified" 状态由本阶段 suite 运行证据支持；运行时引擎声明保持 self-declared，不把测试状态写进代码。
- OpenAI/Pi Adapter 未实现；不得表述为"三种 Engine 已完成"。

## 9. 回滚

单提交 revert 可完整回退：契约/Registry/包装/测试/文档为新增文件；platformComposition、standaloneComposition、createAgentPlatform 的接线改动在 revert 后恢复 runtime 直调（无 engineRegistry 即旧行为），不遗留半接状态。
