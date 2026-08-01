# 1Panel 部署 standalone 小佛 Agent 平台

本文覆盖在 1Panel 面板上部署 standalone 拓扑（`deploy/standalone/docker-compose.yml`）。
Fosu 一体化服务（`server/docker-compose.yml`）的既有部署不在本文范围。

## 前置

- 1Panel 已安装 Docker（面板「容器」可用）。
- 已持有按 commit SHA tag 或 digest 固定的平台镜像（禁 floating latest）：
  - 方式一：CI 发布到镜像仓库（推荐，多架构 manifest 见
    [oracle-arm.md](./oracle-arm.md)），服务器 `docker pull` 后可被 compose 引用；
  - 方式二：在服务器上对仓库做 `git checkout <sha>` 后用 compose 的 `build` 段本地构建
    （仅限测试环境，不作为生产发布物）。

## 编排导入

1. 将仓库 `deploy/standalone/` 目录放到服务器（如 `/opt/fosu-agent-platform/standalone`），
   或直接在 1Panel「容器 → 编排 → 创建编排」中粘贴
   `deploy/standalone/docker-compose.yml` 内容。
2. 在 1Panel 编排的环境变量（`.env`）中按 `deploy/standalone/.env.example` 逐项填值：
   - 必填：`AGENT_PG_PASSWORD`、`AGENT_PLATFORM_ADMIN_TOKEN`
     （或 `AGENT_PLATFORM_SERVICE_TOKENS`）；
   - 镜像：`AGENT_PLATFORM_IMAGE` / `AGENT_PLATFORM_VERSION` 指向固定 SHA tag 或 digest；
   - 随机密钥：`openssl rand -hex 24` 生成；
   - `AGENT_PLATFORM_HOST_BIND` 保持 `127.0.0.1`，公网入口交给 1Panel 反向代理。
3. 创建/启动编排。依赖序由 compose 保证：
   postgres/redis healthy → migrate `service_completed_successfully` → server/worker。

## 卷

compose 声明三个命名卷（1Panel「容器 → 存储卷」可见，前缀为编排名）：

- `pgdata`：PostgreSQL 权威数据（备份对象）；
- `agent-data`：统一数据根（file fallback、artifact 缓存、知识库上传暂存；备份对象）；
- `redisdata`：Redis AOF（队列暂存，**非权威，不备份**）。

备份/恢复/升级/回滚操作步骤统一见 [deploy/standalone/README.md](../../deploy/standalone/README.md)，
1Panel 上可用「计划任务」执行同样的 `pg_dump` 与卷快照命令。

## 反向代理

1. 1Panel「网站 → 创建网站 → 反向代理」，目标填 `http://127.0.0.1:8080`
   （即 compose 发布的 server HTTP 端口）。
2. 在 1Panel 为该站点签证书、强制 HTTPS。
3. 管理台（`/admin/agent-platform`）经该代理暴露时，使用
   `AGENT_PLATFORM_ADMIN_TOKEN`（或细粒度 `AGENT_PLATFORM_SERVICE_TOKENS`）
   Bearer 鉴权；令牌只经 `.env` 注入，不进日志。
4. Run API（`/api/ai/agent/runs*`）如需被外部客户端消费，走同一代理即可；
   注意代理超时需大于最长 Run 同步窗口，或客户端按 cursor 轮询恢复。

## 健康检查

- 容器级：compose 已内置 healthcheck（server/worker 调
  `server/scripts/test-standalone-health.js`；migrate 为一次性任务，禁用 healthcheck）。
  1Panel「容器」列表应显示 `healthy`；migrate 显示 `Exited (0)` 为正常。
- 业务级探针（也可挂到 1Panel/外部监控）：
  - `GET /health/live`：进程存活；
  - `GET /health/startup`：首次迁移与索引恢复完成；
  - `GET /health/ready`：细分 readiness（postgres/redis/migration/artifact/
    config snapshot/worker queue/RAG backend/Provider/published configVersion）。
- Provider 未配置时容器仍 healthy，但 readiness 的 Provider 项如实 `not_ready`
  （public 模式不受影响；trial/dev 的 strict_model_first 不可用属预期，非故障）。

## 常见问题

- `migrate` 反复重启/非 0 退出：多为 `AGENT_PG_PASSWORD` 与 postgres 不一致或
  `AGENT_PG_URL` 填错；看 `docker compose logs migrate`，修复后
  `docker compose up -d --no-deps migrate` 重跑（迁移幂等）。
- server 一直 `unhealthy`：先看 `GET /health/ready` 的细分项与原因码，
  不要先重启容器抹掉现场。
