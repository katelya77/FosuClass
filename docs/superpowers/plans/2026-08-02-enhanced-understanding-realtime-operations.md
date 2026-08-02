# 小佛助手增强理解与实时运行中心实施计划

> 基线：`origin/main` = `9d093596846b734c6185cebfb06e2ba646ccbad9`
> 分支：`codex/xiaofu-agent-enhanced-understanding-realtime-ops`

## 目标与边界

- 让“二五级动物科学三班”等口语中文数字稳定落到确定性班级事实查询，歧义时仍返回候选，模型不得成为课表事实源。
- 让 trial/dev 的 Decision 阶段只选择已配置且真正支持严格结构化输出的 Provider，并给予可用但受总 Run 15 秒上限约束的预算；public 外部调用仍为 0。
- 将 Provider Runtime 的真实开始、成功、失败事件贯穿到 readiness、助手运行中心和查询服务日志，并从 durable Run/Event Store 恢复历史。
- 嵌入后台时移除“返回后台”导航；首屏仅加载运行概览和近期 Run，高级配置惰性加载；实时刷新在页面隐藏时暂停。
- 使用克制、可访问的 SVG 校园课表脉冲标识，不引入通用 AI Dashboard 风格。

## Task 1：班级口语数字规范化（RED → GREEN）

**文件**

- 修改：`server/src/services/ai/classAliasResolver.js`
- 修改：`server/src/services/ai/toolRegistry.js`
- 新增：`tools/test-agent-class-spoken-numerals.js`
- 修改：`tools/test-agent-campus-product-scenarios.js`

**步骤**

1. 先写行为测试：真实班级索引 fixture 中，“二五级动物科学三班”唯一命中 `25动物科学3班`；“二〇二五级…十一班”正确解析；多个同名候选不猜测。
2. 运行测试并确认因 `parseClassEntity()` 返回 `null` 而失败。
3. 在班级实体边界新增上下文限定的中文数字解析：只转换年级前缀和“班”前的班号，不做全局文本替换。
4. `resolveClass()` 的精确、结构化、模糊路径统一消费规范化结果；查询 Tool 使用规范化关键词。
5. 运行测试确认通过，并做反向变异检查：移除中文数字转换后测试必须失败。

## Task 2：Provider 分阶段能力、配置过滤与预算（RED → GREEN）

**文件**

- 修改：`server/src/services/ai/providerRuntimeComposition.js`
- 修改：`server/src/services/ai/decision/decisionService.js`
- 修改：`packages/agent-runtime/src/agentRuntime.js`
- 修改：`server/src/services/ai/decision/decisionPrompt.js`
- 新增：`tools/test-agent-provider-stage-capabilities.js`

**步骤**

1. 先写测试证明：public 返回空外部链；trial Decision 跳过未配置 Provider；Coze workload 默认不占严格 Decision 槽，但仍可用于 Response；显式且可验证的结构化模式才允许进入 Decision。
2. 写一个约 4 秒完成的假结构化 Provider，确认旧 3.5 秒 Decision 预算失败。
3. 运行 RED 测试并保存失败证据。
4. 给 Adapter 声明 `supportsDecision` / `supportsResponse` / `configured` 事实；选择器先按阶段能力和当前环境配置过滤，再取至多主备两个。
5. 将 enhanced Decision 默认预算提高到有界值，同时保留 `AI_AGENT_RUN_TOTAL_TIMEOUT_MS <= 15000`、finish reserve 和 fallback 账本。
6. 在 Decision 提示中明确口语数字需规范化，但工具查询仍由确定性实体解析再次校验。
7. 运行新测试与 public-zero-provider、deadline、strict-decision 回归。

## Task 3：真实 Provider 事件与 durable 调用日志（RED → GREEN）

**文件**

- 修改：`packages/provider-runtime/src/providerRuntime.js`
- 修改：`server/src/services/ai/providerRuntimeComposition.js`
- 修改：`server/src/services/ai/providerChainService.js`
- 新增：`server/src/services/ai/providerOperationsLogService.js`
- 修改：`server/src/routes/admin.js`
- 修改：`server/src/services/ai/platformComposition.js`
- 新增：`tools/test-agent-provider-live-operations.js`

**步骤**

1. 先写测试：Provider Runtime 成功/失败事件更新 readiness 投影；admin 调用日志能从 durable Run 事件返回 `runId/requestId/provider/stage/reasonCode/latencyMs`；不含消息、OpenID、密钥；进程内投影清空后 durable 事件仍可读。
2. 运行 RED 测试并确认当前日志为空、verified 不更新。
3. 给 Provider Runtime 增加不会影响执行结果的全局观察回调；组合根把事件映射到 `providerChainService.observeRuntimeEvent()`。
4. 新日志服务合并 durable Run/Event 事件与非 Run Probe 事件，以 eventId 去重、按时间倒序、支持 `after` 游标；返回明确 `source`。
5. admin call-log route 改为异步 durable 查询，并保持 no-store、鉴权和脱敏边界。
6. operations snapshot 使用真实 Provider 状态，并识别部署变量 `FOSU_DEPLOY_COMMIT_SHA`。
7. 运行测试，并验证失败观察回调绝不改变 Provider 调用终态。

## Task 4：助手运行中心快速首屏、实时刷新与 SVG（RED → GREEN）

**文件**

- 新增：`apps/agent-admin/public/agent-platform-live.js`
- 修改：`apps/agent-admin/public/agent-platform.html`
- 修改：`tools/test-agent-admin-operations-dashboard.js`

**步骤**

1. 先写可执行控制器测试：嵌入态不显示/不导航“返回后台”；启动只触发 operations + runs；高级配置首次展开才加载；页面隐藏时不轮询；恢复可见后立即刷新；并发刷新不重叠。
2. 运行 RED 测试。
3. 用 UMD 小控制器承载嵌入识别、首屏并行加载、惰性高级配置和可见性感知刷新；HTML 实际消费该控制器。
4. 移除嵌入态返回链接，独立访问时才保留返回入口；禁止 iframe 内导航到后台首页。
5. 运行概览 5 秒刷新、Run 3 秒刷新；显示实时/暂停/重试状态和最后更新时间，失败使用行内状态并指数退避，避免 Toast 风暴。
6. 以 inline SVG 替换“佛”字块，区块标题使用同一线性图标系统；保留亮/暗色、窄屏、键盘焦点与 reduced-motion。
7. 再运行控制器测试和后台 UI 契约测试。

## Task 5：查询服务实时日志 UI（RED → GREEN）

**文件**

- 修改：`server/src/routes/adminPages.js`
- 修改/新增：`tools/test-admin-ai-provider-ux.js`、`tools/test-agent-provider-live-operations.js`

**步骤**

1. 测试真实 API payload 能渲染 durable 来源、runId/requestId、阶段和失败码；页面隐藏暂停刷新。
2. 把 10 秒进程内轮询改为 2 秒增量轮询，恢复可见立即补拉；显示数据来源、最后更新时间和加载/错误状态。
3. 缩短空日志区域并提供可执行空态说明，不把“暂无”误报为 Provider 不可用。

## Task 6：集成、文档与交付验证

**文件**

- 修改：`package.json`（将新增关键测试纳入可靠性/phase3 或 release gate）
- 修改：`docs/xiaofu-agent/operations-center-guide.md`
- 修改：`docs/xiaofu-agent/real-device-reliability-root-cause.md`

**步骤**

1. 运行新增针对性测试、`git diff --check` 和 secret scan。
2. 运行 `npm run test:agent-foundation`、`npm run test:agent-regression`、`npm run test:ai-competition`、`npm run test:agent-final-convergence`、`npm run test:agent-phase3`。
3. 运行后台 inline/UTF-8/build 检查与相关 Provider/Run tests。
4. 使用本地无密钥输出的真实 Probe 验证 Provider 可达性；Mock、代码测试、真实 Probe 分开报告。
5. 不声称真机或生产通过；交付未验证项、VPS 发布步骤、回滚路径。未经新的发布确认，不部署生产。
