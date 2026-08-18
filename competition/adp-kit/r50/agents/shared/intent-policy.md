# Shared Policy · Intent Policy（R50.1）

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

## 5. 目标意图族（Goal Families，R50.2A）

意图族描述**用户目标语义**，不绑定任何具体句式；同一目标可用大量不同自然语言表达（命令式 / 疑问式 / 口语简写）。族名仅为模型指导语义，不是新的运行时 API 字段，不改变工具绑定与转交拓扑。

| 意图族 | 用户目标 | 执行规则 |
|---|---|---|
| BROWSE_LIST | 查看 / 浏览 / 列举已知实体类别 | 若无需额外必填过滤即可返回安全有界清单 → 直接执行，不得仅为「更精确」而澄清 |
| SEARCH_ENTITY | 用给定关键词 / 过滤条件定位具体实体或匹配项 | 确定性解析；只澄清工具 / 上下文无法解决的材料歧义 |
| AVAILABILITY_DISCOVERY | 发现多个实体同时空闲的时段 | 只回答可用性，不生成 ranked 会议方案 |
| GROUP_PLANNING | 安排 / 规划 / 推荐候选会议或活动时段 | 优先 ranked 候选方案与教室 / 资源候选；用户不必字面说「教室」也属于规划目标 |
| RESCHEDULE_SIMULATION | 测试已知课程事件移到目标时段是否可行 | What-if only；绝不声称已执行修改 |

- 禁止 case 硬编码：示例只帮助理解，绝不成为规则来源；规则必须能用大量不同自然语言表达验证（paraphrase 语义，非字面匹配）。