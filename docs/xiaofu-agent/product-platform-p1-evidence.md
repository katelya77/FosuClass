# 小佛助手产品平台 P1 生产接线证据

> 验证日期：2026-07-30（Asia/Shanghai）
> 基线：`origin/main@c3eae84881bbda121d35776018b6d85a9162260e`
> 分支：`codex/xiaofu-agent-product-platform`
> 范围：P1 通用包边界、现有 Fosu Runtime 生产接线、统一 HTTP 传输、运行时真相后台和一体化镜像装载。

## 1. P1 结论

P1 已把现有在线 Turn 的编排入口切到共享平台调用链。新增目录不是脚手架：生产 `server/src/app.js` 在启动时绑定同一个 `apps/agent-server` 实例；该实例实际调用 `packages/agent-runtime`，并由 `plugins/fosu-campus` 注入现有 Manifest、Skill、Tool、Release 上下文和五个阶段端口。旧 `/agent/chat`、`/agent/agui` 与 `/agent/runs` 只保留协议/传输兼容，不再拥有另一份 Agent 执行闭包。

已满足本阶段的 R1、R4.4–R4.8、R10.4、R11.1、R11.4 接线要求。P2 的 strict_model_first、统一 Decision、Deadline 和持久性能分位数尚未在 P1 声称完成。

## 2. 唯一生产调用链

真实导入和执行顺序为：

```text
server/src/app.js
  → server/src/services/ai/platformComposition.js
  → apps/agent-server/createRunHandlers
  → apps/agent-server/createAgentPlatform
  → packages/agent-runtime
  → plugins/fosu-campus stages
      → Context
      → Decision
      → packages/skill-runtime + packages/tool-runtime
      → existing authoritative campus Tool implementation
      → Verification
      → Response
  → packages/ui-schema
  → RunEvent Repository
  → Run poll / legacy chat / AG-UI
```

后台真相链为：

```text
server/src/routes/admin.js
  → apps/agent-admin
  → the same platformComposition singleton
  → the same in-process PlatformTrace repository
```

生产接线断言由 `tools/test-agent-platform-production-wiring.js`、`tools/test-agent-platform-http.js` 和 `tools/test-agent-platform-admin.js` 执行。HTTP 测试启动真实 Express app，创建 Run、轮询终态，并调用 chat 与 AG-UI；三者均返回 `@xiaofu-agent/agent-runtime` Trace。Run 事件中存在真实 `runtime.entered`、`stage.started`、`runtime.completed`，且 Repository 对外只暴露一个、位于末尾的终态事件。

## 3. 新目录的实际运行用途

| 目录 | 生产调用者 | 已执行行为 | 证据 |
| --- | --- | --- | --- |
| `packages/agent-protocol` | `agent-runtime`、Run event catalog、`agent-admin` | RunEvent、Trace、公开字段脱敏 | contracts + HTTP + admin tests |
| `packages/ui-schema` | `agent-runtime`、Fosu plugin | 结果转通用 UI blocks、拒绝任意组件 | contracts + production wiring |
| `packages/skill-runtime` | `platformComposition`、`AgentKernel` | 不可变 Skill catalog、精确候选解析 | capability runtimes + production wiring |
| `packages/tool-runtime` | `platformComposition`、`AgentKernel` | 五因子 exact-match、输入/输出 Schema、Abort | capability runtimes + production wiring |
| `packages/agent-runtime` | `apps/agent-server` | 固定五阶段生命周期、不可变交接、Trace、UI | lifecycle + HTTP tests |
| `plugins/fosu-campus` | `platformComposition` | 注入权威 Manifest、校园 Tool、Release 上下文和阶段端口 | plugin + production wiring tests |
| `apps/agent-server` | `server/src/app.js` | Run/create/poll/cancel、chat/agui 兼容、单平台执行 | real HTTP test |
| `apps/agent-admin` | `server/src/routes/admin.js` | 认证后的 topology/recent runs 运行时真相 | authenticated admin HTTP test |

`tools/test-agent-generic-package-boundaries.js` 扫描 `packages/**` 与 `apps/**` 的 JavaScript/JSON，拒绝 Fosu 名称、校名、专属请求头和 Release Pack 固定路径。部署专属 principal、poll credential 与 Repository 名称均由 `server` Composition Root 注入。

## 4. 安全 Trace 样例

以下为 public、无个人课表输入的本机执行摘要；ID 仅为测试 Run ID：

```json
{
  "runId": "run_44f62180-9cd3-49ab-aa6a-60ddd30540b6",
  "runtimePackage": "@xiaofu-agent/agent-runtime",
  "configVersion": "manifest:agent-capabilities.v1",
  "pluginIds": ["fosu-campus"],
  "stages": [
    "context:success",
    "decision:success",
    "skill_tool:success",
    "verification:success",
    "response:success",
    "ui:success",
    "total:success"
  ],
  "uiBlockTypes": ["text"],
  "externalProviderUsed": false
}
```

Trace 只包含阶段、ID、计数、耗时、结果类型和版本；不包含 Prompt、隐藏推理、凭据、完整课表或原始 Tool 结果。认证后台返回体另经 `agent-protocol.sanitizePublicValue` 裁剪。

## 5. 独立提交

| Commit | 内容 |
| --- | --- |
| `76a16f6a` | Agent protocol 与 UI Schema 可执行契约 |
| `f4e62b99` | Skill/Tool Runtime 与五因子 exact-match |
| `bb4d4fc7` | Fosu campus plugin 注入 |
| `c179fd18` | 通用 Runtime 生命周期与 Trace |
| `96e34ef5` | 现有 Fosu Turn 迁入五阶段生产链 |
| `4c8b2328` | Run/chat/AG-UI 汇入单一 app service |
| `aa023a70` | Admin topology/recent Trace 真相接口 |
| `e9d1cd73` | 一体化 Docker workspace 装载与 CI 门禁 |
| `09ca0abd` | 移除通用 app 的部署专属身份/请求头假设 |

旧 `agentService.chat()` 已降为调用 `platformComposition.getPlatform().executeTurn()` 的兼容门面；旧大段私有编排已迁至注入式 Fosu stage ports，不存在第二个 whole-chat callback。

## 6. 新鲜验证结果

边界修正后的最终一轮结果：

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `npm ci --ignore-scripts` | PASS | 根 workspace lockfile 可重建 |
| `npm run test:agent-platform-p1` | PASS | contracts、runtimes、plugin、生产链、HTTP、Admin、边界、模块装载 |
| `npm run test:agent-foundation` | PASS，42/42 | 已包含全部 P1 专项与通用边界扫描 |
| `npm run test:agent-regression` | PASS，134/134 | 自动发现新增 `test-agent-*` 测试 |
| `npm run test:ai-competition` | PASS | 包含 public 安全、Provider、模块装载与无密钥检查 |
| `npm run test:agent-final-convergence` | PASS | Planner、Observation、RAG、Composer、Memory、UI |
| `npm run test:agent-phase2` | PASS，11/11 | Memory、KB、MCP、UI |
| `npm run test:agent-phase3` | PASS，27/27 | RunEvent、Readiness、Provider、实时 UI 等 |
| `npm run test:agent-release-gate` | PASS，15/15 steps | P1 专项已成为第一步；完整发布/安全门禁通过 |
| `npm run test:no-ai-secret-committed` | PASS | 未发现提交密钥 |
| `npm run test:docker-secret-scan` | PASS | Docker context 排除 `.env`、storage、node_modules 等 |
| `git diff --check` | PASS | 无空白错误 |

测试日志中的 `wx.request failed` 是既有小程序断网 fixture 的预期诊断；npm 的 `electron_mirror` 是本机 npm 配置弃用警告，不是门禁失败。

## 7. Docker 与环境状态

- 代码/静态契约：PASS。`server/Dockerfile` 从仓库根构建，安装 root workspace 与 server production dependencies，镜像包含 `/app/server`、`/app/packages`、`/app/plugins`、`/app/apps`，并从 `/app/server` 启动；原 `/app/data` 与 `/app/storage` 持久路径保持不变。
- 本机容器：**未验证**。Docker CLI 存在但 daemon 不可连接；`tools/test-server-docker-smoke.js` 按既有规则在非 CI 明确 skip，未描述为通过。
- CI 容器：待分支推送后的 GitHub Actions。CI 环境中 daemon 不可用会 hard fail；smoke 将校验平台目录、认证 topology 和一个 public Run。
- ARM64/AMD64 manifest：属于 P5，P1 未声称完成。
- CloudBase、体验版、真机、生产：本阶段均未部署、未上传、未验证。

## 8. 回滚

P1 无数据库迁移和不可逆写入。需要回滚时按下列顺序逐个 `git revert`，不使用 reset：

```text
09ca0abd → e9d1cd73 → aa023a70 → 4c8b2328 → 96e34ef5
→ c179fd18 → bb4d4fc7 → f4e62b99 → 76a16f6a
```

在 `4c8b2328` 回滚后，旧 route 执行闭包恢复；在 `96e34ef5` 回滚后，`agentService` 原编排恢复。每一步都需重新运行 Agent mandatory gates。

## 9. 明确留给后续阶段的缺口

- trial/dev 仍是旧 Understanding + Planner 语义，尚未实现一次统一 Decision 和 strict_model_first 默认；后台 topology 对此诚实返回 `legacy_configured`、`strictModelFirstReady=false`。
- Run Repository 当前仍为单进程、短 TTL 内存存储；真正的幂等、重启恢复与多实例持久化在 P6。
- 总 Deadline、分阶段预算、一次受控 Provider fallback、六阶段 P50/P95 在 P2。
- 成熟长期 Memory 在 P3；统一热发布、MCP/RAG Runtime 在 P4；Standalone 和多架构镜像在 P5。
- OpenAI/Pi Engine Adapter 在核心平台验收完成后的 P7。
