# FosuClass 领域术语表

> 本文件是全仓库共享的领域模型术语表（glossary）。只收录术语与其规范含义，不写实现细节、配置值或计划。架构取舍见 `docs/adr/`，阶段计划见 `specs/xiaofu-agent-product-platform/`。

## 运行模式（Runtime Mode）

- **public**：正式版运行模式。外部 Provider 调用恒为 0，一切决策为确定性。
- **trial / dev**：体验版 / 开发版运行模式。默认执行策略为 strict_model_first。
- **competition**：兼容配置名，仅映射为规范运行模式（trial），无独立业务语义。

## 执行策略（Execution Policy）

- **deterministic**：确定性策略。规则决议，不调用外部 Provider。public 恒为此策略。
- **strict_model_first**：模型优先策略。每个通过安全守卫的用户 Turn，其第一语义决策必须来自真实 Provider 的一次结构化 Decision 调用；规则只用于规范化、Schema 校验、权限交集与受控回退。
- **adaptive**：自适应策略。显式开启；高置信简单任务可走确定性快路径，且必须记录本 Turn 实际使用的路径。

## Run 与上下文

- **Run**：一次用户 Turn 的完整执行。创建时原子绑定唯一不可变 configVersion 与 Engine 版本；终态（completed/failed/cancelled）不可被后续普通事件覆盖。
- **agent-context.v2**：ContextAssembler 产出的统一上下文快照，贯穿 Decision / Tool / Verification / Response 四阶段；四视图共享同一 contextId，具备硬 token 预算、确定性裁剪与分段指纹。
- **recentTurns**：会话恢复消息的权威字段。服务端归一化为 `{role, text}`、上限 12 条；`local_only` 模式恒为空数组。空数组即"无可恢复消息"，不得回退拼接其他来源。

## 记忆（Memory）

- **MemoryItem**：长期记忆条目，含 provenance、confidence、TTL、scope、revision、status、supersedes/supersededBy。
- **EpisodicMemory**：成功且经 Verification（`ok === true`）的任务摘要。完整课表、工具原始结果、天气、凭据、隐藏推理不得写入。
- **supersede**：事实纠正关系。"不是 A，是 B"使 B 成为有效事实、A 被取代；两者不得同时作为真相进入检索、摘要或 Provider。
- **记忆模式**：`local_only`（仅本机，默认）/ `session_state`（服务端当前会话，不读写长期记忆）/ `cloud_sync`（加密长期记忆 + 跨设备，须用户显式开启）。
- **Mutation Plan**：单 Turn 记忆变更的统一提交单元。三类变更（偏好/约束/Episode）归并后单次原子写入；revision 冲突时以最新状态重算合并，仅重试一次，两次失败则 fail-soft 跳过并产生 `memory.write_skipped` 结构化事件。
- **provider-safe memory projection**：经相关性选择、TTL/supersede/confidence/scope 过滤、敏感级判断与最小化投影后，允许进入 Decision Provider 请求的记忆派生上下文（边界见 ADR-0006）。

## 检索（RAG）

- **deterministic local encoder**：本地确定性向量编码器（归一化词元 + CJK bigram + 稳定 hash 投影）。是 integrated / public 模式的离线检索基线，不等同神经语义 embedding（见 ADR-0007）。
- **golden query set**：检索质量固定验收查询集，报告 lexical-only / vector-only / hybrid / hybrid+rerank 四组对照。
- **结构化校园事实**：课表、教室占用、教师课表、实时教学周等，只能通过 Tool 查询，禁止向量化替代。

## 平台（Platform）

- **configVersion**：不可变配置快照标识。Run 创建时原子绑定；发布与回滚只影响之后创建的新 Run，在途 Run 不受影响。
- **发布链（Publication Pipeline）**：draft → validate → test → publish → hot reload → rollback。Provider、Skill、Tool、MCP、RAG、Memory 六域共用同一套发布协议与 Artifact/ConfigSnapshot 基础设施。
- **AgentEngineAdapter**：Engine 单一权威契约。Fosu Engine 是唯一默认 Engine；未通过 conformance 的 Engine 不得设为默认。
- **fosu-campus**：校园能力插件。通用 Runtime 不依赖佛山大学名称、课表路由或 Release Pack 路径；校园卡片经插件 mapper 映射为通用 UI Block。
- **UI Block**：服务端输出的通用 UI Schema 单元：text、markdown、plan、tool_progress、list、detail、schedule、clarification、confirmation、action_receipt、warning、error。
- **refresh-on-conflict**：客户端记忆写操作遇 revision 409 时的统一模式：刷新云端记忆与 revision，基于不可变用户意图仅重试一次；非 409 错误不自动重试。
