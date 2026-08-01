# 小佛助手真机可靠性与产品收敛实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every behavioral change. Follow superpowers:systematic-debugging evidence gates before changing a suspected layer.

**Goal:** 让 trial/develop 真机与服务端使用同一受权运行环境，修复 Runs 传输、离线本地工具、记忆语义和后台运行事实，使故障可定位、能力可降级、状态不冒充。

**Architecture:** 保留服务端 Agent Kernel 作为在线唯一决策核心，保留 Runs Transport 与 Config Kernel；在小程序公共可信请求层统一传播环境信号，在服务端绑定一次受权 Runtime Decision 并贯穿请求上下文。离线只走确定性本地工具。记忆在最终持久化边界统一校验。后台直接消费 durable Run/Event/Trace Store 与真实 probe 指标。

**Tech Stack:** 微信小程序 CommonJS、Node.js/Express、PostgreSQL/文件持久化、原生 HTML/CSS/JS 后台、Node `assert` 场景测试、GitHub Actions、Docker Compose/OpenResty。

**Baseline:** `origin/main` 与任务分支起点均为 `4f06c697f71f5ffb38a4ce7eed4ca8227d803bde`；分支为 `codex/xiaofu-agent-reliability-and-product-convergence`。

---

## 阶段 0：保存根因证据与发布边界

### Task 0.1：固化已复现根因与外部网络事实

**Files:**

- Create: `docs/xiaofu-agent/real-device-reliability-root-cause.md`
- Create: `docs/xiaofu-agent/real-device-acceptance.md`
- Modify: `docs/xiaofu-agent/reliability-product-convergence-design.md`

**Steps:**

- [ ] 记录 `readiness=trial` 但 Run 结果 `runtimeMode=public` 的在线复现，说明客户端未统一传 `envVersion` 与服务端二次裁决丢失环境上下文两处根因。
- [ ] 记录 `miniprogram/utils/request.js` 仅接受 HTTP 200、把合法 Run Create HTTP 202 误判为网络错误并重试的根因。
- [ ] 记录 readiness 将 `configuredAvailable` 错当 `providerReachable` 的事实。
- [ ] 记录 durable store 已存在但后台读取 `recentPlatformTraces` 进程内数组的事实。
- [ ] 记录当前 DNS A/AAAA、TLS 证书、Cloudflare 直连健康检查结果；把微信后台、Cloudflare SSL 模式、源站证书、OpenResty/WAF/5G IPv6 列为需人工验证，不声称已通过真机。
- [ ] 文档不得包含 poll token、session、OpenID、密钥或用户原文。

### Task 0.2：定义测试接线与分阶段提交

**Files:**

- Modify: `package.json`
- Modify: `.github/workflows/deploy-vps.yml`

**Steps:**

- [ ] 为新增契约测试建立单独脚本，并接入 `test:agent-release-gate`、体验版检查和 VPS 部署前 CI；先只加测试脚本，确认红灯后再修实现。
- [ ] CI 的 Provider 检查区分 status-only、mock structural 与真实 probe；无凭据时明确 skipped，不能写 verified。
- [ ] 不触发生产部署；工作流改动只通过 PR 检查验证。
- [ ] 每个阶段形成小而清晰的 commit，预计控制在 80 个文件内；若审计后超过 80 个文件，停止并拆分堆叠 Draft PR。

---

## 阶段 1（P0）：修复环境绑定与 Runs 传输

### Task 1.1：先写环境传播失败测试

**Files:**

- Create: `tools/test-agent-env-version-propagation.js`
- Modify: `tools/test-xiaofu-agent-run-shell.js`
- Modify: `tools/test-xiaofu-runs-transport.js`

**Steps:**

- [ ] 测试 `trial` 请求的 readiness、Run create、chat compat、memory 与 CloudBase gateway 都使用同一个环境来源。
- [ ] 测试 `develop -> dev`、`trial -> trial`、`release -> public`。
- [ ] 测试缺失环境信号 fail closed 到 public。
- [ ] 测试伪造环境头不能绕过 session/capability authorization。
- [ ] 测试 readiness 的 `runtimeMode/config environment/configVersion` 与 Run 最终结果一致。
- [ ] 运行 `node tools/test-agent-env-version-propagation.js`，保存预期失败输出后才实现。

### Task 1.2：统一小程序环境来源和可信请求头

**Files:**

- Modify: `miniprogram/utils/platform.js`
- Modify: `miniprogram/utils/request.js`
- Modify: `miniprogram/services/agentReadinessClient.js`
- Modify: `miniprogram/services/agentMemoryClient.js`
- Modify: `miniprogram/services/courseReminderClient.js`
- Modify: `miniprogram/services/aiAssistantService.js`
- Modify: `miniprogram/services/aiVoiceInputService.js`
- Modify: `miniprogram/services/cloudbaseHunyuanService.js`
- Modify: `cloudfunctions/xiaofuAgentGateway/index.js`

**Steps:**

- [ ] 将现有 `platform.getMiniProgramEnvVersion()` 规范化为唯一来源，异常/未知值返回 `release`。
- [ ] 仅对 `securitySessionService.isTrustedApiUrl()` 判定为可信的 API 自动加入 `X-Fosu-Env-Version`；绝不向第三方绝对 URL 泄漏。
- [ ] readiness/memory/reminder 等兼容 query 改用唯一来源，逐步去除重复实现。
- [ ] CloudBase gateway 继续只透传客户端显式环境与已持有 session，不自行提权；调用侧使用同一来源填充。
- [ ] 环境信号只参与服务端既有裁决，不视为认证凭据。

### Task 1.3：绑定服务端受权环境上下文

**Files:**

- Modify: `server/src/routes/ai.js`
- Modify: `apps/agent-server/src/createRunHandlers.js`
- Modify: `server/src/services/ai/runtime/requestContextAssembler.js`
- Modify: `server/src/services/ai/platformComposition.js`

**Steps:**

- [ ] 路由层从 query/header/body context 读取环境信号并调用现有 `runtimeModeService` 一次完成受权裁决。
- [ ] 将“客户端上报环境”与“服务端已裁决 runtimeMode”作为不同字段传递，避免把请求体 `runtimeMode` 当授权。
- [ ] `platformInput` 把 canonical env context 传给 `requestContextAssembler`，二次防御裁决必须得到相同结果。
- [ ] Config Snapshot 只按已裁决环境绑定，Run 创建后不可被客户端字段改写。
- [ ] public 外部 Provider 调用仍恒为 0。

### Task 1.4：修复 HTTP 202、幂等与单一终态

**Files:**

- Modify: `miniprogram/utils/request.js`
- Modify: `miniprogram/services/aiTransportRouter.js`
- Modify: `miniprogram/services/agentRunShell.js`
- Modify: `packages/agent-sdk/src/client.js`（仅在契约需要时）

**Steps:**

- [ ] 公共请求层接受全部 2xx；仍将 payload `success:false` 作为业务失败。
- [ ] Run Create 默认使用同一 `requestId` 作为幂等键，重试不得创建多个 Run。
- [ ] SDK/Run shell 对 deduplicated create 保留已持有 poll credential；匿名请求不能因重放丢 poll token。
- [ ] 同一问题最多一个终态、一个错误卡；不能伪造终态 RunEvent。
- [ ] 运行新增测试，确认从红到绿；再运行既有 request/run shell/transport 测试。

---

## 阶段 2（P0）：真实诊断与精确错误分类

### Task 2.1：先写诊断契约失败测试

**Files:**

- Create: `tools/test-agent-real-device-diagnostics-contract.js`
- Modify: `tools/test-request-error-normalize.js`
- Modify: `tools/test-xiaofu-runtime-ui.js`

**Steps:**

- [ ] 覆盖离线、明确 timeout、显式 DNS/TLS/domain errMsg、模糊 `request:fail`、HTTP 4xx/5xx、session、runtime auth、Run create/poll/expired/executor lost、Provider、Tool、Memory 错误。
- [ ] 模糊微信失败只能标记 `WECHAT_NETWORK_REQUEST_FAILED`/“微信网络层请求失败”，保留脱敏 errMsg，不冒充已定位 DNS/TLS/VPS。
- [ ] 报告必须包含 `failureLayer/reasonCode/status/elapsedMs/requestId/runId/action`，且无 session/poll token/OpenID/用户全文。
- [ ] 正式版不显示诊断入口或敏感详情。

### Task 2.2：统一客户端与服务端错误词汇

**Files:**

- Modify: `miniprogram/utils/request.js`
- Modify: `miniprogram/services/agentClientErrorMapper.js`
- Modify: `packages/agent-protocol/src/*`（若已有错误契约适合扩展）
- Modify: `apps/agent-server/src/createRunHandlers.js`
- Modify: `server/src/services/ai/agentReadinessService.js`

**Steps:**

- [ ] 分类请求失败并保留原始 safe reason；不把 Provider 错误包装成服务器断网。
- [ ] 贯穿 requestId/runId；所有日志仅记录脱敏 ID 与安全摘要。
- [ ] readiness 分开输出 configured、verified、reachable、lastProbeAt、lastSuccessAt、circuit state。
- [ ] `configuredAvailable` 不得再直接赋给 `providerReachable`。

### Task 2.3：实现 trial/develop 连接诊断面板

**Files:**

- Create: `miniprogram/services/agentConnectionDiagnostics.js`
- Modify: `miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js`
- Modify: `miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml`
- Modify: `miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss`
- Modify: `miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.json`

**Steps:**

- [ ] 逐项执行网络类型、API host、health、readiness、session、Run create、poll、memory snapshot。
- [ ] 展示 runtimeMode/configVersion/Provider 四态/circuit/最近失败与可执行建议。
- [ ] 诊断 Run 使用无隐私的确定性问候，不触发写入，不冒充 Provider probe。
- [ ] 支持复制脱敏报告；正式版隐藏入口并禁止输出敏感字段。
- [ ] 使用现有后台/小程序设计语言，状态颜色同时带文字。

---

## 阶段 3（P0）：严格的 Local Tool Fallback

### Task 3.1：先写本地能力接管失败测试

**Files:**

- Create: `tools/test-agent-local-tool-fallback.js`
- Modify: `tools/test-xiaofu-agent-page-integration.js`（若现有页面测试入口为其他文件则使用现有入口）

**Steps:**

- [ ] 覆盖今日/本周个人课表、缓存教师/班级/教室/课程、教学周、全校课表/空教室/地图/常用入口/本机记忆。
- [ ] 覆盖复杂联网任务明确拒绝、网络恢复一键重试、结果标记“本机结果”。
- [ ] 覆盖本地数据缺失时顶部显示“离线，仅可查看已缓存页面”。
- [ ] 覆盖同一问题只有一个失败终态和一个错误卡。

### Task 3.2：收口确定性本地工具注册与能力探测

**Files:**

- Create: `miniprogram/services/localAgentToolFallback.js`
- Modify: `miniprogram/services/aiAssistantService.js`
- Modify: `miniprogram/services/aiTransportRouter.js`
- Modify: `miniprogram/services/agentLocalDataSource.js`（如现有来源不同则复用现有服务）
- Modify: `miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js`

**Steps:**

- [ ] 注册白名单确定性能力，每项先 probe 数据是否真实存在，再决定“本地可用”。
- [ ] 不调用旧 direct-chat/客户端生成式路径，不创建假 Run，不补全不存在的事实。
- [ ] 能执行则返回结构化本机结果与页面操作；不能执行则指出需要联网。
- [ ] 网络恢复后保留原问题的一键重试入口。

---

## 阶段 4（P1）：记忆语义正确性与迁移

### Task 4.1：先写记忆语义与迁移失败测试

**Files:**

- Create: `tools/test-agent-memory-semantic-validator.js`
- Create: `tools/test-agent-memory-invalid-migration.js`
- Modify: `tools/test-agent-memory-store-reliability.js`

**Steps:**

- [ ] 覆盖“你能记住什么”“我叫什么”等问句不产生长期记忆。
- [ ] 覆盖 cloud_sync 的明确称呼写入、local_only 仅当前上下文、纠正称呼 supersede。
- [ ] Provider 候选 `preferredName=什么` 在最终写入边界被拒绝。
- [ ] 旧数据无效称呼被标记 invalidated 并写审计，不删除正常记忆。
- [ ] 恢复不重复、不回滚 revision；云端不可达时本机记忆与聊天仍可用。

### Task 4.2：在最终持久化边界统一校验

**Files:**

- Create: `server/src/services/ai/memory/memorySemanticValidator.js`
- Modify: `server/src/services/ai/memory/memoryController.js`
- Modify: `server/src/services/ai/memory/userMemory.js`
- Modify: `server/src/services/ai/conversation/userPreferenceService.js`
- Modify: `server/src/services/ai/memory/memoryCandidateExtractor.js`
- Modify: `server/src/services/ai/conversation/personalMemoryInterpreter.js`

**Steps:**

- [ ] 所有 deterministic/provider/preferencePatch/action receipt/legacy candidate 在 commit 或最终落盘前经过同一 validator。
- [ ] preferredName 拒绝疑问词、角色词、语气词、问句片段、空值与明显非名字。
- [ ] 低置信度只保留 working 或返回确认请求，不直接写 user memory。
- [ ] 保存 provenance/source/confidence/scope/reasonCode/timestamps/supersede 与可选脱敏来源摘要。
- [ ] 对所有可写入口（upsert/batch/patch/migration）复用同一规则，不能只修 extractor 正则。

### Task 4.3：安全迁移与可观察指标

**Files:**

- Create: `server/src/services/ai/memory/invalidMemoryMigration.js`
- Modify: `server/src/services/ai/conversation/userPreferenceService.js`
- Modify: `server/src/services/ai/memory/userMemory.js`

**Steps:**

- [ ] 读取文档时幂等执行版本化迁移，失效明确黑名单值，保留不确定正常值。
- [ ] 审计只记录 memoryId/key/reasonCode，不记录私人值。
- [ ] 提供聚合计数：拒绝数、迁移数、冲突、最近写入成功/失败、scope 数量、TTL 清理。

### Task 4.4：重做记忆面板体验

**Files:**

- Modify: `miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js`
- Modify: `miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml`
- Modify: `miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss`
- Modify: `miniprogram/services/agentMemoryClient.js`

**Steps:**

- [ ] 三模式命名为“仅本机 / 保留当前对话状态 / 跨设备记忆”，各用一句话说明内容、期限和跨设备性。
- [ ] 展示为什么记住、来源对话、更新时间；支持修改、忘记、撤销。
- [ ] 云端失败行内显示；面板仍显示本机记忆，不用全局 Toast 遮挡。

---

## 阶段 5（P2）：助手运行中心

### Task 5.1：先写后台事实源失败测试

**Files:**

- Create: `tools/test-agent-admin-operations-dashboard.js`
- Create: `tools/test-agent-admin-durable-run-query.js`
- Modify: `tools/test-agent-config-plane-browser.js`

**Steps:**

- [ ] 证明进程重启/重新绑定 store 后 Run/Trace 仍可查询。
- [ ] 证明筛选环境、状态、Provider、Tool、errorCode、时间范围。
- [ ] 证明 configured/verified/reachable/lastSuccess 分离。
- [ ] 证明首页无 raw JSON，原发布/回滚/审计仍在高级配置且语义不变。
- [ ] 证明响应不含用户原文、OpenID、私人记忆、密钥。

### Task 5.2：扩展 durable store 的只读管理查询

**Files:**

- Modify: `server/src/services/ai/persistence/memoryRunStore.js`
- Modify: `server/src/services/ai/persistence/journalRunStore.js`
- Modify: `server/src/services/ai/persistence/pgRunStore.js`
- Modify: `server/src/services/ai/agentTraceRecorder.js`
- Modify: `server/src/services/ai/platformComposition.js`
- Modify: `apps/agent-admin/src/createPlatformAdminHandlers.js`

**Steps:**

- [ ] 增加 store 统一 `queryRuns/queryTraces/getRunTimeline` 只读接口；journal 与 PG 等价。
- [ ] 管理端不再读 `recentPlatformTraces`，直接查 durable store。
- [ ] Run 摘要包含安全字段：runId/requestId/environment/configVersion/intent/skill/tool/provider/external/fallback/status/duration/failure/error/createdAt。
- [ ] 时间轴来自真实 Run Events/Trace，不生成 Thinking 或工具状态。

### Task 5.3：真实运行概览与 Smoke Test API

**Files:**

- Modify: `apps/agent-admin/src/createPlatformAdminHandlers.js`
- Modify: `apps/agent-admin/src/createConfigPlaneHandlers.js`
- Modify: `server/src/routes/admin.js`
- Modify: `server/src/services/ai/agentReadinessService.js`
- Create: `server/src/services/ai/operationsCenterService.js`

**Steps:**

- [ ] 聚合部署 SHA、环境/configVersion、Run 成功率/P50/P95、active runs、Provider 四态、Memory/RAG/Tool/Queue/PostgreSQL/Redis。
- [ ] smoke tests 覆盖 public 本地工具、trial decision、tool、Run create/poll、memory 回滚、RAG；明确 live/mock/skipped。
- [ ] Smoke 使用隔离测试 principal/幂等键并回滚写入，不污染真实用户。

### Task 5.4：重构后台信息架构与视觉

**Files:**

- Modify: `apps/agent-admin/public/agent-platform.html`
- Modify: `server/src/routes/adminPages.js`（仅必要桥接）
- Modify: `server/src/routes/admin.js`

**Steps:**

- [ ] 首页为“运行概览 / 一键诊断 / Run 监控 / 记忆状态 / 能力管理”。
- [ ] 六域配置、JSON、draft/validate/test/publish/history/rollback/audit 折叠至“高级配置”。
- [ ] 复用现有设计 token，支持亮/暗色与窄屏；状态颜色都有文本。
- [ ] 若保留 iframe，校验 `event.source`、自动高度/内部滚动、session 失效、路由恢复与超长内容；不使用固定超高 iframe。
- [ ] 使用 frontend-design 与 ui-ux-pro-max 的设计系统搜索、两遍实现和截图批评流程。

---

## 阶段 6（P3）：用户可感知的校园 Agent 场景

### Task 6.1：先写 30 个产品场景

**Files:**

- Create: `tools/test-agent-campus-product-scenarios.js`
- Modify: `tools/test-agent-final-convergence.js`（如场景入口由其他脚本承载则接入现有套件）

**Steps:**

- [ ] 实现用户列出的 1–30 场景，包括问候、能力说明、教师/班级/教室/课程、今日/明日、空教室、天气组合、教学周、RAG、记忆、Provider 401/429/timeout、VPS 不可达、poll 恢复、重开恢复、public 0 外调、trial snapshot、本地接管。
- [ ] 每个断言验证工具证据、无伪造 RunEvent、无重复终态/错误卡、无错误记忆、无跨环境串配置。
- [ ] 先运行并确认具体行为失败，再逐项实现。

### Task 6.2：修复多轮继承、歧义与组合任务

**Files:**

- Modify: `server/src/services/ai/memory/workingMemory.js`
- Modify: `server/src/services/ai/runtime/*Coordinator.js`（只改与失败场景直接相关的现有协调器）
- Modify: `server/src/services/ai/classAliasResolver.js`
- Modify: `server/src/services/ai/decision/decisionService.js`
- Modify: `server/src/services/ai/responseComposer.js`
- Modify: `plugins/fosu-campus/*`（仅当现有工具编排缺口在插件层）

**Steps:**

- [ ] 继承目标、week、weekday、period，用户当前明确条件始终覆盖记忆。
- [ ] 班级缩写归一化与多候选返回，不猜测。
- [ ] Planner 真正消费 `plan.steps`，每步工具结果为事实源；天气等非校园事实也必须由工具给出。
- [ ] Provider 故障时能由工具完成则继续，依赖模型时明确“增强理解暂不可用”。
- [ ] 问候/能力说明走确定性低成本响应。

---

## 阶段 7：发布门禁、体验版构建与 Draft PR

### Task 7.1：全量验证

**Files:**

- Modify: `docs/xiaofu-agent/real-device-acceptance.md`
- Create: `docs/xiaofu-agent/operations-center-guide.md`
- Create: `docs/xiaofu-agent/reliability-product-convergence-design.md`（若 Task 0 已创建则继续完善）

**Steps:**

- [ ] 运行新增专项测试及直接相关既有测试。
- [ ] 运行 `npm run test:agent-foundation`。
- [ ] 运行 `npm run test:agent-regression`。
- [ ] 运行 `npm run test:ai-competition`。
- [ ] 运行 `npm run test:agent-final-convergence`。
- [ ] 运行 `npm run test:agent-phase2`。
- [ ] 运行 `npm run test:agent-phase3`。
- [ ] 运行 `npm run test:agent-release-gate`、`npm run release:experience:check`、secret scan、`git diff --check`。
- [ ] 运行 Docker smoke 与备份门禁；若本机/凭据不足，明确标为未验证并保留证据。
- [ ] 生成体验版构建，但不提交正式审核、不部署生产。

### Task 7.2：外部配置与真机验收清单

**Files:**

- Modify: `docs/xiaofu-agent/real-device-acceptance.md`
- Modify: `docs/xiaofu-agent/real-device-reliability-root-cause.md`

**Steps:**

- [ ] 精确列出微信 request 合法域名、DNS A/AAAA、TLS 链/SNI/TLS1.2+、Cloudflare SSL 模式、OpenResty 路由/头/WAF、GitHub Variables/Secrets、Provider probe 配置。
- [ ] 真机矩阵包含 iOS 5G/Wi-Fi、前后台、断网恢复、重进、三种记忆、public/trial。
- [ ] 未直接操作真机的项目全部标记“待用户验收”，不声称通过。

### Task 7.3：分阶段提交、推送与 Draft PR

**Steps:**

- [ ] `git status` 与 `git diff` 审查只包含本任务文件；统计文件数，超过 80 停止并拆 PR。
- [ ] 按 P0 transport/diagnostics、P0 local fallback、P1 memory、P2 operations、P3 scenarios/docs 分阶段 commit。
- [ ] 推送 `codex/xiaofu-agent-reliability-and-product-convergence`。
- [ ] 创建 Draft PR，描述分别列出代码测试、Mock、本地集成、Provider 真实 Probe、DevTools、真机、体验版、生产。
- [ ] 等待 GitHub checks；失败时读取真实日志并修复，不自动合并 main，不触发生产部署。
- [ ] 最终报告列出修改文件、根因、修复、命令/结果、未验证项、风险、回滚与人工配置。
