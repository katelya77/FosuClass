# 小佛 Agent 产品平台 P3：统一上下文与成熟记忆证据

日期：2026-07-30（2026-07-30 修订：如实表述修正 + H1/H2/M1/M3/M4/M5/Low×6 修复证据）
分支：`codex/xiaofu-agent-product-platform`
验收标准：`specs/xiaofu-agent-product-platform/p3-acceptance.md`

## 结论

P3 已把统一 `ContextAssembler` 接入真实在线调用链，并把跨会话长期记忆收敛到加密的 `user-memory.v2` 文档。当前生产组合路径为：

```text
微信请求 / Run API
  -> apps/agent-server
  -> packages/agent-runtime ContextAssembler
  -> Decision view
  -> fosu-campus 私有权威 Tool context
  -> Verification view
  -> Response view
  -> RunEvent / PlatformTrace / UI Schema
```

Decision、Tool、Verification、Response 使用同一个 `contextId`。完整个人课表和课表变化基线只作为请求级 Tool 私有输入，不进入通用 Runtime artifact、Provider Context、Response Context、Trace 或长期记忆。

## 唯一上下文生产路径

- `server/src/services/ai/platformComposition.js` 创建 `packages/agent-runtime` 导出的 `createContextAssembler`，并注入生产 `createFosuTurnPorts`。
- `server/src/services/ai/runtime/fosuTurnPorts.js` 只组装一次 `agent-context.v2`；返回 `{ snapshot, privateState }`，通用 Runtime 只持有 snapshot。
- `apps/agent-server/src/createAgentPlatform.js` 将 request-scoped 私有状态保存在闭包中，不把 Session、Repository、Provider 配置或权威 Tool 数据写入 artifact。
- `packages/agent-runtime/src/agentRuntime.js` 校验所有阶段的 `contextId`；阶段不能替换或绕开本次统一上下文。
- `server/src/services/ai/decision/decisionService.js` 在 `strict_model_first` 下不再预先运行规则 Intent Resolver；第一语义 Decision 来自 Provider，规则仅用于 adaptive/public、规范化、Schema 和权限交集。

旧 `server/src/services/ai/context/` 仅保留未迁移测试和兼容读取，不再由生产 Provider Orchestrator 组装在线上下文；它不是在线状态源。

## ContextAssembler 契约

统一快照包含：最近 8–12 条脱敏消息；最多 1200 字滚动摘要；Working State、pending clarification/action；语义相关长期记忆和成功 Episode；当前页面、日期、教学周、课表目标及"个人课表是否可用"布尔值；发布态 Manifest 的 Skill/Tool ID 摘要；知识库引用摘要（不含原始 Tool 结果）。

快照具备硬 token 预算、确定性裁剪、`configVersion`、选择指纹、分段指纹和不可变视图。Trace 只记录 ID、数量、预算与指纹，不记录消息、记忆正文或课表内容。

## 长期记忆事实源

`server/src/services/ai/conversation/userPreferenceService.js` 的 `user-memory.v2` 是长期事实和 Episode 的唯一持久源：

- AES-256-GCM 加密，按服务端验证 Principal 分片；客户端 `conversationId` 不参与身份判定；
- provenance、confidence、TTL、scope、revision、supersedes/supersededBy、status 完整保存；
- "不是 A，是 B"会把 A 标记为 superseded，低置信自动提取不能覆盖高置信显式事实（implicit 永不覆盖有效 explicit）；
- term/release scope 只有在权威边界匹配时才能进入 Turn snapshot，学期或 Release Pack 变化会失效；
- 多条同 Turn 记忆在一个锁和一个 revision 中原子写入；Turn 读取在一个锁内获得 policy、全部可见值、相关记忆和 Episode；
- corruption、未知 Schema、错误密钥、revision 冲突均 fail closed，且不覆盖原文件；
- pause/capacity/episodeCapacity 立即生效；无变化操作不写盘、不增加 revision；
- 只保存通过 Verification（`ok === true`）的成功 Tool Episode；天气、完整课表、原始 Tool 结果、凭据和隐藏推理被拒绝。

模式边界：

| 模式 | 最近消息/Working State | 跨会话长期记忆 | 跨设备 |
| --- | --- | --- | --- |
| `local_only` | 小程序本机 | 仅本机低风险偏好 | 否 |
| `session_state` | 服务端当前会话 | 不读取、不写入 User Memory | 否 |
| `cloud_sync` | 服务端会话 | 加密 User Memory + verified Episode | 是 |

## 2026-07-30 修复闭环（grilling 确认口径）

### H1 — 清除全部云端记忆 revision 闭环

服务端 `DELETE /agent/memory` 强制 `expectedRevision`（不变）；客户端 `onClearAllMemory` 经统一 helper 携带当前 `memoryRevision`；409 → 刷新云端记忆与 revision → 仅重试一次；非 409 不重试；二次 409 / 刷新失败即停止并提示中文可理解错误；成功后同步列表、数量与最新 revision。此前"清除全部"按钮必败（无参调用撞 400）已修复。

### H2 — recentTurns 跨设备/跨会话恢复

服务端契约冻结（`recentTurns` 顶层、`{role, text}`、上限 12 条、local_only 恒空）。客户端 `getCloudConversation` 在 API 边界一次规范化：`recentTurns` 存在且为数组即权威（空数组不 fallback、不合并 conversation.messages），仅缺失时 fallback 旧 `messages`（兼容分支）；`{role, text}` → `{role, content}` 保序。投影层白名单过滤（仅 user/assistant 且正文非空），不伪造系统消息，不覆盖 conversation/memory/contextSlots/pendingClarification。

**如实记录**：修复前本能力在生产环境实际失效（客户端读取生产响应中不存在的 `conversation.messages`），旧 UI 测试 fixture 形状与生产响应不符；本次已修正 fixture 为生产形状，并新增 `tools/test-agent-context-restore-contract.js` 以真实服务端 `getConversation` 序列化输出驱动客户端规范化/投影的契约测试。

### M1 — 单 Turn 单次原子记忆提交

三处独立写路径收敛为一个确定性 mutation plan + 一次权威 `mutate`（`applyMutationPlan`），all-or-nothing；首次携带 expectedRevision；冲突 → 重读最新基线 → 以最新状态重算合并（重跑 supersede/去重/TTL/scope/confidence/容量/Episode 合并）→ 仅重试一次；两次仍冲突则 fail-soft 跳过并产生 `memory.write_skipped` 结构化事件（`memory.write_succeeded/write_retried/write_skipped/write_failed` 四态区分；Schema/权限/存储错误准确分类，不伪装成 revision conflict）。记忆持久化失败不打挂聊天 Turn、不显示"已同步"。

### M3 — 滚动摘要结构化

`mergeRollingSummary` 接收结构化 `currentTurnFragments`（completedTools/verificationSummary/pendingClarification/pendingAction/stableFacts/supersededFacts/workingStateDelta）；previousSummary 存在时不再丢当轮工具轨迹与 pending 状态；工具轨迹最小化（completed ≠ verified，Verification 失败不记为已确认）；pending 生命周期结构化（resolved 移除、新 pending supersede 旧）；1200 字预算按确定性优先级裁剪；"不是 A 是 B"只留 B；系统生成英文占位符改为自然中文（用户英文原文不受影响）。

### M4 — Memory-to-Provider 边界（ADR-0006）

双层防护：ContextAssembler 产出显式 provider-safe projection（九项准入门禁；缺失/非法 expiresAt 的记忆与 Episode 按 expired fail closed 排除；redact 用作检测器而非清洗器；固定 Schema 结构化数组；确定性截断）；decisionPrompt 本地强制门禁（校验投影版本标记与白名单字段集、重跑敏感模式检查、控制字符剥离、段预算截尾、上游异常 fail closed）；system prompt 声明记忆为不可信数据；Trace 只记选中数与排除原因类别。21 组请求体级用例断言实际发送给 Provider 的请求体（本地 HTTP 假端点拦截），覆盖学号/手机号/密码/Cookie/Token/API Key、嵌套字段、reusableConstraints、Episodic 摘要、过期/superseded/scope/低置信、public 恒 0、strict/adaptive 合规进入、合规记忆真实影响 Goal/约束、确定性截断、注入防护、fail closed。

### M5 — delete/edit/pause 的 refresh-on-conflict

`withMemoryRevisionRetry(operation, userIntent)` 集中于 `agentMemoryClient`：只处理 409、刷新后基于不可变用户意图仅重放一次、二次 409 停止、不降级为无 revision 写入。差异回放：delete 404 收敛（刷新+移除本机项+温和提示）；edit 刷新后目标消失不强制覆盖（提示重新确认）；pause 按期望终态重放而非 toggle；export 只读不套用写重试。

### Low×6

1. 客户端死分支与 Mock 保真：页面只调真实导出方法（`patchMemoryPolicy`/`exportCloudMemory`），静默 fallback 模式清除，`expectedRevision` 经抓包验证真实进入请求体，UI Mock 与生产 API 严格一致。
2. `deleteEpisode` 与 `deleteMemory` 未找到统一 404（`EPISODE_NOT_FOUND`）。
3. canonical 字段核查结论：canonical = 服务层条目 `scope+termId+releaseVersion`（scopeMatches/invalidateContext/prepareTurnSnapshot 真实消费）；candidate 级字段为 legacy 仅补位；冲突记结构化代码；学期变化真实失效有测试。
4. TTL 类别化：`resolveTtlMs`（term/release 短 TTL 绑版本、pending 24h、key 默认长 TTL）；legacy 缺 expiresAt 用 updatedAt→createdAt 起算 + 类别默认 TTL；空串/非法日期 fail closed；禁止"当前时间+默认 TTL"复活旧数据。
5. explicit 优先链落实：implicit 永不覆盖有效 explicit；pause 只停自动抽取/implicit 写入，不阻止手动管理与用户主动确认保存。
6. verification fail-closed：`responseComposerBridge` 仅 `verification.ok === true` 视为通过；缺 ok/null/字符串/结构非法/异常均不通过；无通过证据可 completed 不可 verified、不写入摘要/Episode。

## 用户管理闭环

服务端已提供带 Session、环境作用域和 revision 并发控制的 API：查看 overview/items/episodes/policy/audit；修改、删除单条记忆；暂停/恢复自动记忆及调整容量；删除 Episode；导出脱敏副本；清除长期记忆和会话记忆（跨存储失败明确返回 `partial` 与各存储状态）。

小程序 Memory 面板消费真实 policy、revision、items 和 episodes。云端写失败不会先更新本机状态或显示成功；云端独有会话先拉取 recentTurns 并经相同消息隐私/大小边界投影到本机，旧 revision 不能覆盖新投影。

**兼容性注记**：legacy preferences 端点（PATCH/DELETE `/agent/memory/preferences*`）本次起强制 `expectedRevision`；旧版本小程序若直接调用这些端点会收到 400（中文提示"请刷新记忆列表后再重试"）。v2 items 路径不受影响。

## 可执行证据

`npm run test:agent-platform-p3` 通过（16 个测试文件）：

- `agent-context.v2` 预算、裁剪、分阶段视图、泄漏防护和 config identity（context-assembler-v2、context-production-path）；
- `strict_model_first` 首次 Provider 证明（strict-first-call-proof）；
- 长期记忆存储可靠性、语义检索、TTL、scope、冲突和 Episode（memory-store-reliability、long-term-memory、memory-content-policy）；
- 多轮场景（memory-scenarios-60）；
- 真实 MemoryController 连续 100 Turn、服务重实例化+磁盘重读、新会话恢复（memory-100-turn-runtime）；
- Memory v2 API、revision 冲突、partial clear（memory-api-v2）；
- 小程序查看/修改/删除/暂停/恢复/导出（xiaofu-memory-ui-v2）；
- 跨设备/跨会话恢复的服务端→客户端契约（context-restore-contract）；
- 单 Turn 原子提交与并发（memory-concurrency）；
- 滚动摘要结构化（rolling-summary）；
- Memory-to-Provider 请求体级边界（memory-provider-boundary）；
- 课表变化 current/baseline 仅进入 Tool 私有上下文（platform-production-wiring、course-action-agent）。

同时通过：`npm run test:agent-phase2`（11/11）、`npm run test:agent-phase3`、`npm run test:agent-final-convergence`、`npm run test:agent-release-gate`（14 步）。

## 如实表述修正（相对 2026-07-30 初版）

1. "60 个多轮场景"：数量属实（`assert.strictEqual(count, 60)`），但实为 7 个模板循环参数化生成，多数迭代仅索引值不同；真正长程多轮的为少数场景（如 100 轮摘要场景）。不表述为 60 个独立端到端场景。
2. "跨设备会话恢复"：初版声称时该能力在生产实际失效（见 H2），初版 UI fixture 形状与生产响应不符；本次修复并以真实服务端序列化契约测试锁定。
3. "服务重建"：实际为同进程重实例化 + 磁盘重读，非进程重启。
4. "一个锁和一个 revision 原子写入"：初版只对 `upsertMemoryBatch` 单批次成立；M1 后单 Turn 全部变更收敛为单次原子提交。
5. 上述均为本地代码和 mock/fixture 证据；本阶段没有执行真实 Provider staging、CloudBase、体验版、真机或生产部署验证。

## 回滚

P3 以独立提交交付。回滚时应整体回滚 ContextAssembler 生产接线、`user-memory.v2` Controller/API/UI 和对应测试；已有 v2 数据文件保留为加密数据，不应通过删除文件回滚。回滚不会改变 Release Pack、课表事实源或 public 零外部 Provider 约束。
