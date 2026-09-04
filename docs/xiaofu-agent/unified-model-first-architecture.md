# 小佛助手统一模型优先架构

> 状态：实现事实源。协议以 `agent.v2` 为准，`agent.v1` 保持兼容；能力权威源仍是 `server/config/agent-capability-manifest.json`。

## 1. 单一在线链路

```text
Protocol / Cancel / Credential Guard
→ Provider Layer
→ Understanding（每轮安全消息必跑）
→ Strict GoalContract
→ Manifest Goal Resolver
→ Constrained Planner
→ Capability Router / Whitelist
→ Tool Executor
→ Observation / Verification（最多一次 Replan）
→ Response Composer
→ Working State Tree
→ RunEvent / Action / Card UI Stream
```

- `trial/dev`：Understanding 的第一个模型请求经统一 Provider Chain 执行；失败后才进入确定性降级。
- `public`：经过同一 Understanding/GoalContract 接口，但来源固定为 `deterministic_policy`，外部 Provider 调用数必须为零。
- 空消息、取消、协议不兼容和敏感凭据是模型前安全例外；凭据永不进入 Provider。
- 小程序端 `xiaofuAgentRouter` 只负责传输失败后的离线兼容，不参与在线决策。

## 2. Strict GoalContract

模型只允许返回以下八个字段，额外字段（包括 `toolName`）直接判为非法并降级：

```json
{
  "goal": "search_school_index",
  "entityType": "teacher",
  "entity": "陈芳",
  "normalizedEntity": "陈芳",
  "constraints": {},
  "followUpMode": "new_goal",
  "confidence": 0.98,
  "needsClarification": false
}
```

`goal` 必须存在于 Capability Manifest；`entityType`、`followUpMode` 和 `constraints` 均使用有限枚举/白名单。Goal Resolver 只把契约映射为 Manifest Intent 和 Slots，不接受模型给出的任意工具名。

## 3. Provider Layer

统一 Provider Chain 支持：

| 对外名称 | 内部适配器 | 结构化 Understanding / Planner |
| --- | --- | --- |
| `hunyuan3` | `cloudbase-openai`（CloudBase OpenAI 兼容入口） | 支持 |
| `deepseek` | DeepSeek OpenAI 兼容入口 | 支持 |
| `coze` | Bot V3 / workload / stream_run 适配器 | 支持 |

关键配置：

- `AI_PROVIDER` / `AI_PROVIDER_CHAIN`：请求级配置优先于进程级配置。
- `AI_UNDERSTANDING_ENABLED` / `AI_UNDERSTANDING_MODEL`：理解层开关与可选模型覆盖。
- `AI_STRUCTURED_TIMEOUT_MS` / `AI_STRUCTURED_MAX_TOKENS`：统一结构化请求预算。
- `AI_PROVIDER_SHADOW_ENABLED` / `AI_PROVIDER_SHADOW`：可选影子评估；结果只进入诊断计数，不进入决策、回复或记忆。
- `AI_PROVIDER_CIRCUIT_FAILURES` / `AI_PROVIDER_CIRCUIT_COOLDOWN_MS`：熔断与半开探测。

Provider 状态记录健康度、成功/失败时间、P50/P95、熔断、降级和 Shadow 统计；`probeProvider` 只允许在非 public 的显式运维检查中调用。Coze 只接受 PAT / Service Token / 官方 API Token。

Shadow 评估在主 Provider 返回后异步调度，不阻塞用户响应。`trial/dev` 的 `providerStages` 分别记录 Understanding、Planner、Response 的 attempted/completed/fallback；整轮 Provider 真值由三阶段聚合，不能再用“回复阶段未调用”覆盖前两阶段。`public` 保留 `externalProviderUsed=false` 安全信号，但省略 Provider/Understanding 诊断字段和实现名称。

## 4. Working State Tree

线程级状态由现有 Working Memory 扩展，不创建第二套记忆系统：

```text
activeGoal
pendingClarification
lastResolvedEntity { type, id, name }
lastConstraints { date/dateOffset/week/weekday/period/campus/college/continuousSections/... }
pendingAction { command, status=awaiting_receipt, runId, createdAt, expiresAt, target }
providerUsed
understandingSource
lastGoalContract
```

Follow-up 只从该树继承缺失字段：换校区保留日期、连续空教室保留校区/星期、设置当前课表复用上一条已解析班级。`setCurrentSchedule` 在 Action 发出后只写 `pendingAction`；只有服务端确认会话已由用户开启 `cloud_sync`，并校验 Receipt 的 Principal、command、runId、有效期和目标一致后，才提交 `currentScheduleTarget` 并清空 Pending。失败或过期 Receipt 返回拒绝，不得声称已完成。

## 5. Teacher Search Contract

权威配置：`server/config/teacher-search-contract.json`；生成命令：

```text
npm run generate:teacher-search-contract
npm run check:teacher-search-contract
```

生成物分别位于服务端与小程序可打包目录，但来自同一配置，不手工维护。两端共享：

- `teacher-search.v1` Contract Version；
- Teacher Index Schema v4；
- Request/Response 字段；
- 教师条目规范化；
- Release Version + Term + Query + College + Title + Pagination 的语义缓存键。

物理缓存仍按安全作用域包裹该语义键：服务端为 Run/Principal 作用域，小程序为本机 Storage；不会引入第二套缓存。学院筛选是严格匹配，精确姓名在错误学院下不得模糊串到其他教师。

## 6. Schedule 与 UI

- 教师、班级、教室、课程结果继续复用 `scheduleNavigationService` 和唯一 `schedule-view`；只有缺少 `detailId`/版本时才降级到全校页。
- 校园管家只保留文字 Composer 与任务入口，不申请录音权限，也不部署或调用语音转写能力。
- 发送前 UI 只显示中性 `submitting`；`understanding.started` 后才显示理解，只有真实 `provider.started` 才显示 Thinking。
- 状态岛全宽居中；Composer 是唯一底部胶囊并处于 Flex 流中；消息区与真实测量的 `composerInsetPx` 同步，不保留覆盖式大底部空白。

## 7. Runtime Truth 与完成语义

- `run.completed / run.degraded / run.failed` 在最终协议/Card 校验后，由工具执行、验证结果、Provider 降级和错误数共同推导；异步 Run 不得把既有 partial/degraded 终态覆盖成 completed，客户端也不得硬编码“完成/已验证”。
- Action 完成必须有受服务端状态约束的 Receipt；只有 `verification.ok=true` 才能展示“结果已核验”。
- 部分完成显示 degraded，硬失败显示 network_error，Provider 降级仍保留确定性事实但明确为 degraded。
- RunEvent、Action、Card 和最终回复消费同一终态摘要；后台 Shadow 事件不回写已结束 Run。
- public RunEvent 仅保留用户可理解的状态与标签，清空 Provider、purpose、understandingSource 和内部 reasonCode；trial/dev 才提供安全裁剪后的诊断。

## 8. 模块处置

| 处置 | 模块 |
| --- | --- |
| 保留并复用 | Agent Kernel、Capability Manifest、Action Bus/Receipt、Observation Loop、Response Composer、Conversation Memory、Release Pack、schedule-view、CloudBase ASR/VPS 基础设施 |
| 重构 | Provider Chain、Planner Provider Adapter、AgentService 入口、Working Memory、RunEvent Reducer、Teacher Search Contract、Voice 状态可观测层 |
| 删除/替代 | 在线规则优先入口、Planner 私有 Provider HTTP 分支、重复 Teacher Schema 常量、客户端预猜 Understanding、旧 UI V2/V3/迁移阶段文档 |

## 9. 回滚

代码回滚以本次合并提交的父提交为目标；不要删除 Release Pack、缓存或 last-known-good。紧急降级只需在 trial/dev 把 `AI_UNDERSTANDING_ENABLED=false` 或 Provider Chain 末端保留 `mock`；`public` 本来就是确定性路径。部署回滚使用既有 GHCR 镜像标签、VPS Compose 版本和 CloudBase 函数历史版本，禁止用清空数据目录作为回滚手段。
