# 小佛助手 Agent 产品平台现状审计

> - 审计日期：2026-07-30（Asia/Shanghai）
> - 审计基线：`main` / `origin/main` 均为 `c3eae84881bbda121d35776018b6d85a9162260e`
> - 工作分支：`codex/xiaofu-agent-product-platform`
> - 证据范围：仓库源码、PR #36、`agent-platform-implementation-handoff.md`、最新提交、Agent release gate 本机基线。未连接生产数据库、生产容器或真实 Provider 流量。

## 1. 结论摘要

| 审计问题 | 结论 | 可信边界 |
| --- | --- | --- |
| Agent 是否仍只运行在 `fosuclass-api` 单容器 | **是** | 当前默认 Dockerfile 只启动 `node src/app.js`；业务 API、Agent API 与 Admin 挂在同一 Express 进程。不存在独立 Agent Server/Worker。 |
| Understanding / Planner / Response 实际调用次数 | **按路径变化，当前 trial/dev 默认并非模型优先** | 高置信事实路径为 `0 / 0 / 0`；`project_qa` 常见为 `0 / 0 / 1`；未命中规则的普通对话常见为 `1 / 0 / 1`；需要模型规划的路径为 `1 / 1..3 / 0..1`。这表示语义阶段调用数，不等于底层 HTTP 尝试数。 |
| 三阶段 P50/P95 | **无法从当前事实源得出可信数值** | 仅有进程内、按 Provider 聚合的最近 100 个成功样本；混合 Understanding/Planner/Response/probe，失败耗时未进入 percentile，进程重启即丢失。阶段 P50/P95、总耗时 P50/P95 均未实现。 |
| `deterministic_rule_first` 是否绕过模型 | **是** | trial/dev 默认 `AI_UNDERSTANDING_RULE_FIRST=1`；命中后 Planner 又默认用 `AI_MODEL_PLANNER_RULE_FIRST_SKIP=1` 跳过。 |
| Runs / AG-UI 是否为线上唯一传输 | **否** | `/agent/chat`、`/agent/agui`、`/agent/runs` 并存；小程序 Runs 失败会回退 `/agent/chat`。AG-UI 当前是执行结束后的事件转换/回放，不是真实实时流。 |
| Memory / RAG / Skill / MCP / Provider 是否可热更新 | **只有局部能力** | Provider 可在单进程即时应用；知识库 lexical 部分可读到发布版本。Skill/Manifest 冻结于模块加载，MCP 未接入 Runtime，向量索引不会按知识版本自动重建，Memory 策略没有版本发布链。 |
| 后台显示是否等于真实执行 | **不等于** | Provider 配置读取基本同源，但后台没有执行策略，也看不到规则短路；`verified` 只表示本进程曾成功调用或 probe，不能证明当前 Turn 实际用了该 Provider。 |
| 通用内核是否已与 Fosu 业务解耦 | **否** | `toolRegistry`、Capability Manifest、Planner prompt、Composer、知识/RAG、路由和 UI 卡片均包含校园与 Release Pack 语义。目标 packages/apps/plugins 目录均不存在。 |

因此，PR #36 完成的是“单仓库内的 Agent 内核收敛和可靠性基础”，尚不是可独立部署、可后台热配置、可开源复用的 Agent 平台。

## 2. 审计方法与基线

已核对：

- 根目录 `AGENTS.md`；
- GitHub PR #36（已合并，Copilot 因变更超过审查上限未给出实质代码审查）；
- `docs/xiaofu-agent/agent-platform-implementation-handoff.md`；
- `docs/xiaofu-agent/agent-platform-migration-plan.md`；
- `docs/xiaofu-agent/unified-model-first-architecture.md`；
- `c3eae848` 及其前序 fast-path / memory / provider 相关提交；
- `.github/workflows/xiaofu-agent-ci.yml`、`.github/workflows/container-publish.yml`；
- 所有 Agent gate runner 与根 `package.json` 中的 Agent 测试入口。

Git 基线命令：

```text
git fetch --prune origin main
git rev-parse HEAD
git rev-parse origin/main
git rev-list --left-right --count main...origin/main
```

结果：本地与远端均为 `c3eae84881bbda121d35776018b6d85a9162260e`，ahead/behind 为 `0/0`，创建分支前工作树干净。

本机工具链：Node `v24.15.0`、npm `11.12.1`、Docker CLI `29.5.3`。Docker daemon 本次不可连接。

## 3. 当前真实运行与部署拓扑

### 3.1 默认部署仍是一个 API 容器

`server/Dockerfile` 的镜像标题仍是 `fosuclass-api`，最终命令为：

```text
CMD ["node", "src/app.js"]
```

`server/docker-compose.yml` 只有 `fosu-api` 一个服务。`server/src/app.js` 同时挂载：

- `/api/ai`：Agent、Memory、Run API；
- `/api/admin`：后台控制面 API；
- `/admin`：Legacy Admin 页面；
- 其余 FosuClass 业务 API、Release Pack 与静态资源。

当前没有：

- `apps/agent-server`；
- `agent-worker` 进程；
- 独立 Agent 镜像；
- Runtime 所需的 Postgres/pgvector/Redis 服务；
- Runtime/Admin 与 FosuClass 主业务 API 之间的进程边界。

结论：**当前 Agent 仍只在 `fosuclass-api` 单容器、单 Node.js 进程中运行。** CloudBase gateway 只是兼容代理，不是决策核心或独立 Runtime。

### 3.2 当前调用链

当前在线主链为：

```text
POST /api/ai/agent/runs（或 /agent/chat、/agent/agui）
→ server/src/services/ai/agentService.js
→ MemoryController
→ UnderstandingCoordinator
→ GoalContractResolver
→ PlannerCoordinator / AgentKernel
→ toolRegistry
→ VerificationCoordinator
→ ProviderOrchestrator / ResponseComposer
→ agent.v1 / agent.v2 payload
```

这条链仍直接回到 `server/src/services/ai/**` 私有实现，没有经过任何目标 `packages/*`。因此当前不能用目录或接口声明证明平台化。

## 4. 模型调用次数与延迟事实

### 4.1 当前默认调用次数矩阵

下表统计“语义阶段调用数”。Provider Chain 内同一阶段可能因瞬时连接错误重试一次，也可能继续尝试后备 Provider，所以真实 HTTP 请求数可以更高。

| Runtime / Turn 类型 | Understanding | Planner | Response | 当前证据 |
| --- | ---: | ---: | ---: | --- |
| public 任意安全 Turn | 0 | 0 | 0 | Structured inference 在 public 明确拒绝；Response 使用 deterministic/mock。 |
| trial/dev 高置信校园事实 | 0 | 0 | 0 | `deterministic_rule_first` 命中；rule-first planner skip；事实 Response 由确定性 Composer 渲染。 |
| trial/dev 显式 `project_qa` | 0 | 0 | 1 | 理解与规划被规则跳过，但表达层允许 Provider。 |
| trial/dev 未命中规则的普通对话 | 1 | 0 | 1 | Understanding 调用真实 Provider；无工具意图默认跳过 Planner；Response 再调用一次。 |
| trial/dev 需要模型规划的任务 | 1 | 1..3 | 0..1 | 初始 Planner 一次；Observation Loop 最多可 replan 2 次；事实结果通常 deterministic response，表达类可再调用 Response。 |
| 身份/偏好记忆短路 | 0 | 0 | 0 | `agentService` 在 Understanding 前直接处理部分记忆问句。 |
| 空消息、协议不兼容、凭据拦截、已取消 | 0 | 0 | 0 | 属于模型前安全例外。 |

`tools/test-agent-fast-path.js` 明确把事实路径“零 structured 调用”和记忆路径“全程零模型”作为当前通过条件。最新提交 `c3eae848` 也以 “factual path now zero structured calls” 为目标。该行为与本次要求的 trial/dev 默认 `strict_model_first` 直接冲突。

### 4.2 底层请求次数还可能被低估

`providerChainService.generateWithChain()` 对每个 Provider 的瞬时连接错误最多原地重试一次，再继续后备链。当前 `callCount` 只在 `markSuccess()` 增加；失败尝试只增加 `fallbackCount` 并写环形 call log。因此后台的 `callCount` 不是“实际 HTTP 尝试总数”。

要证明 `strict_model_first`，后续必须独立记录：

- `executionPolicy`；
- `intendedProvider`；
- `actualFirstProvider`；
- `decisionSource`；
- `goal`；
- `selectedSkill`；
- `fallbackPath`；
- 每个 attempt 的 stage、provider、开始/结束时间与结果。

### 4.3 当前 P50/P95 不能作为验收证据

| 指标 | 当前实现 | 问题 |
| --- | --- | --- |
| Provider P50/P95 | 每个 Provider 进程内保留最近 100 个成功 latency | 混合三个阶段与 probe；不含失败；重启丢失；不是阶段指标。 |
| Understanding latency | 单次 response/Run 的 `latencyMs` | 无持久 histogram，无 P50/P95。 |
| Planner latency | 单 Run diagnostics 累加初始 plan 与 replan | 无分次样本和 fleet percentile。 |
| Response latency | 单 Run `latencyMs` | 无持久 histogram。 |
| Agent total | 内存 trace 的 `totalDurationMs` | trace 只在本进程、最多固定条数、无 percentile API。 |
| createRun/tool/verification/首事件 | 未形成统一 stage timing | 目标六阶段指标无法计算。 |

本机没有正在监听的本地 Agent 服务，也没有生产 Trace 数据。故本审计对现有 P50/P95 的结论是 **N/A：缺少权威指标和足够样本**，不是 `0ms`，也不是测试通过。

后续性能验收必须落地统一 Run Trace：`createRun`、`decision`、`tool`、`verification`、`response`、`total`，并分别保留 success/failure/cancel/fallback 样本；再以相同任务分类计算简单任务与多工具任务的 P50/P95。

## 5. `deterministic_rule_first` 与模型优先语义

`understandingService` 在非 public 环境默认读取：

```text
AI_UNDERSTANDING_RULE_FIRST = 1
```

当 Manifest 标记 factual、意图为 `project_qa` 或规则分数足够高时，直接返回 `source=deterministic_rule_first`，不调用 Provider。

`modelPlanner` 又默认读取：

```text
AI_MODEL_PLANNER_RULE_FIRST_SKIP = 1
AI_MODEL_PLANNER_NO_TOOL_SKIP = 1
```

所以当前并不是文档所称的“每个安全 Turn 先模型理解”，而是规则优先快路径。更严重的是，这三个开关不属于后台正式的 execution policy；管理员可以看到已启用的 Provider，却无法从配置页得知当前 Turn 已被规则短路。

结论：

- public 的 deterministic 路径正确且必须保留；
- 当前 trial/dev 默认行为不满足 `strict_model_first`；
- 这些 skip 只能在 public 或显式 `adaptive` 下允许；
- 规则在 strict 模式只能做输入规范化、Schema 校验、权限交集和 Provider 失败后的受控 fallback，不能先决定 Goal。

## 6. Runs、RunEvent 与 AG-UI

### 6.1 Runs 不是唯一传输

服务端同时公开：

- `POST /api/ai/agent/chat`；
- `POST /api/ai/agent/agui`；
- `POST /api/ai/agent/runs`；
- `GET /api/ai/agent/runs/:runId`；
- `POST /api/ai/agent/runs/:runId/cancel`。

小程序生产配置默认启用 Runs，但 `agentRunClient` 超时后会走 direct chat fallback；显式关闭 Runs 开关时也会使用旧链。因此 Runs/AG-UI 不是线上唯一传输。

### 6.2 当前 Run API 的真实能力

已有能力：

- createRun 同步生成 `runId`/`pollToken` 并立即返回 `202`；
- `run.accepted` 在内存中同步追加；
- 事件有单调 `sequence`；
- GET 支持 `afterSequence`，可在同一进程、TTL 内增量续取；
- 最终 payload 可在短 TTL 内恢复；
- principal 或 poll token 隔离；
- terminal event 去重。

缺口：

- `idempotencyKey` 虽被路由 body 白名单接受，但没有传给 `createRun`，未实现幂等建 Run；
- Run Store 是模块级 `Map`，进程重启或切换实例后全部丢失；
- 事件最多保留 80 条，不是 durable event log；
- `DEFAULT_TOTAL_TIMEOUT_MS` 只存进 run record，没有真正包住执行；
- cancel 只设置内存标志，不向 Provider/Tool 传播 `AbortSignal`；
- worker 不存在；
- 多实例下没有共享状态或路由粘性保证。

### 6.3 AG-UI 不是实时链路

`/agent/agui` 当前先等待 `agentService.chat()` 完整完成，在内存收集事件，再由 `aguiAdapter` 转成 SSE/JSON 输出。它可以表达 AG-UI 事件形态，但不能证明执行过程实时到达客户端。

此外，adapter 会在缺失时补 `RUN_STARTED`/terminal 事件。该兼容行为不能被当成“服务端真实发生”的运行事实。

结论：后续应让 Run API 成为唯一在线执行入口，direct chat 只保留显式兼容层；AG-UI/SDK 订阅同一 durable RunEvent 源，而不是另跑一次或事后合成。

## 7. 热更新与控制面

| 模块 | 当前可热更新性 | 控制面成熟度 | 结论 |
| --- | --- | --- | --- |
| Provider | 保存后写 runtime config、应用到当前 `process.env`、重置熔断 | 有 configVersion、环境 profile、probe；没有 draft→validate→test→publish→rollback | **单进程即时生效，但不是完整发布系统**。多实例一致性也未解决。 |
| Skill | `skillRegistry` 在 require 时从 Manifest 构造并 `Object.freeze` | 无 Skill CRUD、测试、发布、版本、回滚 | **不可热更新**。 |
| Tool | 实现集中在静态 `toolRegistry.js`，Capability Manifest 静态加载 | 无声明式 Tool 发布链 | **不可热更新且高度 Fosu 耦合**。 |
| MCP | 只有 `tools/fosu-kb-mcp` 独立 stdio 工具，且仅代理受保护 KB Admin API | 无 Runtime MCP registry、Streamable HTTP、工具发现、环境权限、发布/回滚 | **未接入 Agent Runtime，不可热更新**。 |
| RAG / KB | KB 有 draft、validate、test、publish、rollback 与审计；lexical 每次读 published | 上传/网页摄取不完整；无独立 RAG configVersion；向量索引非空后不按 KB 版本重建；无真正 rerank 阶段 | **知识文本局部热生效，RAG 整体不成立**。 |
| Memory | 对话与偏好文件按请求读取/写入 | 无版本化策略发布、环境范围、测试、rollback | **用户数据可即时变化，Memory 策略不可热发布**。 |
| UI Schema | agent.v1/v2 + campus cardTypes 静态定义 | 无独立 schema registry/version publish | **协议兼容存在，但不是通用热更新 UI Schema**。 |

RAG 的具体一致性缺陷：`KnowledgeRetriever.ensureVectorIndex()` 只要发现现有 index `itemCount > 0 && version > 0` 就直接复用，没有比较 KB published version/content hash。因此发布新知识后 lexical/BM25 可读到新内容，而 vector 部分仍可能是旧版本。

## 8. 后台配置与真实执行是否一致

### 8.1 已做到的同源部分

- Provider profile、primary/fallback chain、stage assignments 由 `providerConfigService` 读取并投影到请求级 runtime config；
- Admin payload 调用相同的 Provider 配置服务；
- public 被服务端强制改写为 mock/tool-only；
- `configuredAvailable` 与 `verified` 已区分；
- KB Admin 的 draft/publish/rollback 通过 Knowledge Control Plane，而非直接把搜索结果发布。

### 8.2 不一致或证据不足的部分

- 后台只有 `tool-only/auto/always` Response policy，没有 `deterministic/strict_model_first/adaptive` Turn policy；
- 规则优先和 Planner skip 是隐藏的 env/default 行为，不在后台权威配置中；
- 页面展示“主 Provider/阶段 Provider”不等于本 Turn 调用它；
- `verified=true` 只表示当前进程历史上有成功请求或 probe，不能证明当前环境、当前 stage、当前 configVersion 正在成功执行；
- P50/P95 是 Provider 聚合的进程内成功样本，不能代表 Decision/Response 阶段；
- 后台没有本次 Run 的 `executionPolicy/intendedProvider/actualFirstProvider/decisionSource/fallbackPath`；
- Skill/MCP/RAG/Memory 没有完整控制面，所以不存在“显示配置等于运行时”的可验证闭环；
- Agent status API 中多项计数明确返回 `null`，说明当前没有真实计数源。

结论：**Provider 配置意图大体同源，但后台显示不等于实际执行。必须增加 configVersion 绑定的 Run Trace 才能证明。**

## 9. Context 与 Memory 成熟度

### 9.1 已有能力

- 对话 schema 最多保留 12 条脱敏 recent turns；
- Working Memory 覆盖 active goal、实体/约束、pending clarification、pending action、已执行工具、最近推荐等；
- `local_only`、`session_state`、`cloud_sync` 已有不同持久化边界；
- cloud_sync 使用服务端 Session 派生 Principal，不信任客户端 conversationId 作为身份；
- 低风险用户偏好加密落盘；
- 用户可以列出、修改、删除单条偏好或清空云端对话/偏好；
- ActionReceipt 对 principal、command、runId、有效期和 target 做约束；
- evidence refs 会按当前 Release Version 过滤。

### 9.2 与“ChatGPT 式长期记忆”的差距

| 要求 | 当前状态 | 缺口 |
| --- | --- | --- |
| 最近 8–12 条 | 基本具备 | Response Provider 又裁到最近 6 条，统一 ContextAssembler 尚未贯穿 Decision/Tool/Response。 |
| 滚动摘要 | 只有最长 240 字的当前 Working State 摘要 | 每次成功后重建，未真正累积压缩早期事实，不能证明 100 Turn 后可恢复。 |
| 相关长期记忆 | 固定 10 个左右低风险 preference key | 不是通用记忆条目模型。 |
| 语义检索 | `memoryRetriever` 明确是 keyword/entity rank、无向量 | 不满足 semantic relevant memory。 |
| Episodic Memory | 不存在 | 没有成功任务 episode、结果摘要、复用条件与 provenance。 |
| provenance/confidence/TTL/scope | policy candidate 内部有部分字段 | 偏好存储只持久化 key/value；load 时重新合成 metadata，`updatedAt` 与 `expiresAt` 会随读取刷新，TTL 不能可靠到期。 |
| supersede/冲突消解 | 同一 Turn candidate 有“最新 correction wins” | 没有持久 supersedes 关系、冲突历史或 active/tombstone 状态。 |
| 学期/Release 失效 | evidence refs 有 release 过滤，slots 有部分 term 处理 | 长期 schedule preference 没有 term/release provenance，不能自动精准失效。 |
| 查看/修改/删除 | 部分具备 | 只覆盖固定 preferences；无 episode/全部长期记忆管理。 |
| 暂停 | API 接受 `autoMemoryEnabled` | 注释明确由客户端本地保存，服务端没有持久暂停策略。 |
| 导出 | 不存在 | 缺少用户可下载的安全导出。 |
| 跨设备恢复 | cloud_sync 对话与固定偏好可恢复 | 没有成熟长期/episodic memory；session_state 的产品语义仍需端到端证明。 |

现有安全策略正确禁止凭据、完整课表、天气快照、原始工具结果和模型推理作为长期记忆候选；重构必须保留并扩展这一负面清单。

## 10. 通用 UI 壳现状

当前 Manifest card types 为：

```text
empty_room, schedule, teacher, course, weather,
diagnosis, guide, reminder, generic
```

这是一组 Fosu 业务卡片，不是要求的通用 UI Schema。现有小程序确有安全 Markdown、plan/step、运行状态、结果卡、clarification 与 ActionReceipt 组件，但服务端没有统一、版本化地输出以下 block union：

```text
text, markdown, plan, tool_progress, list, detail, schedule,
clarification, confirmation, action_receipt, warning, error
```

当前新增 Skill 仍可能需要在 Manifest、Composer、卡片渲染或小程序分支中增加业务类型，不能证明“复用已有 Schema 即无需发版”。

## 11. Fosu 业务耦合与不可复用模块

静态扫描发现包含 `FosuClass/佛大/课表/教学周/Release Pack/校园/仙溪` 等业务词的文件：

- `server/src/services/ai`：45 个；
- `server/src/routes/ai.js`：1 个；
- `miniprogram/services`：21 个；
- `miniprogram/packageXiaofu`：13 个。

### 11.1 必须迁入 `plugins/fosu-campus` 的能力

- `toolRegistry.js` 中全部校园 Tool 实现；
- Release Pack、全校索引、教师/班级/教室/课程查询；
- 教学周、学期、课表摘要、空教室、课表诊断；
- 校园地图、路线、天气与 Fosu 知识；
- 个人课表导入/同步相关 Action 与 Receipt 语义；
- 校园卡片 mapper、校园 quick actions、中文校园提示；
- Fosu capability manifest 内容与校园测试 fixtures。

`toolRegistry.js` 当前直接 import `releaseService`、`schoolSearchContractService`、`termRegistryService`、weather、campus map、classroom search、reminder 和 user preference 等服务，是最明显的耦合中心。

### 11.2 可提取但仍需依赖反转的通用候选

- Agent Kernel 与 Observation Loop；
- Decision/Goal/Plan contract validator；
- Provider Chain、熔断与 probe；
- Context budget/compression；
- Tool schema/permission/verification；
- Memory policy 与 repositories；
- Run/RunEvent/Trace；
- RAG ingestion/index/retrieval contracts；
- UI Schema 与 SDK；
- draft→publish→rollback 配置发布框架。

这些模块现在仍通过相对路径 import Fosu registry、Manifest 或文案，不能直接复制到独立项目使用。提取时必须让通用 Runtime 依赖接口和已发布配置快照，由 `fosu-campus` 在 composition root 注入；不能建立第二份 Tool/Skill/Memory 状态源。

## 12. 平台目录、Engine 与独立部署缺口

以下目标当前全部不存在：

```text
apps/agent-server
apps/agent-admin
packages/agent-runtime
packages/agent-protocol
packages/agent-sdk
packages/provider-runtime
packages/skill-runtime
packages/tool-runtime
packages/mcp-runtime
packages/rag-runtime
packages/ui-schema
plugins/fosu-campus
deploy/standalone/docker-compose.yml
```

根 `package.json` 也尚未声明 npm workspaces。仓库中没有 `AgentEngineAdapter`、OpenAI Agents SDK Adapter 或 Pi Agent Core Adapter。

当前 container workflow：

- 默认只构建 `linux/arm64` 的 `fosuclass-api`；
- `linux/amd64` 仅手工触发并使用独立 `-amd64` tag；
- 没有把两个 digest 合成为同一 SHA 多架构 manifest；
- 没有 `fosu-agent-platform` 镜像；
- 没有 standalone Compose。

## 13. 基线门禁实测

执行：

```text
npm run test:agent-release-gate
```

结果：

- exit code：`0`；
- runner steps：`14`；
- wall time：提交前复验 `456.5s`（前一轮 `449.8s`）；
- foundation、regression、ai-competition、final-convergence、Phase 2、Phase 3、package hygiene、module require、release preflight、安全验收等均未触发 fail-fast；
- 测试后 Git 工作树仍干净。

重要限制：Docker daemon 不可用，现有 `server container smoke` 在 CI 外输出 “Docker is not available ... Skipping outside CI”。因此本次结果只能写为：

```text
代码/mock 门禁：通过
本机 Docker smoke：未验证（daemon 不可用）
ARM64 standalone smoke：尚不存在，未验证
真实 Provider staging：未验证
CloudBase：未验证
体验版上传：未执行
微信真机：未验证
生产：未部署、未验证
```

npm 还报告本机 `electron_mirror` 配置将在下一 npm major 停止支持；这不是本分支引入的代码失败。

## 14. 对产品化迁移的约束性结论

后续实现必须满足以下顺序和证据要求：

1. 先建立 workspace 和通用 contracts，但每个新 package 必须被生产 composition root 实际 import；禁止只做 re-export 或空 Adapter。
2. 以 `apps/agent-server` 的 Runtime 为唯一在线执行核心；Fosu 一体化 app 与 standalone app 使用同一个 composition API。
3. 先把现有 Fosu Runtime 作为默认 Engine 迁入新链并通过 golden/conformance 对照，再改 strict policy；避免同时重写所有行为而失去回归参照。
4. Decision 合并 Understanding + Planner，一次结构化调用输出 GoalContract V2、实体/约束、Skill 候选与计划骨架；Tool 最终集合仍由 Manifest/Skill/Runtime/Environment/Safety 五因子交集决定。
5. Run Store、Config Store、Memory Store 与 RAG version 必须抽象为单一 repository 接口；一体化可用本地实现，standalone 用 Postgres/Redis，但不能让两套状态同时成为权威源。
6. 每次 Run 固定 configVersion/pluginVersion/releaseVersion，并将真实路径和阶段 timing 写入可持久、可聚合的安全 Trace。
7. Provider/Skill/Tool/MCP/RAG/Memory 共享版本发布状态机：draft→validate→test→publish→hot reload→rollback；发布物只能是声明式 schema/config，不执行后台上传的任意 JS。
8. 核心链、双部署、热发布、成熟记忆、RAG 与小程序协议先验收；OpenAI/Pi Adapter 最后接入且必须真实执行只读 Skill。若未验证，不设默认也不宣称完成。

## 15. P0 判定

P0 “审计和真实调用链基线”具备以下事实证据：

- Git 基线已锁定；
- 当前运行/调用/传输/热更新/后台/记忆/UI/容器/耦合已逐项审计；
- 现有 14 步 release gate 本机通过；
- Docker、真实 Provider、CloudBase、体验版、真机、生产边界已明确标为未验证；
- 没有把 mock、静态源码存在或测试 skip 描述为生产验证。

P0 之后仍需在设计批准后新增可持久 Trace 和基准工具，才能把三阶段调用次数与 P50/P95 从“源码推导/N/A”升级为真实运行数据。

## 16. 回滚

本阶段只新增审计文档并创建开发分支，不改业务代码、Release Pack、缓存或持久数据。回滚方式是删除本文件或 revert 对应 P0 文档提交；不得清空任何 storage/data 目录。
