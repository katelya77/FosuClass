# 01 — R49-MA 架构设计

## 1. 为什么 Multi-Agent，而不是继续加巨型 00 Workflow

R49（认知编排设计）已定位 P0 根因：**00 顶层缺结构化 Turn 语义层与 stale context escape 出口**，导致：
- 「T09 整周课表 → 检查一下他的风险」被 03 入口 `second_entity required` 契约误判为需要第二对象；
- 澄清/错误态（pending second_entity + risk-local state）污染后续「空教室」「校园态势」等新 domain 任务。

R49 原方案是把 TurnState/Resolver/Gate 全部实现为一个巨型 00 Workflow。**R49-MA 的架构决策是：不再把语义编排堆进一个工作流**，而是：

1. **把语义原则降维到 Agent 层**：TurnState 的结构化字段 → Main Agent 的判定 Prompt + 子 Agent 的返回契约；数据优先级 → Context Policy；stale escape → Handoff Policy + 每新 turn 由 Main 重新接管。
2. **把动态事实收敛到工具层**：Agent 只负责理解与路由，事实由 5 个确定性 Agent Tool（→ CampusTools）输出。
3. **让平台承担状态流转**：腾讯 ADP Multi-Agent 模式 + 「每个新 Turn 重新由主 Agent 接管」的流转策略，从机制上防止旧 workflow 的 suspended/pending state 污染新任务。

**不变量**：R49 的 `turnType/domain/needsCampusFacts/continuationConfidence/comparisonMode/staleContextEscaped/reasonCode` 等语义仍然有效，只是载体从「00 workflow 内部节点」变为「Main Agent Prompt + Handoff Policy + Tool Contract + Regression Tests」。

## 2. 总体拓扑

```
[用户 Turn]
    │  SYS.UserQuery / SYS.RewriteQuery / SYS.ChatHistory
    ▼
┌───────────────────────────────┐
│ 小序 · 主协调 (Main)           │
│ 1) turnType 判定               │
│ 2) 是否需动态事实？             │
│ 3) 代词/上轮对象/日期/Top1 解析 │
│ 4) 旧上下文相关性判断           │
│ 5) 路由 / 澄清 / 直接回复        │
└───────┬───────────┬───────────┘
        │ handoff   │ handoff
        ▼           ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ 课程空间      │ │ 风险规划      │ │ 校园洞察      │
│ Schedule    │ │ Risk        │ │ Insight     │
└──────┬──────┘ └──────┬──────┘ └──────┬──────┘
       │ 回 Main (含结果信封)  │          │
       └────────────┬─────────┘          │
                    ▼                    ▼
             ┌───────────────────────────────┐
             │  5 个 Agent Tool → CampusTools │
             │  → competition-demo-v2         │
             └───────────────────────────────┘
```

**第一阶段手转交规则**：只有 `Main → Child` 与 `Child → Main`。禁止配置子 Agent 互相横向自由转交（`Child → Child`）。平台对话流转策略必须设为：**每个新 Turn 由主 Agent 重新接管**。

## 3. Turn 生命周期（Main 视角）

1. **接管**：每个新 turn（含 Widget 发出的 state-complete sys.chat）都作为新 root turn 由 Main 接管。
2. **判定 turnType**：`NEW_TASK`（新业务域/明确新问题）/ `FOLLOW_UP`（同域继续、代词继承）/ `CHAT`（闲聊、无需事实）/ `META`（能力询问、功能导航）/ `CLARIFY`（参数不足）。
3. **判定是否需动态事实**：是 → 路由 Domain Agent；否 → 静态知识（KnowledgeRetrievalAnswer）或直接回复。
4. **相关性判断**：旧上下文是否仍相关？若新问题明显属于另一业务域 → 视为 NEW_TASK，旧 domain-local pending state 必须清除（stale escape）。
5. **路由**：选择唯一 Domain Agent，附带已确认 slots。
6. **回包**：子 Agent 返回机器可识别状态（`SUCCESS` / `NEED_CLARIFICATION` / `NO_RESULT` / `ERROR`）。
7. **收口**：Main 负责最终输出（文本或 Widget），结束本轮。子 Agent 不得长期占据会话控制权追问。

## 4. 状态分层与作用域

| 状态 | 作用域 | 来源 | 用途 |
|---|---|---|---|
| `SYS.UserQuery` | 会话 | 平台 | 本轮原始输入（唯一权威） |
| `SYS.RewriteQuery` | 会话 | 平台 rewrite | 当前完整意图，优先于 ChatHistory |
| `SYS.ChatHistory` | 会话 | 平台 | 相关上下文选择（6 vs 8 轮 A/B） |
| 上轮 confirmed slots | Agent 输出 | Main 维护 | FOLLOW_UP 继承候选，可被本轮显式覆盖 |
| `APP.*` / 长期记忆 | **不用作 session-local 临时任务状态** | — | 不用于短期 task state 继承 |

**数据优先级（固定）**：
1. 本轮显式用户输入 > 2. 当前 RewriteQuery / 完整意图 > 3. 上轮 confirmed active state > 4. 与本轮相关的 ChatHistory > 5. 缺失。
**铁律**：旧 history 绝不覆盖本轮明确新任务；明确新实体/新日期/新 domain 覆盖旧值。

## 5. R47.7 的定位

- R47.7 单工作流基线 = **Golden Baseline**：作为多轮回归对照的真值来源。
- = **Regression Baseline**：每次架构改动后用同一批用例对比，不许出现事实倒退。
- = **Emergency Fallback**：Multi-Agent 出现无法快速修复的回归时，一键回滚到 R47.7（见 `11-R47.7-BASELINE-AND-ROLLBACK.md`）。
- **不删除、不覆盖、不退役** R47.7 与旧 01~05；它们继续作为平台侧已导入资产保留。

## 6. 为什么本轮能先在仓库落地

- 5 个 Agent Tool 契约、schema、adapter、OpenAPI 都是**仓库内可交付物**，不依赖真实腾讯 AgentID/PluginID。
- 自动测试（schema/self-compare/description-lint/no-production/no-fake-id/fixtures/knowledge-guard/baseline-integrity）可本地运行验证。
- 真正的 Agent 创建、Workflow 重绑、Widget 绑定、模型切换属于**平台侧人工动作**，见 `06-ADP-MANUAL-CONFIG-CHECKLIST.md` 与 `reports/R49-MA-ADP-HANDOFF.md`。
