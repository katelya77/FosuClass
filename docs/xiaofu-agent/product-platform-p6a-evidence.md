# P6a Evidence — Recoverable Run Protocol and Agent SDK

阶段：P6a — Recoverable Run Protocol and Agent SDK
提交：`feat(agent): add recoverable run protocol and agent sdk`
日期：2026-08-01

## 1. 交付范围

| 位置 | 内容 |
| --- | --- |
| `packages/agent-protocol/src/protocol.js` | `PROTOCOL_VERSION="run.v2"`、`MIN_COMPATIBLE="run.v1"`、`LEGACY_PROTOCOL_VERSIONS`（run.v1/agent.v1/agent.v2）、`PROTOCOL_CAPABILITIES`（12 类 UI Block、cursorResume、cancellation、finalResultRecovery、actionReceipt、idempotencyKey）、`negotiateProtocol`、`RUN_ERROR_CLASSES`+`classifyRunError`、`DIRECT_CHAT_COMPAT`（compatibility-only/deprecated/禁伪造事件清单） |
| `packages/agent-sdk/` | 环境无关 Run 状态机（`createRunState`/`reduceRunEvent` 幂等 reducer、终态吸收态、窗口上限 events 200 / seenEventIds 500 / diagnostics 50）+ `createAgentRunClient`（createRun/poll/resumeFromCursor/reconnect/waitForTerminal/cancelRun/recoverFinalResult/getState；request/storage/clock/logger/sleep/transport 全 DI；默认 cursor polling，SSE 为注入式接缝） |
| `server/src/services/ai/runEventCatalog.js` | 公开事件摘要 additive：`eventId`（透传）+ `protocolVersion`（默认 run.v2） |
| `server/src/services/ai/agentRunEventService.js` | `appendEvent` 无 eventId 时服务端生成 `evt_*`；createRun 返回带 protocolVersion/capabilities；新增 `getRunViewDeep`（cursor 早于内存投影窗口时经 `store.listEventsAfter` 兜底，按 sequence 去重合并、内存优先、标记 `eventSource:"store+memory"`） |
| `apps/agent-server/src/createRunHandlers.js` | createRun 开头协议协商（未知版本 → 400 `RUN_PROTOCOL_UNSUPPORTED`+errorClass+capabilities）；**idempotencyKey 真实转发** `runRepository.createRun`（此前只诊断不转发，属显示≠执行缺口）；deduplicated 分支直接 202 不再调度执行；202/200 响应带 protocolVersion/capabilities/compatibilityMode/eventCursor/errorClass；getRun 改 async 走 `getRunViewDeep`（无 deep 能力仓储回落 `getRunView`） |
| `tools/test-agent-run-protocol.js` | 协议/服务端/持久化/Handler 四层 18 项验收（自动进入 regression runner） |
| `tools/test-agent-sdk.js` | SDK 状态机/客户端/失败矩阵/DI/静态边界 15 项验收（自动进入 regression runner） |
| `tools/test-agent-p5a-run-store.js` | parity 投影归一化随机 eventId（同 `at` 惯例），新增 `eventIdsPresent` 跨后端一致性断言 |
| `tools/test-agent-platform-http.js` | Run Store 按进程隔离（`FOSU_AGENT_RUN_STORE_PATH`→mkdtemp），匹配幂等真实语义 |
| `package-lock.json` | 注册 `@xiaofu-agent/agent-sdk` workspace（Docker `npm ci` 前提） |

## 2. 关键设计决策

### 2.1 协议协商矩阵（现网兼容优先）

| 客户端发送 | 结果 |
| --- | --- |
| 缺失 / `run.v2` | native，按 run.v2 应答 |
| `run.v1` / `agent.v1` / `agent.v2` | `compatibilityMode:"legacy"` 受控兼容，仍按 run.v2 应答（additive 字段旧客户端忽略） |
| 其他显式值 | 400 `RUN_PROTOCOL_UNSUPPORTED`，errorClass `unsupported_protocol`，附 capabilities（fail clearly，不白屏不无限重试） |

**为什么 agent.v1/agent.v2 必须兼容**：现网小程序 `agentRunClient.js`/`aiTransportRouter.js` 在 Run API 上默认发送 `protocolVersion:"agent.v2"`（能力清单 `protocolVersions:["agent.v1","agent.v2"]` 为权威源）。初版实现将其误判 unsupported 导致 `test-agent-platform-http` 全链 400——属生产回归级缺陷，已在门禁捕获后修复（LEGACY_PROTOCOL_VERSIONS）。additive 应答字段对现有客户端安全：旧 Run 客户端只消费 runId/events/result，不校验响应 protocolVersion。

### 2.2 交付语义

服务端至少一次可重放 + 客户端按 eventId/sequence 幂等消费 = 用户状态不重复、不回退。

- 同一 Run 内 sequence 严格单调递增（服务端计数器，不用时间戳）；
- 客户端保存最后确认 cursor，断线重连携带 cursor 只取其后事件；
- reducer 幂等：`duplicate_eventId`（同 eventId 不重放）、`stale_sequence`（旧 sequence 不倒退）、`after_terminal`（终态吸收态，completed/degraded/failed/cancelled 互不改写）、`out_of_order_gap`（跳跃仍推进但如实记录诊断，必要时重新拉权威快照）；
- 终态结果可经 `recoverFinalResult` 在断线前后恢复；取消端到端：客户端 cancel → 服务端 AbortSignal → `run.cancelled` 持久化；重复取消幂等（alreadyFinished）；网络失败**不伪造 cancelled**；completed 不可被 cancelled 覆盖。

### 2.3 事件持久化与深重放

- 事件经 Repository（store）接口持久化：integrated=journal（文件）、standalone=PostgreSQL（`agent_run_events` 全量流），同一事件模型，无第二套；
- 内存投影（80 条环形窗口）是 read-your-writes 在线事实源；cursor 早于窗口下界时 `getRunViewDeep` 经 store 兜底合并（pg 全量流；journal 与投影同窗口，如实下界）；
- 服务重启：store 重放恢复保留窗口内 Run 与事件流；崩溃时非终态 Run 如实追加 `run.failed`/`RUN_EXECUTOR_LOST`（恢复+标记，不重复执行副作用）；eventId 跨重启稳定。

### 2.4 SDK 环境无关边界

`packages/agent-sdk` 不 require http/https/net/fs/child_process、不触碰 wx/DOM/globalThis.wx、不引用 `../server` 或任何校园业务符号（测试 C11 静态扫描逐文件强制）。传输/存储/时钟/日志全部注入，供 P6b 微信 Adapter 与任意宿主复用。

## 3. 测试证据（本机实际执行）

| 命令 | 结果 |
| --- | --- |
| `node tools/test-agent-run-protocol.js` | **PASS 18/18**：A1–A5 协商矩阵/错误分类/direct-chat 契约；B1–B5 稳定 eventId、严格递增、终态不可覆盖、cancel 幂等、无敏感键；C1–C3 journal 深重放合并（90 事件 afterSequence=5→`store+memory` 窗口下界 12 如实、无重复不倒退；afterSequence=88 投影直返）、重启 eventId 稳定+RUN_EXECUTOR_LOST（trial 口径，public 摘要按目录契约抹除 reasonCode）、store 字段同形；D1–D5 未知版本 400、agent 系版本 legacy 202、幂等键重放 executeTurn 仅一次、eventCursor/增量/终态结果恢复、cancel 不改写 completed |
| `node tools/test-agent-sdk.js` | **PASS 15/15**：S1–S4 状态机转换/四类幂等/窗口上限/HTTP 失败矩阵；C1–C10 全链（createRun 透传、poll cursor 推进、至少一次重放零重复应用、reconnect 不建第二 Run、跨客户端 storage 恢复 cursor、recoverFinalResult 终态/非终态、cancel 端到端+网络失败不伪造 cancelled、waitForTerminal 成功/超时/中止、storage DI、transport 注入、失败分类、未知 Run）；C11 静态边界扫描 |
| `node tools/test-agent-run-events.js` | PASS |
| `node tools/test-agent-platform-contracts.js` | PASS 7/7 |
| `node tools/test-agent-platform-http.js` | PASS（真实 HTTP 链；初跑捕获 agent.v2 协商回归，修复后全绿） |
| `node tools/test-agent-platform-production-wiring.js` | PASS |
| `node tools/test-agent-p5a-run-store.js` | PASS（三后端 parity + 真实 postgres 容器） |
| `node tools/test-agent-p5b-standalone.js` | PASS |
| `node tools/test-agent-performance-budget.js` | PASS（mock benchmark 口径） |

全量门禁链最终结果（2026-08-01 第二轮，第一轮捕获 test-agent-platform-http 跨轮污染后修复复跑）：

- `npm run test:agent-phase2`：全绿（含 regression runner 自动发现的 test-agent-run-protocol 18 项与 test-agent-sdk 15 项）。
- `npm run test:agent-release-gate`：全绿（含 test-server-docker-smoke 真实容器通过、release preflight）。
- `git diff --check`：干净。
- `npm run test:no-ai-secret-committed`：passed，无新增泄露。

## 4. 实现过程中发现并修复的缺陷

1. **runStateMachine 丢事件（自身新代码缺陷）**：`LEGAL_TRANSITIONS.running` 未含 `"running"` 自环，第二个普通事件即被判 `illegal_transition` 丢弃、cursor 停滞。修复为 running 允许保持 running，S1/C2 回归锁定。
2. **现网信封版本误判（生产回归级）**：见 §2.1。由 `test-agent-platform-http` 真实 HTTP 链捕获。
3. **p5a 三后端 parity 假失败**：eventId 为每实例随机值，跨后端 deepStrictEqual 不可比；按既有 `at`/`traceId` 惯例在投影层归一化，另加 `eventIdsPresent` 断言保证覆盖不削弱。
4. **test-agent-platform-http 跨轮污染（幂等真实化的必然暴露）**：该测试用固定 `idempotencyKey:"platform-http-idempotency"` 且全仓库无测试隔离 `FOSU_AGENT_RUN_STORE_PATH`（默认 `server/data/ai/run-store/` 跨进程持久）。idempotencyKey 真实转发后，上一轮遗留键被如实去重重放（pollToken 明文只在首发返回一次，P5a 既定安全语义），第二轮起 `create.body.pollToken` 为空。修复：测试进程启动时将 `FOSU_AGENT_RUN_STORE_PATH` 指向 mkdtemp 独立目录（hermetic），连续两轮复跑验证通过。此缺陷只有在「幂等从诊断升级为真实语义」后才会出现，属测试环境债而非生产语义缺陷。

## 5. 如实边界（未交付/不在本阶段）

- SSE 流式传输仅提供注入式 Adapter 接缝（`options.transport`），默认与唯一实装传输为 cursor polling；微信侧 Adapter 归 P6b。
- journal 后端深重放下界与投影同窗口（80 条）——pg 后端保留全量事件流；该差异为保留策略的如实语义，契约由 `store+memory` 合并路径承载。
- direct chat fallback 仅落地协议侧契约标记（`DIRECT_CHAT_COMPAT`）；客户端落地、退役门槛与 DevTools smoke 归 P6b。
- 小程序壳、UI Block 渲染、真机/体验版验证不在本阶段（P6b/P8）。
- 本阶段全部为本地自动化验证；staging live 与生产验证归 P8，不以 mock 冒充。

## 6. 回滚

单提交 revert 即可完整回退：SDK/协议包为新增目录与 additive 字段，服务端三处改动向后兼容（旧客户端忽略新字段；idempotencyKey 转发恢复服务端既有幂等语义）。回滚后 Run API 行为回到 P5c 基线。
