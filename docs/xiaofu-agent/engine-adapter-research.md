# Engine Adapter 研究文档 — OpenAI Agents SDK JS（P7b）与 Pi Agent Core（P7c）

> **状态：deferred / not implemented。** 对应 [`specs/xiaofu-agent-product-platform/tasks.md`](../../specs/xiaofu-agent-product-platform/tasks.md) 的 P7b、P7c 条目（两者均标注 deferred / not implemented，重启门槛见 tasks.md 与本文 §1.6 / §2.8）。
>
> 本文档是 P7a 交付物之一：能力研究、依赖与许可证审计、API 映射设计、缺口清单、验收计划与完成条件。**本文不构成任何实现承诺**：未添加任何 SDK 依赖、未写空 Adapter、未做 re-export、未设永远关闭的 feature flag、未以 Mock 冒充真实验证。
>
> 调研日期：2026-08-01。所有包名 / 版本号 / license 均来自当日实际抓取的 npm registry 或官方文档页（来源见 §4）；标注「二级来源」的内容未逐一核验；查不到的如实标注「未确认」（汇总见 §5），不编造版本号。

## 0. 映射目标：本项目 Engine 契约基线

两个实验 Adapter 的映射对象是本项目已在 P7a 落地的 Engine 契约（单一权威）：

- 契约定义：`packages/agent-runtime/src/engine/agentEngine.js`（contractVersion `agent-engine.v1`）。`createAgentEngine({ engineId, engineVersion, capabilities, conformance, execute, resume?, cancel?, readiness?, health?, shutdown? })`；capabilities 为 11 个固定键（`supportsStreaming / supportsResume / supportsCancel / supportsStructuredDecision / supportsToolCalling / supportsMemory / supportsRag / supportsActionReceipt / supportsUiSchema / supportsParallelTools / supportsProviderFallback`），未声明一律 false，能力未声明时明确抛 `AGENT_ENGINE_CAPABILITY_UNSUPPORTED`，不静默忽略。
- execute 形状：输入 `{ request, configSnapshot, signal, emit, stages{ context / decision / skillTool / verification / response } }`，输出 `{ runId, configVersion, deadlineAt, artifacts, ui, platformTrace }`（缺 runId/artifacts/platformTrace 抛 `AGENT_ENGINE_RESULT_INVALID`）。
- Registry：`packages/agent-runtime/src/engine/engineRegistry.js` —— 服务端受控选择（defaultEngine / 显式 engineId / environment scope / feature flag / experimental 标记）；experimental 引擎仅在 `featureFlags.allowExperimentalEngines === true` 且 environment ∈ `experimentalEnvironments`（默认仅 `dev`）时可经显式 engineId resolve，**不得设为默认**；Engine 不可用抛 coded error，不静默切换伪装原引擎；resolve 在单次执行开始时发生一次，Run 创建后绑定 Engine 版本。
- conformance：`conformance.suiteVersion` 必填；运行时引擎声明永远 `self-declared`，`suite-verified` 只由 conformance suite（`tools/test-agent-engine-conformance.js`，22 项，suiteVersion `p7a-conformance-1`；截至本文书写该 suite 随 P7a 收尾回填，契约层单测 `tools/test-agent-engine-contract.js` 已 PASS 27/27）的运行证据写入，不由引擎自身声称。
- Trace：`engineTraceMetadata` 七字段（intendedEngine / actualEngine / engineVersion / contractVersion / conformanceVersion / fallbackPath / outcome），挂 `platformTrace.engine`；无 Provider 名、无密钥、无隐藏推理。
- 唯一默认 Engine：Fosu Engine（`fosu-runtime@0.1.0`，`server/src/services/ai/engine/fosuEngine.js`，薄包装 `apps/agent-server/src/createRuntimeEngine.js`；standalone 为同一包装的 `standalone-runtime`）。其实测 capabilities（`createRuntimeEngine.js:42-54`）：`supportsStreaming:false、supportsResume:false、supportsCancel:true、supportsStructuredDecision:true、supportsToolCalling:true、supportsMemory:true、supportsRag:true、supportsActionReceipt:true、supportsUiSchema:true、supportsParallelTools:false、supportsProviderFallback:true`。
- 统一消费要素（任何实验 Engine 必须消费本项目这一套，不得创建第二套状态源）：Provider、Tool Registry、Memory Context、RAG Retrieval、Guardrail、RunEvent emitter、UI Schema composer、Deadline、AbortSignal、immutable configVersion、executionPolicy。public 永远确定性：外部 Provider 调用次数恒为 0。

---

## 1. OpenAI Agents SDK JS（P7b 研究）

### 1.1 官方 SDK 现状

- 包名：`@openai/agents`（官方 TypeScript/JavaScript SDK）。2026-08-01 抓取 npm registry `latest` 为 **0.14.2**，author `OpenAI <support@openai.com>`，license **MIT**。仓库 [openai/openai-agents-js](https://github.com/openai/openai-agents-js)，文档站 [openai.github.io/openai-agents-js](https://openai.github.io/openai-agents-js/)。
- 维护状态：活跃；registry 显示 0.14.2 经 GitHub Actions trusted publisher（npm OIDC）发布并附 SLSA provenance attestation。注意仍为 **0.x 版本**：二级来源报道称 2026-06-19 发布的 0.11.8 才达成 TypeScript 与 Python 版功能对齐（[AgenticWire，二级来源](https://www.agenticwire.news/article/openai-agents-sdk-typescript-guide)），minor 升级存在 breaking 风险。
- 运行环境：Node.js 22+、Deno、Bun；Cloudflare Workers 为 experimental（仓库 README）。
- 包结构：`exports` 含 `.`、`./utils`、`./sandbox`、`./realtime`、`./sandbox/local` 五个子路径（registry）。Sandbox Agents 为 beta。
- 核心抽象（仓库 README「Core concepts」与文档站）：
  - **Agent**：LLM + instructions + tools + guardrails + handoffs 的配置体。
  - **Runner / `run()`**：内置 agent loop——模型调用 → final output 返回 / handoff 切换 / tool calls 执行后回到模型调用；`maxTurns`（默认 10）安全上限，超限抛 `MaxTurnsExceededError`（[Running agents 文档](https://openai.github.io/openai-agents-js/guides/running-agents/)）。
  - **Tools**：function tools（zod schema）、MCP tools、hosted tools。
  - **Handoffs / Agents as tools**：多 Agent 委派。
  - **Guardrails**：input / output / tool guardrails，tripwire 快速失败；官方文档站特性列表称「与 agent 执行并行运行，检查不通过即快速失败」（[文档站首页](https://openai.github.io/openai-agents-js/)；并行语义未读 guardrails 专页源码核验，见 §5）。
  - **Sessions**：`Session` 接口（`getSessionId / getItems / addItems / popItem / clearSession`），内置 `MemorySession`（进程内存，仅开发）与 `OpenAIConversationsSession`（OpenAI 服务端 Conversations API）；可自定义存储后端（[Sessions 文档](https://openai.github.io/openai-agents-js/guides/sessions/)）。
  - **Tracing**：内置 tracing（默认导出 OpenAI Traces 后台）；`RunConfig.tracingDisabled` / `traceIncludeSensitiveData` 控制（Running agents 文档 RunConfig 表）。
  - **Streaming**：`run(..., { stream: true })` 返回 `StreamedRunResult`（AsyncIterable），三类事件 `raw_model_stream_event / run_item_stream_event / agent_updated_stream_event`（[Streaming 文档](https://openai.github.io/openai-agents-js/guides/streaming/)）。
  - **Human in the loop**：工具审批 interruptions + `RunState.approve()/reject()`，以 `RunState` 重跑恢复。
  - **Realtime Agents**：语音实时 Agent（`@openai/agents/realtime` 子路径）。
  - **Provider**：「provider-agnostic, supporting OpenAI APIs and more」（仓库 README）；`RunConfig.modelProvider` 可替换，默认 OpenAI provider（默认读 `OPENAI_API_KEY` 环境变量）。

### 1.2 依赖与许可证审计

直接依赖（2026-08-01 抓取自 [registry `@openai/agents/latest`](https://registry.npmjs.org/@openai/agents/latest) 与 [registry `@openai/agents-core/latest`](https://registry.npmjs.org/@openai/agents-core/latest)）：

| 包 | 版本 | license | 直接依赖 |
| --- | --- | --- | --- |
| `@openai/agents` | 0.14.2 | MIT | `debug ^4.4.0`、`openai ^6.46.0`、`@openai/agents-core 0.14.2`、`@openai/agents-openai 0.14.2`、`@openai/agents-realtime 0.14.2`；peer：`zod ^4.0.0` |
| `@openai/agents-core` | 0.14.2 | MIT | `debug ^4.4.0`、`openai ^6.46.0` |

- **许可证兼容性**：MIT，与本项目兼容。如实修正一处任务描述：本项目根 `package.json` 的 `license` 字段实为 **ISC** 且仓库根未见 LICENSE 文件（Glob `LICENSE*` 无匹配），并非任务描述所称 MIT；MIT 与 ISC 同属宽松许可证，引入 MIT 依赖无法律障碍。正式引入时仍须对完整传递闭包跑许可证扫描。
- **依赖树规模**：直接依赖 5 个（+zod peer），核心闭包小，重量级项是 `openai` 客户端本体。注意 `@openai/agents-realtime` 是**硬性 dependency 而非可选**——即使实验范围不用 Realtime，安装时也会引入，裁剪不可行，其闭包计入审计面。**完整传递闭包与 `npm audit` 结果属重启时审计动作，本文未展开（见 §5）。**
- **供应链风险**：
  - 正面：trusted publisher + SLSA provenance；OpenAI 官方维护。
  - 风险：0.x semver，minor 可能 breaking → 锁精确版本 + 升级评审；SDK 默认读 `OPENAI_API_KEY` 环境变量、默认向 OpenAI 后台导出 tracing——两个「默认」都必须在 Adapter 中显式关闭/重定向，否则破坏本项目 Provider 配置隔离与数据出域边界。

### 1.3 API 映射表（本项目契约要素 → SDK 对应物）

| 本项目契约要素 | SDK 对应物（来源） | 映射方式 / 缺口 |
| --- | --- | --- |
| `execute({request, configSnapshot, signal, emit, stages})` | `Runner.run(agent, input, options)` / `run()`（Running agents 文档） | Adapter 在 execute 内组装 Agent + 输入并调用 run；输出归一化为 `{runId, configVersion, deadlineAt, artifacts, ui, platformTrace}`。`runId` 由 Adapter 按本项目规则生成，SDK 内部 trace/run id 仅作 `traceMetadata` 关联，语义不同。 |
| `stages.context`（上下文装配） | 无一一对应；`Session` 历史合并 + `sessionInputCallback` + `callModelInputFilter` 可承担部分 | 本项目 context 阶段（课表事实、Memory Context 装配）必须由 Adapter 在调用 run 前完成并作为输入传入，不得交由 SDK 自由装配。 |
| `stages.decision`（结构化决策） | 无对等概念；Agent `outputType`（zod）仅是最终输出形态约束 | 不等于本项目 Decision 对象。`supportsStructuredDecision` 预期声明 false（以实现时实测为准）。 |
| `stages.skillTool`（工具执行） | function tools（zod schema）/ MCP tools / hosted tools（仓库 README） | 本项目 Tool Registry 条目逐个适配为 SDK function tool（schema 转 zod），工具实现仍调用本项目 Tool 执行层；**禁止把 Tool Registry 之外的任何能力（含 hosted tools、MCP）暴露给 SDK agent**。 |
| `stages.verification` | 无对应 | 保留在 Adapter 外层：execute 返回前由本项目验证组件执行，不进 SDK。 |
| `stages.response`（Response Composer / UI Schema） | 无对应；SDK 只产出 `finalOutput` / `history` | `ui` 由本项目 UI Schema composer 从 artifacts 组装；`supportsUiSchema` 预期 false。 |
| Memory Context | `Session` 接口五方法；内置 `MemorySession` / `OpenAIConversationsSession`；可自定义存储（Sessions 文档） | 实现自定义 Session 桥接本项目 Memory/Run Store，或不用 Session、由 Adapter 每次显式注入历史。`OpenAIConversationsSession` 把会话存到 OpenAI 服务端，**数据出域，本项目禁用**。 |
| RAG Retrieval | 无内建 | 以本项目 RAG 组件包装为 function tool 或在 context 阶段注入；禁止 SDK 直连知识库。 |
| Guardrail | `inputGuardrails / outputGuardrails`（RunConfig 或 Agent 级，tripwire 快速失败）+ tool guardrails（Running agents 文档） | 本项目 Guardrail 判定函数映射为 SDK guardrail；guardrail 内不得携带敏感上下文出域。 |
| RunEvent emitter | 流事件三类（`raw_model_stream_event / run_item_stream_event / agent_updated_stream_event`，`stream:true`）+ tracing spans（Streaming 文档） | 需事件翻译层映射为本项目 RunEvent；无法真实对应的事件**禁止伪造**（如 Thinking 只允许在 Provider 调用真实发生后展示，沿用 Runtime Truth Layer 纪律）。 |
| Tracing / platformTrace | SDK tracing（默认导出 OpenAI Traces 后台；`tracingDisabled` / `traceIncludeSensitiveData`）（RunConfig 表） | 格式与本项目 platformTrace 完全不同。必须 `tracingDisabled: true` 或以自定义 processor 重定向到本项目采集；禁止把未脱敏数据导出 OpenAI 后台。 |
| Deadline | 无内建 deadline；仅 `maxTurns`、function tool `timeoutMs`（Running agents 文档） | Adapter 以 `AbortController` + 计时实现 `deadlineAt`，超时 abort 并如实上报 outcome。 |
| AbortSignal | run options `signal`（原生，AbortSignal for cancellation；流场景 abort 后须 `await stream.completed` 收尾） | 直接透传 execute 输入的 `signal`。`supportsCancel` 可声明 true（实测后）。 |
| immutable configVersion | 无对应 | Adapter 输出时绑定 `configSnapshot` 版本，SDK 无感知。 |
| executionPolicy | 无对应 | Adapter 外层强制执行。 |
| Provider 配置 | `RunConfig.modelProvider` / `OpenAIProvider`；默认 OpenAI provider 读 `OPENAI_API_KEY` 环境变量 | 必须显式注入本项目统一 Provider 与密钥解析，**禁止环境变量旁路**导致 public 串环境；public 模式外部 Provider 调用恒 0 的门禁不变。 |
| Resume | `RunState`（HITL interruptions + 以 state 重跑恢复；Streaming/Sessions 文档） | 与本项目 Run 协议 cursor 重放模型不同；`supportsResume` 预期 false，恢复仍由 Run 协议层（P6a）承担。 |
| 并行工具 | `toolExecution.maxFunctionToolConcurrency` 可限并发；provider 侧 `parallelToolCalls` 独立（RunConfig 表） | 适配时限制并发为 1 以对齐本项目当前串行语义；`supportsParallelTools` 预期 false（与 Fosu Engine 对齐）。 |
| Handoff / 多 Agent | SDK 原生 | 本项目无对应概念，实验范围内禁用（单 Agent）。 |
| Sandbox / Realtime | `@openai/agents/sandbox`（beta）、`@openai/agents/realtime` 子路径 | 超出实验范围且扩大攻击面，禁用；但 `agents-realtime` 作为硬依赖会被安装（见 §1.2）。 |

### 1.4 缺口清单

- **G1 双状态源冲突**：SDK 提供四种会话状态策略（`result.history` / `session` / `conversationId` / `previousResponseId`，Running agents 文档「Choose one memory strategy」）。其中 `conversationId` / `previousResponseId` 依赖 OpenAI 服务端状态，数据出域且破坏 public 确定性，**本项目禁用**；`session` 只能桥接本项目 Memory/Run Store 或弃用。设计决定：SDK 按「无状态单次 run」使用，状态权威永远是本项目 Run Store。
- **G2 Trace / 事件格式差异**：SDK 流事件与 tracing span 跟本项目 RunEvent/platformTrace 语义粒度不同，需要翻译层；翻译不了一律不展示，不伪造。
- **G3 Provider 与 tracing 的「默认出域」**：默认读 `OPENAI_API_KEY`、默认导出 tracing 到 OpenAI 后台，两个默认都必须显式关闭/重定向。
- **G4 stages 五段无对应**：decision / verification / response 只能留在 Adapter 外层；SDK 实际只覆盖 skillTool 循环。
- **G5 0.x 版本稳定性**：minor 升级可能 breaking；锁版本 + 升级评审。
- **G6 UI Schema / Deadline / configVersion / executionPolicy 无对应**：全部自适配。
- **G7 硬依赖含 Realtime 子包**：不使用也会被安装，计入审计面。

### 1.5 最小只读 Skill 验收计划（实现时执行，非现在）

1. 范围：仅 `dev` 环境；经 Registry 以 `experimental: true` 注册（`allowExperimentalEngines` flag + environment scope 仅 dev）；public/trial resolve 必须抛 `AGENT_ENGINE_NOT_ALLOWED`。
2. 测试 Skill：选一个**明确注册的只读测试 Skill**（不触达真实学生数据的只读查询），其工具经适配层暴露为唯一 SDK function tool。
3. 统一消费要素逐项验证：Provider（本项目统一配置注入，断言无 `OPENAI_API_KEY` 环境旁路）、Tool Registry（只暴露该 Skill 的工具）、Memory Context（自定义 Session 桥接或显式注入，断言无双写）、RAG（经本项目组件）、Guardrail（映射为 SDK guardrail）、RunEvent（翻译层，断言无伪造事件）、UI Schema（外层 composer）、Deadline（超时真实 abort）、AbortSignal（透传生效）、configVersion（platformTrace 绑定）、executionPolicy（外层强制）。
4. 真实执行：跑一次真实 run（非 mock），断言输出形状 `{runId, configVersion, deadlineAt, artifacts, ui, platformTrace}` 完整，`platformTrace.engine.actualEngine` 为该 Adapter 真实 engineId，fallbackPath 如实。
5. conformance：通过**同一** `tools/test-agent-engine-conformance.js`（suiteVersion `p7a-conformance-1` 或其后续版本），不得另建弱化版 suite。
6. 门禁：public 外部 Provider 调用计数恒 0；release-gate 全绿。

### 1.6 完成条件（重启门槛，全部满足才可启动实现）

沿用 tasks.md P7b 原文并补充审计项：

1. P3–P7a 全部完成；2. release-gate 全绿；3. 双部署 smoke 完成；4. 真机验收无 Critical/Important；5. 时间与预算充足；6. **用户再次明确授权**；7. 依赖审计通过：完整传递闭包清单评审 + `npm audit` + 许可证扫描（覆盖 §1.2 全部直接与传递依赖）；8. 验收计划 §1.5 全部通过（含同一 conformance suite）。

---

## 2. Pi Agent Core（P7c 研究）

### 2.1 调研对象确认（如实说明）

任务描述的「Pi Agent Core」在 npm 上真实对应 **Mario Zechner（libGDX 作者）的 pi-agent-core** 及其生态，本文按此建模：

- `@mariozechner/pi-agent-core`：2026-08-01 抓取 `latest` 为 **0.73.1**，license **MIT**，仓库 [badlogic/pi-mono](https://github.com/badlogic/pi-mono)。**registry 明确标注 deprecated：「please use @earendil-works/pi-agent-core instead going forward」**（[registry](https://registry.npmjs.org/@mariozechner/pi-agent-core/latest)）。
- `@earendil-works/pi-agent-core`：继任包，`latest` 为 **0.83.0**，license **MIT**，同作者，仓库 [earendil-works/pi](https://github.com/earendil-works/pi)，Node >=22.19.0，同样经 trusted publisher + SLSA 发布（[registry](https://registry.npmjs.org/@earendil-works/pi-agent-core/latest)）。
- 如实标注：**未找到 Inflection AI 发布的任何名为「Pi Agent Core」的开源 SDK**——Inflection 的 Pi 是 C 端助手产品而非开源 agent 框架。若任务原意确指 Inflection，则结论为「无权威上游，P7c 前提不成立，仅按任务描述的假设能力建模」。
- 生态分层（二级来源，未逐一核验）：`pi-ai`（统一多厂商 LLM API）→ `pi-agent-core`（agent loop / 工具执行 / 状态管理）→ `pi-coding-agent`（CLI，内置工具与会话持久化）→ `pi-tui` / `pi-web-ui`（[Agentic AI Knowledge Base，二级来源](https://agentic-ai.readthedocs.io/en/latest/AgentHarness/pi-dev/)、[Agentlas，二级来源](https://agentlas.pro/compare/langchain-vs-pi/)）。`pi-coding-agent` npm 页自述为「Coding agent CLI with read, bash, edit, write tools and session management」（[npm](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)）。
- 核心抽象（[@mariozechner/pi-agent-core npm README](https://www.npmjs.com/package/@mariozechner/pi-agent-core)，注意：README 基于 0.73.1，新 scope 0.83.0 的 API 差异**未确认**，实现时须以新 scope 文档复核）：
  - **Agent 类**：`initialState{ systemPrompt, model, thinkingLevel, tools, messages }`；`prompt()` / `continue()` / `abort()` / `waitForIdle()` / `reset()`；`agent.state`（`AgentState`，含 `messages / isStreaming / pendingToolCalls`）。
  - **事件流**：`agent.subscribe(event)` —— `agent_start / turn_start / message_start / message_update / message_end / tool_execution_start / tool_execution_update / tool_execution_end / turn_end / agent_end`。
  - **AgentTool**：`{ name, label, description, parameters(typebox schema), execute(toolCallId, params, signal, onUpdate), executionMode }`；工具 `execute` 原生接收 **AbortSignal**，`onUpdate` 可流式回报进度；错误以 throw 上报（`isError`）。
  - **hooks**：`beforeToolCall`（参数校验后可 **block** 执行）/ `afterToolCall`（可改写结果或 `terminate`）。
  - **工具执行模式**：`toolExecution: "parallel"`（默认）/ `"sequential"`，可按工具覆盖。
  - **上下文管线**：`transformContext`（裁剪/注入）→ `convertToLlm`（过滤 UI-only / 自定义消息类型，declaration merging 扩展 `AgentMessage`）。
  - **Provider**：经 `pi-ai` `getModel(provider, model)`；`getApiKey` 支持动态密钥；`streamFn / streamProxy` 支持代理后端。pi-ai 自述「Unified LLM API with **automatic model discovery and provider configuration**」（registry description）——自动发现与本项目受控 Provider 配置冲突，必须显式覆盖。
  - **低层 API**：`agentLoop()` / `agentLoopContinue()`（无 Agent 类状态屏障语义的裸循环）。
  - steering / follow-up 消息队列、thinkingLevel / thinkingBudgets：本项目无对应需求，不使用。

### 2.2 包与许可证审计

直接依赖（2026-08-01 抓取自 registry）：

| 包 | 版本 | license | 直接依赖 |
| --- | --- | --- | --- |
| `@mariozechner/pi-agent-core`（**deprecated**） | 0.73.1 | MIT | `typebox ^1.1.24`、`@mariozechner/pi-ai ^0.73.1` |
| `@earendil-works/pi-agent-core` | 0.83.0 | MIT | `diff 8.0.4`、`yaml 2.9.0`、`ignore 7.0.5`、`typebox 1.3.7`、`@earendil-works/pi-ai ^0.83.0` |
| `@earendil-works/pi-ai` | 0.83.0 | MIT | `openai 6.26.0`、`typebox 1.3.7`、`partial-json 0.1.7`、`@google/genai 1.52.0`、`http-proxy-agent 7.0.2`、`@anthropic-ai/sdk 0.91.1`、`https-proxy-agent 7.0.6`、`@opentelemetry/api 1.9.0`、`@mistralai/mistralai 2.2.6`、`@smithy/node-http-handler 4.7.3`、`@aws-sdk/client-bedrock-runtime 3.1048.0` |

- **许可证**：全链 MIT，与本项目（根 package.json 为 ISC）兼容；引入时对传递闭包跑许可证扫描。
- **依赖树规模**：pi-agent-core 本体仅 5 个直接依赖，但 `pi-ai` 一层**捆绑了 5 个厂商 SDK**（openai / @anthropic-ai/sdk / @google/genai / @mistralai/mistralai / @aws-sdk/client-bedrock-runtime）+ proxy agents + OpenTelemetry + smithy。即使实验只用单一 Provider，这些依赖全部入安装闭包——**闭包明显大于 @openai/agents，安装体积与 CVE 暴露面都更大**，是 P7c 相对 P7b 的主要审计劣势。
- **供应链风险**：0.x semver；个人/小团队维护（bus factor）；**scope 迁移**（`@mariozechner/*` → `@earendil-works/*`，仓库同步迁移）——采用前必须核实新 scope 的所有权连续性与发布链可信（当前两 scope 最新版均带 SLSA provenance，为正面信号）。锁精确版本 + lockfile 提交。

### 2.3 安全隔离设计（P7c 专项，不可绕过）

- **S1**：微信用户侧**绝不开放** bash / read / write / edit / 任意文件系统 / 任意 shell。这些能力根本不出现在工具注册表中。如实指出一点有利事实：`pi-agent-core` 底座**本身不内置任何工具**，工具全部由宿主注入（内置 read/bash/edit/write 的是上层 `pi-coding-agent`），因此「不引入危险工具」在依赖层面可强制。
- **S2**：只允许**明确注册的只读测试 Skill**：Adapter 仅注入白名单工具集；同时以 `beforeToolCall` 默认拒绝白名单外一切工具名（纵深防御，防模型幻觉出未注册工具名）。
- **S3 依赖裁剪**：`package.json` 只列 `@earendil-works/pi-agent-core` 一个包（连带 pi-ai）；**禁止安装 `pi-coding-agent` / `pi-tui` / `pi-web-ui`**；静态扫描 node_modules 与 lockfile 断言无这些包。
- **S4 宿主能力隔离测试**（重启门槛之一，实现时执行）：
  - T1 静态：lockfile / node_modules 扫描无 `pi-coding-agent`；Adapter 源码无 `child_process` / fs 写路径被注册为工具。
  - T2 运行时：构造模型输出请求白名单外工具名（`bash` / `read` / `write` / `edit` 等）→ 必须被工具解析层 / `beforeToolCall` 拒绝并如实记录，Run 以受控错误结束，不执行任何宿主能力。
  - T3 运行时：白名单只读工具断言无文件系统 / 网络副作用（stub 层断言）。
  - T4 环境隔离：public/trial resolve 该引擎抛 `AGENT_ENGINE_NOT_ALLOWED`（仅 dev + flag 可用）。

### 2.4 集成方式

- **不复制整个仓库**（不 vendor pi-mono / pi 仓）：以正式 npm 依赖引入唯一必要包，锁精确版本并提交 lockfile，经 §2.2 审计后进入 dev 依赖闭包。
- 后备路径（如实说明，非当前计划）：若传递依赖审计不通过（如 pi-ai 的多厂商 SDK 闭包不可接受），候选方案是仅借鉴其 agent loop 语义在本项目内自研——届时它**不再是「Pi Adapter」**，需重新命名与评审，不得继续用 P7c 名义交付。

### 2.5 API 映射表（本项目契约要素 → pi-agent-core 对应物）

| 本项目契约要素 | pi-agent-core 对应物（npm README，基于 0.73.1） | 映射方式 / 缺口 |
| --- | --- | --- |
| `execute(...)` | `agent.prompt(input)` 或低层 `agentLoop(prompts, context, config)` | 推荐低层 `agentLoop` 或每次新建 Agent 实例（无状态用法），避免携带上一 Run 的 `AgentState`。`runId` 由 Adapter 生成（SDK 无 run 概念，`sessionId` 仅是 provider 缓存提示）。 |
| `stages.context` | `transformContext` + `convertToLlm` | 可承担消息裁剪/注入；本项目 context 装配仍在调用前完成。 |
| `stages.decision` | 无 | 预期 false。 |
| `stages.skillTool` | `AgentTool`（typebox schema；`execute(toolCallId, params, signal, onUpdate)`） | Tool Registry 条目适配为 AgentTool（schema 转 typebox）；`signal` 原生透传 AbortSignal；`onUpdate` 可映射工具进度事件。白名单强制（§2.3）。 |
| `stages.verification` | 无 | Adapter 外层。 |
| `stages.response` / UI Schema | 无 | 外层 composer；预期 false。 |
| Memory Context | `initialState.messages` / `agent.state.messages` / 自定义消息类型（declaration merging + `convertToLlm`） | 桥接本项目 Memory/Run Store；**禁止 AgentState 与 Run Store 双状态源并存**（无状态用法 + 显式历史注入）。 |
| RAG Retrieval | 无内建 | 同 P7b：包装为本项目组件输出的 tool 或 context 注入。 |
| Guardrail | `beforeToolCall`（可 block）/ `afterToolCall` | 工具侧 guardrail 可映射；输入/输出侧 guardrail 无内建，需 Adapter 自实现。 |
| RunEvent emitter | `agent.subscribe` 十类事件（§2.1） | 事件翻译层；无法真实对应的一律不展示、不伪造。 |
| Tracing / platformTrace | 无 tracing 系统（pi-ai 闭包含 `@opentelemetry/api`，但 agent-core 无导出管线） | platformTrace 由 Adapter 组装，无 SDK 侧对照。 |
| Deadline | 无 | `AbortController` + 计时，同 P7b。 |
| AbortSignal | `agent.abort()` + 工具 `execute` 的 `signal` 参数（原生） | 透传；`supportsCancel` 可声明 true（实测后）。 |
| configVersion / executionPolicy | 无 | Adapter 外层。 |
| Provider 配置 | `pi-ai getModel(provider, model)`；`getApiKey` 动态密钥；`streamFn/streamProxy` | 显式注入本项目统一 Provider；**禁用 pi-ai 自动 model discovery / provider configuration**（与本项目受控配置冲突）；防环境变量旁路。 |
| Resume | `agent.continue()`（从现有 context 续跑，限错误重试） | 与本项目 Run 协议 cursor 重放不同；预期 false。 |
| 并行工具 | `toolExecution: "parallel"` 默认 / per-tool `executionMode` | 适配时强制 `sequential` 对齐本项目串行语义；`supportsParallelTools` 预期 false。 |
| steering / follow-up / thinking | 原生 | 本项目无对应需求，不使用、不暴露。 |

### 2.6 缺口清单

- **G1 宿主危险能力**（最严重）：pi 生态招牌层 `pi-coding-agent` 内置 read/bash/edit/write（默认启用）且无权限门 → 绝对禁止引入；只用 `pi-agent-core` 底座 + 显式白名单工具（§2.3）。
- **G2 状态源**：`Agent` 类自带 `AgentState`（messages/isStreaming）→ 无状态用法，权威永远在本项目 Run Store。
- **G3 包迁移与维护者风险**：旧 scope 已 deprecated；采用前核实 `@earendil-works` 所有权连续性；0.x 版本 + 小团队维护。
- **G4 依赖面**：pi-ai 捆绑 5 个厂商 SDK，闭包大（§2.2）。
- **G5 schema 体系差异**：typebox vs 本项目工具体系，需转换层。
- **G6 事件/追踪语义差异**：无 tracing、无 deadline、无 runId、无 configVersion，全部外层自适配。
- **G7 API 复核**：本文 API 描述基于 `@mariozechner/pi-agent-core@0.73.1` README；`@earendil-works/pi-agent-core@0.83.0` 的 API 差异**未确认**（§5）。

### 2.7 最小只读 Skill 验收计划（实现时执行，非现在）

骨架与 §1.5 相同（仅 dev、experimental 注册、统一消费要素逐项验证、真实执行、同一 conformance suite、public 恒确定性），**另加 §2.3-S4 全部宿主能力隔离测试（T1–T4）**，缺一不可。

### 2.8 完成条件（重启门槛）

同 §1.6 全部 8 项，**另加**：宿主能力隔离测试（§2.3-S4）通过；依赖审计额外覆盖 pi-ai 的 5 个厂商 SDK 闭包；`@earendil-works` 新 scope 所有权连续性核实完成。

---

## 3. 共同接缝

### 3.1 两个 Adapter 共用的接缝设计

- **接缝 A：capabilities 如实声明**。按下表预期声明——**「预期」以实现时实测为准，未实测一律 false**；声明后受 `assertEngineCapability` 门控，不得静默忽略。

| capability 键 | fosu-runtime（实测，`createRuntimeEngine.js`） | P7b 预期 | P7c 预期 |
| --- | --- | --- | --- |
| supportsStreaming | false | true（`stream:true` 原生，事件翻译落地后才可声明） | true（`message_update` 原生，同前） |
| supportsResume | false | false（恢复由 Run 协议层承担） | false（同） |
| supportsCancel | true | true（options.signal） | true（abort + tool signal） |
| supportsStructuredDecision | true | false | false |
| supportsToolCalling | true | true | true |
| supportsMemory | true | true（桥接后） | true（桥接后） |
| supportsRag | true | true（经本项目组件） | true（经本项目组件） |
| supportsActionReceipt | true | false（外层可组装时再评估） | false（同） |
| supportsUiSchema | true | false（UI 外层 composer） | false（同） |
| supportsParallelTools | false | false（强制串行对齐） | false（强制串行对齐） |
| supportsProviderFallback | true | false | false |

- **接缝 B：conformance suite 复用**。两个 Adapter 必须通过**同一** `tools/test-agent-engine-conformance.js`（suiteVersion `p7a-conformance-1` 或其后续版本），不得为实验引擎另建弱化版；`suite-verified` 状态只由 suite 运行证据写入，引擎声明保持 `self-declared`。
- **接缝 C：Trace 字段**。统一 `platformTrace.engine` 七字段（intendedEngine / actualEngine / engineVersion / contractVersion / conformanceVersion / fallbackPath / outcome）；Adapter 必须填真实 actualEngine，fallbackPath 如实，不含 Provider 名/密钥/隐藏推理。
- **接缝 D：experimental 注册方式**。`registry.register(engine, { experimental: true })`；仅在 `featureFlags.allowExperimentalEngines === true` 且 environment ∈ `experimentalEnvironments`（默认仅 dev）时可经显式 engineId resolve；**禁止 `makeDefault`**；public/trial resolve 抛 `AGENT_ENGINE_NOT_ALLOWED`；Run 创建绑定 engineVersion。建议 engineId：`openai-agents-sdk` / `pi-agent-core`（以实现时确认为准）。当前生产与 standalone 均无实验引擎注册、`allowExperimentalEngines: false`——**这不是为 P7b/P7c 预留的「永远关闭的 flag」，而是 Registry 的通用安全机制**，实验引擎实现前不注册任何实例。
- **接缝 E：统一消费要素清单**。每个 Adapter 设计评审逐项打勾：Provider / Tool Registry / Memory Context / RAG / Guardrail / RunEvent / UI Schema / Deadline / AbortSignal / configVersion / executionPolicy；任何一项由 SDK 另起炉灶即视为设计失败。

### 3.2 如实表述模板

完成 P7a 后：

- **只允许说**：「P7a 完成：AgentEngineAdapter 契约、Engine Registry、Fosu Engine（唯一默认，`fosu-runtime@0.1.0`）真实生产接线、conformance suite、P7b/P7c 研究文档（能力研究、依赖与许可证审计、API 映射、缺口、验收计划、完成条件）。P7b/P7c 为 deferred / not implemented，仅有研究与审计结论。」
- **禁止说**：「已接入 / 已支持 OpenAI Agents SDK」「已接入 / 已支持 Pi Agent Core」「三种 Engine 已完成」「多引擎运行时可切换」「实验引擎已灰度 / 已上线」；禁止把 SDK 原生能力（streaming、sessions、tracing、handoff、sandbox、内置工具）表述为本项目已具备的能力；禁止把本文的映射设计表述为已实现；禁止以 mock 结果描述为真实验收。

---

## 4. 来源清单（均于 2026-08-01 实际抓取 / 阅读）

一手来源：

- [registry.npmjs.org/@openai/agents/latest](https://registry.npmjs.org/@openai/agents/latest) — 版本 0.14.2、MIT、依赖、exports、trusted publisher + SLSA
- [registry.npmjs.org/@openai/agents-core/latest](https://registry.npmjs.org/@openai/agents-core/latest) — agents-core 依赖（debug/openai）、MIT
- [github.com/openai/openai-agents-js](https://github.com/openai/openai-agents-js) — 仓库 README：Core concepts、Node 22+、子路径、provider-agnostic
- [openai.github.io/openai-agents-js](https://openai.github.io/openai-agents-js/) — 官方文档站特性列表（guardrails 并行、function tools、MCP、tracing、realtime）
- [Running agents 文档](https://openai.github.io/openai-agents-js/guides/running-agents/) — Runner loop、run options（signal/session/maxTurns）、RunConfig（modelProvider/guardrails/tracing 开关）、四种会话状态策略、错误类型
- [Streaming 文档](https://openai.github.io/openai-agents-js/guides/streaming/) — `stream:true`、三类流事件、HITL interruptions、abort 语义
- [Sessions 文档](https://openai.github.io/openai-agents-js/guides/sessions/) — Session 接口五方法、MemorySession、OpenAIConversationsSession、自定义存储
- [registry.npmjs.org/@mariozechner/pi-agent-core/latest](https://registry.npmjs.org/@mariozechner/pi-agent-core/latest) — 0.73.1、MIT、deprecated 指向 @earendil-works、依赖
- [npmjs.com/package/@mariozechner/pi-agent-core](https://www.npmjs.com/package/@mariozechner/pi-agent-core) — 完整 README：Agent API、事件流、hooks、AgentTool（signal 原生）、低层 agentLoop、MIT
- [registry.npmjs.org/@earendil-works/pi-agent-core/latest](https://registry.npmjs.org/@earendil-works/pi-agent-core/latest) — 0.83.0、MIT、依赖、Node>=22.19.0、仓库 earendil-works/pi、SLSA
- [registry.npmjs.org/@earendil-works/pi-ai/latest](https://registry.npmjs.org/@earendil-works/pi-ai/latest) — pi-ai 0.83.0、11 个直接依赖（含 5 个厂商 SDK）、description
- [npmjs.com/package/@mariozechner/pi-coding-agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) — 内置 read/bash/edit/write 工具与会话管理的自述

二级来源（仅背景，未逐一核验）：

- [AgenticWire：OpenAI Agents SDK TypeScript 指南](https://www.agenticwire.news/article/openai-agents-sdk-typescript-guide) — 0.11.8 功能对齐报道
- [Agentic AI Knowledge Base：Pi (pi.dev)](https://agentic-ai.readthedocs.io/en/latest/AgentHarness/pi-dev/) — pi 生态分层
- [Agentlas：LangChain vs Pi](https://agentlas.pro/compare/langchain-vs-pi/) — pi 架构与背景
- [dabit3 gist：PI agent stack 笔记](https://gist.github.com/dabit3/e97dbfe71298b1df4d36542aceb5f158) — pi-coding-agent 内置工具清单

## 5. 未能确认 / 未验证事项

- **Inflection「Pi」官方 agent core**：未找到任何开源 SDK；npm 上真实存在且活跃的「pi-agent-core」为 Mario Zechner 项目，本文按后者建模。若任务原意确指 Inflection，则 P7c 前提不成立。
- **`@earendil-works/pi-agent-core@0.83.0` 与 `@mariozechner/pi-agent-core@0.73.1` 的 API 差异**：本文 API 描述基于后者 README，新 scope 文档未逐页核对。
- **两个 SDK 的完整传递依赖闭包、`npm audit` 结果、传递闭包许可证扫描**：属实现时重启门槛的审计动作，本文只列直接依赖。
- **OpenAI Agents SDK guardrails「与 agent 执行并行」**：来自官方文档站特性列表，未读 guardrails 专页 / 源码核验。
- **各包历史版本发布日期**：未逐一核验；「latest」版本号以 2026-08-01 抓取为准，实现时必须重新核对。
- **pi 生态分层与内置工具数量的二手描述**（readthedocs / agentlas / gist）：与 npm 一手描述一致但未独立核验。
