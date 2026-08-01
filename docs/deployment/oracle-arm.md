# Oracle ARM（aarch64）部署 standalone 小佛 Agent 平台

本文只写 standalone 平台（`deploy/standalone/`）在 Oracle ARM 上的特有事项。
Fosu 一体化服务（`server/Dockerfile` + `server/docker-compose.yml`）的 ARM64 部署、
DeepSeek 配置与数据合规说明见既有文档
[docs/oracle-arm-deploy-ai.md](../oracle-arm-deploy-ai.md)，此处不重复——
其中「Oracle ARM 不等同于境内合规部署」的结论对 standalone 同样适用。

## 镜像：arm64 从哪来

- `server/Dockerfile` 的 `standalone` target 基于 `node:20-alpine`，不引入任何
  仅 x86 的原生二进制（无 Chromium；依赖均为纯 JS），可原样构建 linux/arm64。
- linux/amd64 + linux/arm64 双架构镜像由 CI 工作流
  `.github/workflows/agent-platform-publish.yml` 产出并发布为同一 manifest：
  ubuntu-latest（amd64）与 ubuntu-24.04-arm（arm64）**双原生架构 runner** 各自
  build → 以 `tools/standalone-compose-smoke.js` 跑真实 compose smoke →
  push `sha-<sha>-<arch>`（含 provenance/sbom）→ `imagetools create` 合并为
  `sha-<sha>` manifest（标签含 commit SHA，digest 以 artifact 记录；禁 floating latest）。
  手工等价构建（非发布依据）：

  ```bash
  docker buildx build --platform linux/amd64,linux/arm64 \
    -f server/Dockerfile --target standalone \
    --build-arg GIT_REVISION=$(git rev-parse HEAD) \
    -t <registry>/fosu-agent-platform:<git-sha> --push .
  ```

- 验证口径纪律（如实标注，不混淆）：
  - **build verified**：镜像在对应架构构建成功（CI 双原生 runner 或本地 buildx）；
  - **smoke verified**：镜像在真实对应架构机器上 compose 起栈并通过
    `tools/standalone-compose-smoke.js` 18 条验收。CI 的 `ubuntu-24.04-arm`
    即真实 aarch64 环境，其 smoke 通过可如实标 arm64 smoke verified；
    若某次 CI 仅完成构建未起容器，只能标 build verified，不得写 smoke verified。
- `pgvector/pgvector:pg16` 与 `redis:7-alpine` 官方均提供 arm64 manifest，
  compose 内无需改动。

## 部署步骤

与 amd64 完全一致（compose 按宿主架构自动选 manifest）：

```bash
cd deploy/standalone
cp .env.example .env   # 填值；AGENT_PLATFORM_VERSION=<git-sha> 或 digest 固定
docker compose up -d
curl -fsS http://127.0.0.1:8080/health/ready
```

快速启动、备份/恢复/升级/回滚统一见
[deploy/standalone/README.md](../../deploy/standalone/README.md)；
反向代理与面板操作见 [1panel.md](./1panel.md)。

## standalone 特有事项

- **资源配比**：Oracle ARM 免费档常为 4C24G Ampere。server/worker/postgres/redis
  四容器同机时，建议 worker 限制内存（RAG 摄取/索引是内存大户），必要时
  `docker compose up -d --scale worker=0` 先只跑 server 验证控制面，再开 worker。
- **QEMU 与原生构建**：本地（x86 开发机）`docker compose build` 只会产出 amd64；
  给 Oracle ARM 用必须走 CI buildx 或在 ARM 机器上原生构建，不要推单架构
  amd64 镜像冒充多架构发布。
- **迁移幂等**：升级/回滚流程与架构无关，migrate 角色在任何架构上都是
  一次性任务（`Exited (0)` 即成功），失败先查 `docker compose logs migrate`。
- **Provider 出站**：Oracle ARM 出境链路访问部分 Provider 可能不稳定；
  readiness 的 Provider 项会如实反映（`not_ready` + 原因码），不要用 Mock 冒充。
  合规要求见上文链接的既有文档。
