# 小佛助手 Agent 产品平台实施任务

> 本清单连接 [`requirements.md`](./requirements.md) 与 [`design.md`](./design.md)。
> 每个 P 阶段必须完成 RED→GREEN→REFACTOR、相关门禁、独立 Commit 和回滚说明后才进入下一阶段。

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

## P1 — 通用包边界与真实生产接线

- [x] 建立 npm workspace 与 `agent-protocol`、`ui-schema` 的可执行契约。
- [x] 建立真实 `skill-runtime`、`tool-runtime`，实现声明式 registry、五因子交集与 exact-match。
- [x] 建立 `plugins/fosu-campus`，由 Composition Root 注入现有 Manifest 和校园事实 Tool。
- [x] 建立 `packages/agent-runtime`，由它拥有 Context/Decision/Skill-Tool/Verification/Response 阶段顺序和阶段 Trace。
- [x] 建立 `apps/agent-server`，让 `/agent/runs`、旧 chat/agui 兼容入口汇入同一 Runtime。
- [x] 建立 `apps/agent-admin` 的真实 topology/readiness/trace 接口并由现有 Admin 挂载。
- [x] 让 agent.v2 输出通用 UI blocks，同时保持 agent.v1 可观察行为。
- [x] 更新 Docker/CI/package hygiene，使生产容器包含并加载 workspaces。
- [x] 用 HTTP + Trace 测试证明新 packages/apps/plugin 的真实顺序，运行全部现有门禁并提交 P1。
  - _Requirements: R1, R4.4–R4.8, R10.4, R11.1, R11.4, R11.7_

## P2 — strict_model_first、统一 Decision 与性能

- [x] 建立 `packages/provider-runtime`，迁入 Provider Adapter、连接池、attempt、熔断与 probe。
- [x] 实现三种 executionPolicy；public 强制 deterministic，trial/dev 默认 strict_model_first，adaptive 显式开启。
- [x] 将 Understanding 与 Planner 合为一次 DecisionContract V2 调用；移除 strict 下规则先决定 Goal 的路径。
- [x] 校验 allowedSkillIds 与五因子 Tool 集合，拒绝任意模型 Tool 名。
- [x] 实现总 Deadline、阶段预算、AbortSignal 和一次受控 fallback。
- [x] 持久记录真实 first provider、fallbackPath 与六阶段 timing。
- [x] 建立三 Provider mock conformance、strict-first 证明、public 零 attempt 与性能基准。
- [x] 运行相关门禁并提交 P2。
  - _Requirements: R2, R3, R10.2, R11.2, R11.4, R11.6_

## P3 — ContextAssembler 与成熟 Memory

- [ ] 建立统一 ContextAssembler，贯穿 Decision、Tool 与 Response。
- [ ] 实现持久 MemoryItem、EpisodicMemory、MemoryPolicy 和滚动摘要。
- [ ] 实现本地零外部 semantic encoder、hybrid retrieval 与确定性 rerank。
- [ ] 实现 supersede、冲突消解、TTL、scope、term/release invalidation。
- [ ] 实现查看、修改、删除、清空、暂停、恢复和导出 API。
- [ ] 明确 local_only/session_state/cloud_sync，并验证跨设备/跨会话恢复。
- [ ] 增加 50+ 多轮 fixture 和 100 Turn 验收，运行 Phase 2/3 与完整门禁并提交 P3。
  - _Requirements: R5, R10.1–R10.2, R11.3_

## P4 — 热发布控制面、MCP 与 RAG

- [ ] 建立统一 Artifact/ConfigSnapshot Repository 和发布状态机。
- [ ] Provider、Skill、Tool、MCP、RAG、Memory 全部接入 draft→validate→test→publish→hot reload→rollback。
- [ ] 建立 `packages/mcp-runtime`，支持 Streamable HTTP、受控 stdio、发现、scope、超时和写确认。
- [ ] 建立 `packages/rag-runtime`，支持文件/网页摄取、解析、分块、BM25、向量、rerank、引用与原子版本切换。
- [ ] 完成 `apps/agent-admin` 六领域配置、Run Trace/Eval 与真实发布证据 UI。
- [ ] 用新 Run 证明 configVersion 发布/回滚无需重建镜像，运行浏览器/安全/门禁并提交 P4。
  - _Requirements: R6, R7, R10.2–R10.3, R11.5_

## P5 — 一体化与 Standalone 双部署

- [ ] 完成一体化容器的持久 Repository、迁移、健康与恢复。
- [ ] 完成 Standalone server/worker、PostgreSQL/pgvector、Redis Adapter。
- [ ] 新增 `deploy/standalone/docker-compose.yml`、`.env.example` 和持久卷/健康检查。
- [ ] 提供迁移、备份、升级、回滚、1Panel、Oracle ARM 文档。
- [ ] 更新 GHCR workflow 生成同 SHA linux/amd64 + linux/arm64 manifest。
- [ ] 执行两架构 build/start/Run smoke；本地不可用项交由 CI 且明确记录，提交 P5。
  - _Requirements: R8, R10.4, R11.6, R11.8_

## P6 — 通用 Agent SDK 与微信稳定壳

- [ ] 完成 `packages/agent-sdk` 的 create/poll/SSE/reconnect/idempotency/cancel/result recovery 状态机。
- [ ] 让 RunEvent 使用持久 event cursor，断线、重启和多实例后可恢复。
- [ ] 小程序接入 SDK，移除在线 direct chat fallback 与客户端伪造状态。
- [ ] 完成 12 类通用 UI block renderer，并用 Fosu plugin mapper 保持校园卡片。
- [ ] 验证新增声明式测试 Skill 无需改小程序即可渲染。
- [ ] 运行小程序单测、DevTools smoke（可用时）和全部门禁并提交 P6。
  - _Requirements: R4, R11.6–R11.7_

## P7 — Engine Adapter

- [ ] 固化 AgentEngineAdapter conformance，Fosu Engine 保持默认。
- [ ] 查阅官方 OpenAI Agents SDK JS 与 Pi Agent Core 当前接口和许可证。
- [ ] 实现 OpenAI Adapter，只通过项目 Runtime ports 执行只读 Skill。
- [ ] 实现 Pi Adapter，不注册 bash/read/write/edit，并执行相同只读 Skill。
- [ ] 验证 feature flag、事件/UI/Memory/RAG/Guardrail 一致性；未通过时明确 unavailable。
- [ ] 运行 Adapter conformance 和全部门禁并提交 P7。
  - _Requirements: R9, R10.2–R10.3, R11.1_

## P8 — 收敛、文档、镜像与 Draft PR

- [ ] 更新开发者 Provider/Skill/Tool/MCP/RAG/UI Client 示例和开源使用文档。
- [ ] 执行全部 AGENTS 门禁、故障矩阵、性能基准、密钥/许可证扫描和容器 smoke。
- [ ] 生成并记录 SHA 镜像/manifest 证据；不可用环境不得用 mock 替代。
- [ ] 执行独立代码复审并修复所有 Critical/Important。
- [ ] 推送分支并创建 Draft PR，等待全部 CI。
- [ ] CI 全绿且独立复审无 Critical/Important 后转 Ready；不合并、不部署。
- [ ] 输出按代码/mock/staging/容器/CloudBase/体验版/真机/生产区分的最终报告。
  - _Requirements: R8.6–R8.7, R11_
