# 小佛助手 Agent 产品平台需求规格

> 状态：已批准（方案 A：共享 Composition Root 的端口/适配器式模块化单体）
> 日期：2026-07-30
> 基线：`origin/main@c3eae84881bbda121d35776018b6d85a9162260e`

## 1. 问题与范围

现有小佛助手已经具备校园确定性工具、Release Pack、ActionReceipt、Provider、Memory、RAG、RunEvent 与后台基础，但在线执行仍由 `server/src/services/ai/agentService.js` 私有编排，运行于 `fosuclass-api` 单进程；模型调用、事件持久化、配置热发布、长期记忆和独立部署均未形成可证明的平台闭环。

本规格要求在同一 monorepo 内进行绞杀式迁移，形成可被 FosuClass 一体化容器和独立 `fosu-agent-platform` 镜像共同使用的通用 Agent 平台。迁移必须保留现有微信协议兼容、校园事实权威源、安全边界和 public 零外部模型约束。

## 2. 用户故事

- 作为微信用户，我希望每次请求立即获得真实 `runId` 与服务端事件，并能在断网重连后继续恢复结果。
- 作为 trial/dev 用户，我希望每个通过安全守卫的 Turn 首次语义决策确实由配置的 Provider 产生，而不是由规则伪装成模型理解。
- 作为 public 用户，我希望校园事实仍由确定性工具给出，且任何请求都不会调用外部模型。
- 作为管理员，我希望通过版本化控制面发布 Provider、Skill、Tool、MCP、RAG 和 Memory 配置，并能看到真实执行版本、测试结果和回滚点。
- 作为用户，我希望助手跨设备、跨会话记住相关稳定信息，同时允许我查看、修改、暂停、删除和导出记忆。
- 作为外部开发者，我希望不依赖 FosuClass 业务即可启动平台，并通过声明式插件扩展 Provider、Skill、Tool、MCP、知识库和 UI Client。
- 作为运维人员，我希望在 amd64 与 arm64 环境部署同一 SHA 镜像，并能够健康检查、迁移、备份、升级和回滚。

## 3. 全局不变量

1. Release Pack、全校课表索引、受控个人课表摘要和校园确定性工具始终是校园事实唯一来源。
2. 生成式模型不得补全、覆盖或改写工具事实；课表数据不得被 RAG 向量库替代。
3. public 的外部 Provider 调用次数在所有成功、失败、重试和后台路径上均为零。
4. 线上语义决策核心只有一套通用 Agent Runtime；旧入口只能转发至同一 Run API。
5. 每类运行状态在一次部署中只有一个权威 Repository，不允许新旧状态双写后各自读取。
6. 后台不得上传并执行任意 JavaScript；代码插件只能随受审计镜像发布，后台只发布声明式配置。
7. Trace 不记录密钥、凭据、完整个人课表、原始工具结果、系统提示或隐藏推理。
8. 未经人工授权不得生产部署、正式 CloudBase 发布、上传体验版、自动合并 `main` 或执行不可逆数据破坏。

## 4. 验收需求

### R1 — 唯一生产调用链与包接线

- R1.1 当微信客户端创建 Run 时，系统应真实经过 `apps/agent-server`、`packages/agent-runtime`、Decision、Skill/Tool、Verification、RunEvent 和 `packages/ui-schema` 后返回结果。
- R1.2 当旧 `/agent/chat` 或 `/agent/agui` 被调用时，兼容层应创建同一类 Run 并消费同一事件源，不得调用第二套 Agent Kernel。
- R1.3 当通用 Runtime 启动时，Fosu 校园能力应由 `plugins/fosu-campus` 注入；通用包不得导入佛大名称、课表路由或 Release Pack 固定路径。
- R1.4 当功能从旧服务迁出后，对照测试应证明新旧可观察行为一致；随后旧编排应被删除或降为只调用新 Runtime 的兼容门面。
- R1.5 当检查新增目录时，每个要求的 package/app/plugin 都应被生产 Composition Root 或实际客户端直接导入，不得仅包含 re-export、空接口或永远关闭的分支。

### R2 — 执行策略与统一 Decision

- R2.1 当 Runtime Mode 为 public 时，系统应强制 `deterministic` 策略并拒绝任何外部 Provider attempt。
- R2.2 当 Runtime Mode 为 trial 或 dev 且管理员未显式覆盖时，系统应采用 `strict_model_first`。
- R2.3 当安全守卫允许 strict Turn 时，第一个语义决策应是一次真实 Provider 结构化 Decision 调用。
- R2.4 当策略为 strict 时，规则只能执行规范化、Schema 校验、权限交集和受控 fallback，不得先确定 Goal、Skill 或计划。
- R2.5 当管理员显式选择 adaptive 时，高置信简单任务可走确定性快路径，并应在 Trace 中记录实际来源。
- R2.6 当 Decision 成功时，输出应同时包含 GoalContract V2、实体、约束、Skill 候选和计划骨架。
- R2.7 当模型返回 Tool 候选时，Runtime 应只接受 Manifest、Skill、Runtime Mode、Environment 与 Safety 五因子交集中的精确 Tool 名称，并再次校验参数 Schema。
- R2.8 每个 Run Trace 应记录 `executionPolicy`、`intendedProvider`、`actualFirstProvider`、`decisionSource`、`goal`、`selectedSkill`、`fallbackPath` 和每次 Provider attempt。

### R3 — 性能、Deadline 与故障语义

- R3.1 当 Run 被接受时，API 应立即返回 `runId`，首个真实 RunEvent 的 P95 应不超过 500ms。
- R3.2 在基准环境中执行简单任务时，总耗时 P95 应不超过 6 秒。
- R3.3 在基准环境中执行多工具任务时，总耗时 P95 应不超过 12 秒。
- R3.4 对任何在线 Turn，服务端硬 Deadline 应不超过 15 秒，并通过单一 `AbortSignal` 传播至 Provider、Tool、MCP 和 RAG。
- R3.5 当主 Provider 超时或收到可回退错误时，系统最多执行一次受控 fallback，所有 attempt 共享剩余 Deadline，不得顺序吃满完整超时。
- R3.6 Provider HTTP 客户端应启用 keep-alive 与连接复用，并按 Decision、Tool、Verification、Response 分配阶段预算。
- R3.7 Trace 聚合应分别计算 `createRun`、`decision`、`tool`、`verification`、`response` 和 `total` 的成功、失败、取消、fallback P50/P95。

### R4 — Run、RunEvent 与 UI 协议

- R4.1 当客户端使用同一 principal 和 `idempotencyKey` 重试创建请求时，系统应返回同一 Run，而不是重复执行。
- R4.2 当客户端携带最后 sequence 重连时，系统应返回后续事件；进程重启或切换实例后仍应恢复未过期事件和最终结果。
- R4.3 当用户取消 Run 时，系统应持久记录取消并传播 AbortSignal；取消后不得发布伪造的成功终态。
- R4.4 RunEvent 应具有单调 sequence、稳定 eventId、协议版本、configVersion、时间戳和安全公开 payload。
- R4.5 小程序 SDK 应消费 `text`、`markdown`、`plan`、`tool_progress`、`list`、`detail`、`schedule`、`clarification`、`confirmation`、`action_receipt`、`warning` 与 `error` UI block。
- R4.6 当新增 Skill 只输出既有 UI block 时，小程序不应需要新增业务分支或重新发布。
- R4.7 客户端只应根据真实 RunEvent 展示 Understanding、Verification 和 Completed 状态，不得猜测或伪造。
- R4.8 agent.v1 客户端应继续得到兼容 payload；agent.v2 及新版 SDK 应通过显式版本协商使用通用 blocks。

### R5 — Context 与长期记忆

- R5.1 每次 Decision 应由统一 ContextAssembler 提供最近 8–12 条消息、滚动摘要、Working State、pending clarification/action、相关长期记忆、成功任务 episode、当前页面、日期、教学周和课表目标。
- R5.2 当对话超过 100 Turn 时，滚动摘要与长期记忆应仍能恢复早期已确认且当前相关的信息。
- R5.3 当用户在新会话或另一设备登录并启用 cloud_sync 时，系统应按相关度恢复稳定偏好和可复用 episode。
- R5.4 当用户说“不是 A，是 B”时，新条目应以 `supersedes` 指向 A，A 不再作为 active truth 被检索。
- R5.5 当学期或 Release Pack 变化时，具有相应 provenance/scope 的课表相关记忆应自动失效；无关稳定偏好不受影响。
- R5.6 长期记忆条目应持久化 provenance、confidence、TTL、scope、supersedes、状态、创建/更新时间与版本边界。
- R5.7 当检索记忆时，系统应执行语义向量与 lexical 混合召回并按策略 rerank，只注入最相关且未过期的最小集合。
- R5.8 用户应能查看、修改、删除、清空、暂停和导出自己的长期记忆；所有操作应受 principal、审计和并发版本约束。
- R5.9 `local_only` 不应声称云同步；`session_state` 只持久化会话状态；`cloud_sync` 必须由用户显式开启。
- R5.10 系统不得长期保存完整课表、天气快照、原始工具结果、凭据、系统提示或隐藏推理。

### R6 — 统一配置发布与后台真实控制

- R6.1 Provider、Skill、Tool、MCP、RAG 和 Memory 配置应共享 `draft → validate → test → publish → hot reload → rollback` 状态机。
- R6.2 每次发布应产生不可变 `configVersion`、审计记录、环境范围、发布者、测试证据和回滚点。
- R6.3 当配置发布成功时，新 Run 应无需重建镜像即可绑定新版本；进行中的 Run 应继续使用创建时固定的快照。
- R6.4 当回滚发生时，后续 Run 应绑定目标历史版本，历史 Run 的版本引用不得被改写。
- R6.5 后台显示的 Provider/Skill/Tool/MCP/RAG/Memory 状态应来源于实际配置快照和 Run Trace，而非仅来自表单或进程环境变量。
- R6.6 Provider 控制面应支持 primary、fallback、阶段模型、真实 probe、attempt 延迟、错误率和熔断状态，且不得泄露密钥。
- R6.7 Skill 应使用声明式 Schema、允许 Tool 集合、测试样例、发布和回滚，不得加载后台上传的 JavaScript。
- R6.8 MCP 应支持 Streamable HTTP 和受控 stdio、鉴权引用、工具发现、环境 scope、超时、只读/写分类和写操作确认。

### R7 — RAG 产品能力

- R7.1 当管理员上传支持的公开文件或提交允许的网页 URL 时，系统应执行安全获取、解析、分块和草稿版本生成。
- R7.2 当 RAG 版本测试时，系统应同时执行 BM25、向量召回、融合 rerank 和引用验证。
- R7.3 当 RAG 版本发布或回滚时，lexical 与 vector 索引应原子切换到相同内容版本，不得出现新文本配旧向量。
- R7.4 回答使用 RAG 时，应返回可公开的引用信息；引用不可包含内部路径、凭据或受限内容。
- R7.5 课表、教师、教室、课程和教学周等结构化事实应继续调用 Tool，不得被知识库答案替代。
- R7.6 网页摄取应阻止本机、私网、元数据地址、重定向逃逸和超限内容；联网结果只能进入草稿。

### R8 — 双部署与开源复用

- R8.1 FosuClass 一体化镜像应在一个容器内运行现有业务 API、Agent Runtime 和 Admin，并复用同一 Composition API。
- R8.2 独立 `fosu-agent-platform` 镜像应在脱离 FosuClass 主业务后，通过配置 Provider、Skill、Tool、MCP、知识库和 UI Client 独立运行。
- R8.3 `deploy/standalone/docker-compose.yml` 应提供 agent-server、agent-worker、Postgres/pgvector 与 Redis，并配置健康检查、持久卷和启动依赖。
- R8.4 一体化和独立镜像应以同一 SHA 发布 linux/amd64 与 linux/arm64 多架构 manifest。
- R8.5 两种模式都应通过真实 arm64 容器 smoke；amd64 构建与启动也应验证。
- R8.6 仓库应提供 `.env.example`、迁移、备份、升级、回滚、1Panel 和 Oracle ARM 文档，且不包含真实密钥。
- R8.7 外部开发者文档应提供可运行的 Provider、Skill、Tool、MCP、知识库插件和 UI Client 示例。

### R9 — Engine Adapter

- R9.1 Runtime 应定义 AgentEngineAdapter 契约，并将迁移后的 Fosu Runtime 作为默认实现。
- R9.2 OpenAI Agents SDK JS 与 Pi Agent Core Adapter 只应在核心平台验收后接入，并通过 feature flag 选择。
- R9.3 每个实验 Adapter 应真实执行至少一个只读测试 Skill，并使用相同 Tool、Memory、RAG、RunEvent、Guardrail 和 UI Schema。
- R9.4 Pi Adapter 面向微信用户时不得注册 bash、read、write 或 edit 等本地系统工具，也不得复制整个 Pi 仓库。
- R9.5 未完成 conformance 与只读执行证据的 Adapter 不得成为默认 Engine。

### R10 — 安全、兼容与事实完整性

- R10.1 服务端应从已验证 Session 派生 principal，不得把客户端 conversationId 当作用户身份。
- R10.2 Provider 上下文应经过脱敏和预算裁剪，不得包含管理员 Token、完整个人课表、系统提示或内部部署信息。
- R10.3 ActionReceipt、写 Tool、MCP 写操作和高风险知识发布应继续要求确认、细粒度 scope、幂等、审计和回滚。
- R10.4 Release Pack 的版本校验、静态回退、缓存与 last-known-good 应保持；加载失败时不得清空上一份可用数据。
- R10.5 `competition` 配置只能映射到规范 Runtime Mode，不得形成第四种策略。

### R11 — 测试、证据与交付

- R11.1 每个 P1–P8 阶段应遵循 RED→GREEN→REFACTOR，并形成独立可回滚 Commit。
- R11.2 strict_model_first 测试应证明真实第一 Provider attempt；三种 Provider mock 应通过相同 Decision conformance，凭据存在时另行执行 staging live。
- R11.3 记忆测试应覆盖不少于 50 个多轮场景，并包含 100 Turn、纠正、指代、省略、跨设备、跨会话和版本失效。
- R11.4 Tool 测试应覆盖精确名称、Schema、Manifest 五因子交集和越权拒绝。
- R11.5 控制面测试应证明 MCP/RAG/Memory/Skill 热发布和回滚后真实 Run 无需重建镜像即采用新版本。
- R11.6 故障测试应覆盖断网、429、Provider 超时、取消、Redis 故障、数据库故障和一次 fallback 上限。
- R11.7 所有现有 Agent 门禁与 AGENTS.md 指定命令应保留并通过；不得删除安全检查或弱化断言。
- R11.8 Draft PR 创建前应完成密钥扫描、依赖/许可证检查、SHA 镜像构建证据与独立代码复审。
- R11.9 CI 全绿且独立复审无 Critical/Important 后方可转 Ready；不得自动合并或生产部署。
- R11.10 最终报告应分别列出代码、mock、staging、容器、CloudBase、体验版、真机和生产状态，未知或未执行项必须写明。

## 5. 非目标

- 不把生成式模型变成校园事实源。
- 不在本阶段自动部署生产、发布 CloudBase、上传微信体验版或合并 main。
- 不允许通过后台上传通用 JavaScript/Node 包并在运行时执行。
- 不为了引入 Engine Adapter 而复制 OpenAI 或 Pi 的完整运行时仓库。
- 不以目录存在、类型声明、mock 成功或关闭的 feature flag 作为平台完成证据。

## 6. 完成定义

只有当 R1–R11 均有当前代码、测试、Trace、容器或 CI 的直接证据，要求的目录被真实生产链引用，两种部署均可启动，Draft PR CI 全绿且独立复审无 Critical/Important 时，本 Goal 才可声明完成。外部凭据导致的 staging 未验证必须单列，但不得阻塞其余可在仓库内完成的代码与 mock conformance。
