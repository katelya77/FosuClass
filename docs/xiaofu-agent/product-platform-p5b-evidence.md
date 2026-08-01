# P5b Evidence — Standalone Service Topology

日期：2026-08-01（本地分支 `codex/xiaofu-agent-product-platform`）
范围：tasks.md P5b（:139-149）——单 `fosu-agent-platform` 镜像四角色（server/worker/admin/migrate）；`deploy/standalone/` compose + `.env.example` + 命名卷 + 内部网络；依赖顺序与健康检查分层；无 fosu-campus 可独立运行；Provider 未配置如实 not ready；worker 职责边界；备份/恢复/升级/回滚文档。

## 1. 提交链（每步独立可回滚）

| 提交 | 内容 |
| --- | --- |
| `2a03dc00` | feat(agent): add standalone platform deployment（WS-A 运行时 + WS-B 打包部署，17 文件 +3504） |
| `03e49ddb` | fix(agent): align worker health probe and standalone deployment docs（独立两轴审查修复，8 文件 +38/-21） |
| 本提交 | test(agent): add p5b aggregate gate step and evidence（聚合门禁步 + 本文档 + tasks 勾选） |

### 1.1 阶段内回归发现与修复（提交前完成，随 `2a03dc00` 落地）

- **Dockerfile stage 顺序回归**：WS-B 初版把 `FROM runtime-common AS standalone` 追加在文件末尾，导致无 `--target` 的默认构建从 browser 变成 standalone，`test:server-docker-smoke`（默认构建必须是一体化 browser 容器）失败（容器 `PG_CONFIG_REQUIRED` 致命退出）。修复：standalone 块移到 core 与 browser 之间，browser 恢复最后 stage，并在 browser 头注释注明默认构建契约（smoke 门禁/发布工作流/1Panel 依赖）。修复后 `npm run test:server-docker-smoke` 单步复验 PASS（127.0.0.1:18326，容器内健康+Run API 验证），第二次全门禁链 22/22 OK。
- **compose 数据目录未显式设置**：原 compose 未设 `AGENT_PLATFORM_DATA_DIR`，standaloneComposition fallback 会落镜像层 `/app/data/standalone`，file fallback/artifact 缓存重启即丢。修复：统一 `AGENT_PLATFORM_DATA_DIR=/app/storage/agent-data` 并挂命名卷 `agent-data`（server/worker 两卷合一）。
- **env 契约对齐 WS-A 事实源**：`.env.example`/compose 初版沿用 integrated 旧名（`ADMIN_API_TOKEN`/`AI_RUNTIME_MODE`/`AI_PROVIDER`/`AI_API_KEY`/`AGENT_PLATFORM_ARTIFACT_DIR`/`AGENT_PLATFORM_UPLOAD_DIR` 等无消费点或语义不符），全部改为 WS-A 真实消费的 `AGENT_PLATFORM_ADMIN_TOKEN`/`AGENT_PLATFORM_SERVICE_TOKENS`/`AGENT_PLATFORM_RUNTIME_MODE`/`AGENT_PLATFORM_PROVIDERS`+按名引用的 `DEEPSEEK_API_KEY` 空占位；deploy/docs 旧 env 名零残留。
- **密钥扫描折行**：compose 中 `${AGENT_REDIS_PASSWORD:-}` 等三处长行命中仓库密钥扫描行格式规则，以 YAML `>-` 折行规避（附注释，语义等同单行；`docker compose config -q` 验证展开值正确）。

## 2. 交付内容（按工作流）

### 2.1 WS-A standalone 运行时（`server/src/standalone/`）

- `agentServerMain.js`：四角色（server/worker/admin/migrate）进程入口，非法角色 coded `AGENT_PLATFORM_ROLE_INVALID` exit 1；SIGTERM/SIGINT 优雅退出。
- `standaloneComposition.js`：standalone 组合根——不复用 integrated `platformComposition`（无 Fosu 顶层耦合）；PG 迁移+种子 memoized `initPlatform()`；file 仅开发回退，standalone 默认 `FOSU_AGENT_REPOSITORY_BACKEND=postgres`。
- `createStandaloneApp.js`：Express 挂载面——`/health/live|startup|ready`；Run API（POST /api/agent/runs、GET /api/agent/runs/:runId、POST cancel，主聊天同步链留在 server）；config-plane `/api/admin/agent-platform/config/*`（Bearer 全权/scoped 令牌，未配置→503 fail closed，无 Cookie 会话→无 CSRF 面）；Admin 静态 `/admin/agent-platform`；fosu-campus 接缝恒 501（`FOSU_CAMPUS_NOT_ENABLED` / `FOSU_CAMPUS_ASSEMBLY_NOT_IMPLEMENTED`）。
- `healthRoutes.js`：三探针分离；readiness 九项细分（postgres/redis/migration/artifactRepository/configSnapshot/workerQueue/ragBackend/provider/publishedConfigVersion）；blocking 仅 postgres/migration/artifactRepository/configSnapshot/ragBackend/publishedConfigVersion 六项；Provider 未配置 `not_ready/PROVIDER_NOT_CONFIGURED` 且 `blocking=false`，strictModelFirstReady 仅真实凭据时为 true，无 Mock 冒充。
- `workerMain.js` + `standalonePlugin.js`：worker 唯一执行入口为 kind 白名单（仅 RAG 索引构建）；未知 kind（如 shell.exec）明确 reject → dead-letter（`TASK_QUEUE_JOB_KIND_UNSUPPORTED`），不执行任意 shell/用户上传内容；integrated 模式不留无法消费的队列任务。
- `standaloneLogger.js`：结构化日志（serviceRole/version/configVersion/runId-jobId 安全标识/errorClass），密钥字段脱敏。

### 2.2 WS-B 打包部署（`server/Dockerfile` + `deploy/standalone/` + `docs/deployment/`）

- `server/Dockerfile` 新增 `--target standalone`（core 与 browser 之间；默认构建仍为一体化 browser，契约注释在位）。
- `server/scripts/test-standalone-health.js`：容器 HEALTHCHECK——server/admin 探 `/health/ready`（可降级 `/health/live`）；worker 无 HTTP 监听时回退 `/proc/1/cmdline` 主进程活性；migrate 直接 exit 0。
- `deploy/standalone/docker-compose.yml`：pgvector/pgvector:pg16 + redis:7-alpine + migrate（一次性）+ server + worker；依赖序 postgres/redis healthy → migrate completed_successfully → server/worker；PG/Redis 不暴露宿主端口（单一内部 bridge 网络，仅 server 发布 HTTP 且默认绑回环）；命名卷 pgdata/redisdata/agent-data；禁 floating latest（`AGENT_PLATFORM_VERSION` 按 SHA/digest 固定，默认 local 仅本地构建回退）。
- `deploy/standalone/.env.example`：全占位、必填注释、openssl 随机密钥生成提示；Provider 凭据留空即未配置。
- `deploy/standalone/README.md`：备份/恢复（PG 权威 + agent-data 卷；Redis 非权威不纳入）、升级（备份→固定 digest 拉镜像→migrate→readiness→smoke→失败回滚）、回滚。
- `docs/deployment/1panel.md` / `oracle-arm.md` / `developer-quickstart.md`：1Panel 部署、Oracle ARM（多架构归 CI buildx/QEMU，P5c）、外部开发者快速启动。

### 2.3 独立两轴审查与加固（`03e49ddb`）

P5b 落地后经独立两轴 code review（Standards / Spec，agent-40/41）：**0 Critical、2 Important**。Important 与连带 Minor 已全部修复并复验：

- **I-1（Spec：worker 健康检查探错端口）**：compose 给 worker 注入 `AGENT_PLATFORM_PORT=8080`，而 worker 健康监听在 `AGENT_PLATFORM_WORKER_HEALTH_PORT`（默认 8081），健康脚本恒 ECONNREFUSED 后静默回退 `/proc/1/cmdline` 活性检查——worker 的 readiness 从不参与 `service_healthy` 判定。修复：`test-standalone-health.js` 新增 `AGENT_PLATFORM_HEALTHCHECK_PORT`（优先于 `AGENT_PLATFORM_PORT`）；compose worker 设 `8081` 对齐，并把探针路径设为 `/health/ready`（真实 readiness 语义：PG/队列等九项）。smoke item 13 复验：worker healthy 来自 8081 就绪探针 200。
- **I-2（Standards：交付文档与代码事实不符）**：`docs/deployment/*.md` 写 `/api/ai/agent/runs*`、rollback `"version":1`、轮询 `?cursor=`——与真实挂载（`/api/agent/runs`、`toVersion`、`pollToken`+`afterSequence`）不符，照抄即 404/400。已全部对齐 `createRunHandlers` 契约；`deploy/standalone/README.md` 必填项旧 `ADMIN_*` 改 `AGENT_PLATFORM_ADMIN_TOKEN`/`AGENT_PLATFORM_SERVICE_TOKENS`。
- **B1（Standards：命名违反被调方契约）**：`pgPersistenceService.closeForTests()` 头注「生产路径不调用」却被生产关停路径调用。改为导出生产语义 `close()`（`closeForTests` 保留为测试别名），`agentServerMain`/`migrateMain` 关停路径改调 `close()`。

Spec 轴连带澄清（tasks.md 措辞随本提交如实化）：admin 角色 compose 默认与 server 合一（分离仅预留）；worker 职责边界=RAG 摄取/索引已落地并 smoke 验证，golden 验证/发布前测试/Eval/维护清理的 kind 白名单接缝已立、任务生产者随对应域成熟接入（unknown kind 明确 reject 进 dead-letter 已验证）。Minor 保留：standalone 目录 helper 去重（judgement call）；deployment 三文档为 P5c 交付提前落地（无害，P5c 复验）。

## 3. 真实 smoke（原提示词十二，18 条逐项真实结果）

环境：本机 Docker Desktop server 29.5.3 linux/amd64，buildx v0.34.1；镜像 `fosu-agent-platform:p5b-smoke`（buildx --target standalone；最终运行镜像 manifest list digest `sha256:9cc759b2ae35acd2e19c89dc67561490e41abd8db8548c8e6056197ca8bf29ee`，于审查修复落地后重建，内容与 `03e49ddb` 树一致）；compose project `agent-p5b-smoke`（容器/卷隔离命名）；HTTP 入口 127.0.0.1:18080；`AGENT_PLATFORM_RUNTIME_MODE=public`、无 Provider 凭据；全部密钥运行时 `crypto.randomBytes` 生成、只落 mkdtemp 临时目录（不落仓库）。编排脚本 `.tmp/p5b-smoke.js`，transcript `.tmp/p5b-smoke-transcript.log`；结束后 `down -v` 已清理。**最终运行（审查修复后重建镜像）18/18 PASS**；此前运行：两次为编排脚本自身修正（artifact 必须显式 version 参数、worker healthy 需等 start_period），一次为修复前基线 18/18。

| # | 项 | 结果 | 真实观测 |
| --- | --- | --- | --- |
| 1 | PostgreSQL/Redis healthy | PASS | 两容器 `State.Health.Status=healthy` |
| 2 | migrations 完成 | PASS | migrate 容器 ExitCode=0；readiness `migration=ok` |
| 3 | Admin 可访问 | PASS | `GET /admin/agent-platform/` 200；`runtime-config.js` 200 |
| 4 | 声明式 Skill 草稿 | PASS | 版本历史取当前 v1 → 改描述 → `PUT config/draft` 200 |
| 5 | validate/test/publish | PASS | skill v2 / tool v2 / mcp v2 全部 validate→test→publish；read-only scoped token 发布 → 403 |
| 6 | 创建 Run | PASS | `POST /api/agent/runs` 202 → 轮询收敛 `completed` |
| 7 | Run 绑定 configVersion | PASS | `platformTrace.configVersion=cfg-public-0010-17b12d5291b2` = rag 发布版 |
| 8 | 只读示例 Tool/Skill 执行 | PASS | 内置 `platform.time` 应答含 UTC；通用 UI blocks=2 |
| 9 | 收到 RunEvent | PASS | run.accepted→runtime.entered→6×(stage.started→stage.completed)→runtime.completed→run.completed（14 事件） |
| 10 | 最终结果可恢复 | PASS | 终态后 `GET /api/agent/runs/:runId?pollToken=…` 200，result 可读 |
| 11 | RAG 文档创建并发布 | PASS | rag v2（docId=`p5b-smoke-acceptance`），publishedConfigVersion=`cfg-public-0010-17b12d5291b2` |
| 12 | 查询返回真实引用 | PASS | 「配置发布流程是怎样的？」→ citations `["p5b-smoke-acceptance"]` |
| 13 | worker 完成异步索引 | PASS | worker healthy=true（修复后来自 8081 `/health/ready` 真实就绪探针，非纯进程活性）；引用出现即索引完成（索引仅经 worker 队列异步构建）；附证 worker 日志含 rag/index 记录 |
| 14 | 重启后数据仍在 | PASS | `compose restart server worker` 后 configVersion 不变、历史 Run 可读、RAG 引用仍在 |
| 15 | rollback 后新 Run 用旧版本 | PASS | rollback skill→v1：`cfg-public-0010-…`→`cfg-public-0011-7db3b0bfc818`；新 Run 绑定旧版 |
| 16 | public 外部 Provider 调用为 0 | PASS | 3 个 Run `externalProviderUsed=false`/`provider=""`；readiness `provider=not_ready(PROVIDER_NOT_CONFIGURED,blocking=false)`；capabilities `externalProviderCallsInPublic=0` |
| 17 | 无 fosu-campus 通用平台正常 | PASS | 接缝 501 `FOSU_CAMPUS_NOT_ENABLED`；全部检查在无校园插件下完成 |
| 18 | 启用 fosu-campus 经插件注入不污染 | PASS | override `AGENT_PLATFORM_ENABLE_FOSU=1` → 501 `FOSU_CAMPUS_ASSEMBLY_NOT_IMPLEMENTED`（本阶段仅验证装配接缝语义）；还原后回 `NOT_ENABLED` |

readiness 九项细分实测：`artifactRepository=ok, configSnapshot=ok, migration=ok, postgres=ok, provider=not_ready, publishedConfigVersion=ok, ragBackend=ok, redis=ok, workerQueue=ok`；capabilities 实测 `{"publicDeterministic":true,"strictModelFirstReady":false,"externalProviderCallsInPublic":0}`。

## 4. 测试证据

| 命令 | 结果 |
| --- | --- |
| `node tools/test-agent-p5b-standalone.js` | PASS（regression runner 按 `test-agent-*` 自动纳入；父进程角色分发/守卫 + 死后端九项 readiness + 真实 PG/Redis 闭环：migrate→启动→Skill 草稿→validate/test/publish→Tool/MCP/KB 发布→Run 绑定 configVersion→RunEvent→内置只读示例 Skill→worker 异步索引→RAG 引用→未知 kind dead-letter→重启持久→rollback→public 外部调用 0；serve/worker SIGTERM 优雅退出） |
| 真实 compose 全栈 smoke（上表 18 条） | 18/18 PASS |
| `npm run test:agent-phase2` | 11/11 PASS（第二次全门禁链） |
| `npm run test:agent-release-gate` | 22/22 OK，durationMs=929138（第二次全门禁链，含 `test:server-docker-smoke`、`release:preflight`、`security:acceptance`；无 UNVERIFIED） |
| 前置阶段回归（release-gate 输出） | p1 / p2 / p4a / p4b / p4c / p4d / p4e / p5a 全 OK |
| `git diff --check` | 通过 |
| `npm run test:no-ai-secret-committed` | 通过 |
| 聚合步 `test:agent-platform-p5b`（本提交新增） | 随本提交前全门禁链复跑验证（结果见最终报告/审查记录） |

门禁过程记录：第一次全门禁链 21 OK / 1 FAIL 于 `test:server-docker-smoke`，根因为本阶段引入的 Dockerfile stage 顺序回归（见 1.1），修复后第二次 22/22 全绿。第三次全门禁链在 `test:ai-competition` 失败：smoke 密钥文件此前落 `.tmp/p5b-smoke.env`（`.env` 文本被仓库 secret 扫描命中，AssertionError 指向该文件）——属测试产物污染而非产品缺陷，修复为 smoke 密钥文件改落 mkdtemp 临时目录（`os.tmpdir()`），仓库目录不再出现 smoke 密钥。修复后 smoke 18/18 复验通过，第四次全门禁链随本提交前复跑（结果见最终报告/审查记录）。

## 5. 边界与纪律核对

- integrated（file 后端、`server/src/app.js` 既有入口）零改动：本阶段不动 Fosu 路由、Dockerfile core/browser target 行为（默认构建契约经 smoke 门禁验证）。
- packages/ 与 apps/ 红线 grep 零命中（无 fosu/佛山/佛大/x-fosu/release-pack 字样、无 FOSU_ env；`test-agent-generic-package-boundaries` PASS）。
- public 正式版外部 Provider 调用恒为 0：smoke item 16 在真实容器栈双重验证（Run 结果字段 + readiness/capabilities 项）。
- 密钥纪律：smoke 全部密钥运行时随机生成、只落 `.tmp`（gitignore）；`.env.example` 全占位；compose 长行折行规避扫描误报且无真实值。
- worker 不执行任意 shell：未知 kind（shell.exec）明确 reject 进 dead-letter（`TASK_QUEUE_JOB_KIND_UNSUPPORTED`），任务内容源按引用从内核重取。
