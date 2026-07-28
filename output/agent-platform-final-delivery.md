# 小佛助手 Agent 平台化迁移：最终交付报告

- 分支：`refactor/xiaofu-agent-platform-v2`（基线 `main @ 33ae65fc`，未合并、未推送、未部署）
- 任务书：`docs/xiaofu-agent/agent-platform-migration-plan.md`（M0–M7）
- 方向级审计：`docs/xiaofu-agent/agent-platform-reorientation-audit.md`
- 交接文档：`docs/xiaofu-agent/agent-platform-implementation-handoff.md`
- 里程碑提交：M0 `064de232` / M1 `c6c2b301` / M2 `cdf1b276` / M3 `64a00347` / M4 `52e93424` / M5 `e7f31eaf` / M6 `356014df` / M7 本次提交
- 报告时间：2026-07-28（+08:00）

## 验证分级声明（先读）

| 级别 | 状态 |
|---|---|
| 已写代码 | M1–M6 全部落地，M7 文档收口 |
| mock/桩已验证（本地实际运行） | 全部：`test:agent-release-gate` 14 步全绿（首跑 2026-07-28 21:33 +08:00，durationMs=400330），含 foundation 33/33、regression 126/126、final-convergence、phase3、ai-competition、final-suite、core-experience、memory-autonomy、task-gates、package-hygiene、server-ai-module-require、server-docker-smoke、release:preflight、security:acceptance |
| staging live（真实凭据+真实网络） | **未做**：无真实 Provider 凭据环境，三 Provider live test 阻塞（见 §12） |
| 真机验证 | **未做** |
| 体验版 | **未上传** |
| 生产 | **未发布** |

本报告所有"通过/全绿"均指上表第二级（本地实跑），不涉及第三级及以上。

## 1. 当前方向是否错了：最终结论

**错了一半。** 服务端 Agent 内核（Understanding → Kernel/Planner → ToolRegistry → ResponseComposer → MemoryController，RunEvent/ActionReceipt/Hybrid RAG）是真实资产，不是假象。方向性错误集中在三处（审计 §结论先行，已逐条治理）：

1. **真相层在传输接缝断裂**：生产聊天链曾绕过 RunEvent，前端在无事件窗口期自行合成状态文案 → M5 已接 runs 传输 + 事件映射单源生成 + 客户端五处伪造点清除。
2. **语义决策权分散（服务端 8 处 + 客户端离线栈 + 4 个 follow-up 解析器 + 2 份 GoalContract）** → M2/M4/M6 收敛：单一 FollowUpResolver、GoalContract V2 单源、kernel 单一 PlannerCoordinator 路径、意图→工具映射 manifest 单源。
3. **Provider 控制面不权威**：后台单选曾被运行时链旁路 → M1 五元组权威配置 + 单选=链首 + 三阶段显式链，11 组专项测试锁定。

**"把 Agent 行为表现寄托在前端页面层"是主要错误的三分之一**（症状）；根因是语义主权分散，放大器是控制面失效。治理顺序（先语义主权、再真相传输、再控制面、前端退化为展示壳）已被 M1–M6 执行验证。**平台化收敛划算、继续补丁不划算**的判定成立：同一语义多处实现的修复模式（4cae9854/c2075284 各改 4 文件）在 M3/M4/M6 后结构性消除。

## 2. 为什么新方案更适合微信小程序 + VPS + CloudBase

- **小程序端**：只承担展示/卡片/客户端动作/权限状态机/Receipt 回传五职，事件协议对齐 AG-UI 思想且由 runEventCatalog 单源生成——包体内不再维护第二份语义栈，审核面（隐私/权限）边界清晰；语音链路合规形态（授权→录音→云函数转写→填框不自动发送）保持不变。
- **VPS 服务端**：Agent Runtime 可独立运行、独立测试（本报告全部验证均不依赖小程序端），durable 层以 JSON 文件存储起步、无重型中间件，适配 ARM VPS 资源约束。
- **CloudBase**：继续做它擅长的——小程序 SDK、云函数（语音转写等）、托管与权限承接；不引入第二套 Agent/Memory/Tool 体系。
- **零新增框架依赖**：全链路自研轻量实现，部署形态与 main 一致（docker smoke 在 gate 中实跑通过）。

## 3. 总体架构图

```
┌────────────────────────────────────────────────────────────────┐
│ 微信小程序（AG-UI 风格高定制前端壳）                            │
│ 消息展示 │ 卡片渲染 │ 客户端动作 │ 权限状态机 │ Receipt 回传    │
│ 事件映射单源生成(runEventCatalog→agui map, --check 守卫)        │
│ 十态只消费服务端事件：understanding/planning/tool_running/      │
│ verifying/waiting_confirmation/waiting_receipt/completed/      │
│ degraded/failed/cancelled                                      │
└───────────────┬────────────────────────────────────────────────┘
                │ runs 传输 + RunEvent 轮询（回滚开关
                │ AI_AGENT_RUNS_TRANSPORT_ENABLED=false→legacy 链）
┌───────────────▼────────────────────────────────────────────────┐
│ VPS 服务端 Agent Runtime（runtime/ 13 文件协调层）              │
│ requestContextAssembler → understandingCoordinator →           │
│ goalContractResolver(GoalContract V2) → plannerCoordinator →   │
│ skillRouter / toolExecutor（五因子交集选工具）→                │
│ verificationCoordinator(toolResultVerifier/departureChain) →   │
│ providerOrchestrator → responseComposerBridge →                │
│ memoryCoordinator                                              │
│ 横向：runEventPublisher │ actionReceiptCoordinator             │
├────────────────────────────────────────────────────────────────┤
│ 控制面（单源）                                                 │
│ Capability Manifest → GoalContract V2 schema / 意图→工具映射 / │
│ verification 策略 / 搜索契约 / 卡片标签（各带 --check 守卫）   │
│ Provider 五元组：primaryProvider/fallbackProviders/            │
│ effectiveChain/configVersion/environment + 三阶段显式链 + probe│
│ Durable 层：durable/(taskStore/waitForEvent/resume)，哈希 token│
├────────────────────────────────────────────────────────────────┤
│ CloudBase：小程序 SDK │ 云函数（语音转写等）│ 托管 │ 权限承接  │
└────────────────────────────────────────────────────────────────┘
```

## 4. 保留 / 重写 / 删除清单

**保留为平台骨架（审计 §6.3，未推翻）**：Agent Kernel + Planner/ObservationLoop + ToolRegistry；Capability Manifest 单源生成链；MemoryController 三层记忆；RunEvent 目录与轮询存储；ActionReceipt 四重校验链；public 零外部调用多层强制；语音合规链路；Coze 凭据合规（Bearer PAT、HMAC 派生 user_id、到期跳过）；Release Pack 版本校验/静态回退/last-known-good（全程未动）。

**重写/收敛（已执行）**：
- agentService 2642→733 行薄编排，拆出 `runtime/` 12 模块边界（M-前置阶段，本分支验收）
- 两份 GoalContract → GoalContract V2 单源（V1→V2 适配器保留）
- 4 个 follow-up 解析器 → 单一 FollowUpResolver（M4，grep 唯一性证据）
- kernel `useToolChain` 旧链（实证零调用方死代码）→ 单一 PlannerCoordinator；业务恢复逻辑下放 `skillRegistry.SKILL_RECOVERY_RULES`（M6）
- 意图→工具手工映射（toolRegistry 启发式 + capabilityRouter 正则权重）→ manifest 五因子交集单源（M6）
- 搜索过滤×2 / 精确命中×3 / URL 构建×4 / 唯一多候选决策×3 → 服务端 Search Contract 单实现，Agent 与全校页同源（M3）
- 两份 AG-UI EVENT_MAP → runEventCatalog 单源生成（M5）
- 工具/卡片标签双表 → manifest displayName/cardTypeLabels 单源（M5）
- 客户端离线语义栈伪造形态（合成 `agent.v2`/runId/steps/verified）→ 五处伪造点清除，统一 degraded 真实标识（M5）
- `xiaofuAgentGateway` 无 session 提权到 trial → 收紧同鉴权（M5）

**删除（已执行）**：`miniprogram/shared/aiRouteClassifier.js`、`miniprogram/services/cloudbaseHunyuanService.js`、ai-assistant PROVIDER_LABELS 死代码、kernel `executeToolChain` 及分派块、capabilityRouter `INTENT_HINT_WEIGHTS` 及手工工具表、toolRegistry legacy 特判。

**删除（待用户二次授权，未执行）**：docs/xiaofu-agent 下 6 篇旧审计快照 + `product-experience/` 目录（审计 §6.1，清单与理由将单独提交用户批准）。

## 5. Provider 控制面最终行为证明

- 唯一权威配置五元组：`getAuthoritativeProviderConfig(env)` → admin status API 与后台 UI 同源（M1 测试 G1–G3）
- **后台单选 = 实际第一跳**：保存即 `recomputeChainForPrimary` 重算 effectiveChain，链首恒为单选（G4–G6）
- Understanding / Planner / Response 三阶段链显式配置，`resolveStageChain` 三调用点（understandingService / plannerModelAdapter / structuredInferenceService），无隐式串链（G7–G8）
- probe：`POST /api/admin/ai-provider/probe` 真实探测端点（桩环境验证请求构造与错误分类；真实网络属 staging live 阻塞项）；readiness `configuredAvailable` 与 `verified` 分离，"已配置未验证"不得标真实可用（G9–G10）
- **public 模式外部 Provider 调用恒为 0**：多层强制，控制面测试锁定（G11）
- Shadow Eval 存在且结果不参与用户回复与记忆（既有 `test-provider-shadow-eval` 在 gate 链路中通过）
- 证据：`tools/test-provider-control-plane.js` 11/11（M1），接入 foundation 套件；release-gate 首跑 foundation 33/33 通过

## 6. GoalContract V2 说明

- schema 由 Capability Manifest 单源生成（`tools/generate-goal-contract-v2.js`，`goalContractV2.generated.js`，--check 守卫入 foundation），不手工维护字段白名单
- 字段：goalId / candidateGoals / entities（多 role）/ constraints / followUpMode / missingSlots / ambiguity / requestedEffect(read/write/navigate/conversation) / confidence / provenance
- **不含** toolName / url / route / db command；Understanding 只输出 GoalContract，不直接选 Tool（选工具在 planner/toolExecutor 经五因子交集）
- V1→V2 适配器保留（`fromV1Contract`），内部运行统一 V2，working memory 存 V2 形态（`normalizeStoredGoalContract`：V1 升级、垃圾丢弃）
- 覆盖面：课表查询 / 设为当前课表 / 下一节课+出发 / 天气校区日期 / 空教室连续节数 / 教师班级教室课程追问 / 提醒增删改 / 页面导航 / 用户偏好 / 公开知识问答（manifest goalIds 生成物可枚举）
- 证据：`tools/test-goal-contract-v2.js` 全绿（M-前置），foundation 套件内含

## 7. MCP / Skill / Tool / Memory / RAG / RunEvent / ActionReceipt 分层

- **Skill（业务能力层）**：`skillRegistry` 声明式定义，含 `SKILL_RECOVERY_RULES`（恢复逻辑业务侧挂，kernel 只保留通用机制）
- **Tool（执行层）**：`toolRegistry` manifest 单源；规划候选 = Intent ∩ Skill ∩ Runtime ∩ Principal ∩ Environment 纯交集，禁止并集放宽（M6，13 组测试含并集放大反例锁定）
- **MCP（外部工具/上下文层）**：`tools/fosu-kb-mcp` 只走受保护后台 API 的只读模式，未注册 publish/rollback；未新增远程可写 MCP
- **Memory**：三层（Turn Context / Thread Working State / 显式长期记忆）；working state 八字段（activeGoal/pendingClarification/lastGoalContract/lastResolvedEntity/lastConstraints/pendingAction/providerUsed/understandingSource）M4 对齐，pendingClarification 5 键统一形态三方一致；长期记忆仅存显式确认或低风险稳定偏好
- **RAG**：Hybrid RAG 仅覆盖公开知识，禁止向量化课表事实，Embedding 不可用自动 Lexical 退化（既有约束未变）
- **RunEvent**：服务端唯一真相源，catalog 单源生成客户端事件映射；verification.started/completed 入目录（M2）；客户端十态全部事件驱动（M5）
- **ActionReceipt**：四重校验链不变（M5 提醒全链闭环 21 项测试）；durable `receipt_wait` 任务接线提醒回执（M6，token 只存哈希，跨进程 resume 实证）

## 8. 开源框架采用建议

| 框架 | 结论 | 理由 |
|---|---|---|
| OpenAI Agents SDK | **不采用** | 与现有轻量内核范式冲突；引入即第二套运行时；ARM VPS 依赖成本高 |
| LangGraph / LangChain | **不采用** | AGENTS.md 明确禁止替换轻量业务内核；状态图抽象对当前同步对话链过重 |
| Mastra | **不采用** | 同上；其记忆/工具抽象与 MemoryController/ToolRegistry 重复 |
| Inngest | **借鉴原语，不引服务** | step-like 持久任务 / wait-for-event / resume 三原语已自研落地 `durable/`（JSON 文件存储，无外部服务依赖，适配 ARM VPS）；同步对话链保持轻量未迁工作流 |
| MCP | **保持现状按需评估** | 现有 fosu-kb-mcp 手写 stdio 只读控制面满足需求；官方 SDK 引入留待出现第二个 MCP server 时再审 |
| CloudBase AG-UI / agent-ui-miniprogram | **借鉴协议思想，不直接接入** | 事件协议思想已对齐并收敛为单源生成；直接接入会引入与 runEventCatalog 重复的第二事件源 |

二创性与维护：零新增运行时依赖，全部边界在仓内可审可改；生成器 + --check 守卫模式使"单源改动 → 全链一致"可机械化验证。

## 9. 分阶段迁移路线图（实际执行）

M0 基线认证（五门禁全绿记录 + 失败四类分类规则）→ M1 Provider 控制面专项认证（11 组测试，无真实缺陷，T3 跳过）→ M2 Verification 运行时化（toolResultVerifier + departureChainVerifier + 核验事件）→ M3 搜索契约统一（服务端单实现 + 四类结果决策统一 + 客户端切换）→ M4 FollowUpResolver 收敛（唯一 V2 实现 + 旧三处退役）→ M5 AG-UI 事件层（事件映射单源 + 客户端去伪造 + 提醒 Receipt 闭环 + 标签单源）→ M6 单源工具规划 + Durable 层（五因子交集 + kernel 单链 + durable 三文件）→ M7 终验交付（release-gate 首跑 + 本文档体系 + 敏感终扫）。每里程碑独立 commit，验收证据在 `output/agent-platform-m{0..6}-*.md`。

## 10. 风险、成本、维护复杂度

**维护复杂度净降**（审计 §4 判定已兑现）：语义决策点 8+4 → 单一 Understanding + FollowUpResolver；搜索相关实现 2/3/4/3 份 → 1；GoalContract 2 份 → 1；EVENT_MAP 2 份 → 1 生成；标签 2 表 → 1 源；agentService 2642 → 733 行。同一语义修 N 遍的模式结构性消除。

**新增复杂度（如实记录）**：`runtime/` 13 文件协调层与 `durable/` 3 文件需要维护；生成器守卫链（goal-contract-v2 / school-search-contract / agui 事件映射 / capability-compat）成为关键路径，改 manifest 必须过 --check。

**残留风险**：见 §12 阻塞项与遗留清单；最大残余风险是三 Provider 真实链路未经 staging live 验证——控制面语义（单选=链首、阶段链、public 零调用）已被桩测试锁定，但真实凭据下的首跳延迟/错误分类/熔断行为未实测。

## 11. 测试矩阵

**release-gate 首跑（2026-07-28 21:33 +08:00，14/14 OK，durationMs=400330）**：

| 步骤 | 结果 |
|---|---|
| test:xiaofu-final-suite / test:xiaofu-core-experience / test:agent-memory-autonomy | OK |
| test:agent-foundation（33/33）/ test:agent-regression（126/126） | OK |
| test:agent-final-convergence / test:agent-task-gates / test:agent-phase3 | OK |
| test:ai-competition / test:miniprogram-package-hygiene | OK |
| test:server-ai-module-require / test:server-docker-smoke | OK |
| release:preflight / security:acceptance | OK |

**本分支新增专项测试（全部本地实跑通过，均接入套件自动发现）**：

| 里程碑 | 测试 | 组数 |
|---|---|---|
| M1 | test-provider-control-plane | 11 |
| M2 | test-agent-verification + test-agent-departure-chain-verification | 6+9 |
| M3 | test-search-contract-unified | 15 |
| M4 | followUpResolver 专项 | 11 |
| M5 | ActionReceipt 闭环 21 + AG-UI 契约 7 | 28 |
| M6 | test-agent-tool-plan-manifest 13 + test-agent-durable-execution 18 | 31 |

补充门禁：test:agent-phase2 11/11（M6 收尾实跑）；test:xiaofu-core-experience 72/72（M6 实跑）。

**失败分类**：release-gate 首跑零失败，无需 A/B/C/D 分类。M3 记录的 11 个 school/cache 链 standalone 测试（test-school-cache-schema 等）为 main 基线已有红、不在 gate 14 步之内、与本分支改动无交集（M3 已用 main @33ae65fc 对照取证），维持既有结论。

## 12. 阻塞项与遗留

**阻塞项**：
1. 三 Provider（混元3 / DeepSeek / Coze）staging live test：**未做，需真实凭据 + 真实网络环境**；mock contract 层已验证，live 层标注阻塞，不得以 mock 冒充生产验证
2. 真机验证：未做（需微信开发者工具/真机环境人工执行）
3. 体验版：未上传（按纪律不自动上传）
4. 11 个 school/cache 链 standalone 测试基线红：main 已有，非本分支引入，修复不在本任务范围

**遗留（全部记录，未静默）**：①`get_course_route` manifest `emptyResultPolicy.codes` 缺口（M2 冻结待 manifest 负责方裁定）；②`parseDateOffset` "大后天"分支顺序、legacy 空教室 inherited/replaced 双列（M4 锁定【疑似缺陷】未修）；③`request.js` GET dedupe 竞态（搜索链已 `dedupe:false` 规避，其余页面链未动）；④responseComposer TOOL_PUBLIC_LABELS 第三份手工进度文案表未收口；⑤xiaofu-reminder-sheet 删除提醒未接 receipt（端点与派生已就绪）；⑥durable 无定期 sweep（惰性过期正确性已保证）；⑦跨 run 旧卡边界（M5 记录）。

## 13. 回滚方法

- **整分支**：未合并未推送，删除分支即整体回滚；main 全程未动
- **逐里程碑**：按 M6→M0 逆序 `git revert 356014df e7f31eaf 52e93424 64a00347 cdf1b276 c6c2b301 064de232` 可回到基线
- **运行时开关**：`AI_AGENT_RUNS_TRANSPORT_ENABLED=false`（`miniprogram/config/cloudbase.js`）回退 legacy 轮询链，`tools/test-cloudbase-ai-router.js` 覆盖该回滚路径
- **Release Pack**：版本校验/静态回退/last-known-good 全程未改动，网络或新数据失败仍保留上一份可用数据

## 14. PR 链接

**无 PR。** 按任务纪律全程未 push：分支 `refactor/xiaofu-agent-platform-v2` 仅存在于本地仓库。如需评审，推送后创建 PR 即可；是否推送由用户决定。
