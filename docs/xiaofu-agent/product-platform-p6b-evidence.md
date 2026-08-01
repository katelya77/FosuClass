# P6b Evidence — Miniprogram Agent Shell and UI Block Runtime

阶段：P6b — Miniprogram Agent Shell and UI Block Runtime
提交：`refactor(miniprogram): adopt agent sdk and ui block shell`
日期：2026-08-01

## 1. 交付范围

| 位置 | 内容 |
| --- | --- |
| `tools/generate-agent-sdk-compat.js` | 生成器：`packages/agent-sdk`（runStateMachine+client）+ `packages/ui-schema`（blocks）打包为单文件 `miniprogram/shared/agentSdk.generated.js`（纯 JS 零依赖，模块注册表包装，不改语义）；`--check` 新鲜度校验进测试 |
| `miniprogram/shared/agentSdk.generated.js` | 生成产物（小程序运行时无法 require `miniprogram/` 之外的 `packages/*`，沿用仓库生成拷贝惯例） |
| `miniprogram/services/agentRunShell.js` | **页面唯一 active-run 状态源**：SDK 客户端 + wx 依赖注入（utils/request 适配、wx KV 适配、懒绑定）；startRun/cancelActiveRun/resumeActiveRun/getActiveRun/clearActiveRun；终态宽限 4×600ms、轮询错误 500ms 容忍、nextPollMs 节奏、shouldCancel 每 tick；active 句柄持久化（`agent-run:active`，游标随句柄）；事件扇出走 reducer sequence 差分 + eventId 集合兜底，整个 Run 生命周期同一 eventId 绝不重复投递 |
| `miniprogram/services/aiTransportRouter.js` | 传输改道：callOracleViaRuns 由 shell 驱动（页面回调契约不变）；**direct chat 标记 compatibility-only/deprecated**：仅显式开关 `AI_AGENT_RUNS_TRANSPORT_ENABLED=false` 或服务端 `RUN_PROTOCOL_UNSUPPORTED` 触发，记录 compatReason/protocolVersion/clientVersion/transport/featureImpact 五元组（`FOSU_AI_DIRECT_CHAT_COMPAT`），普通网络错误/超时如实上抛不再静默降级；兼容应答打 compatMode/compatReason/transport 标记且绝不伪造 plan/tool_progress/verification/action_receipt |
| `miniprogram/packageXiaofu/services/uiBlockAdapter.js` | 通用 12 类 UI Block → 既有卡片模型适配（deriveBlocks/mapBlocksToDisplay/responseToDisplayAugment）；未知 Block 安全 text fallback + 计数；通用层零校园字段（静态扫描锁定）；Fosu 映射仍由页面 normalizeCard 管线承担（插件 Adapter 角色） |
| `miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js` | 绞杀式接线：require shell/adapter；`resumeActiveAgentRun`（onLoad/onShow/网络恢复监听三触发，诚实恢复不伪造进行中）；`buildAssistantMessageFromResponse` 纯提取（发送与恢复共用同一消息构建）；`normalizeMessageForDisplay` 空卡片时经 uiBlockAdapter 增强（有卡片消息逐字节不变）；compatMode/compatReason 透传 + fallback-banner 槽位如实提示「实时进度不可见」；`wx.onNetworkStatusChange` 注册/注销 |
| `miniprogram/services/aiAssistantService.js` | `isClientFallbackTransportError` 增补 `RUN_CREATE_FAILED`/`AGENT_SDK_RUN_ID_MISSING`（Run 契约破坏=服务失败类，走离线降级而非未分类异常） |
| `packages/agent-sdk/src/client.js` | createRun 缺 runId 时抛 `code:"RUN_CREATE_FAILED", errorClass:"internal", retriable:true`（与旧 agentRunClient 同码）；重新生成 bundle |
| 测试 | 新：`test-xiaofu-agent-run-shell.js`（13）、`test-xiaofu-ui-block-adapter.js`（87）、`test-xiaofu-run-resume-ui.js`（55）；改写：`test-xiaofu-runs-transport.js`（5 场景：默认 runs/显式开关/协议不兼容受控兼容/网络错误不降级/超时如实可重试）；`test-agent-sdk.js` C9 增补契约破坏用例 |
| `tools/devtools-smoke.js` | DevTools 条件式真实 smoke（非 regression 自动发现成员；SKIPPED 如实标注不冒充） |

## 2. 关键设计决策

### 2.1 单一状态源（不许两个活跃 Run 状态源）

agentRunShell 是页面唯一 active-run 权威：页面 `liveRunEvents/activeRunId/activePollToken` 全部由 shell 回调喂给；事件幂等归并只在 SDK reducer 一处（shell 不重实现）；active 句柄只写 `agent-run:active` 一个 storage 键。此前「页面卸载即孤儿 Run」被真实修复：句柄持久化 + onLoad/onShow/网络恢复三触发 resume，恢复只续读不重放、不建第二个 Run。

### 2.2 direct chat 受控兼容（Q12 决策落地）

| 触发 | 处理 |
| --- | --- |
| `AI_AGENT_RUNS_TRANSPORT_ENABLED=false` | 显式开关 → oracleChat，记录 explicit_flag |
| 服务端 400 `RUN_PROTOCOL_UNSUPPORTED` | 协议协商确认旧服务端 → directChatCompat，记录 protocol_unsupported，应答打 compatMode 标记，页面横幅如实提示功能影响 |
| 普通网络错误 / 超时 / 失败 | **不再静默转 direct chat**；如实上抛（TIMEOUT/RUN_TIMEOUT 可重试）由离线降级链接管；超时句柄保留供恢复 |

退役门槛（tasks.md）达成前 direct chat 不删除；五元组本地日志供旧量归零度量。

### 2.3 UI Block 通用消费

服务端信封当前不带 ui.blocks（platformComposition 只注入 runtime 内部），小程序经生成拷贝的同一权威 `blocksFromAgentResult` 在本地从信封推导 → `uiBlockAdapter` 映射既有卡片模型：新声明式 Skill 只输出 12 类通用 Block 时页面零改动可渲染（测试 4 证明）；有卡片消息行为逐字节不变（测试 3b deepStrictEqual）；Fosu 校园字段不进通用层（测试 5 静态扫描）。

### 2.4 恢复语义诚实性

resumeActiveAgentRun：无句柄立即返回（结构测试锁定 guard 顺序）；恢复中状态文案只出现在真实恢复路径；RUN_GONE 清句柄 + 如实过期提示；终态经 `buildAssistantMessageFromResponse`（与发送路径同一构建）落消息；取消如实 cancelled；网络失败不伪造。

## 3. 测试证据（本机实际执行）

| 命令 | 结果 |
| --- | --- |
| `node tools/test-xiaofu-agent-run-shell.js` | PASS 13/13（happy path/至少一次重放零重复/终态宽限/取消/网络失败不伪造/无句柄 null/重开续跑不重建/404 RUN_GONE/错误容忍/超时保留句柄/NO_ACTIVE_RUN/生成器新鲜度） |
| `node tools/test-xiaofu-ui-block-adapter.js` | PASS 87/87（12 类映射/未知 fallback/垃圾输入/优先级/声明式 Skill 零改动/通用层静态纯净/不编造字段） |
| `node tools/test-xiaofu-run-resume-ui.js` | PASS 55/55（接线结构/不伪造恢复状态/增强行为与逐字节不变/消息构建形状/compat 横幅/导出签名） |
| `node tools/test-xiaofu-runs-transport.js` | PASS 5 场景（默认 runs/显式开关/协议不兼容受控兼容/网络错误不静默降级/超时如实可重试） |
| `node tools/test-agent-sdk.js` | PASS 15/15（C9 增补 RUN_CREATE_FAILED 契约破坏） |
| `npm run test:agent-regression` | **PASS 183/183**（首轮在 test-agent-persistence-migrations 环境性失败，单测复跑通过；完整复跑 183/183） |
| 既有页面/卡片/记忆/动作总线测试 | runtime-ui、agent-ui-v2、final-ui、ai-message-retry-replace、ai-card-default-actions、ai-no-object-object-render 等全部 PASS（agent-45 执行 + regression 覆盖） |

DevTools smoke：见 §4。

## 4. DevTools / 真机 / 体验版口径

- CLI 探测：`D:\微信web开发者工具\cli.bat` 存在，`islogin` 返回 `{"login":true}`，`cli auto --project <repo> --auto-port 9420` 可建立自动化会话。
- smoke 结果：**PASS 13/13（DevTools verified: YES，真实 IDE 自动化执行）**——项目导入编译通过；reLaunch 首次遇 IDE 编译窗口超时、按脚本重试机制恢复；进入小佛助手（`packageXiaofu/pages/ai-assistant/ai-assistant`）；初始渲染消息区在场且无伪造发送状态；真实创建 Run（打真实生产 API，public 确定性链，零外部 Provider 成本）：`sending=true` + `liveRunVisible=true`，终态返回真实回答（确定性问候意图）；用户取消后 `sending=false` 且 `activeRunId` 清理（真实 cancelled/空闲，20s 窗口内复位）；会话重开页面数据在场且无悬挂伪造状态；控制台无未处理错误；无未捕获异常。执行日志 `.tmp/p6b-devtools-smoke-6.log`（脚本 `tools/devtools-smoke.js`，可重复执行）。
- 真机/体验版：按路线归 P8 人工验收，本阶段未验证（如实标注）。

## 5. 实现过程中发现并修复的缺陷

1. **Run 契约破坏未分类（W3 改道暴露）**：SDK createRun 对缺 runId 的应答抛裸 `AGENT_SDK_RUN_ID_MISSING`，离线降级链不识别 → test-ai-personal-sync-import-routing 破裂。修复：SDK 归类 `RUN_CREATE_FAILED`（与旧 agentRunClient 同码）+ aiAssistantService 降级名单增补；test-agent-sdk C9 锁定。
2. **automator.launch 中文路径 spawn 失败**：`miniprogram-automator` 对 `D:\微信web开发者工具\cli.bat` 的启动失败；smoke 脚本回退手工 `cli auto` + WebSocket connect（等价真实会话）。
3. **regression 首轮环境性失败**：test-agent-persistence-migrations 在并发 docker pg 下失败一次，单测复跑通过，完整复跑 183/183（判定：环境抖动，非代码回归）。
4. **automator reLaunch 相对路径拼接**：无前导斜杠的页面路径被 IDE 拼接到当前页路由下（`pages/index/packageXiaofu/...` 报 page not found）；统一使用 `/` 前缀绝对路径。
5. **automator 内部命令 unhandledRejection 致命化**：connect 后库内部初始化命令在 IDE 未就绪窗口超时 reject 且无人 await，Node≥15 默认升级为进程崩溃；smoke 进程级兜底并留痕（主流程每条 promise 均有显式 try/catch，兜底不改变断言语义）。

## 6. 如实边界

- 流式（SSE）传输仍未实装：微信侧以 cursor polling 为权威；SDK 注入式 transport 接缝保留。
- direct chat 兼容通道保留（deprecated），退役门槛未达成前不删除；旧 modelPlanner 同门槛。
- 页面绞杀式迁移仅提取传输/恢复/消息构建/Block 增强；4715 行页面的进一步拆分不以行数为验收标准，核心交互回归由既有测试矩阵保证。
- 真机与体验版未验证（P8 人工）；DevTools smoke 13/13 通过（§4，真实 IDE 自动化，非单测冒充）。

## 7. 回滚

单提交 revert 可完整回退：shell/adapter/生成器/测试为新增文件；路由与页面改动保持回调契约与导出签名，回退后旧 agentRunClient 路径仍在（未删除）。
