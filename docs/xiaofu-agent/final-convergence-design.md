# 小佛助手 Agent V2 Final Convergence — 实施设计

**分支**：`feat/xiaofu-agent-final-convergence`  
**基线**：`dbc713aa`（Agent V2 Phase 3 Runtime Truth Layer）  
**目标**：可作为 Release Candidate 的最终产品收敛，而非继续搭未接通的基础设施。

## 1. 模块边界

```
User
 → Runtime Policy (runtimeModeService + capability manifest)
 → Memory Context (conversationMemoryService + preference)
 → Intent / Slot Resolution (toolRegistry.resolveIntent)
 → Planner (deterministicPlanner | modelPlanner → planValidator)
 → Skill / Tool Execution (agentKernel + observationLoop)
 → Observation → Verify → Complete | Clarify | Replan(≤1)
 → Hybrid Retrieval (knowledge only; 课表事实永不向量化)
 → Response Composer (presentationMode 统一展示)
 → Mini-program Renderer (精简 Header / Feedback / Sheets)
```

| 模块 | 职责 | 不做什么 |
|------|------|----------|
| `planner/*` | 结构化计划；public 确定性；trial/dev 受约束模型规划 | 不直接查库、不任意 Tool |
| `observationLoop` | Plan→Tool→Observe→Verify→Replan | 不无限重试（最多 1 次 replan） |
| `responseComposer/*` | 决定 plain / single_card / multi_card / clarification / recovery | 不生成课表事实 |
| `retrieval/*` | 公开知识 Hybrid RAG | 不向量化课表/个人数据 |
| `conversationMemoryService` | Upsert 会话、模式策略、偏好 | 不信任客户端 principal |
| `AgentClientErrorMapper` | 用户可见中文错误 | 不把内部 code 当 toast |

## 2. 已知缺陷修复

1. **Conversation not found**：`setMemoryPolicy` / `patchConversation` 使用 `createIfMissing`，新建绑定当前 Principal。
2. **英文错误**：统一 `AgentClientErrorMapper`。
3. **记忆原子性**：服务端成功后再写本地 Storage；失败回滚 UI。
4. **取消 Run**：`cancelled` 不调用 `persistAfterSuccess`。

## 3. Runtime 分层

| 能力 | public | trial | dev |
|------|--------|-------|-----|
| 外部生成式 Provider | 禁止 | 允许（表达+规划） | 允许 |
| deterministicPlanner | 强制 | 回退路径 | 回退路径 |
| modelPlanner | 禁止 | 受约束 | 受约束 |
| 一般学习/代码问答 | 禁止 | 配置开关 | 默认可开 |
| Hybrid RAG vector | 可选退化 lexical | 可用 | 可用 |

## 4. 实施顺序

1. Memory Upsert + 错误映射 + 取消不落库  
2. Response Composer + 去掉 generic 表达卡  
3. 小程序最终 UI 信息层级  
4. Planner + Observation Loop  
5. Hybrid RAG  
6. Runtime 开关 + Coze 向导 + Admin 诊断  
7. 评估集 + 回归测试 + 文档  

## 5. 安全不变量

- public 零外部 Provider  
- 课表事实只来自 Tool  
- 不保存 CoT / Secret / 完整个人课表  
- MCP 不开放 publish/rollback  
- 不自动合并 main、不部署生产  
