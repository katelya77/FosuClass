# Standalone 部署：小佛 Agent 平台

单镜像四角色（`server` / `worker` / `admin` / `migrate`）的独立部署拓扑。
Admin 角色默认与 server 合一（同一进程托管 admin 静态 + config-plane），
角色分离仅为水平扩展预留。本目录不依赖 fosu-campus 插件即可运行。

- 镜像：`fosu-agent-platform`（`server/Dockerfile` 的 `standalone` target）
- 入口：`node server/src/standalone/agentServerMain.js`，角色由 `AGENT_PLATFORM_ROLE` 选择
- 探针：`/health/live`、`/health/startup`、`/health/ready`（readiness 细分
  postgres/redis/migration/artifact/config snapshot/worker queue/RAG backend/
  Provider/published configVersion，逐项 ok/not_ready/unknown + 原因码）
- 拓扑：postgres（pgvector/pgvector:pg16）+ redis（redis:7-alpine）+
  migrate（一次性）→ server/worker；依赖序由 healthcheck 与
  `service_completed_successfully` 保证

## 快速启动

```bash
cd deploy/standalone
cp .env.example .env
# 编辑 .env：必填 AGENT_PG_PASSWORD、ADMIN_*（至少一项鉴权）；
# 随机密钥用 openssl rand -hex 24 生成
docker compose up -d
docker compose ps          # migrate 应为 Exited (0)，server/worker healthy
curl -fsS http://127.0.0.1:8080/health/ready | head -c 2000
```

本地无镜像时 compose 会用 `build` 段从仓库根构建 `standalone` target。
生产部署不要用本地构建充当发布物——见下文镜像纪律。

## 镜像纪律：禁止 floating latest

- 生产必须按 **commit SHA tag** 或 **digest** 固定镜像：
  - `AGENT_PLATFORM_IMAGE=fosu-agent-platform`、`AGENT_PLATFORM_VERSION=<git-sha>`
  - 或 `AGENT_PLATFORM_IMAGE=<registry>/fosu-agent-platform@sha256:<digest>`
- `latest`（以及任何可变 tag）不作为生产部署、升级或回滚依据。
- 每次发布记录：镜像 digest、commit SHA、部署时间、执行人——回滚时按记录定点。

## 备份

权威数据与备份对象：

| 对象 | 位置 | 是否备份 | 说明 |
| --- | --- | --- | --- |
| PostgreSQL | 卷 `pgdata` | 是（权威） | Run/RunEvent/配置元数据/会话记忆/RAG 文档与索引元数据 |
| 数据根卷 | 卷 `agent-data` | 是 | `AGENT_PLATFORM_DATA_DIR` 统一根：file fallback、artifact 缓存、知识库上传暂存 |
| 已发布索引/配置元数据 | PG 内 + `agent-data` 卷 | 是 | 发布状态、版本、digest 均在 PG；卷内为 file fallback/可重建缓存但建议随备 |
| Redis | 卷 `redisdata` | **否** | 仅队列暂存，非权威事实源；最终状态落 PG，丢失后任务可重放/重入队 |

PG 逻辑备份（推荐，可在线执行）：

```bash
docker compose exec postgres pg_dump -U "$AGENT_PG_USER" -d "$AGENT_PG_DATABASE" \
  --format=custom --file=/tmp/agent-platform.dump
docker compose cp postgres:/tmp/agent-platform.dump ./backups/agent-platform-$(date +%Y%m%d%H%M%S).dump
```

卷快照（停机或接受 crash-consistent 时）：

```bash
docker compose stop server worker migrate
docker run --rm -v fosu-agent-platform_pgdata:/src -v "$PWD/backups:/dst" alpine \
  tar czf /dst/pgdata-$(date +%Y%m%d%H%M%S).tar.gz -C /src .
# agent-data 卷同理（替换卷名）
docker compose start server worker
```

## 恢复

```bash
# 1) 恢复 PG（逻辑备份）
cat backups/agent-platform-<ts>.dump | docker compose exec -T postgres \
  pg_restore -U "$AGENT_PG_USER" -d "$AGENT_PG_DATABASE" --clean --if-exists
# 2) 恢复 agent-data 卷（与备份方式对称的 tar 解包）
# 3) 重新执行迁移（幂等，schema 版本不足时补齐）
docker compose up -d --no-deps migrate
# 4) 拉起业务并验证 readiness
docker compose up -d
curl -fsS http://127.0.0.1:8080/health/ready
```

## 升级

1. **备份**（PG dump + agent-data 卷快照，见上）。
2. 拉取按 SHA/digest 固定的新镜像：`docker compose pull`（确认 `.env` 中
   `AGENT_PLATFORM_VERSION` 已指向目标 SHA/digest）。
3. 先跑迁移：`docker compose up -d --no-deps migrate`，
   `docker compose ps migrate` 确认 `Exited (0)`；迁移失败则停止升级，按备份回滚。
4. 滚动业务：`docker compose up -d server worker`。
5. 验证 readiness：`curl -fsS http://127.0.0.1:8080/health/ready` 各项 ok。
6. smoke：建一个 Run 并消费 RunEvent、打开 Admin 配置快照页、声明式示例
   Skill 各验一次（清单见仓库 `specs/xiaofu-agent-product-platform/tasks.md` P5b）。

## 回滚

- 应用回滚：把 `.env` 的 `AGENT_PLATFORM_VERSION`（或 digest）改回上一份记录值，
  `docker compose pull && docker compose up -d server worker`。
- schema 回滚：**仅在 migration 允许时**进行（expand-contract 纪律下，
  新版本 schema 对旧应用向后兼容窗口内可直接回滚应用；破坏性变更需专项
  回滚 migration 或从备份恢复 PG）。无法安全回滚 schema 时，恢复升级前的
  PG 备份 + agent-data 卷快照，再启动旧镜像。
- 回滚后同样执行 readiness + smoke 验证，并记录回滚原因与时间点。

## 安全基线

- postgres/redis 不发布宿主端口；仅 server 的 HTTP 默认绑 `127.0.0.1`，
  公网暴露交给反向代理（1Panel 见 `docs/deployment/1panel.md`）。
- 凭据只经 `.env`（本机）或外部 Secret 注入；`.env` 不进 git（已 gitignore
  约束，提交前自查）。
- Provider 未配置时平台 healthy 但 readiness 对应项如实 `not_ready`；
  public 模式零外部 Provider 调用，不会用 Mock 冒充生产 Provider。
