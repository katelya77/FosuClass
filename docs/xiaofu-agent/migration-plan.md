# 小佛助手 Agent V2 迁移计划

## 1. 迁移原则

本迁移采用增量收敛，不重写课表业务：先锁定既有行为，再建立服务端权威清单和协议兼容层，然后把在线入口切到服务端，最后保留并验证客户端离线能力。任何阶段都不能让模型成为课表事实源，也不能破坏 Release Pack、缓存或 last-known-good。

## 2. 阶段状态

| 阶段 | 状态 | 本阶段实际结果 |
| --- | --- | --- |
| 0. 行为基线与调用链审计 | 已完成 | 追踪小程序服务、服务端 Agent/Provider/知识库、路由、后台、文档和测试；记录改造前测试基线及既有失败 |
| 1. Capability Manifest | 已完成 | 新增唯一 JSON 权威源、服务端加载/一致性校验、小程序裁剪生成物 |
| 2. Protocol V2 + V1 兼容 | 已完成 | V1 默认与旧字段保留；V2 增加 run/skill/steps/observations/evidence 等稳定字段；新增公开能力接口 |
| 3. 最小 Agent Kernel/Skill/Trace | 已完成 | 复用现有 Intent/Tool 逻辑，加入 Skill 选择、计划/工具白名单、步数/超时、结果验证和内存 Trace |
| 4. 小程序在线收敛 | 已完成 | 语义聊天在线默认服务端优先；本地 Router 改为 Offline Fallback/Compatibility；统一客户端降级标记 |
| 5. 知识库控制面接口准备 | 已完成（接口级） | 五类可测试适配器已建立；原有后台读写链未整体迁移，未部署 MCP |
| 6. 生产发布 | 未执行 | 本任务明确禁止部署、提交、推送或合并 |

## 3. 迁移后的兼容策略

### 3.1 旧客户端

- 未提交 `protocolVersion` 的请求按 `agent.v1` 处理。
- V1 保持旧的对象形态 `intent`、`taskSteps`、`evidenceItems` 和 Card/Action 结构。
- V1 将非 public 规范模式序列化成旧名 `competition`，避免旧 UI 只识别两种模式时出错。

### 3.2 新客户端

- 提交 `agent.v2`、`requestId` 和 `conversationId`。
- 在线成功时直接消费服务端 canonical Intent、Skill、Steps、Evidence 与上下文槽位。
- 服务端失败仅在明确的可降级条件下进入本地；本地响应也是 V2 形态并带 client fallback 标记。

### 3.3 运行模式配置

- 新配置应使用 `AI_RUNTIME_MODE=public|trial|dev`。
- 旧 `AI_RUNTIME_MODE=competition` 暂时保留：根据 `AI_PROVIDER_ACTIVE_ENV` 映射为 trial 或 dev。
- 客户端不能用请求参数覆盖服务端模式。
- Release 小程序无条件 fail-closed 到 public。

## 4. 推荐的后续迁移顺序

### 下一阶段 A：服务端会话记忆

1. 定义版本化的 `ConversationState` Schema，只保存 canonical Intent、经过白名单裁剪的 slots、工具结果引用和 Evidence 引用。
2. 引入可替换的 `ConversationRepository`，先实现内存/文件测试适配器，再选择受控持久层。
3. conversationId 只存哈希或安全标识；原始消息、完整个人课表和凭证不得入库。
4. 将 `xiaofuContextManager` 的本地槽位作为断网缓存，在线时以服务端规范化状态为准。
5. 增加 TTL、用户清除、Schema 迁移、并发更新和跨设备恢复测试。

### 下一阶段 B：知识库 MCP 控制面

1. 让现有后台路由逐步通过 `KnowledgeRepository`、`KnowledgeValidationService`、`KnowledgeVersionService` 和 `KnowledgeAuditService`，先保持 HTTP 行为不变。
2. 给写操作补齐可持久审计、操作者、细粒度 scope、幂等键、Diff 和确认票据。
3. 只读上线 Resources 和 `search/get`，验证权限与脱敏后再考虑草稿 Tool。
4. `create_draft/update_draft/preview_import/validate/diff/delete_draft` 必须限制为草稿域。
5. `publish/rollback` 不作为普通 MCP Tool；需要独立人工确认和可回滚工作流。
6. 任何联网知识补充必须走“检索 → 候选草稿 → 检查 → 管理员 Diff/确认 → 发布”。

### 下一阶段 C：可选 Planner 与混合检索

1. 让 Planner 只输出 Manifest/Skill Registry 允许的 canonical Intent、slots 和 Tool 计划。
2. 在 Tool Executor 之外禁止模型访问业务存储或管理员凭证。
3. 事实工具先执行，Provider 只基于脱敏观察结果做查询改写或自然表达。
4. 若引入向量检索，只用于已发布校园知识；全校课表继续由 Release Pack/结构化索引查询。
5. 为 Planner 加最大循环次数、总超时、预算、回退和对抗 Prompt Injection 测试。

## 5. 每次迁移的门禁

所有 Agent 相关迁移至少执行：

```text
npm run test:agent-foundation
npm run test:agent-regression
npm run test:ai-competition
```

此外必须满足：

- `node tools/generate-agent-capability-compat.js --check` 无漂移；
- public 测试中外部 Provider 调用计数为 0；
- 事实 V2 回答 Evidence 完整；
- 客户端在线 server-first 与网络失败 client fallback 都通过；
- 知识库 draft/publish/rollback 回归通过；
- 不含密钥、原始个人文件、系统提示和内部 URL；
- 与本次改动直接相关的既有测试通过或有清晰的改动前失败证据。

## 6. 回滚方案

本阶段没有数据库迁移或生产部署，代码层回滚可按边界执行：

1. 保留 `agent.v1` 作为协议回滚面；服务端可以继续接受旧客户端请求。
2. 若 V2 客户端出现兼容问题，可让客户端请求 V1，但仍应通过服务端在线决策；不要恢复客户端在线 Provider 分流。
3. 若新 Kernel 出现问题，可在本地代码中恢复 `agentService` 原有直接 Tool Chain 调用，同时保留 public Provider 禁令、安全守卫和现有事实工具。
4. 小程序网络故障时无需发布回滚，Offline Fallback 会继续使用缓存和 last-known-good。
5. Manifest/生成物必须成对回滚；只回滚一端会被一致性测试拦截。
6. 知识库控制面目前只是适配器，不替换原后台路径；删除适配器不会改变现有知识库数据格式。实际知识发布应继续使用已有 backup/rollback。

任何生产回滚、Git 提交、远程分支修改或部署都必须由用户另行明确授权。

## 7. 不在本阶段内

- 服务端持久会话记忆；
- 多实例 Trace 汇聚和数据库存储；
- 模型驱动的动态 Tool 循环；
- 向量数据库和混合 RAG；
- MCP Server、远程 MCP 授权和生产接入；
- 自动联网抓取、自动写库或自动发布；
- 生产部署、灰度、提交、推送和合并。
