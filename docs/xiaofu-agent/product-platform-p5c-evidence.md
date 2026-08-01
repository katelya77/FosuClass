# P5c 多架构交付证据（Multi-Architecture Delivery）

日期：2026-08-01。阶段提交：`build(agent): publish multi-architecture platform image`。

## 1. 交付物

- `tools/standalone-compose-smoke.js`：永久 standalone compose 18 条验收工具
  （由 P5b 一次性编排脚本泛化：SMOKE_IMAGE/SMOKE_PROJECT/SMOKE_PORT/SMOKE_SKIP_BUILD/
  SMOKE_KEEP 全 env 化；密钥仍只落 mkdtemp；transcript 落
  `.tmp/standalone-compose-smoke-transcript.log` 并带 mkdir 兜底）。
  **不进入 release-gate 聚合**：compose 全栈依赖 Docker 且耗时数分钟，
  作为发布工作流逐架构步骤与本地显式验收使用（命名刻意不带 `test-agent-` 前缀，
  避免被 regression runner 自动纳入拖垮聚合门禁）。
- `.github/workflows/agent-platform-publish.yml`：多架构发布工作流（新增，
  不触碰既有 `container-publish.yml` 的 fosuclass-api 发布链）。
  - 触发：push 到 `codex/xiaofu-agent-product-platform` / `main`（路径过滤
    server/**、deploy/standalone/**、apps/**、packages/**、smoke 工具、工作流自身）
    + workflow_dispatch。
  - `build-smoke-amd64`（ubuntu-latest）与 `build-smoke-arm64`（ubuntu-24.04-arm）：
    双**原生架构** runner 各自 buildx build（load）→ 真实 compose smoke
    （`SMOKE_SKIP_BUILD=1` 复用本架构本地镜像）→ smoke 过后才 push
    `sha-<sha>-<arch>`（provenance/sbom + digest artifact + transcript artifact）。
  - `manifest`（needs 两架构）：`imagetools create` 合并
    `ghcr.io/katelya77/fosu-agent-platform:sha-<sha>`（amd64+arm64 同一源码 SHA）。
  - 纪律：**无 floating latest**；生产部署依据 = `sha-<sha>` tag / digest。
- 文档对齐：`docs/deployment/oracle-arm.md` 的镜像来源与验证口径改为描述
  真实 CI 机制（双原生 runner + 逐架构 smoke + imagetools manifest；
  CI 原生 aarch64 runner 的 smoke 可如实标 arm64 smoke verified）；
  `1panel.md` / `developer-quickstart.md` 已分别覆盖 SHA 固定镜像与快速启动，
  无多架构缺口。
- 校验：工作流 YAML 经 js-yaml 解析通过（jobs: build-smoke-amd64,
  build-smoke-arm64, manifest）；smoke 工具 `node --check` 通过。

## 2. 本地 amd64：smoke verified（真实观测）

运行：2026-08-01T04:54:58Z → 04:56:09Z（本机 Docker Desktop，linux/amd64）。
命令：`node tools/standalone-compose-smoke.js`（默认构建
`fosu-agent-platform:local-smoke`，GIT_REVISION=e984124e）。
transcript：`.tmp/standalone-compose-smoke-transcript.log`。

- 镜像构建成功（desktop-linux buildx；镜像 ID
  `sha256:77296a4ec906281dd718ab46de2abd91b42b7aca43d5eac4caa9eee1435f0ac6`）。
- 18/18 PASS，关键观测：
  - readiness 九项：artifactRepository/configSnapshot/migration/postgres/
    publishedConfigVersion/ragBackend/redis/workerQueue=ok，
    provider=not_ready(PROVIDER_NOT_CONFIGURED, blocking=false)；
  - capabilities：`publicDeterministic=true, strictModelFirstReady=false,
    externalProviderCallsInPublic=0`；
  - 发布链：skill/tool/mcp/rag 各 v2 经 draft→validate→test→publish；
    read-only token 写操作 403；
  - Run 绑定 `cfg-public-0010-bedf7fd3ad20`；RunEvent 链完整（run.accepted →
    … → run.completed）；终态结果可恢复；
  - RAG 引用真实 docId `standalone-smoke-acceptance`（worker 异步索引）；
  - 重启后 configVersion/历史 Run/RAG 引用全在；
  - rollback 后新 Run 绑定 `cfg-public-0011-4d0bf1077d03`；
  - fosu-campus 未启用 501 NOT_ENABLED；请求启用 501 ASSEMBLY_NOT_IMPLEMENTED。

## 3. CI arm64 / manifest / GHCR：pending（如实）

以下项目的工作流已交付但**只有在 P8 首次 push 后才会真实执行**，当前状态一律
记为 pending，不预先宣称：

- CI amd64 镜像 build + compose smoke（预期 smoke verified，待运行）；
- CI arm64 镜像 build + compose smoke（ubuntu-24.04-arm 原生 aarch64，
  通过后可如实标 smoke verified）；
- `sha-<sha>` 多架构 manifest 创建与 inspect 记录；
- GHCR 镜像 digest 记录（artifact：image-digest.txt / manifest-inspect.txt）。

P8 收敛时以真实 workflow 运行结果回填本节与 tasks.md，若 CI 仅构建未起容器
则对应项只能标 build verified。

## 4. 边界

- 未修改 `container-publish.yml`，fosuclass-api 既有发布链零影响。
- 本地 smoke 构建时 GIT_REVISION=e984124e（运行时刻 HEAD）；镜像内容不含
  本阶段新增的工作流/工具/文档（它们不影响 server 运行时）。
- smoke 工具不进聚合门禁的理由已在本文件 §1 说明；P5b 阶段已验证的同套
  18 条断言语义未变（docId/命名泛化，断言逐字保留）。
- npm audit 报的既有依赖漏洞（axios-cookiejar-support 等）为仓库既有状态，
  非本阶段引入，出范围。

## 5. 门禁记录

- 本阶段定向验证：js-yaml 解析工作流通过；`node --check` 工具通过；
  本地 amd64 compose smoke 18/18 PASS（本文件 §2）。
- 提交前全门禁链（test:agent-phase2 + test:agent-release-gate +
  git diff --check + test:no-ai-secret-committed）结果随提交记录回填。
