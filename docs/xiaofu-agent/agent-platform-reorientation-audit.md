# 小佛助手平台化重构：方向级诊断

- 基线：`main @ 33ae65fc`（PR #35 "unify Xiaofu model-first task agent chain" 合并后），工作区干净，审计前已 `git fetch / pull` 确认为最新。
- 性质：只读方向级审计。本文不评价单点 bug，只回答"方向对不对"。所有结论附 `文件:行号` 证据；静态审计未运行的验证项在文末单列。
- 审计范围：小程序前端层、服务端 Agent 运行时、Provider 控制面与后台、Agent vs 全校页搜索统一性、文档/测试/技术栈盘点。关键冲突结论（生产链路是否消费 RunEvent）已由主审计员直接读码复核确认。

---

## 结论先行

**当前方向错了一半。** 服务端已经有一套真实的 Agent 运行时（Understanding → Kernel/Planner → ToolRegistry → ResponseComposer → MemoryController，RunEvent/ActionReceipt/Hybrid RAG 均真实存在），继续"打补丁"的对象不应该是这套内核。真正的方向性错误集中在三处：

1. **真相层在传输接缝处断裂**：生产聊天链路绕过了 RunEvent 基础设施，前端被迫在"无事件窗口期"自行合成状态文案——界面假象不是前端偷懒，而是架构把前端置于只能猜的位置。
2. **语义决策权分散在 8+ 处、横跨端云两侧**：服务端 8 个语义决策点 + 客户端一整套离线语义栈 + 4 个并存 follow-up 解析器 + 2 份同名不同义的 GoalContract。同一个 bug 要在 4 个文件里各修一遍（近期 4cae9854/c2075284 即此模式）。
3. **Provider 控制面不是权威**：后台"单选 Provider"会被运行时链优先级旁路，单选与实际第一跳不保证一致；Understanding/Planner/Response 三阶段模型分配是隐式的。

因此：**继续补丁不划算，平台化收敛划算**。但收敛的正确姿势是"收"，不是"重建"——服务端内核、Capability Manifest 单源生成链、MemoryController、teacher-search-contract 生成链、语音合规链路都是已经做对的资产，必须保留并成为新平台的骨架。

---

## 一、哪些"智能体"能力仍停留在界面假象层

### 1.1 核心假象：生产链路不消费 RunEvent（已直接读码复核）

- `miniprogram/services/aiAssistantService.js:1716-1730` `callServerAgent` 无条件传入 `oracleChat: oracleAgentChat`（:1698-1714 直连 `POST /api/ai/agent/chat`）。
- `miniprogram/services/aiTransportRouter.js:253-258` `callOracle` 遇到 `oracleChat` 直接短路；`callOracleViaRuns`（:179-251，创建 run + 轮询真实事件的路径）在生产线无调用方，**事实死代码**。
- 服务端对称：`/api/ai/agent/chat` 路由不接 `onEvent`（`server/src/routes/ai.js:210-221`）；事件只在 `/agent/runs`（:1173-1231）与 `/agent/agui` 接线。

直接后果：

| 假象 | 证据 |
|---|---|
| "实时运行事件"面板在真实请求中恒为空；取消按钮依赖的 `activeRunId/activePollToken` 永远为空，`shouldCancel` 无法生效 | `ai-assistant.js:2832-2836, 2934-2948` |
| "正在理解你的问题"是客户端在零服务端事件时自行 emit 的；提交到响应到达之间胶囊不反映任何服务端真实阶段 | `aiTransportRouter.js:256, 299`；`agentActivityState.js:1-9` |
| `thinking` 仅在 `provider.started` 真实事件后设置（合规），但该事件在当前链路永不到达——trial/dev 下 Provider 真实运行时用户也看不到 Thinking | `agentActivityState.js:87-93` |
| 响应返回即先写 `sendingStatusText:"已完成"`、`statusCapsuleText:"完成 · 结果已核验"`，依赖终态补丁覆盖 | `ai-assistant.js:3056-3058` |
| 折叠运行条只要有 steps（含本地伪造 steps）就显示"已核验" | `ai-assistant.js:1125-1127` |

### 1.2 离线降级链路的伪造形态

- 本地伪造 `runId`（`createClientRunId("offline")`）与 `status:"done"` 步骤列表，包装成 `agent.v2` 协议形态：`aiAssistantService.js:1495-1515, 1577`。
- 本地流水线状态文案（"正在查询课表"/"已生成卡片"/"已核验课表数据"）由 `reportPipelineStatus` 按本地阶段产出：`aiAssistantService.js:958-970` 及 1822-1890 各调用点。
- 离线缓存课表响应自带 `evidence.verified:true, complete:true`（:1672-1680），绕过证据标签的降级守卫，**离线答案也显示"已核验课表数据"**（:607-608, 712）。
- 提醒创建后客户端本地改写卡片徽标"已创建"、胶囊"完成 · 提醒已创建"，**不回传 ActionReceipt**（receipt 只接了 setCurrentSchedule 一条链路）：`ai-assistant.js:4122-4147, 4238-4245`；receipt 唯一调用点 :3928/3941/3950。
- 演示模式（`?demo=`）整体伪造 toolCalls/steps/evidence：`demo-data.js:1-225`。已标注"演示数据"，低风险。

### 1.3 核验语义本身是浅的

- `skillRegistry.defaultResultVerifier`（`server/src/services/ai/skillRegistry.js:18-48`）只检查：工具在白名单、`success !== false`、事实类意图至少一个证据工具成功。**不校验输出语义后置条件**（不比实体/日期/地点一致性）。
- `planner/goalContract.verifyGoalContract`（:109-255）`acceptEmpty` 允许空结果记为 satisfied，`unknown_accepted` 放行未定义 outcome。
- manifest 里 `tool.outputSchema` 存在（`capabilityRouter.js:323-324` 透出）但**无任何执行后校验消费它**。
- 服务端步骤条"已核验空教室/已查询校园索引"是按工具名模板生成的装饰措辞：`agentService.js:1161-1183`。

### 1.4 后台管理面的假象

- "小佛助手实际使用"横幅只读 `profile.provider` 单选值，不反映链优先级——实际第一跳可能与横幅不符：`adminPages.js:14563-14575`（机制见第三节）。
- Agent 状态卡四项指标（工具调用量/事实类/说明类/安全拦截）**硬编码为 0**：`admin.js:658-661` → `adminPages.js:14095-14098`。
- readiness 的 `network:"reachable"`、`server:"ready"`、`runEventsSupported:true` 是硬编码常量：`agentReadinessService.js:73-74, 82`；`providerReachable` = `configured && !expired && !isCircuitOpen`，**从不真实触达 Provider**（`providerReadinessService.js:136`）。
- `probeProvider()` 是死代码（`providerChainService.js:337-389`，全仓无调用点）；readiness-matrix / diagnose-enhanced 两个真实管理 API 没有任何 UI 消费者（`modules/ai-provider/routes.js:35, 99`）。

### 1.5 已经做真、不属于假象的部分（避免误伤）

- 终态胶囊由响应内 `verification/partial/fallback` 字段推导，来自服务端 `deriveExecutionOutcome`（`agentService.js:544-572`）——真。
- 降级披露链（fallbackBanner、"离线降级/本机缓存"徽标、`status:"degraded"` 强制）——真。
- `thinking` 门控逻辑本身（仅 `provider.started` 触发）——真，只是事件到不了。
- public 模式外部 Provider 零调用——多层真实强制（见 3.4）。
- ActionReceipt 服务端校验链（command/runId/target/过期四重校验）——真（`memoryController.js:383-478`）。

---

## 二、哪些逻辑仍由小程序本地规则主导

在线路径（server-first）本身不猜 intent：`sendMessage` 把原文+上下文交给服务端（`ai-assistant.js:2956-2962`）。但以下本地语义能力仍然活跃：

| # | 本地逻辑 | 位置 | 触发条件 |
|---|---|---|---|
| 1 | 完整离线意图路由器：11 类意图枚举、天气/课表/帮助/导航/闲聊全套正则，自行产出 `confidence/shouldUseXxxTool/cardType` | `xiaofuAgentRouter.js:8-20, 38-163, 176-293` | 传输错误、协议不兼容、或**服务端响应声明 `fallbackAllowed:true`**（`aiAssistantService.js:1979-2005`）——即服务端可主动把在线会话的语义决策权交还给客户端规则 |
| 2 | 客户端课表意图解析器：班级/教师/教室/课程抽取、周次/相对日解析、追问目标继承 | `scheduleIntentParser.js:52-97, 115-180, 203-270` | 被 #1 与离线课表工具共用 |
| 3 | 本地工具执行：离线课表查询（`scheduleAssistantService` 710 行）、离线天气、本地 RAG（`ragRetriever.js` 358 行 + `ragAnswerBuilder.js` 346 行） | `aiAssistantService.js:1842-1894` | 离线路径 |
| 4 | 手写意图→技能映射 `OFFLINE_SKILL_BY_INTENT` + `resolveOfflineCanonicalIntent` | `aiAssistantService.js:1424-1447, 1467-1493` | 离线路径；Manifest 之外的第二份能力映射 |
| 5 | 提醒类消息路由前本地拦截：正则解析提前分钟数，**直接改写本机用户偏好**，并伪造 `toolCalls:[{name:"update_user_preference",status:"success"}]` | `aiAssistantService.js:1745-1811` | 任何含"提醒/通知"关键词的消息——**在线路径也会先被它截走** |
| 6 | 敏感信息守卫客户端直接改写意图并终止请求 | `aiTransportRouter.js:304-306` | 消息含敏感串（合理，但属客户端语义决策） |
| 7 | 本地待澄清状态机（wx Storage 镜像 `contextSlots/pendingClarification`）与服务端 working memory 平行 | `xiaofuContextManager.js:78-100`；`aiAssistantService.js:382-423` | 离线路径真实使用 |
| 8 | 快捷动作用模板句替用户提问（`SUPPLEMENT_PARAMS` 类能力带 `message` 即自动发送，"请补充参数"实际不生效） | `ai-assistant.js:2653-2658` | 快捷动作/任务面板 |
| 9 | 死代码：第三套意图分类器 + 客户端直连混元 Provider | `shared/aiRouteClassifier.js:21-82`；`services/cloudbaseHunyuanService.js:1-399` | 无运行时调用方，纯遗留 |

**判定**：小程序端保留着一套"完整的第二语义系统"（#1-#4 + #7），词表与服务端 Manifest 不同源，靠生成映射桥接。它的合规定位只能是"断网降级"，但 #5 和 `fallbackAllowed` 机制让它在在线会话中仍能夺权。这是"把 Agent 行为寄托在前端"的主要载体。

---

## 三、Provider 控制面 / Goal / Tool / Memory / RAG / RunEvent / ActionReceipt 是否同源

| 域 | 同源？ | 关键证据 |
|---|---|---|
| 能力清单（Intent/Skill/Tool/Action） | ✅ 同源 | 唯一权威 `server/config/agent-capability-manifest.json`（3900 行）；protocol/skill/action 全部由它派生；客户端映射是生成物 + CI 守卫 |
| Tool 执行器 | ✅ 同源执行，❌ 映射三套 | `toolRegistry`（2165 行）唯一执行器；但意图→工具映射有 manifest `intent.allowedTools`、`toolRegistry.buildPlanForIntent`(:1944)、`capabilityRouter` 正则权重(:18-48) 三套 |
| Memory | ✅ 同源 | `MemoryController` 唯一 load/commit 路径（`memory/memoryController.js:25, 148`）；三层记忆真实存在（working state 字段见第六节） |
| RAG | 服务端 ✅；端云 ❌ | 服务端 Hybrid 单入口（`knowledgeRetriever.js:74`）；客户端另有本地 RAG 一套 |
| RunEvent | 模型 ✅；消费 ❌ | 一份事件目录（`runEventCatalog.js:6-35`）；但生产聊天链路不消费（见 1.1），AG-UI 映射有两份（`aguiAdapter.js:8-25` vs `cloudfunctions/xiaofuAgentGateway/index.js:15-25`，需手工同步） |
| ActionReceipt | ✅ 同源 | `actionCommandContract.js` → `deriveActionCommands` → 路由 → `memoryController.commitActionReceipt` 四重校验 |
| Goal/Intent 数据模型 | ❌ **两份同名 GoalContract** | `understanding/goalContract.js:4-13`（goal/entityType/constraints/followUpMode/confidence）vs `planner/goalContract.js:6-50`（OUTCOME_RULES/requiredOutcomes） |
| Provider 控制面 | ❌ **不是权威** | 详见 3.1-3.3 |

### 3.1 权威配置五元组不存在

全仓不存在统一的 `primaryProvider / fallbackProviders / effectiveChain / configVersion / environment` Schema。实际是另一套：`AI_PROVIDER_ENVIRONMENTS` Profile JSON（`providerConfigService.js:11, 118-120`）+ 每请求现算链（`providerChainService.js:76-100`）+ `runtimeVersion = String(Date.now())` 时间戳（无语义版本）。功能自洽，但"权威源"是 Profile 整体 JSON，部分顶层键在 `sanitizeRuntimeConfig` 时会被丢弃（`providerRuntimeConfigStore.js:7-45, 93-102`）。

### 3.2 后台单选 ≠ 实际第一跳（控制面失效，方向性问题）

链路：`adminPages.js:14707-14734` 保存 payload **只含 `provider`，从不含 `providerChain`** → `providerConfigService.js:282` trial 默认链恒为 `hunyuan3,deepseek,coze,mock` → `providerChainService.js:79-84` **chain 优先于单选** → 单选值被旁路。反例：曾启用过混元后单选 deepseek，第一跳仍是 hunyuan3，后台横幅却显示"deepseek"。协议层其实已区分 `desiredProvider` vs `resolvedProvider`（`agentService.js:2336-2338`），但主配置横幅不用它。

### 3.3 Understanding / Planner / Response 模型分配：隐式串链

三阶段共用同一条链，无显式阶段绑定：

- Understanding：`structuredInferenceService.generateStructured`（`understandingService.js:176`），模型键 `AI_UNDERSTANDING_MODEL`（唯一进后台的阶段键）。
- Planner：`plannerModelAdapter.js:172-180` 走同一 structured 链**重来一遍**；`AI_PLANNER_MODEL` 不在任何后台清单里，只能改裸环境变量；`AI_MODEL_PLANNER_ENABLED` 后台不可见。
- Response：`generateWithChain` 非结构化（`agentService.js:2188-2198`），模型键 `AI_MODEL`。

### 3.4 public 零外部调用：多层真实强制（做对了的部分）

模式裁决 fail-closed（`runtimeModeService.js:114-131`）→ public Profile 强制 mock/tool-only（`providerConfigService.js:819-824`）→ 链层 `["mock"]` → structured 层抛 `PUBLIC_PROVIDER_FORBIDDEN` → Planner 抛 `PLANNER_PUBLIC_FORBIDDEN` → manifest `isExternalProviderAllowed` 恒 false。残余缺口：底层 provider 模块自身不查 runtimeMode，依赖调用方约束（纵深防御缺口，非现行漏洞）。

### 3.5 语义决策点全景（8+4 的分散现状）

服务端 8 处语义决策：P1 `toolRegistry.resolveIntent`(:930-1002，内串 6 级启发式)；P2 模型 Understanding（`understandingService.js:113-256` + `goalResolver.js`）；P3 知识库规则覆盖器 `resolveRuleBackedIntent`（`agentService.js:340-362`，可在理解后改写 intent）；P4 工作记忆回填 `enrichIntentFromWorkingMemory`（:1214-1260）；P5 capabilityRouter 正则权重；P6 planner outcome 正则（`planner/goalContract.js:52-93`，可反向把 verification.ok 打 false）；P7 workingMemory 自带周次/星期正则（:261-283）；P8 personalMemoryInterpreter 可在 kernel 前整体接管一轮（`agentService.js:1775-1915`）。**4 个并存 follow-up 解析器**：`planner/followUpResolver.js:182`、`toolRegistry.js:870`（自称 Legacy）、`goalResolver.js:59-65, 132-141`、`enrichIntentFromWorkingMemory`。另有 kernel 内双执行架构（`useToolChain` 旧链 vs Planner/ObservationLoop）与 Planner 双实现（deterministic/model）。策略漂移实例：`planSchema.MAX_REPLAN = 2`（`planSchema.js:33`）实际生效，而 AGENTS.md 与 `plannerPolicy.js:22` 声称 ≤1——文档与代码已互相矛盾。

---

## 四、继续补丁 vs 平台化收敛

**判定：平台化收敛划算，继续补丁不划算。** 依据：

1. **补丁成本已超阈值**：一个"学院+关键词教师搜索"语义要同时改 `releasePackService.js`、`releaseService.js`、`toolRegistry.js`、`school.js` 四个文件（4cae9854）；"可点教师卡"要再改四个（c2075284）。同一语义 N 份实现，每个 bug 修 N 遍。
2. **假象无法靠补丁消除**：1.1 的 RunEvent 断裂是传输层架构选择问题，不改传输链，前端状态文案永远只能靠猜；1.3 的浅核验必须引入 outputSchema/后置条件体系，这是新抽象不是补丁。
3. **控制面失效是模型缺失**：3.2 不是 UI bug，是"单选"与"链"两个概念没有统一进一个权威 Schema；3.3 同理。补丁只能再叠一层横幅修正。
4. **回归面已经失控**：根 package.json 有 70+ agent 相关测试脚本、回归套件自动发现约 115 个测试文件——测试很多，但测的是各平行路径各自的行为，平行路径不收敛，测试数量只会继续膨胀。
5. **服务端内核质量足够支撑收敛**：Understanding/Kernel/ToolRegistry/MemoryController/RunEvent 目录/Manifest 生成链都是真实实现，收敛=拆边界+删平行路径+接断线，不是重写。风险可控。

---

## 五、主要错误是不是"把 Agent 行为表现寄托在前端页面层"

**是，但这只是三分之一。** 更准确的表述是三个互相强化的错误：

1. **表现层错误（症状）**：前端在"无事件窗口期"自行合成运行状态——因为生产传输链不送事件（1.1），前端不猜就是一片空白。把前端改成"只消费服务端真实状态"必须先把事件送达，两件事是同一次改造。
2. **语义层错误（根因）**：语义决策权端云两侧多点并存（第二节 + 3.5）。前端的"猜"不只发生在状态文案上，还发生在 intent/tool 决策上（离线栈 + `fallbackAllowed` + 提醒拦截）。前端假象是语义权分散的最表层投影。
3. **控制面错误（放大器）**：Provider 选择、阶段模型分配、readiness 指标都不权威（3.1-3.4、1.4），导致"后台显示一套、运行跑另一套"，连运维入口都在强化假象。

所以本轮重构的正确顺序是：先修语义主权（统一 GoalContract + 单一 Understanding 决策点），再修真相传输（RunEvent 接入生产链），再修控制面（权威 Provider 配置），最后前端自然退化为纯展示壳。只改前端是治标。

---

## 六、必须删除或收敛的平行语义路径

### 6.1 直接删除（死代码，无运行时调用方）

| 目标 | 证据 |
|---|---|
| `miniprogram/shared/aiRouteClassifier.js` | 全仓无 require（98 行第三套意图分类器） |
| `miniprogram/services/cloudbaseHunyuanService.js` | 仅 `tools/test-cloudbase-ai-router.js:9` 引用（399 行客户端直连混元） |
| `ai-assistant.js:262-270` `PROVIDER_LABELS` 死代码 + :1388-1389 未渲染的默认 providerLabel | 潜伏假象 |
| `providerChainService.js:337-389` `probeProvider` 死代码 | 改造为真实 probe 或删除（本方案选择改造，见重构方案） |
| docs/xiaofu-agent 下 6 篇旧基线审计快照（`capability-truth-matrix.md`、`final-product-convergence-audit.md`、`goal-action-runtime-audit.md`、`core-experience-root-cause.md`、`memory-autonomy-audit.md`、`product-experience-audit.md` + `product-experience/`） | 已被 unified-model-first 两篇吸收，README 已声明替代但未删除（**已于 M7 收口经用户二次授权执行删除**，Git 历史可恢复） |

### 6.2 收敛为单一路径（保留能力，消灭平行）

| 平行路径 | 收敛方向 |
|---|---|
| 两份 GoalContract（`understanding/` vs `planner/`） | 合并为统一 **GoalContract V2**（由 Capability Manifest 生成 schema），planner 的 outcome 规则并入 Verification |
| 4 个 follow-up 解析器 | 单一 **FollowUpResolver** 消费 GoalContract V2 + Thread Working State |
| `resolveRuleBackedIntent`/`matchLocalRule` 覆盖层 + capabilityRouter 正则权重 + toolRegistry 多级启发式 | 规则只保留为 Understanding 的 deterministic fallback 与 public 政策层，权重/提示从 Manifest 派生，不再手工维护第二份语义表 |
| kernel 内 `useToolChain` 旧链 + Planner 双实现 + kernel 硬编码业务恢复逻辑（`agentKernel.js:168-179`） | 单一 PlannerCoordinator 路径；业务恢复逻辑下放到 Skill 定义 |
| 客户端离线语义栈（`xiaofuAgentRouter` + `scheduleIntentParser` + 本地 RAG + 本地工具 + `OFFLINE_SKILL_BY_INTENT`） | 压缩为**纯降级缓存应答**：不再伪造 `agent.v2`/runId/steps/verified 标签，不再做 intent→tool 决策，统一标注 degraded；`fallbackAllowed` 机制限定为"服务端明确声明且仅返回安全只读结果" |
| 提醒消息客户端拦截（`aiAssistantService.js:1745-1811`） | 提醒语义收回服务端 GoalContract（`requestedEffect: write`），客户端只执行确认动作并回传 ActionReceipt |
| 两份 AG-UI EVENT_MAP（`aguiAdapter.js` vs `xiaofuAgentGateway/index.js`） | 单源生成（从 runEventCatalog 派生），网关消费生成物 |
| `miniprogram/utils/classroomSearch.js` ≡ `server/src/services/ai/classroomSearch.js`（173 行逐字节复制） | 改为单源生成共享（与 teacher-search-contract 同模式） |
| 教师/班级/教室/课程搜索的过滤实现×2、精确命中×3、schedule-view URL 构建×4、唯一/多候选决策×3 | 统一 **Search Contract Service**（服务端唯一实现，全校页走 HTTP、Agent 进程内调用同一服务）；URL 构建统一收进 `scheduleNavigationService` 并由服务端复用其契约 |
| 工具/卡片中文标签双份维护（`ai-assistant.js:278-341` vs `xiaofu-agent-run/index.js:1-22`） | 从 Manifest 生成 |
| 客户端 `contextSlots/pendingClarification` 镜像 vs 服务端 working memory | 客户端镜像只作离线缓存展示，不再参与在线语义 |
| 第三入口 `xiaofuAgentGateway`（默认注入 `X-Fosu-Env-Version: trial` 且可无 session 转发） | 保留为兼容层但收紧：与主入口同一鉴权/环境裁决，禁止无 session 提权到 trial |

### 6.3 保留并作为新平台骨架（已做对的资产）

- 服务端 Agent Kernel + Planner/ObservationLoop + ToolRegistry 执行器
- Capability Manifest 单源生成链（含 CI 守卫、teacher-search-contract 同模式）
- MemoryController 三层记忆（working state 字段已接近目标态，缺 `pendingClarification` 等与 GoalContract V2 对齐）
- RunEvent 目录与轮询存储、AG-UI 适配思想
- ActionReceipt 四重校验链
- public 零外部调用多层强制
- 语音链路合规实现（隐私授权→录音→云函数转写→填框不自动发送）
- Coze 凭据合规（Bearer PAT、HMAC 派生 user_id、到期跳过）

---

## 七、对重构方案（第二~十二节）的方向确认

审计结论支持任务书提出的总体方向，按优先级排序的落点：

1. **传输真相优先**：生产链切换 `callOracleViaRuns` 为唯一在线传输（或等效 SSE/轮询），删除 `oracleChat` 短路；UI 状态机十态（understanding/planning/tool_running/verifying/waiting_confirmation/waiting_receipt/completed/degraded/failed/cancelled）全部由服务端事件驱动。这是消除一切界面假象的前提。
2. **GoalContract V2 单源**：合并两份 GoalContract，schema 由 Manifest 生成，含 goalId/candidateGoals/entities(多 role)/constraints/followUpMode/missingSlots/ambiguity/requestedEffect/confidence/provenance，禁含 toolName/url/route；V1→V2 适配器保留。
3. **agentService 拆 12 模块边界**：2619 行 God Service 按 ProviderOrchestrator/ContextAssembler/UnderstandingCoordinator/GoalContractResolver/SkillRouter/PlannerCoordinator/ToolExecutor/VerificationCoordinator/ResponseComposer/RunEventPublisher/MemoryCoordinator/ActionReceiptCoordinator 拆分——现有 25 个 require 协作者已天然是这些边界的雏形。
4. **Provider 权威控制面**：落地 `primaryProvider/fallbackProviders/effectiveChain/configVersion/environment` 五元组；保存时显式固化链顺序；Understanding/Planner/Response 阶段绑定显式化进后台；probe 接真实探测（改造现有死代码）；后台横幅改用 `resolvedProvider`。
5. **Verification 语义化**：为 Tool 补 outputSchema/successPostconditions/partialCompletionPolicy/emptyResultPolicy/evidencePolicy，"下一节课+出发时间"类链式任务做实体-时间-地点交叉核验。
6. **搜索统一**：Search Contract Service 服务端唯一实现，Agent 与全校页同源；四类结果唯一直开/多候选/detailId 兜底统一；`scheduleNavigationService` 契约服务端复用。
7. **Durable 执行**：提醒/审批/等待回执建模为 step-like 持久任务 + wait-for-event + resume；同步对话链保持轻量，不迁重型工作流。
8. **技术选型**（结合 3.6 盘点：当前仓库零 Agent 框架依赖，全自研）：OpenAI Agents SDK/Mastra/LangGraph 不直接引入（与现有轻量内核冲突、ARM VPS 部署成本高、AGENTS.md 明确禁止 LangChain/LangGraph 类替换）；Inngest 借鉴原语不引服务；MCP 保留现有手写 stdio 只读控制面模式并按需评估官方 SDK；AG-UI 对齐事件协议思想（现有自研适配器方向正确，收敛为单源生成）。详细对比随实施报告给出。

## 八、本次审计未验证项

- 未运行任何测试套件（`test:agent-*`）；所有行为结论基于静态代码路径。
- "单选被链旁路"未做运行时复现（依据 `providerChainService.js:79-84` 优先级 + `providerConfigService.js:282` 默认链静态推断）。
- `server/storage/` 现役运行时配置内容未检查（敏感文件范畴）。
- 离线 fallback 各触发条件的实际触发率未统计。
