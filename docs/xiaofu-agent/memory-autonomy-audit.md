# 小佛助手 · Memory & Autonomy 真实性审计

**基线 SHA:** `93cce738`（origin/main，Merge PR #28）  
**审计方式:** 仅从已上线调用链（源码路径 + 行号）得出结论，不写未接线的设计愿景。  
**分支:** `feat/xiaofu-agent-memory-autonomy`

---

## 1. Agent Kernel → Observation Loop 是否传入真实 conversationState？

**结论：否。Kernel 未向 Observation Loop 传入 `conversationState`。**

证据：

- `server/src/services/ai/agentKernel.js` 调用 `runObservationLoop` 时只传了 `message / runtimeMode / intent / slots / skill / context / availableTools / availableSkills / modelGenerate / planFn / executePlan / verify`，**没有** `conversationState` 字段。
- `server/src/services/ai/planner/observationLoop.js` 虽在 `planFn` 入参中转发 `conversationState: input.conversationState`，但上游 Kernel 未提供时恒为 `undefined`。
- `agentService.chat` 经 `ConversationMemoryService.loadForChat` 得到 `memoryBundle.state`（含 `conversationSummary`、`contextSlots`），但 Kernel `execute` 只接收 `context`，未把 `state` 组装成 Planner 可见的 conversationState。

**断点：** Memory 已加载 → Context 有 soft-fill 槽位，但 Planner / Observation 看不到统一 conversationState。

---

## 2. Model Planner 读的是 summary 还是 conversationSummary？

**结论：读了错误字段名 `conversationState.summary`；仓库权威字段是 `conversationSummary`。**

证据：

- `server/src/services/ai/planner/modelPlanner.js` → `buildPlannerPrompt`：
  - `conversationSummary: input.conversationState && input.conversationState.summary`
- `server/src/services/ai/conversation/conversationSchema.js` 状态模型使用 `conversationSummary`（create/migrate/public view）。
- `conversationMemoryService.applyServerStateToContext` 写回 context 的键是 `conversationSummary`。
- `plannerContextBuilder.js` 正确消费 `input.conversationSummary`，但上游 modelPlanner 填的是 `summary` → **Planner 上下文中的会话摘要实际常为空**。

---

## 3. session_state 是否保存足够的自动上下文？

**结论：部分足够（槽位 + 模板摘要），对「语义延续 / 最近消息 / 工作记忆」不足。**

`ConversationMemoryService.persistAfterSuccess`（session_state / cloud_sync）写入：

| 字段 | session_state | cloud_sync | 说明 |
|------|---------------|------------|------|
| `contextSlots` | ✅ | ✅ | lastIntent / target / week / weekday 等 |
| `pendingClarification` | ✅ | ✅ | |
| `conversationSummary` | ✅ | ✅ | **仅** Intent+Target+Week 拼接（`conversationSummaryService`） |
| `evidenceRefs` / `lastRun` | ✅ | ✅ | |
| `recentTurns` | ❌ 恒空数组 | ✅ 最多 12 条 | schema migrate 对非 cloud_sync 丢弃 turns |
| workingMemory | ❌ 不存在 | ❌ | 无实体/子任务/已执行工具结构化状态 |

`loadForChat` soft-fill 仅覆盖：`lastTargetType/Name/Week/Weekday/type/q/week/weekday/term` 等。  
「那周三呢 / 下午呢」依赖槽位 soft-fill + 客户端 recentMessages，**服务端 session_state 不恢复消息窗口**。

---

## 4. responseContext 为何只用最近 3 条消息？

**结论：硬编码在 `responseContextBuilder` 的 compress 窗口。**

证据：`server/src/services/ai/context/responseContextBuilder.js`：

```js
const hist = compressMessages(input.messages || input.history || [], 3, 100);
```

第二参数 `3` 为消息条数上限。  
`agentService` 虽把 `context.recentMessages` 传入 assembleContext("response")，但 Response 侧被压到 3 条。  
`conversationMemoryService` cloud_sync 合并 recent 时 `slice(-8)`，与 Response 的 3 条不一致。

---

## 5. personalMemoryInterpreter 为何依赖「记住」？

**结论：长期偏好写入路径要求 explicit 关键词；无「记住」的姓名只作 session_fact。**

证据：`personalMemoryInterpreter.js`：

- `explicit = /记住|记一下|以后叫我|以后称呼我/`
- 姓名：无 explicit 时 `persist: false`（session_fact）；有 explicit 时 `persist: true`
- 校区：仅在 `if (explicit)` 分支解析
- 回答文案明确要求：「只有明确说“记住我叫……”时，我才会把称呼保存为长期偏好」
- `UserPreferenceService.upsert` 还要求 `explicit === true && memoryMode === "cloud_sync"` 才落盘

因此「我叫王奕章」在同对话靠 `findRecentName(recentMessages)` 可答，但 **session_state/cloud_sync 新对话默认不恢复**（除非说过「记住」且 cloud_sync）。

---

## 6. Intent → 单 Skill 是否限制 Planner 跨 Skill 工具？

**结论：是。Kernel 只暴露当前 Skill 的 allowedTools 与单一 skillId。**

证据：`agentKernel.js` Observation 路径：

```js
availableTools: skill.allowedTools,
availableSkills: [skill.id],
```

`validatePlan` 默认 `skill.allowedTools.includes(toolName)` 失败即抛 `TOOL_NOT_ALLOWED_FOR_SKILL`。  
仅对 `campus_multi_step_advice` 或 deterministic 多步且工具不在 skill 列表时有特判（runtime 白名单）。  
`deterministicPlanner.expandMultiStepPlan` 可生成跨工具步骤，但 enrich 时仍过滤 `skillAllowed`。

**断点：** 用户一句「明天有没有课 + 空教室 + 天气」若 Intent 落在单一 schedule skill，天气/空教室工具可能被 allowlist 挡掉（除非命中 multi-step intent / expand 特判）。

---

## 7. Replan 为何只覆盖空教室或少数多步任务？

**结论：策略硬编码 + MAX_REPLAN=1。**

证据：

- `planSchema.js`：`MAX_REPLAN = 1`
- `observationLoop.shouldReplan`：
  - 仅当 `steps.length > 1 || plan.intent === "campus_multi_step_advice"` **或** 步骤含 empty_room
  - 空事实条件主要针对 empty_room / multi-step 下 schedule 空结果
  - 单工具「无个人课表」等**不** replan（注释写明有意为之）

---

## 8. 客户端与服务端重复维护的上下文

| 路径 | 位置 | 职责 |
|------|------|------|
| 客户端 recentMessages / local prefs | `packageXiaofu/pages/ai-assistant/ai-assistant.js` + Storage | 本机消息、memoryMode、本地偏好补丁 |
| 服务端 ConversationRepository | `conversationMemoryService` + file repo | contextSlots / summary / cloud turns |
| 服务端 UserPreferenceService | 加密 preferences 文件 | 仅 cloud_sync + explicit |
| personalMemoryInterpreter | agentService 早退分支 | 与主 Kernel 并行的记忆问答路径 |
| soft-fill conversationSlots | loadForChat → context | 与客户端槽位双写 |
| safetyGuard.sanitizeAgentContext | 进 Kernel 前 | 再截断 recentMessages |

**风险：** 同名信息（称呼）可能在 recentMessages、preferencePatch、云端 preferences 三处，语义不一致；Planner 几乎不读任何一处的完整形态。

---

## 9. 哪些测试只注入 recentMessages？

| 测试 | 行为 |
|------|------|
| `tools/test-agent-personal-memory.js` | 直接调 `resolvePersonalMemoryTurn` 并注入 `recentMessages`；**不**经 HTTP/agentService 多轮 |
| `tools/test-agent-context-memory-flow.js` | sanitize + 注入 recentMessages 的单元/服务片段 |
| `tools/test-conversation-memory.js` | 仓储 load/persist；cloud 恢复 recent；非连续 chat HTTP |
| `tools/test-agent-real-http-e2e.js` | 真 agentService.chat，但**单轮**消息，无「查课表→那周三」继承断言 |

**缺口：** 缺少「真实连续多轮 chat + conversationId + session_state」对实体继承与自动称呼的门禁。

---

## 平行记忆路径（待合并为 MemoryController 唯一链路）

1. `ConversationMemoryService.loadForChat` / `persistAfterSuccess`
2. `personalMemoryInterpreter` + `UserPreferenceService`（agentService 早退）
3. 客户端 `memoryPreferencePatch` / `FOSU_AI_MEMORY_MODE` Storage
4. `buildConversationSummary` 模板串（与语义摘要目标平行且过弱）
5. modelPlanner 的 `summary` 幽灵字段

---

## 推荐最小接线（实现约束）

```
agentService.chat
  → MemoryController.load  (包装 ConversationMemoryService + UserMemory + WorkingMemory)
  → ContextAssembler / Kernel.context
  → AgentKernel.execute(conversationState, capabilityRoute)
  → ObservationLoop / Planner(conversationSummary, workingMemory, userMemories≤5)
  → Tools / ResponseComposer
  → MemoryController.commit (candidates + slots + summary + turns)
```

不重写 Kernel 架构；只补 conversationState、Capability Router 多 Skill 候选、统一字段名、自动记忆策略与 Replan=2。

---

## 审计问题快速对照

| # | 问题 | 结论 |
|---|------|------|
| 1 | conversationState → ObsLoop | **未传入** |
| 2 | summary vs conversationSummary | **读错 summary** |
| 3 | session_state 自动上下文 | **槽位有、消息/工作记忆弱** |
| 4 | response 3 条 | **硬编码 compressMessages(..., 3)** |
| 5 | 「记住」依赖 | **长期偏好强制 explicit** |
| 6 | 单 Skill 限工具 | **是** |
| 7 | Replan 范围 | **empty_room / multi-step；MAX=1** |
| 8 | 重复上下文 | **client + CMS + prefs + interpreter** |
| 9 | 注入式测试 | **personal-memory / context-flow 等** |
