# 小佛助手 Agent V2 第一阶段交付记录

日期：2026-07-19

## 1. 交付结论

第一阶段已在本地工作树实现服务端单一在线决策核心、可版本化 Capability Manifest、`agent.v2`/`agent.v1` 双协议、可执行 Skill Registry、最小 Agent Kernel、脱敏 Trace、小程序 Offline Fallback，以及知识库控制面的接口准备。

本次没有改变课表事实源，没有删除已有本地能力。本地 Agent 改动在合并远端 admin/deploy 提交后完成验证；Docker 镜像构建已纳入 `agent-capability-manifest.json` 复制，避免生产缺配置。

这里的 “public 零外部 Provider” 专指零生成式模型 Provider 调用。天气等确定性数据适配器可能按既有业务配置访问天气数据源，但它不是生成式表达 Provider，也不能生成课表事实。

## 2. 审计得到的根因

改造前有三层决策：

1. `xiaofuAgentRouter` 在小程序端先识别粗粒度 Intent；
2. `aiAssistantService` 对天气、课表状态、帮助、导航、知识、个人课表等大量请求直接生成事实/入口卡片；
3. `aiTransportRouter` 又用 `aiRouteClassifier` 决定走服务端工具还是客户端 CloudBase 混元，而服务端 `agentService/toolRegistry/agentProtocol` 同时维护另一套 canonical Intent。

典型分叉包括：客户端 `schedule_query/personal_schedule/weather/school_knowledge`，分类器 `search_teacher_schedule/search_class_schedule/teaching_week`，服务端 `search_school_index/get_today_courses/get_campus_weather/get_teaching_week`。不同环境可能本地回答、客户端 Provider、服务端 Tool 或 mock，导致工具权限、上下文槽位和 Evidence 难以统一。

当前在线语义入口固定为：

```text
小程序最小安全上下文
→ aiAssistantService.chat
→ aiTransportRouter.serverFirstChat
→ POST /api/ai/agent/chat
→ 服务端 Agent Kernel
→ Intent / Skill / Tool / Provider Policy / Protocol
→ 客户端会话与上下文保存
```

本地原有链路仅在网络/超时/协议不兼容/服务端允许降级时执行，并返回明确的 client fallback 标记。

## 3. 主要代码交付

### 权威能力与协议

- `server/config/agent-capability-manifest.json`：唯一 Intent/Skill/Tool/Card/模式/Provider/槽位/安全/降级权威源。
- `server/src/services/ai/capabilityManifestService.js`：加载、查询、公开裁剪和跨模块一致性校验。
- `tools/generate-agent-capability-compat.js`：生成微信小程序可用的裁剪映射。
- `miniprogram/shared/agentCapabilityCompat.generated.js`：生成物，不可手工编辑。
- `server/src/services/ai/agentProtocol.js`：保留 V1，新增 V2 字段、运行模式序列化、步骤/Observation 和响应校验。
- `server/src/routes/ai.js`：聊天路由接收协议元数据，新增只读 `/api/ai/agent/capabilities`，服务异常返回可降级协议响应。

### Agent Kernel、Skill 和 Trace

- `server/src/services/ai/skillRegistry.js`：从 Manifest 创建 20 个可执行 Skill，绑定计划构建、结果验证和 Tool 白名单。
- `server/src/services/ai/agentKernel.js`：运行模式、上下文、Intent、Skill、槽位、计划、步数、Tool、超时、结果校验、Step/Observation 的统一执行边界。
- `server/src/services/ai/agentTraceRecorder.js`：有界内存 Trace 和 conversationId 哈希。
- `server/src/services/ai/agentService.js`：改为通过 Kernel 执行确定性链，完成 Provider 决策、结果合并、Evidence、Trace 和 V1/V2 组合。
- `server/src/services/ai/toolRegistry.js`：向 Manifest/Skill 暴露可执行 Tool 清单，并继续承载原有确定性业务实现。
- `runtimeModeService.js`、`providerFactory.js`、`providerChainService.js`、`providerConfigService.js`：规范化 public/trial/dev 和 competition 兼容；服务端模式优先；public 强制 mock；事实 Intent 禁止生成式 Provider。
- `safetyGuard.js`、`evaluationService.js`：补充 V2/Trace/运行模式相关的裁剪和评估字段。

### 小程序收敛

- `miniprogram/services/aiAssistantService.js`：在线 server-first；创建 V2 请求元数据；只在允许条件下调用 `offlineChat`；统一 client fallback；保留缓存个人课表、天气失败、RAG/导航和入口卡片。
- `miniprogram/services/aiTransportRouter.js`：导出在线入口固定为 `serverFirstChat`；凭证在网络前拦截；客户端生成式表达实现不再由在线入口调用。
- `miniprogram/services/xiaofuAgentRouter.js`：明确定位为 Offline Fallback/V1 Compatibility Router，并使用生成的 canonical 映射。
- `miniprogram/services/xiaofuContextManager.js`：理解 V2 字符串 Intent、slots 和服务端 `contextSlots`，避免 canonical 上下文丢失。

### 知识库边界

- `server/src/services/ai/knowledgeControlPlane.js`：新增 Repository/Search/Version/Validation/Audit 五个可测试适配器。
- `knowledgeBaseService.js`：继续提供并向适配器复用 draft、published、backup、import preview、CRUD、publish、rollback 和 lexical search。

这些适配器尚未替换全部管理员路由，也没有部署 MCP 或向量数据库。

### 测试与规范

- `tools/run-agent-foundation-tests.js`、`tools/run-agent-regression-tests.js`：一键测试入口。
- `tools/test-agent-*.js`、`tools/test-xiaofu-online-server-first-v2.js`、`tools/test-knowledge-control-plane.js`：覆盖 Manifest、协议、模式、Provider 权限、Kernel、Tool 白名单/未知 Tool、步数/超时、Trace、Evidence、能力接口、在线优先/离线降级、知识库与 Prompt Injection。
- `package.json`：新增 `test:agent-foundation` 和 `test:agent-regression`。
- 根 `AGENTS.md` 与 `docs/xiaofu-agent/`：固化项目事实、安全边界、迁移和下一阶段入口。

## 4. 兼容性结果

| 场景 | 当前行为 |
| --- | --- |
| V1 客户端 | 未指定版本默认 V1；旧 intent 对象、taskSteps 和 competition 模式名保留 |
| V2 客户端 | canonical Intent 字符串、Skill、Plan、Steps、Observations、Evidence、Run/Request/Conversation ID |
| public/Release | Release fail-closed public；生成式 Provider 调用为 0；事实和帮助由工具/已发布知识/模板处理 |
| trial/dev | 服务端配置决定模式；仅 Manifest 允许的非事实 Intent 可进入生成式表达层；事实 Tool 结果优先 |
| Provider 失败 | 服务端保留 mock/确定性答案，不覆盖事实 |
| 服务端/网络失败 | 客户端 Offline Fallback；缓存、last-known-good 和现有页面入口继续可用；明确标记降级 |
| 敏感凭证 | 客户端网络前或服务端 SafetyGuard 拦截，不进入 Provider、Trace 或普通日志 |

## 5. 测试证据

### 改造前行为基线

- `AI_AGENT_ENABLED=false` 逐一执行全部 `tools/test-ai-*.js` 和 `tools/test-xiaofu-*.js`：60/60 文件通过。
- `node tools/test-assistant-kb-service.js`、`test-assistant-mode-switch.js`、`test-assistant-env-version-routing.js`、`test-assistant-local-rules-seed.js`、`test-assistant-kb-seed.js`：5/5 文件通过。
- `npm run test:ai-competition`：改造前即在首个 `test:no-ai-secret-committed` 失败。扫描器命中 `tools/test-config-migration-safe.js` 内测试夹具的 `ADMIN_API_TOKEN: "explicit-i..."` 赋值；本阶段没有删除或放宽密钥检查。最终交付必须继续把它作为既有基线问题报告，除非另行修复并复跑。

### 第一阶段新增验证

- `npm run test:agent-foundation`：17/17 测试文件通过。其中 factual Evidence 测试覆盖 20 个事实 Intent。
- `npm run test:agent-regression`：81/81 测试文件通过（合并 `origin/main` 后再次完整复跑）。
- 修正「连续自习…时间和教室」意图误判为全校索引的问题，回归为 `recommend_meeting_time`。
- 修正既有 `test:no-ai-secret-committed` 对测试夹具假 token 的误报（`test-config-migration-safe.js` 改为 `test-` 前缀夹具）。
- `server/Dockerfile` 增加复制 `agent-capability-manifest.json`，保证容器内 Kernel 能加载能力清单。

### 未执行的验证

- 没有运行需要真实 Provider Key 的 `test:ai-live-providers`；mock 结果不作为生产 Provider 验证。
- 没有在本机执行完整 Docker 构建与远端 VPS 发布（需 GitHub Actions / 服务器凭据）。
- 本地 Node 测试覆盖小程序服务行为，但不等价于微信开发者工具和真机完整 UI/网络验收。

## 6. 验收状态

| 验收项 | 状态 | 证据/限制 |
| --- | --- | --- |
| 在线服务端唯一决策核心 | 已实现 | 客户端在线入口只导出 server-first |
| 可靠客户端降级 | 已实现并有单测 | 明确 fallback Layer/Reason；保留缓存与入口 |
| `agent.v1` 兼容 | 已实现并有单测 | V1 默认、旧字段和旧模式名 |
| V2 可扩展协议 | 已实现并有单测 | 完整稳定字段，无隐藏思维链 |
| 唯一 Capability Manifest | 已实现并有生成/一致性测试 | 服务端 JSON 为权威，小程序为生成物 |
| 可执行 Skill Registry | 已实现并有白名单测试 | 20 个 Skill，复用现有 Tool |
| public 零生成式 Provider | 已实现并有调用计数测试 | 不排除确定性天气数据源 |
| Tool/Skill/Intent/Card 一致性 | 已实现并有单测 | 构建期 `--check` + 运行时校验 |
| Trace 可用且脱敏 | 已实现并有集成测试 | 内存 500 条/7 天，重启丢失 |
| 既有课表/天气/地图/个人课表无退化 | 针对性 Node 回归通过 | `test:agent-regression` 81/81；真机未验证 |
| 知识库 draft/publish/rollback | 保留并有测试 | 控制面适配器未替换后台路由 |
| 文档与实现一致 | 已完成 | 本目录和根 AGENTS.md |
| Docker 可部署 | 已纳入 Manifest COPY | 需经 GHCR/deploy-vps 流水线实际发布 |

## 7. 已知限制与未完成项

- `server/config/admin-rollout-manifest.json` 已由后续 admin 迁移提交补齐；与 Agent Capability Manifest 共存于 `server/config/`。
- 服务端会话记忆仍由客户端传入的安全上下文和本地 `conversationStore` 支撑；没有持久的服务端 Conversation Repository。
- Trace 只在单进程内存中，未跨实例、未落 JSONL/数据库。
- 知识库控制面类可测试，但尚未成为后台 HTTP 路由的统一依赖，也没有持久的 MCP 审计实现。
- 旧客户端表达层代码仍留在 `aiTransportRouter.js` 内部作为未导出兼容实现，在线入口不再调用；后续可在稳定回归后清理。
- 动态模型 Planner、Tool 循环、混合 RAG、向量库和 MCP 都属于下一阶段。

## 8. 风险与回滚

- 已修正一处旧测试对 trial 客户端直连 CloudBase Hunyuan 的假设；后续若发现同类旧代码，正确处理仍是迁移到服务端表达层，而不是恢复双决策中心。
- V2 消费异常时客户端会使用统一 Offline Fallback；V1 服务端接口仍可作为旧客户端兼容面。
- Manifest 与小程序生成物必须一起回滚；`--check` 会拦截单边变更。
- Agent Kernel 可按模块回滚到原 `agentService` 直接 Tool Chain，但必须保留 public Provider 禁令、SafetyGuard 和事实工具优先。
- 知识库数据格式未迁移；控制面适配器可独立撤回，publish/rollback 继续使用原有备份链。
- 没有数据库迁移或生产部署，因此本阶段回滚主要是本地代码级；执行任何远程回滚仍需用户明确授权。

## 9. 下一阶段准确起点

下一阶段应从两个现有接口面开始：

1. 在 `AgentKernel` 前增加版本化 `ConversationRepository/ContextResolver`，持久化经过白名单裁剪的 canonical slots、Tool/Evidence 引用和 TTL，不存原始消息或完整个人课表；让在线多轮以服务端状态为准、客户端状态作为断网缓存。
2. 让一个现有知识库后台路径先通过 `knowledgeControlPlane.js` 的适配器，补齐持久审计、操作者/scope/幂等键/Diff/确认票据，再上线只读 Resources 与 `search/get`；publish/rollback 保持独立人工确认工作流。

在这两项稳定前，不应接入动态模型 Tool 循环、远程写 MCP 或向量数据库。
