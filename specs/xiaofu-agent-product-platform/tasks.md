# 小佛助手 Agent 产品平台实施任务

> 本清单连接 [`requirements.md`](./requirements.md) 与 [`design.md`](./design.md)。
> 每个 P 阶段必须完成 RED→GREEN→REFACTOR、相关门禁、独立 Commit 和回滚说明后才进入下一阶段。
> 2026-07-30 路线修订：新增 P2R；P4 拆分为 P4a–P4e；P5 拆分为 P5a–P5c；P6 拆分为 P6a/P6b；P7 收缩为 P7a（P7b/P7c deferred）。
> 治理规则见 [`execution-governance.md`](./execution-governance.md)；术语见根目录 `CONTEXT.md`；架构边界见 `docs/adr/0006`、`docs/adr/0007`。

## 已完成

- [x] P0：审计与真实调用链基线
  - 创建 `docs/xiaofu-agent/product-platform-audit.md`。
  - 锁定 `origin/main@c3eae848`，运行 14 步 release gate。
  - 独立提交：`32712842`。
  - _Requirements: 审计前置要求_

- [x] 设计：方案 A 与需求/技术设计
  - 形成 R1–R11、Composition API、Repository、策略、Memory、控制面、RAG、部署和 UI 设计。
  - 独立提交：`1e5d047b`。
  - _Requirements: R1–R11_

## P1 — 通用包边界与真实生产接线（已完成）

- [x] 建立 npm workspace 与 `agent-protocol`、`ui-schema` 的可执行契约。
- [x] 建立真实 `skill-runtime`、`tool-runtime`，实现声明式 registry、五因子交集与 exact-match。
- [x] 建立 `plugins/fosu-campus`，由 Composition Root 注入现有 Manifest 和校园事实 Tool。
- [x] 建立 `packages/agent-runtime`，由它拥有 Context/Decision/Skill-Tool/Verification/Response 阶段顺序和阶段 Trace。
- [x] 建立 `apps/agent-server`，让 `/agent/runs`、旧 chat/agui 兼容入口汇入同一 Runtime。
- [x] 建立 `apps/agent-admin` 的真实 topology/readiness/trace 接口并由现有 Admin 挂载。
- [x] 让 agent.v2 输出通用 UI blocks，同时保持 agent.v1 可观察行为。
- [x] 更新 Docker/CI/package hygiene，使生产容器包含并加载 workspaces。
- [x] 用 HTTP + Trace 测试证明新 packages/apps/plugin 的真实顺序，运行全部现有门禁并提交 P1。
  - _Requirements: R1, R4.4, R4.7–R4.8, R10.4, R11.1, R11.4, R11.7_
  - 注：R4.5（小程序消费 12 种 block）与 R4.6（新 Skill 免改客户端）原误映射至 P1，2026-07-30 修正归 P6，不标记完成。

## P2 — strict_model_first、统一 Decision 与性能（已完成，遗留见 P2R）

- [x] 建立 `packages/provider-runtime`，迁入 Provider Adapter、连接池、attempt、熔断与 probe。
- [x] 实现三种 executionPolicy；public 强制 deterministic，trial/dev 默认 strict_model_first，adaptive 显式开启。
- [x] 将 Understanding 与 Planner 合为一次 DecisionContract V2 调用；移除 strict 下规则先决定 Goal 的路径。
- [x] 校验 allowedSkillIds 与五因子 Tool 集合，拒绝任意模型 Tool 名。
- [x] 实现总 Deadline、阶段预算、AbortSignal 和一次受控 fallback。
- [x] 持久记录真实 first provider、fallbackPath 与六阶段 timing。
- [x] 建立三 Provider mock conformance、strict-first 证明、public 零 attempt 与性能基准。
- [x] 运行相关门禁并提交 P2。
  - _Requirements: R2, R3, R10.2, R11.2, R11.4, R11.6_
  - 已知偏差（不回填勾选，由 P2R 关闭）：plan.steps 只校验不消费；fallback 不区分可回退错误；R3.7 分位数未按 outcome 分离。
  - 旧 `modelPlanner`/`understandingService` 模型路径标记 compatibility-only / deprecated candidate：不删除、不扩展、新代码不得依赖；退役门槛见 P6b。

## P3 — ContextAssembler 与成熟 Memory（已完成）

详细验收标准：[`p3-acceptance.md`](./p3-acceptance.md)。Evidence：`docs/xiaofu-agent/product-platform-p3-evidence.md`。

- [x] 建立统一 ContextAssembler，贯穿 Decision、Tool 与 Response。
- [x] 实现持久 MemoryItem、EpisodicMemory、MemoryPolicy 和滚动摘要。
- [x] 实现本地零外部 semantic encoder、hybrid retrieval 与确定性 rerank。
- [x] 实现 supersede、冲突消解、TTL、scope、term/release invalidation。
- [x] 实现查看、修改、删除、清空、暂停、恢复和导出 API。
- [x] 明确 local_only/session_state/cloud_sync，并验证跨设备/跨会话恢复。
- [x] 增加 50+ 多轮 fixture 和 100 Turn 验收，运行 Phase 2/3 与完整门禁并提交 P3。
  - _Requirements: R5, R10.1–R10.2, R11.3_

附加验收（2026-07-30 grilling 确认，全部纳入 P3 提交）：H1 clear-all revision 闭环；H2 recentTurns 跨设备恢复（客户端边界规范化 + 生产形状契约测试）；M1 单 Turn 单次原子记忆提交与冲突重算；M3 滚动摘要保留工具轨迹与 pending 状态；M4 Memory-to-Provider 双层防护（ADR-0006）；M5 delete/edit/pause 的 refresh-on-conflict；Low×6（客户端死分支与 Mock 保真、404 统一、canonical 字段、TTL 类别化、explicit/pause 语义、verification fail-closed）。

提交边界：暂存区 + 互锁未暂存文件 + 全部修复，单提交 `feat(agent): complete P3 mature memory runtime`；回滚整体撤回 P3，不破坏 P0–P2；v2 加密数据文件不通过删除回滚。

## P2R — Decision 计划真实性、fallback 分类与性能指标回补

详细验收标准：[`p2r-acceptance.md`](./p2r-acceptance.md)。Evidence：`docs/xiaofu-agent/product-platform-p2r-evidence.md`。

- [x] plan.steps 经 Schema 校验与五因子交集后真实影响 resolvedPlan；planBuilder 不得无条件丢弃合规模型计划；Trace 区分 proposedPlan/resolvedPlan 及改写原因。
- [x] 建立单一 retryability / fallback eligibility 分类函数，Provider Runtime、Decision、Response 共用；配置类 4xx fail fast 不 fallback；fallback 每 Turn 至多一次且共享总 Deadline。
- [x] outcome-aware 性能指标：stage × outcome（success/failed/cancelled/degraded）× executionPolicy × usedFallback × taskComplexity；success-only 与 all-runs P50/P95 分离；首事件延迟独立统计；低基数标签。
- [x] 运行相关门禁并提交 `fix(agent): close P2 decision and fallback truth gaps`。
  - _Requirements: R2.4, R2.6, R3.5, R3.7_
  - 不含：P3 记忆实现、P4 热发布、旧 Planner 删除。P2R 完成前不得开始 P4。

## P4 — 热发布控制面、MCP 与 RAG（拆分为 P4a–P4e）

统一发布链：draft → validate → test → publish → immutable configVersion → 新 Run 原子绑定快照 → hot reload → rollback。六域共用一套 Artifact/ConfigSnapshot 基础设施；禁止每域各建发布状态机；禁止草稿进生产；禁止回滚只改后台状态。

### P4a — Artifact Repository and Config Publication Kernel

- [x] Artifact/ConfigSnapshot Repository + 统一发布状态机 + configVersion + environment scope + 审计。
- [x] createRun 原子绑定不可变快照；Run 内快照稳定；发布/回滚只影响新 Run；publish pointer 原子切换。
- [x] validate/test 失败不更新生产 pointer；rollback 只切已验证历史版本；热加载失败保持最近有效配置；重启恢复。
- [x] 最小 Skill 参考 Adapter 证明通用协议（不据此宣称其他域完成）。
- [x] Evidence：`docs/xiaofu-agent/product-platform-p4a-evidence.md`。提交：`feat(agent): add versioned config publication kernel`。
  - _Requirements: R6.1–R6.3, R10.2_

### P4b — Core Domain Hot-Publish Adapters

- [x] Provider、Skill、Tool、Memory 四域分别接入 P4a 内核：声明式 Schema、validate、test、publish、hot reload、rollback、审计、environment scope、失败保留最近有效版本。
- [x] Provider：密钥只存引用，不进 Artifact/Trace/导出；public 外部调用恒 0。
- [x] Skill：禁止上传执行任意 JS；只允许引用 Manifest 允许的 Tool。
- [x] Tool：不得绕过五因子交集与 Guardrail。
- [x] Memory：策略发布不影响在途 Run；不得经策略接口暴露用户记忆原文。
- [x] 统一 domain adapter conformance suite，四域各跑同一契约测试 + 各自专项。
- [x] Evidence：`docs/xiaofu-agent/product-platform-p4b-evidence.md`。提交：`feat(agent): hot-publish core runtime domains`。
  - _Requirements: R6, R11.5_

### P4c — Governed MCP Runtime and Publication

- [x] `packages/mcp-runtime`：Streamable HTTP 优先、受控 stdio（白名单命令，无任意 shell）、注册、鉴权、工具发现、Schema 缓存、scope、超时取消、写确认。
- [x] MCP 发现的 Tool 必须进入 Manifest/权限/Schema 校验链；写操作进 confirmation/ActionReceipt 闭环。（桥接描述符 + 真实五因子一致性测试；生产激活属 P4e 按环境启用，见 evidence §1.3）
- [x] Server 更新只影响新 Run；不可用必须准确降级；鉴权信息不进 Artifact/Trace/导出。
- [x] 收口 `tools/fosu-kb-mcp` 治理（只走受保护后台 API，不注册 publish/rollback 工具）。
- [x] Evidence：`docs/xiaofu-agent/product-platform-p4c-evidence.md`。提交：`feat(agent): add governed MCP runtime`。
  - _Requirements: R7.1–R7.4, R10.3_

### P4d — Versioned Hybrid RAG Runtime

- [ ] `packages/rag-runtime` 权威实现：文件/受控网页摄取（SSRF 防护）、解析、清洗、分块、BM25、deterministic local encoder（ADR-0007）、融合、确定性 rerank、引用、版本发布/回滚。
- [ ] Encoder 单源抽取，semanticMemory 与 RAG 共用；对照测试证明 P3 记忆检索不回归。
- [ ] 草稿索引对生产查询不可见；publish pointer 原子切换；rollback 只切已验证版本；重启恢复；索引构建进受控 worker/队列，不阻塞在线 Run。
- [ ] golden query set：lexical / vector / hybrid / hybrid+rerank 四组对照，Recall@K、MRR、引用正确率、空答案正确率；本地 encoder 提升幅度如实报告。
- [ ] 结构化校园事实继续走 Tool（负向测试锁定）。
- [ ] Evidence：`docs/xiaofu-agent/product-platform-p4d-evidence.md`。提交：`feat(agent): add versioned hybrid RAG runtime`。
  - _Requirements: R7.5–R7.8, R10.2–R10.3_

### P4e — Agent Control Plane and Runtime Evidence

- [x] `apps/agent-admin` 六域配置页面 + draft/validate/test/publish/rollback 操作 + 版本历史 + environment scope。
- [x] Run Trace/Eval：runId、executionPolicy、configVersion、各域 Artifact 版本、intendedProvider/actualFirstProvider、fallbackPath、Goal、selectedSkill、Tool/Verification 状态、阶段耗时、outcome。不显示密钥/完整 Prompt/隐藏推理/记忆原文。
- [x] 后台只消费 P4a–P4d 真实 API；无 mock 数据；浏览器端完成发布→新 Run 生效→回滚闭环验收。
- [x] Evidence：`docs/xiaofu-agent/product-platform-p4e-evidence.md`。提交：`feat(agent): add runtime-backed agent control plane`。
  - _Requirements: R6, R7, R10.2–R10.3, R11.5_

## P5 — 一体化与 Standalone 双部署（拆分为 P5a–P5c）

### P5a — Standalone Durable Storage

- [x] Repository/Adapter 接口（P4a 定义）的 PostgreSQL 实现：Artifact/ConfigSnapshot、发布状态、Provider/Skill/Tool/MCP/RAG/Memory 配置元数据、会话与长期记忆、Working State、Run 元数据与最终状态、RunEvent durable store、审计、RAG 文档/分块/版本/引用、pgvector、异步任务幂等记录。
- [x] 版本化 migration（可重复检测、版本可查、不兼容 schema 不启动）；expand-contract。
- [x] Redis Streams + Consumer Group + ACK + pending reclaim + 幂等 jobId + 有界重试 + dead-letter；Redis 永不做权威事实源。
- [x] 文件 Adapter 与 PostgreSQL Adapter 跑同一 Repository conformance suite。
- [x] Evidence：`docs/xiaofu-agent/product-platform-p5a-evidence.md`。提交：`feat(agent): add standalone durable storage adapters`。
  - _Requirements: R8.1–R8.3, R10.4_

### P5b — Standalone Service Topology

- [x] 单 `fosu-agent-platform` 镜像四角色（server/worker/admin/migrate；compose 默认 admin 面与 server 合一部署，角色分离仅为可扩展预留）；`deploy/standalone/docker-compose.yml` + `.env.example` + 命名卷 + 内部网络。
- [x] 依赖顺序：postgres/redis healthy → migrate completed → server/worker/admin。
- [x] liveness/readiness/startup 分离；readiness 区分 postgres/redis/migration/artifact/config/worker queue/RAG backend/Provider/published configVersion。
- [x] 无 fosu-campus 插件可独立运行（Admin、声明式 Skill、受控 Tool/MCP、知识库、Run、RunEvent、UI Schema、内置只读示例 Skill）；插件经只读卷/数据同步注入。
- [x] Provider 未配置：health 可 healthy，readiness 如实 not ready；不用 Mock 冒充生产 Provider；凭据只经环境变量/Secret 注入。
- [x] worker 职责边界：RAG 摄取/索引（已落地并经 smoke 验证）；golden 验证/发布前测试/Eval/维护清理归入 worker 的接缝已立（kind 白名单，未知 kind 明确 reject 进 dead-letter），任务生产者随对应域成熟接入；主聊天链不无条件异步化。
- [x] 备份/恢复/升级/回滚文档；不用 floating latest 作生产依据。
- [x] Evidence：`docs/xiaofu-agent/product-platform-p5b-evidence.md`。提交：`feat(agent): add standalone platform deployment`。
  - _Requirements: R8, R10.4, R11.6_

### P5c — Multi-Architecture Delivery

- [ ] buildx 构建 linux/amd64 + linux/arm64；两架构各自 build + standalone smoke 通过后发布同 SHA manifest；标签含 commit SHA；记录 digest。
- [ ] 本机 Docker Desktop 可用则本地 amd64 smoke；arm64 与 manifest 归 CI（build verified ≠ smoke verified，如实标注）。
- [ ] 1Panel / Oracle ARM 部署文档；外部开发者快速启动文档。
- [ ] Evidence：`docs/xiaofu-agent/product-platform-p5c-evidence.md`。提交：`build(agent): publish multi-architecture platform image`。
  - _Requirements: R8.4–R8.7, R11.6, R11.8_

## P6 — 通用 Agent SDK 与微信稳定壳（拆分为 P6a/P6b）

### P6a — Recoverable Run Protocol and Agent SDK

- [ ] `packages/agent-protocol`：RunEvent 标准结构、UI Schema、protocolVersion、能力协商、cursor/sequence、cancel、result recovery、错误分类、旧协议兼容契约。
- [ ] `packages/agent-sdk`：环境无关 Run 状态机（createRun/poll/SSE adapter/reconnect/resumeFromCursor/cancelRun/recoverFinalResult/幂等 reducer/依赖注入）；不依赖 wx、DOM、Node HTTP 或 Fosu 业务。
- [ ] 服务端 RunEvent 可恢复：立即返回 runId、稳定 eventId、严格单调 sequence（不用时间戳）、按 cursor 重放、终态不可覆盖、事件持久化经 Repository 接口（integrated 文件/SQLite，standalone PostgreSQL，同一模型）。
- [ ] 交付语义：服务端至少一次可重放 + 客户端幂等消费 = 状态不重复不回退；取消端到端真实传播。
- [ ] Evidence：`docs/xiaofu-agent/product-platform-p6a-evidence.md`。提交：`feat(agent): add recoverable run protocol and agent sdk`。
  - _Requirements: R4.1–R4.3, R10.2_

### P6b — Miniprogram Agent Shell and UI Block Runtime

- [ ] 小程序 SDK Adapter（wx.request/流式/cursor polling/storage/网络监听/生命周期/协议协商）。
- [ ] 12 类通用 UI Block renderer（text/markdown/plan/tool_progress/list/detail/schedule/clarification/confirmation/action_receipt/warning/error）；未知 Block 安全 fallback。
- [ ] ai-assistant 绞杀式迁移：传输/事件归并/恢复/取消抽离，页面只留生命周期/输入/组合/导航；不同时保留两个活跃 Run 状态源；不伪造执行状态。
- [ ] Fosu 卡片经插件 mapper 映射为通用 Block；通用 SDK 不硬编码佛大字段。
- [ ] 新增声明式测试 Skill 小程序零改动即可渲染（R4.5/R4.6 在此验收）。
- [ ] direct chat fallback 标记 compatibility-only/deprecated：仅协议协商或显式开关触发、不伪造状态、记录原因；退役门槛（新 API 全覆盖 + 旧量归零 + DevTools/真机通过 + release-gate 绿）达成前不删。旧 modelPlanner 同门槛退役。
- [ ] DevTools smoke：探测 CLI 可用且已登录则真实执行；否则如实标未验证 + 交付人工验收清单与证据模板。真机/体验版归 P8 人工。
- [ ] Evidence：`docs/xiaofu-agent/product-platform-p6b-evidence.md`。提交：`refactor(miniprogram): adopt agent sdk and ui block shell`。
  - _Requirements: R4.5–R4.6, R11.6–R11.7_

## P7 — Engine Adapter（仅 P7a；P7b/P7c deferred）

### P7a — Engine Contract and Fosu Conformance

- [ ] `AgentEngineAdapter` 单一权威契约（engineId/version/capabilities/readiness/createRun/resume/cancel/probe/shutdown/conformance metadata；统一受控依赖注入；统一归一化输出）。
- [ ] Engine Registry：服务端受控选择（defaultEngine/allowedEngines/environment scope/feature flag/readiness/conformance status/experimental 标记/rollback）；public 恒 Fosu Engine；未过 conformance 不得默认；Run 创建绑定 Engine 版本。
- [ ] Fosu Engine 真实经 Adapter 接入生产链（Trace 证明），行为不变，全部门禁通过。
- [ ] Engine conformance suite（22 项，见 p7a 验收）；Fosu Engine 首先完整通过。
- [ ] OpenAI/Pi Adapter：仅研究文档、依赖与许可证审计、API 映射、缺口与完成条件；不实现、不加依赖、不写空 Adapter。
- [ ] Evidence：`docs/xiaofu-agent/product-platform-p7a-evidence.md`。提交：`refactor(agent): introduce engine adapter contract`。
  - _Requirements: R9, R10.2–R10.3, R11.1_

### P7b — OpenAI Agents SDK Adapter（deferred）

- 状态：deferred / not implemented。重启门槛：P3–P7a 全部完成、release-gate 全绿、双部署 smoke 完成、真机验收无 Critical/Important、时间与预算充足、用户再次明确授权。

### P7c — Pi Agent Core Adapter（deferred）

- 状态：deferred / not implemented。同 P7b 门槛，另加宿主能力隔离测试（无 bash/read/write/edit）。

## P8 — 收敛、文档、镜像与 Draft PR

- [ ] 更新开发者 Provider/Skill/Tool/MCP/RAG/UI Client 示例和开源使用文档。
- [ ] 执行全部 AGENTS 门禁、故障矩阵、性能基准、密钥/许可证扫描和容器 smoke。
- [ ] 生成并记录 SHA 镜像/manifest 证据；不可用环境不得用 mock 替代。
- [ ] 执行独立代码复审并修复所有 Critical/Important。
- [ ] 真机/体验版人工验收（P6 交付的清单与模板）；未验证项如实标注。
- [ ] push 分支并创建 Draft PR，等待全部 CI；CI 全绿且独立复审无 Critical/Important 后按合并门禁处理；不绕过分支保护。
- [ ] 部署按 execution-governance.md 的备份/回滚/观察门禁执行；无备份回滚路径则记录 blocker 禁止自动生产部署。
- [ ] 输出按代码/mock/staging/容器/CloudBase/体验版/真机/生产区分的最终报告；记录生产 SHA、镜像 digest、configVersion、回滚版本。
  - _Requirements: R8.6–R8.7, R11_
