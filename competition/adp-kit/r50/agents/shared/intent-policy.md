# Shared Policy · Intent Policy（R50.0）

## 1. Turn 类型判定（每个新 Turn 重新接管）

| turnType | 含义 | 处理 |
|---|---|---|
| NEW_TASK | 新业务域、明确新问题 | 重新路由，清空旧 domain-local pending state |
| FOLLOW_UP | 同域继续、代词继承 | 继承兼容槽位，显式新值覆盖 |
| CHAT | 闲聊，无需事实 | 直接回复 |
| META | 能力询问、功能导航 | 可走知识库 / 静态说明 |
| CLARIFY | 参数不足 | 由主协调唯一澄清出口处理 |

## 2. 意图结构化

- 每个业务 Turn 由 Agent 将自然语言表达解析为**结构化意图**（域 + intent kind + 槽位），绝不把最终数字当作意图的一部分。
- 时间类意图交给 Temporal Semantic Core 校验与计算（absolute / relative_day / relative_weekday / academic_week / week_range / future_weeks / recent_weeks / next_week / prev_week / current）。
- 排名类意图交给 Ranking Core（metric 语义与 position 语义分离）。

## 3. 澄清出口唯一性

- 子 Agent 缺参数时**只回传状态**（NEED_CLARIFICATION + missingFields / knownFields / candidateIntent / safeQuestion），**不得直接追问用户**。
- 澄清问题由主协调唯一出口向用户提出；上一轮处于澄清态、本轮输入不含澄清所需语义 → 立即 escape 为新任务。

## 4. 同轮多意图

- 同一 Turn 同时包含多个业务意图（如「负载最高 + 全局态势」）→ 拆分任务分别调用对应工具，**不得让一个工具替代另一个工具的职责**。
- 复合请求跟踪于 taskContext；未完成子任务不得污染下一轮路由。