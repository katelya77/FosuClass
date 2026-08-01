# P5a Evidence — Standalone Durable Storage

日期：2026-08-01（本地分支 `codex/xiaofu-agent-product-platform`）
范围：tasks.md P5a（:130-137）——Repository/Adapter 的 PostgreSQL 实现（Artifact/ConfigSnapshot、发布状态、四域配置元数据、会话与长期记忆、Run 元数据与 RunEvent durable store、审计、RAG 文档/索引、pgvector、异步任务幂等）；版本化 migration（可重复检测、版本可查、不兼容 schema 不启动、expand-contract）；Redis Streams + Consumer Group + ACK + pending reclaim + 幂等 jobId + 有界重试 + dead-letter（Redis 永不做权威事实源）；文件与 PostgreSQL Adapter 跑同一 conformance/parity suite。

## 1. 提交链（每步独立可回滚）

| 提交 | 内容 |
| --- | --- |
| `db6b891e` | feat(agent): add pg persistence foundation and store adapters（WS1 地基 + WS4a 会话/任务/审计适配器） |
| `dc03c80d` | fix(agent): pg 池空闲客户端 error 空监听（拆除竞态崩溃） |
| `e422a930` | feat(agent): add config kernel pg repository（WS2，27 文件 +1297/-448） |
| `7f7724cd` | feat(agent): add pg user memory document store（WS4b，7 文件） |
| `272b3846` | feat(agent): add durable run event stores（WS3，11 文件 +1704/-207） |
| `20e905ad` | feat(agent): add task queue and rag index pg stores（WS5，19 文件 +2262/-222，含 ioredis） |
| `1fa1d9c8` | feat(agent): wire pg backends into consumption chains（WS6，19 文件 +2392/-1075） |
| `8de7c601` | fix(agent): isolate task queue pg mirror and harden delivery ordering（独立审查修复，8 文件 +144/-25，含 migration 7） |

## 2. 交付内容（按工作流）

### 2.1 WS1 地基（`db6b891e`）

- `packages/agent-runtime/src/persistence/pgClient.js`：createPgPool/query/withTransaction/withAdvisoryLock/probe，coded error 不泄露凭据。
- `packages/agent-runtime/src/persistence/migrations.js`：版本化 migration runner——sha256 篡改检测、过新 schema 拒启动、逐 migration 事务、advisory-lock 串行、幂等重跑、状态可查。
- `packages/agent-runtime/src/persistence/agentCoreMigrations.js`：migration 1 `agent_meta` bootstrap。
- 后端单点选择：`FOSU_AGENT_REPOSITORY_BACKEND`（file 默认 / postgres 显式开启），`server/src/services/ai/persistence/repositoryBackend.js` + `pgPersistenceService.js`（懒池 + 有序 migration 注册表，目录自动发现）。
- 测试设施 `tools/test-helpers/pg-test-env.js`：`AGENT_TEST_PG_URL` 或 ephemeral Docker 容器；两者皆无 → 明确 UNVERIFIED exit 0。
- 根 workspace `pg` 依赖。

### 2.2 WS4a 会话/任务/审计 PG 适配器（`db6b891e`）

- `conversation/pgConversationRepository.js`：与文件实现同错误码、revision 冲突乐观并发、v1→v2 doc 迁移共享。
- `durable/pgDurableTaskStoreAdapter.js` + `taskStore.js`：可注入 store adapter，文件语义不变。
- `persistence/pgIdempotencyStore.js` / `pgKnowledgeAuditService.js` + `knowledgeAuditEntry.js`：共享 entry-shaping，无重复领域规则。
- migration 3 `0003ConversationMemoryStores.js`：`agent_conversations` / `agent_durable_tasks` / `agent_kb_audit` / `agent_kb_idempotency`。
- `tools/test-agent-repository-parity.js`：file/POSTGRES 双后端跑相同场景并深比较可观察结果。

### 2.3 WS2 配置内核 PG（`e422a930`）

- `packages/agent-runtime/src/configKernel/pgRepository.js`：逐字镜像文件语义——双 digest 校验 fail-closed、`pg_advisory_xact_lock(918273)`、VERSION_EXISTS 冲突、审计上限 500。
- migration 2 `0002ConfigKernel.js`：config_kernel_stores 7 表。
- `platformComposition.js`：memoized `initPlatform()`（postgres 先跑 migration 再 seed）+ `platformReady()`；init 失败 coded `AGENT_PLATFORM_INIT_FAILED`（保留 causeCode）；config-plane 路由鉴权后 platformReadyGate（503 泛化），Fosu 业务路由不受影响。
- 内核与 12 个控制面 handler async 化，行为零改动。
- conformance 双 label：file 9 例 + postgresql 9 例 + 3 个 PG-only 并发/篡改例（真实 Docker postgres）。

### 2.4 WS4b 用户记忆 PG（`7f7724cd`）

- `conversation/fileMemoryDocumentStore.js`：原 userPreferenceService 内嵌文件存储逐字抽取（锁/tmp/rename/quarantine 参数一致）；加密仍在 store 之上，store 只见密文。
- `conversation/pgMemoryDocumentStore.js`：doc 列存密文 text；CAS revision 不匹配抛 `MEMORY_REVISION_CONFLICT` 同构 code。
- migration 4 `0004UserMemory.js`：`agent_user_memory(principal_key pk, doc text, revision bigint, updated_at)`。
- userPreferenceService 全部方法（37 个，含内部助手）签名与同步语义不变，默认注入文件 store；热链 await 化留 WS6。

### 2.5 WS3 Run/Event 持久化（`272b3846`）

- file 后端换 `journalRunStore.js`：append-only journal.jsonl + 原子 snapshot，构造即重放；保留窗默认 30min（`AI_AGENT_RUN_RETENTION_MS` 恒 ≥180s），512 条或 compactForTests 压缩，尾部半行容错。
- postgres 后端 `pgRunStore.js`：内存投影权威 + 有序异步写队列（崩溃可丢毫秒级尾部，文件头已声明）；同事务 append event + 推 status；`event_id=runId#sequence` 幂等。
- 重放时非终态 Run adopt 追加 `run.failed`/`RUN_EXECUTOR_LOST` 终态标记。
- migration 6 `0006RunEventStores.js`：`agent_runs`（含附加 doc jsonb 列；execution_policy/config_version/engine_id 暂空不伪造）/ `agent_run_events` / `agent_run_traces`。
- agentRunEventService 12 函数 surface 逐字不变（仅新增 bindDefaultStore/createRunEventService）；P6a 钩子已备（listEventsAfter、runRetentionPolicy、service.persistenceReady）。

### 2.6 WS5 任务队列 + RAG 索引 PG（`20e905ad`）

- `taskQueue/{contract,fileTaskQueue,redisStreamsTaskQueue}.js`：file/Redis Streams 双后端 parity——consumer group、XADD/XREADGROUP/XACK、XPENDING/XAUTOCLAIM reclaim、幂等 jobId、有界重试 + dead-letter；Redis 不可用诚实降级不伪造入队；任务最终状态落 PostgreSQL（Redis 非权威事实源）。
- `ragIndexFileStore.js` / `ragIndexPgStore.js`：RAG 索引 file/PG 双后端，standalone 不依赖容器 FS，fail closed。
- `packages/rag-runtime/src/pgVectorSearch.js`：pgvector 经 rag-runtime 统一接口（ADR-0007 确定性本地 encoder，禁向量化课表事实）。
- migration 5 `0005RagIndexStores.js`：含 `CREATE EXTENSION IF NOT EXISTS vector` 与 `embedding vector(64)`；PG 测试基线镜像统一 `pgvector/pgvector:pg16`。
- 新增 `ioredis` 依赖与 `tools/test-helpers/redis-test-env.js`（ensureRedis，不可用同样 UNVERIFIED exit 0）。

### 2.7 WS6 异步消费接线（`1fa1d9c8`）

- 新增 `persistence/pgReadiness.js`：`ensureAgentPersistenceReady()`（惰性 require platformComposition.initPlatform，memoized、并发安全、失败 coded `AGENT_PLATFORM_INIT_FAILED` 粘性）+ `createLazyPool({gated})`（构造不触网、缺配置 PG 不在 require 期抛错；gated 查询先过就绪门）。
- 新增 `conversation/pgMemoryDocumentStoreAdapter.js`：把 WS4b `PgMemoryDocumentStore`（异步 load/save CAS）适配为 UserPreferenceService 文档存储 seam 的异步同形实现；加密/迁移/revision 领域逻辑留在服务层，adapter 只见不透明信封文本。
- 新增 `durable/sharedTaskStore.js`：file 后端逐字返回既有单例；postgres 后端 gated PG adapter（load/save 入口 await 就绪门，保留 `AGENT_PLATFORM_INIT_FAILED` 原码）。
- 15 个消费侧文件 maybe-async 化（统一 `chain`/`isThenable` 基元）：conversationRepository/conversationMemoryService 全链、userPreferenceService 37 方法（mutate/clear 以 previousRevision 作 expectedRevision 透传 CAS）、userMemory/memoryController/memoryCoordinator 热链、personalMemoryInterpreter、fosuTurnPorts、toolRegistry、agentService、knowledgeControlPlane（两处 eager getPool 改 lazy gated）、resume/waitForEvent、routes/ai 21 个 handler 与 routes/admin 4 个写 handler 改 chain 风格——file 模式保持同步直返（`test-agent-durable-execution` 18/18 同步调用方回归锁定）。
- init 失败证据（死后端实测）：config-plane 快照端点 503 `{code:"AGENT_PLATFORM_INIT_FAILED"}`；capabilities（不挂 init 门）200；四条链 coded 拒绝（`PG_QUERY_FAILED`/`AGENT_PLATFORM_INIT_FAILED`）；`loadForChat` fail-soft 降级（state=null, persisted=false）。
- 真实 PG（pgvector/pgvector:pg16 docker，随机库用完 DROP）全链：initPlatform 迁移+种子 → 会话云同步（setMemoryPolicy→loadForChat(cloud_sync)→persistAfterSuccess(persisted=true)→跨实例可读）→ 偏好 upsert/getObject/list/policy/snapshot/clear → UserMemory commit+读回 → MemoryController load/commit → durable register→resume→receipt_wait→complete → KB 同 idempotencyKey 两次 createDraft 命中缓存 + 审计记录。
- 新测试 `tools/test-agent-p5a-consumer-wiring.js`（离线 file 同步契约 / 死后端 503 / 真实 PG 全链三段；regression runner 自动纳入）。
- file 后端行为逐字保持、local_only 语义不变；既有测试零修改。

### 2.8 独立审查与加固（`8de7c601`）

P5a 落地后经独立两轴 code review（Standards / Spec，agent-37）：**双轴 PASS、0 Critical、2 Important**。Important 已全部修复并随本阶段门禁复绿：

- **I-1（一表两主）**：Redis 队列 PG 镜像原写 `agent_durable_tasks`，durable 整集合重写/清空会抹掉队列跨重启幂等锚、镜像行会被 durable load 读成幽灵任务。修复：migration 7 独立 `agent_task_queue_mirror` 表（doc jsonb），durable 与队列彻底分表。
- **I-2（ack 顺序）**：`ack()`/`retry()` 原把 XACK 放在状态簿记之前，部分失败窗口内任务出 PEL 后不可重投成孤儿。修复：先落簿记（hash + 镜像 + dead-letter/重投 XADD）再 XACK；`reclaimPending` 新增 done/failed 陈旧守卫（XACK 清出 PEL 不再重投），与 claim 守卫对称。

Minor 加固（同提交）：journalRunStore `appendRecord` fold 无条件且先于 compact（修复持久化失败路径 fold 跳过 + compact 边界记录重启丢失两个潜伏缺陷）；pgClient/pgRepository 错误 `cause` 只挂脱敏副本；ragIndexPgStore 头注与覆盖写行为一致化；pgVectorSearch 查询 coded 包装（RAG_PG_UNAVAILABLE / RAG_PG_QUERY_FAILED，剔除 password=）。

保留为已知限制/设计确认：migration 无历史缺口检测（篡改/异常路径，低概率）；pgRunStore onEvent 事务内裸 client.query 当前无 API 暴露面（P6a 暴露 getLastWriteError 前需评估）；PG 后端并发 mutate 负者表面化 MEMORY_REVISION_CONFLICT(409) 为 adapter 头注声明的设计（file 后端锁串行无此失败面）。审查范围含夹在链中的 `afd9738f`（P4e UI 打磨），单提交独立可回滚，不构成违规。

## 3. migration 全景（getMigrationList 目录自动发现）

| 版本 | 内容 | 引入提交 |
| --- | --- | --- |
| 1 | `agent_meta` bootstrap（agent-runtime/agentCoreMigrations） | `db6b891e` |
| 2 | config_kernel_stores 7 表 | `e422a930` |
| 3 | conversations / durable_tasks / kb_audit / kb_idempotency | `db6b891e` |
| 4 | user_memory | `7f7724cd` |
| 5 | RAG 索引 + `CREATE EXTENSION vector` | `20e905ad` |
| 6 | runs / run_events / run_traces | `272b3846` |
| 7 | task_queue_mirror（队列镜像独立表，审查修复 I-1） | `8de7c601` |

## 4. 测试证据

最终门禁（2026-08-01 本机，Docker 可用，PG/Redis 容器测试真实运行）：

| 命令 | 结果 |
| --- | --- |
| `npm run test:agent-platform-p5a`（聚合 10 个 P5a 测试文件） | PASS（exit 0）：persistence-migrations / pg-client / repository-parity / config-kernel-backend / migrations-0003 / memory-doc-store / run-store / task-queue / rag-index-store / consumer-wiring，全部含真实 PG（pgvector/pgvector:pg16）或 Redis（redis:7-alpine）ephemeral 容器段 |
| `npm run test:agent-phase2` | 11/11 PASS |
| `npm run test:agent-release-gate` | 22/22 OK，无 UNVERIFIED；WS6 收尾跑 durationMs=698859，审查修复（`8de7c601`）后复跑 durationMs=702823（含步骤 `test:agent-platform-p5a` OK） |
| 前置阶段回归（release-gate 输出） | p1 / p2 / p4a / p4b / p4c / p4d / p4e 全 OK |
| `git diff --check` | 通过 |
| `npm run test:no-ai-secret-committed` | 通过 |

门禁 flake 记录：审查修复后首次全门禁跑中 `test-coze-provider-v3` 出现一次无输出 [FAIL]（527ms）；该测试单跑与 phase3 整组复跑均过，其领域（Coze Provider）与修复文件无交集，第二次全门禁跑 22/22 全绿——确认为环境偶发，非改动引入。

已核事实：

- P5a 测试文件（regression runner 按 `test-agent-*` 自动纳入）：`test-agent-persistence-migrations.js`、`test-agent-pg-client.js`、`test-agent-repository-parity.js`、`test-agent-config-kernel-backend.js`、`test-agent-p5a-migrations-0003.js`、`test-agent-p5a-memory-doc-store.js`、`test-agent-p5a-run-store.js`、`test-agent-p5a-task-queue.js`、`test-agent-p5a-rag-index-store.js`、`test-agent-p5a-consumer-wiring.js`。
- `agent-regression` 177/177（176 基线 + WS6 新增）；`agent-foundation` 42/42；`agent-phase3`、`final-convergence`、`ai-competition` 均随 release-gate 通过。
- PG/Redis 依赖测试在本机 Docker 真实运行；不可用环境打印 UNVERIFIED exit 0，release-gate 将 UNVERIFIED 判 FAIL（治理 M-1），因此 CI 必须具备 Docker。

## 5. 边界与纪律核对

- file 后端（integrated 默认）行为逐字保持：全部既有门禁无修改通过。
- packages/ 与 apps/ 无 fosu/佛山/佛大/x-fosu/release-pack 字样、无 FOSU_ env（`test-agent-generic-package-boundaries` PASS；pg/rag 通用代码均在红线内）。
- 密钥扫描一度命中 WS5 旧日志事件名（`task-` 前缀紧邻 `queue` 形成 `sk-` 子串），已改名 `queue-persist-failed` 后转绿——无真实密钥进入提交。
- public 正式版外部 Provider 调用恒为 0 不受影响（本阶段不触 Provider 调用链）。
