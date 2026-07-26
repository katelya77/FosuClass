# 小佛助手统一模型优先链路：需求规格

## 1. 范围

在现有 Agent Kernel、Manifest、Tool、Release Pack、Action Bus、Working Memory 与小程序 UI 上完成统一链路，不引入第二套 Agent 架构、能力清单、搜索索引或缓存。

## 2. 功能需求

### R1 模型优先理解

- 当运行模式为 `trial/dev` 且消息通过安全检查时，系统必须在 Intent/Skill/Tool 选择前调用统一 Understanding Provider。
- 当运行模式为 `public` 时，系统必须使用同一 GoalContract 接口的确定性策略适配器，且外部 Provider 调用数为零。
- 当消息包含凭据或禁止发送给模型的敏感内容时，系统必须先阻断，且不得调用 Provider。

### R2 严格 GoalContract

- Understanding 必须只输出 `goal/entityType/entity/normalizedEntity/constraints/followUpMode/confidence/needsClarification` 八个字段。
- GoalContract 必须拒绝额外字段、任意 `toolName`、非法 Goal、越界 confidence 和非安全约束值。
- 当模型 JSON 无效、超时、未配置或熔断时，系统必须记录降级原因并生成确定性 GoalContract。

### R3 Manifest 白名单路由

- Resolver 必须只把 Goal 映射到 Capability Manifest 中存在的 Intent。
- 模型不得直接选择工具；Capability Router 必须继续按 Manifest 选择 Skill/Tool。
- 事实型任务必须先执行确定性工具并附带可核查 Evidence。

### R4 Provider 统一层

- 推理层必须支持 Coze、DeepSeek、腾讯混元 3（兼容现有 `cloudbase-openai` 配置名）。
- 请求显式 Provider/Chain 必须优先于进程全局环境配置。
- Provider 必须暴露选择、开始、完成、失败、延迟、熔断与降级诊断；不得记录 prompt、Token 或密钥。
- shadow eval 默认关闭，开启时不得影响主结果，且 public 永不执行。

### R5 Follow-up

- 当用户只补充教师名时，系统必须继承“查看教师课表”的 activeGoal。
- 当用户说“换成江湾校区”时，系统必须继承上一轮天气日期约束，只替换 campus。
- 当用户说“只看连续两节”时，系统必须继承空教室目标并更新连续节数约束。
- 当用户说“设为当前课表”时，系统必须复用 lastResolvedEntity，并生成等待 Receipt 的 Action，不得提前提交成功状态。

### R6 Working State Tree

- 每轮成功或可降级执行后，系统必须更新 activeGoal、pendingClarification、lastResolvedEntity、constraints、pendingAction、providerUsed、understandingSource 与 lastGoalContract。
- 云端状态必须由已验证 Session 派生 Principal；无有效 Session 时保持 `local_only`。
- 当前课表状态只允许在已验证成功 Receipt 后更新。

### R7 Teacher Search Contract 与导航

- Agent 和全校页必须使用同一 schema、索引版本、缓存键、学院规范化和返回模型。
- 动物科技学院搜索陈芳必须命中；人文学院搜索陈芳不得命中；全校搜索陈芳必须命中。
- 教师、班级、教室、课程四类结果必须通过统一导航服务直接打开 schedule-view。

### R8 语音状态机

- 状态必须按 `privacy → record_permission → recording → transcribing → fill_composer` 转移。
- 必须区分隐私授权失败、微信录音权限失败、系统麦克风失败、ASR 未开通、ASR 调用失败。
- 转写成功只能填入 composer，用户仍控制发送；云函数部署成功不得被描述为真机语音可用。

### R9 UI 真相流

- Loading/Understanding/Thinking/Tool/Verify/Compose 必须消费服务端 RunEvent；客户端不得猜测正在执行的具体阶段。
- `Thinking` 只能在真实 `provider.started` 后显示。
- 状态岛必须全宽且真居中；只保留一个悬浮输入胶囊；消息区底部 inset 必须由真实 composer 高度驱动。
- Action、Card、RunEvent 必须由同一响应/事件状态流消费。

## 3. 非功能需求

- 保持 `agent.v1` 向后兼容；新增 GoalContract/Understanding 字段只进入 `agent.v2` 公共响应。
- 不泄露隐藏推理、系统提示、内部 URL、Provider 配置或密钥。
- Provider 失败不得覆盖已取得的工具事实。
- 不新增大型前端框架、LangChain、LangGraph、向量化课表事实或远程可写 MCP。
- Release Pack 版本校验、静态回退、缓存与 last-known-good 必须保持。

## 4. 验收场景

下列消息必须通过真实链路契约测试：

1. `你好，你都能做什么`
2. `帮我看看明天的仙溪校区天气怎么样`
3. `查看25动物医学5班的课表`
4. `查看老师的课表` → `陈芳`
5. `将25动物医学3班的课表设为当前课表`
6. `查看后天仙溪校区天气` → `换成江湾校区`
7. `空教室` → `只看连续两节`
8. 教师学院过滤三例。

每个场景必须证明：理解发生在路由前、GoalContract 合法、Tool 来自白名单、事实来自权威工具、最终状态可验证。
