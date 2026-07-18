# GitHub Actions 生产部署凭据契约

`.github/workflows/deploy-vps.yml` 是 API 镜像唯一的 `main` push 发布与部署流水线。它先验证代码和持久化重建，再构建 ARM64 `core`/`browser` 两个 Target，按 `config/admin-rollout-manifest.json` 选择精确 GHCR Digest，执行只读生产前置检查，最后才串行部署到 VPS。

## PR 与手动生产前置检查

PR 事件只运行本地验证与真实 Docker recreate，绝不读取 production environment Secrets，也不执行 PR 中的脚本到 VPS。合并前由维护者从该分支手动执行 `workflow_dispatch` 且设置 `preflight_only=true`；受保护的手动运行会构建并推送当前提交的精确 Digest，再执行生产前置检查，但不会部署。这样既能取得真实主机证据，也不会让 PR 控制的代码自动获得生产 SSH 私钥。

远端脚本只读取 ARM64 架构、磁盘余量、tar 创建/真实解压能力、Docker/Compose、当前容器的四个持久化 bind、运行路径覆盖、可信 `last-healthy-image.txt` 和候选 GHCR Manifest；候选 Digest 必须显式传入，不能回退验证当前镜像。脚本不停止、暂停或替换容器，不拉取镜像，也不改写应用数据目录。结果保存为 `production-preflight-<commit>` artifact。缺少生产 Secrets 或候选 Digest 时必须生成 `status=UNKNOWN` 证据并失败，不能把缺失检查解释为成功。

候选 Compose 只会暂存到提交专属的 `.deploy-preflight/<commit>` 控制目录供解析，不覆盖在线 `server/docker-compose.yml`。正式部署的 Compose 与迁移/验证脚本被打成单一 `tar.gz`，先校验归档 SHA256、封闭文件集合和逐文件 SHA256，再原子移动为 `.deploy-control/<commit>` 不可变控制目录；传输中断或半包不会污染在线控制文件。

## 必需 Secrets

| 名称 | 用途 | 缺失时行为 |
| --- | --- | --- |
| `VPS_HOST` | SSH/SCP 目标主机 | 部署前失败，只输出变量名 |
| `VPS_USER` | SSH/SCP 用户 | 部署前失败，只输出变量名 |
| `VPS_SSH_KEY` | SSH 私钥 | 部署前失败，只输出变量名 |
| `VPS_APP_DIR` | VPS 应用目录 | 部署前失败，只输出变量名 |

应用长期凭据不再经由 GitHub Actions 传输或重写。`ADMIN_API_TOKEN`、`ADMIN_PASSWORD`、`ADMIN_TOKEN`、微信 Session/Ticket 密钥、`FOSU_AI_CONFIG_ENCRYPTION_KEY`、`AI_API_KEY`、`DEEPSEEK_API_KEY`、`CLOUDBASE_OPENAI_API_KEY`、`COZE_API_KEY`、`COZE_BOT_ID` 和 `FOSU_IMPORT_CLOUDBASE_RELAY_TOKEN` 必须已经存在于 VPS 权限为 `0600` 的 `server/.env`，或存在于既有加密运行时配置中。

## 私有 GHCR 读取

部署 Job 只声明 `packages: read`，把本次 Job 的短期 `GITHUB_TOKEN` 通过 SSH 进程环境交给远端。远端使用 `mktemp -d` 创建权限为 `0700` 的 `DOCKER_CONFIG`，通过 `--password-stdin` 登录，并在脚本退出时删除整个临时配置。

GHCR 用户名、Token 或 Docker `auth.json` 不得写入仓库、`.env`、Compose、`storage` 或用户的永久 `~/.docker/config.json`。构建 Job 独立声明 `packages: write`；部署 Job 没有包写权限。

## Rollout Manifest 与固定安全值

以下生产值来自版本化 Rollout Manifest 或部署脚本的固定不变量，不允许由 Repository Variables 临时覆盖：

- `FOSU_ADMIN_PRIMARY=legacy`
- `FOSU_ADMIN_NEXT_ENABLED=true`
- `FOSU_ADMIN_NEXT_WRITE_MODULES` 仅包含 Manifest 中 `productionWriteEnabled=true` 的模块
- `FOSU_RUNTIME_DATA_REQUIRE_MIGRATION=true`
- `FOSU_DATA_DIR=/app/data`
- `FOSU_SEED_DATA_DIR=/app/seed-data`
- `FOSU_STORAGE_DIR=/app/storage`
- `FOSU_STARTUP_DATA_RECONCILIATION_ENABLED=false`，镜像替换不得在启动时迁移 Term、重写 Lifecycle 或补写 Active Pointer
- `imageTarget=browser`，直至个人课表 APaaS 导入被证明不依赖 Chromium

部署脚本不改写 `.env`。候选 Rollout 版本和写模块只作为本次 Compose 调用的进程环境注入；失败回滚时使用旧容器记录的写模块和 Rollout 版本启动旧 Digest。因此 AI、认证、静态资源、导入与其他运行参数保持原样，Repository Variables 也不参与生产应用配置重写。

## 首次持久化迁移与回滚前置

首次挂载 `${FOSU_RUNTIME_DATA_HOST_DIR}:/app/data` 前，部署必须：

1. 确认当前旧容器存在；
2. 记录旧容器原始状态并冻结写入；
3. 检查旧容器 `/app/data` 是否已经是专用 bind 且 receipt 与 migration marker 绑定；若不是，每次尝试都把已有未投产 target 原子移入权限为 `0700` 的 quarantine，再从冻结的权威旧容器导出一个全新 generation；
4. 生成时间戳 `tar.gz`、SHA256 sidecar、独立 Manifest、逐文件哈希和 `.fosu-runtime-migration.json`，并实际解压 tar 后逐文件比对；
5. 在随机的 `127.0.0.1` 临时端口启动 shadow：使用数据副本、只读 `storage`/OpenResty bind，并关闭发布与维护 worker；shadow smoke 通过后才允许替换正式 `18318` 服务；
6. 失败时恢复原容器状态；若正式替换已经开始，只能回到可信的上一 Digest，并在相同专用数据 bind 上验证持久化快照。

允许写入的持久化根只有经 `docker inspect` 验证为显式 durable bind 的 `/app/data`、`/app/storage`、`/openresty-static/releases` 和 `/openresty-static/runtime`。`FOSU_ASSISTANT_KB_PATH`、`FOSU_AI_PROVIDER_CONFIG_PATH`、`RELAY_DIR`、`STAGING_DIR`、OpenResty 路径及静态同步锁/状态路径必须为空或落在这些根内；检查只输出变量名与 `empty/inside/outside`，不输出配置值。

若 VPS 没有由既往成功流水线写入、且与当前容器精确 `.Config.Image` 相等的 `last-healthy-image.txt`，回滚 Digest 必须记录为 `UNKNOWN (bootstrap cutover)`，流水线在停止容器或迁移数据前失败。当前镜像仅仅“看起来是精确 Digest”、Repository Variable 或任意未验证 GHCR Digest 都不能充当上一健康回滚点；若要完成首次引导，必须另行把现有 Digest 在同一 ARM64 主机和 shadow 数据副本上验证并明确记录为 `bootstrap-validated`，不能伪称 previously deployed。

每次成功部署把候选 Digest、上一健康 Digest、Rollout 版本和时间写入宿主机专用的 `server/.deploy/last-deployment.json`；VPS 实测的旧/新镜像本地 Size 与 `docker history` 写入 `server/.deploy/evidence/<commit>-<attempt>-image-sizes.json`。该目录不挂载给应用容器，运行中的服务不能伪造可信回滚指针。CI 同时保留 core/browser 的 OCI Manifest、config/layer descriptor 和压缩字节 JSON artifact。

## Deprecated

`FOSU_STATIC_TICKET_SECRET` 已废弃，替代项为 `FOSU_STATIC_TICKET_SECRET_CURRENT`。流水线不会读取、传输或写入两者；既有 VPS 配置由运行时兼容逻辑读取。

## 不属于镜像部署的操作

这条流水线不会发布 GitHub Release，不调用 `release-auto`/`release-cutover`，不修改静态 Active Pointer，不激活学期，不切换 Admin Primary，也不删除 Legacy 后台。
