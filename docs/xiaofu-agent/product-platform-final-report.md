# FosuClass 小佛助手 Agent 平台产品化与高可靠运行时重构 — 最终交付报告

状态：**已完成（生产已部署并观察通过；staging live / 真机 / 体验版如实标未验证，P7b/P7c deferred）** ｜ 分支：codex/xiaofu-agent-product-platform ｜ 日期：2026-08-01

> 口径纪律：本报告严格区分 **代码完成 / mock conformance / 本地集成 / staging live / Docker build / Docker smoke / DevTools / 真机 / 体验版 / 生产**。未验证项如实标注，不以 mock 冒充真实 Provider，不以 build verified 冒充 smoke verified。

## 1. 阶段完成矩阵

| 阶段 | 内容 | 提交 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| 文档 | 审计 / 设计 / CONTEXT.md / ADR 0006-0008 / tasks.md / 治理规则 | 32712842 + 1e5d047b + 65f10987 等 | specs/xiaofu-agent-product-platform/、docs/adr/ | ✅ 已提交 |
| P1 | 平台生产接线（Runtime 契约 / Skill/Tool / 插件注入 / Run 服务统一传输） | 76a16f6a…46b2d63b | docs/xiaofu-agent/product-platform-p1-evidence.md | ✅ 已提交 |
| P2 | 模型优先统一 Decision + 有界 Provider Runtime + 端到端预算 | b8b757d1 + 15c6930c + 39c8ee3d + 0c6f0958 | docs/xiaofu-agent/product-platform-p2-evidence.md | ✅ 已提交 |
| P3 | 成熟记忆（ContextAssembler / H1/H2/M1/M3/M4/M5/Low×6） | 295c5820 | docs/xiaofu-agent/product-platform-p3-evidence.md | ✅ 已提交 |
| P2R | plan.steps 真实消费 / fallback 分类 / outcome-aware 指标 | 9b096340 | docs/xiaofu-agent/product-platform-p2r-evidence.md | ✅ 已提交 |
| P4a | 版本化配置发布内核 | d7288a87 + f0b11dd4 | docs/xiaofu-agent/product-platform-p4a-evidence.md | ✅ 已提交 |
| P4b | 四域热发布 Adapter | e77fbdae + f4307e8a | docs/xiaofu-agent/product-platform-p4b-evidence.md | ✅ 已提交 |
| P4c | 受控 MCP Runtime | 46fa82fd | docs/xiaofu-agent/product-platform-p4c-evidence.md | ✅ 已提交 |
| P4d | 版本化混合 RAG Runtime | b216dcea + 7df2b6e7 | docs/xiaofu-agent/product-platform-p4d-evidence.md | ✅ 已提交 |
| P4e | Runtime 支撑的控制面 | 8601771d + 2a6b025d + afd9738f | docs/xiaofu-agent/product-platform-p4e-evidence.md | ✅ 已提交 |
| P5a | PostgreSQL/pgvector/Redis 持久化 | db6b891e…b9c25c13（12 提交） | docs/xiaofu-agent/product-platform-p5a-evidence.md | ✅ 已提交 |
| P5b | standalone 服务拓扑 | 2a03dc00 + 03e49ddb + e984124e | docs/xiaofu-agent/product-platform-p5b-evidence.md | ✅ 已提交 |
| P5c | 多架构交付 | 4624b81b | docs/xiaofu-agent/product-platform-p5c-evidence.md | ✅ 已提交（CI 双架构 smoke/manifest/digest 已实测回填，见 §2.5） |
| P6a | Agent SDK + 可恢复 Run 协议 | e7d6f075 | docs/xiaofu-agent/product-platform-p6a-evidence.md | ✅ 已提交 |
| P6b | 小程序壳 + UI Block | 7234618b | docs/xiaofu-agent/product-platform-p6b-evidence.md | ✅ 已提交 |
| P7a | Engine 契约 + Fosu conformance | 5ba5818b | docs/xiaofu-agent/product-platform-p7a-evidence.md | ✅ 已提交 |
| P7b/P7c | OpenAI / Pi Adapter | — | docs/xiaofu-agent/engine-adapter-research.md | ⏸ **deferred / not implemented** |
| P8 | 收敛 / PR / 合并 / 部署 / 观察 | 本次提交 | 本报告 + p8-manual-acceptance.md | 🔄 进行中 |

## 2. 验证证据分级（严格区分）

### 2.1 代码与自动化测试（本机真实执行）

- 提交链：c3eae848..HEAD 共 49 个阶段提交，每个提交前均跑通对应门禁链。
- P8 终跑（本机）：`npm run test:agent-phase2 && npm run test:agent-release-gate && git diff --check && npm run test:no-ai-secret-committed` → **ALL_GATES_GREEN**（日志见会话任务记录；release-gate 含 p1/p2/p3/p4a–p4e/p5a/p5b/p7a + memory-autonomy/foundation/regression/final-convergence/task-gates/phase3/ai-competition/包卫生/docker smoke/release:preflight/security:acceptance 全段）。
- P8 收敛改动：release-gate 补登 `test:agent-platform-p3` 段（原缺，现与 package.json 段定义一致）；许可证统一为 MIT 并新增根 LICENSE（见 §4）；`deploy-vps.yml` 部署前备份/部署后版本标记经 `server/scripts/deploy-guard.sh` 接入 CI（见 §6）；tasks.md P4d 勾选与交付事实同步（复审 Minor-4）。
- 独立代码复审（P8，两轴 Standards/Spec，49 提交全量）：**Critical=0、Important=0**；六项核心不变量（packages/apps 无 Fosu 耦合、public 零外部 Provider、无密钥入库、RunEvent 真实性、单一状态源、agent.v1 兼容）逐项 PASS 并附代码证据；8 条 Minor 见 §5，不阻塞合并。
- P6a/P6b 测试经 regression runner 自动发现（test-agent-sdk.js / test-xiaofu-agent-run-shell.js / test-xiaofu-ui-block-adapter.js 命中 test-{agent,xiaofu}-* 模式），已在门禁链内。

### 2.2 Mock conformance

- 三 Provider（DeepSeek/OpenAI/Anthropic 形态）mock conformance：经 `test:provider-runtime-matrix`、`test:coze-provider-v3`（phase3 段）与 P2 有界 Provider Runtime 测试覆盖；超时 / 429 / 5xx / 不可重试错误 / 单次受控 fallback 行为由 `tools/test-agent-deadline-runtime.js` 以可控延迟 Provider 证明。
- strict_model_first 首个真实 Decision 来源：`tools/test-agent-strict-first-call-proof.js`（p3 段）断言首调用来自真实 Provider 路径而非规则冒充。

### 2.3 本地集成测试

- integrated 模式：文件/SQLite 持久化、Run API（202 返回 runId + pollToken）、cursor 增量恢复、取消端到端、发布链路（draft→validate→test→publish→hot reload→rollback）由 p4a/p5a/p6a 各段集成测试覆盖。
- standalone 拓扑：server/worker/migrate 角色、健康检查（liveness/readiness/startup 分级）、命名卷、无 fosu-campus 插件时通用平台闭环，由 `tools/test-agent-p5b-standalone.js` 覆盖。

### 2.4 Staging live（真实 Provider）

**not verified（本机）**。本机项目凭据实测 401 失效，无法执行真实 staging probe；按治理规则，凭据可用时须以预算与调用上限单独执行，证据只记录 Provider 类型、结果、延迟与错误分类。CI 侧若注入有效 Secrets 可执行 probe；截至本报告编写，无 CI staging live 记录。Mock 数字未冒充 staging-live。

### 2.5 Docker

- 本机 amd64：**smoke verified**（P5c 证据 §2 真实观测：镜像构建 + standalone compose smoke，含迁移/健康/发布/Run/RAG/重启持久/回滚 18 项）。
- CI（首推实测，run 30704487781，sha-f2253be3）：amd64 build + compose smoke ✅、arm64（ubuntu-24.04-arm 原生 runner）build + compose smoke ✅、`sha-<sha>` 多架构 manifest ✅——双架构均启动容器跑过 standalone smoke，属 **smoke verified**（非仅 build verified）。
- GHCR digest（`ghcr.io/katelya77/fosu-agent-platform`）：manifest `sha-f2253be35c57db189c406a8d51f1f652d9670c0e@sha256:9445e2985856d324cd5b42aff73ad642c83a37c711602a41dab23791e979541b`；amd64 `sha256:8c576a6d0f02b2804f86f5ca5bc40d66c630d06b0f203e5f0cc9cfe446215c43`；arm64 `sha256:123050e3b20a128a02df8e34a72990f22133ac8087eb264cdfe2c45ba2b883d4`。
- 生产 API 镜像（`ghcr.io/katelya77/fosuclass-api`，既有生产工作流）：push 触发只发布 arm64（与 Oracle ARM 生产一致，amd64 经 workflow_dispatch 手动发布），sha-f2253be3 digest `sha256:0af456bf2d8845f5042daef53360a246ecc681adaa62155ce346d768fee965b7`；PR #40 未改 server 源码，digest 保持有效。
- 纪律：无 floating latest；生产部署依据 = `sha-<sha>` tag / digest。

### 2.6 DevTools

P6b：真实 IDE 自动化 smoke **13/13 PASS**（tools/devtools-smoke.js，日志 .tmp/p6b-devtools-smoke-6.log）。

### 2.7 真机 / 体验版（人工）

**未验证**。验收清单、证据模板、预期 RunEvent 路径、失败收集模板已交付：docs/xiaofu-agent/product-platform-p8-manual-acceptance.md。未完成前本报告不写「真机通过」或「生产可用」。

### 2.8 生产

**已部署并观察通过**（Deploy to VPS run 30705278409，2026-08-01）。

- 部署链：PR #37 合并（d3b49c03）后前两次部署均被 deploy-guard **安全中止于任何变更之前**（①pre 备份 tar 读取容器属主文件 Permission denied → 修复 67b2d0a8，PR #39；②VPS 根上下文构建缺 packages/apps 源 → SCP 修复 ca947f87，PR #40），期间生产持续运行旧版、健康 200，回滚保护按设计生效；修复后第三次部署全绿（ci 6m59s 含 release-gate + deploy 2m54s）。
- 部署摘要（工作流实测输出）：`commit_sha=1f6ac3b61feea6dc5123f720f6260c18334fc304`、`container_health=healthy`、`active_release=synced_release=2026-07-07T15-02-30`、`runtime_status=200`、Release Pack 静态源 `manifest.json/index/class/all.json/empty-room/index.json` 全 200、`files_copied=0`、elapsed 107s。
- 部署前备份：`$APP_DIR/backups/20260801T151705Z`（server/storage + .env + 部署前状态，保留 15 份）；部署后由 `deploy-guard.sh post` 写入版本标记。
- 部署后 smoke（本机经 Cloudflare 实测）：`/api/health` 200；`/api/ai/agent/readiness` 200（runtimeMode=public、runEventsSupported=true）；`/api/fosu/runtime/active` 200；`/api/fosu/teaching-calendar` 200；`/api/fosu/release-pack/manifest` 200（393KB）；`/api/fosu/search/teachers` 200（URL 编码查询）。
- public 零外部调用：readiness 显示 public 运行时 providerConfigured=false；Provider 状态检查为 statusOnly（无真实外呼）；生产链 `externalProviderUsed === false` 不变量由测试断言。
- 观察期：15:23:55–15:37:32 UTC（13.5 分钟 ≥10 分钟，覆盖部署后 5–19 分钟），每 ~45–60s 探测 health + readiness + manifest 共 15 次——14 次全 200；1 次（15:28:42）health 15s 超时但同轮 manifest 200、下轮即恢复，判定为链路瞬时抖动而非持续性失败，未命中治理第十三节任何回滚条件。观察期 `gh run list` 无连锁失败。
- **生产 SHA**：`1f6ac3b61feea6dc5123f720f6260c18334fc304`（本报告回填为其后 docs-only 提交，部署链将以同一代码重跑一次）。
- **镜像 digest**：生产为 VPS 本地构建（源 = 上述 SHA）；发布产物 digest 见 §2.5/§7（平台镜像 manifest `sha256:9445e298…`、API 镜像 arm64 `sha256:0af456bf…`）。
- **configVersion**：未变更（本次部署未通过控制面发布新配置版本）。
- **回滚目标**：上一稳定生产部署 `c3eae848`（2026-07-29，run 30461287234）；回滚 = `git revert` 合并提交推 main 自动重部署 + `$APP_DIR/backups/latest` 数据备份。

## 3. 性能证据

Runtime overhead baseline（本地受控 Mock，来源 `node tools/test-agent-performance-budget.js`，本机 Windows、Node v24.15.0、无外部网络、Mock Provider 固定 1–4ms、固定 workload、warm-up 隔离）：

| 项目 | 结果 | 门槛 |
|---|---:|---:|
| 首个持久真实 RunEvent | 1 ms | ≤500 ms |
| 简单 Turn P95（success-only） | 79 ms | ≤6 s |
| 多工具 Turn P95（success-only） | 78 ms | ≤12 s |
| Run 硬上限 | 15,000 ms | ≤15 s |

- 数字只证明本项目运行时开销与预算机制，**不含真实 Provider 网络时延**（是否 Mock：是）。
- 硬上限由 `test-agent-deadline-runtime.js` 以可控延迟 Provider 证明生效（Deadline / AbortSignal / 阶段租约 / fallback 共享账本 / 取消传播 / keep-alive 复用）。
- 指标口径（P2R）：低基数标签桶（stage × outcome × executionPolicy × usedFallback × providerClass × taskComplexity × environment）；success-only 与 all-runs P50/P95 分离；fallback/non-fallback 分离；warm-up 计数不入统计；首事件延迟独立成桶并经生产 diagnostics 透出。
- Real-provider end-to-end latency：**not verified**（见 §2.4）。

## 4. 安全与合规

- 敏感信息扫描：`npm run test:no-ai-secret-committed` 全仓库目录树（含 .tmp）通过，无 allowlist；P7a 期间曾命中测试文件静态假密钥字面量，已改为运行时拼接并固化为回归（终审绿）。
- public 零外部 Provider 调用：`tools/test-ai-provider-policy.js` 断言 policy=always 时 public 仍不调用外部 Provider；`tools/test-agent-platform-production-wiring.js` 断言生产链 `externalProviderUsed === false`。
- 密钥纪律：真实凭据只经环境变量/Secret 文件注入；不进镜像、Compose 示例、Artifact、数据库明文字段、Run Trace、日志、导出文件；`.env.example` 仅占位值。
- 许可证（P8 收敛）：统一为 **MIT**——根 package.json 由 ISC 改 MIT 并新增根 LICENSE 文件；`packages/mcp-runtime`、`packages/rag-runtime` 由 UNLICENSED 改 MIT（与其余 7 个 platform 包一致）；`private: true` 保留为防误发布 npm 的护栏，不影响仓库级开源复用口径。
- 安全债务：无新增；如后续发现凭据曾明文入史，按治理规则单独标记与轮换。

## 5. 延期与开放项

- **P7b / P7c：deferred / not implemented**。重启门槛（P3/P2R/P4–P6 全绿 + release-gate 全绿 + smoke 完成 + public 零调用 + strict_model_first 证据 + 真机无 Critical/Important + 预算充足 + 用户授权）见 tasks.md 与 docs/xiaofu-agent/engine-adapter-research.md。当前只能表述：Engine Adapter 契约已完成、Fosu Engine 已经统一 Adapter 生产接线并通过 conformance；不得表述三种 Engine 已完成。
- ~~**P5c CI 回填项**~~（已闭环）：arm64 smoke、多架构 manifest、GHCR digest 已随首推实测回填（见 §2.5）。
- **Staging live**：待有效凭据与受控注入（见 §2.4）。
- **真机 / 体验版人工验收**：清单已交付，待人工执行（见 §2.7）。
- **开发者 quickstart 的 Engine 概念**：明确决定不补——Engine Adapter 是内部接缝，外部开发者消费 Provider/Skill/Tool/MCP/RAG/UI Schema 插件接口，不直接消费 Engine 契约；实验 Adapter 均未实现，写入 quickstart 会误导。
- **独立复审 Minor 遗留（8 条，不阻塞合并，转跟踪 Issue）**：
  1. public 零调用最强证明在 runtime/引擎层，可补一条 HTTP 级端到端断言（test-ai-provider-policy.js 目前为谓词级）。
  2. agent-sdk `cancelRun`/`poll` 存在直写 status 旁路 reducer 的路径；服务端自相矛盾终态理论上可改写本地终态，建议统一经 reducer 归并。
  3. ai-assistant `onCancelRun` 与 shell `cancelActiveRun` 取消双发（服务端幂等吸收，无实际危害），建议统一走 shell。
  4. ~~tasks.md P4d 勾选未同步~~（P8 已修复）。
  5. `providerChainService.generateWithChain` 自身无 public 检查，门禁依赖唯一入口（当前双保险安全，属潜在薄弱点）。
  6. `providerRuntime.probe()` 不检查 runtimeMode（当前无未设防调用方，休眠隐患）。
  7. 配置内核 `saveDraft` 不扫密钥形态（展示恒 REDACTED、过不了 validate、进不了 Artifact 链，残余风险低）。
  8. 双检索栈（校园业务检索 vs 平台 rag-runtime）边界目前仅在 P4d 证据 §1.3 记述，建议后续沉淀为 ADR。

## 6. 回滚方案

- 代码：每阶段独立提交（见 §1 提交列），单阶段回归 = `git revert <阶段提交>` 后重跑门禁；提交链 c3eae848..HEAD 全程可逐段回退。
- 配置发布：控制面 draft→validate→test→publish→hot reload 具备版本指针与 rollback（p4a–p4e 证据）；Artifact 损坏 fail closed 并允许回滚；服务重启恢复 published pointer 与 configVersion。
- 生产（P8 起经 CI 内置门禁）：`deploy-vps.yml` 在任何变更前执行 `server/scripts/deploy-guard.sh pre`——时间戳备份 `server/storage` + `.env` + 部署前状态记录（previousDeployedSha/previousImage/newCommitSha，读取上一部署经全部健康门后由 `deploy-guard.sh post` 写入的标记），备份不可读即中止部署；保留最近 15 份。回滚 = `git revert` 合并提交 → push main → 工作流自动重部署旧代码与静态文件（静态 Release/runtime 为仓库镜像，每次部署重新同步，故不重复打包）；数据恢复取自 `$APP_DIR/backups/latest`（需人工决策时由维护者执行）。数据库迁移遵循 expand-contract，本次自动流程不执行不可逆 drop/truncate/大规模重写。
- 回滚触发条件与动作：见 specs/xiaofu-agent-product-platform/execution-governance.md 第十三节（健康持续失败 / 容器反复重启 / 核心 API 5xx / 关键业务失效 / public 外部调用 >0 等任一命中即自动回滚 + Issue + 报告）。

## 7. 交付物索引

- PR：#37（主体交付 51 提交，已合并 d3b49c03）、#39（部署门禁 sudo 修复，已合并 f2253be3）、#40（SCP 根上下文修复，已合并 1f6ac3b6）；本报告回填随收尾 docs PR 并入 main。跟踪 Issue：#38（复审 8 条 Minor）。
- 镜像 manifest / digest：平台镜像多架构 manifest `ghcr.io/katelya77/fosu-agent-platform:sha-f2253be35c57db189c406a8d51f1f652d9670c0e@sha256:9445e2985856d324cd5b42aff73ad642c83a37c711602a41dab23791e979541b`（amd64 `8c576a6d…`、arm64 `123050e3…`，CI run 30704487781 产物 image-digest.txt / manifest-inspect.txt）；生产 API 镜像 arm64 `ghcr.io/katelya77/fosuclass-api:sha-f2253be35c57db189c406a8d51f1f652d9670c0e@sha256:0af456bf2d8845f5042daef53360a246ecc681adaa62155ce346d768fee965b7`（CI run 30704487761）。
- 规格与治理：specs/xiaofu-agent-product-platform/（tasks.md、execution-governance.md）。
- ADR：docs/adr/0006（Memory-to-Provider Context Boundary）、0007（Deterministic Local Encoder）、0008（Engine Adapter Contract）。
- 证据链：docs/xiaofu-agent/product-platform-{audit,p1,p2,p2r,p3,p4a–p4e,p5a,p5b,p5c,p6a,p6b,p7a}-evidence.md + engine-adapter-research.md + 本报告 + p8-manual-acceptance.md。
- 部署文档：docs/deployment/{developer-quickstart,1panel,oracle-arm}.md；deploy/standalone/{docker-compose.yml,.env.example}。
