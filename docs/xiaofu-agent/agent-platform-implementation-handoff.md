# 小佛助手 Agent 平台化迁移：实施交接文档

> 本文是**安全收口检查点**的交接记录，不是完成报告。所有"已完成"均附验证证据；未验证项明确标注。禁止把本文未标验证的内容当作已完成。

## 1. 分支与基线

- 基线：`main @ 33ae65fc`（"feat: unify Xiaofu model-first task agent chain (#35)"），工作区干净起步
- 当前分支：`refactor/xiaofu-agent-platform-v2`（基于含全部改动的工作区创建，未合并 main、未推送）
- 检查点提交：本分支 HEAD（`chore(xiaofu): checkpoint agent platform migration phases 1-6`，hash 以 `git log --oneline -1` 为准）

## 2. 全部变更文件（36 个路径）

**Modified（27）**：
| 文件 | 归属阶段 | 改动内容 |
|---|---|---|
| `miniprogram/config/cloudbase.js` | 1 | `AI_AGENT_RUNS_TRANSPORT_ENABLED` 回滚开关（默认 true=runs 传输） |
| `miniprogram/services/aiAssistantService.js` | 1 | `callServerAgent` 移除客户端合成状态文案 |
| `miniprogram/services/aiTransportRouter.js` | 1 | 生产链切 runs+RunEvent 轮询；`oracleChat` 仅在开关关闭时生效；提交文案改中性"正在建立校园任务" |
| `package.json` | 1+2 | 4 个新脚本（generate/check/test goal-contract-v2、test:xiaofu-runs-transport） |
| `server/config/agent-capability-manifest.json` | 5 | 16 个事实工具的 verification 策略字段（outputSchema/successPostconditions/emptyResultPolicy 等） |
| `server/src/modules/ai-provider/routes.js` | 4 | `POST /ai-provider/probe` 真实探测端点；diagnose 接 probe |
| `server/src/routes/admin.js` | 4 | status API 输出 `authoritative` 五元组 |
| `server/src/routes/adminPages.js` | 4 | 阶段分配下拉、readiness-matrix 表（含"已配置未验证"徽标）、立即探测按钮 |
| `server/src/routes/ai.js` | 4 | readiness 错误分支补 `configuredAvailable/providerVerified:false`（不再常量化） |
| `server/src/services/ai/agentReadinessService.js` | 4 | readiness verified 语义 |
| `server/src/services/ai/agentService.js` | 2+3 | 2642→733 行薄编排；goalContractV2 转换接入 |
| `server/src/services/ai/capabilityManifestService.js` | 5 | manifest verification 策略字段加载校验 |
| `server/src/services/ai/memory/workingMemory.js` | 2 | `normalizeStoredGoalContract`（V2 存储 + V1 升级 + 垃圾丢弃） |
| `server/src/services/ai/planner/plannerModelAdapter.js` | 4 | Planner 阶段链显式化 |
| `server/src/services/ai/providerChainService.js` | 4 | `resolveStageChain`、`probeProvider` 复活、`isProviderVerified` |
| `server/src/services/ai/providerConfigService.js` | 4 | 五元组 `getAuthoritativeProviderConfig`、阶段字段、`recomputeChainForPrimary`（单选=链首） |
| `server/src/services/ai/providerReadinessService.js` | 4 | `configuredAvailable`/`verified` 分离 |
| `server/src/services/ai/providerRuntimeConfigStore.js` | 4 | 阶段字段持久化白名单 |
| `server/src/services/ai/structuredInferenceService.js` | 4 | structured 调用走阶段链 |
| `server/src/services/ai/understanding/goalContract.js` | 2 | V1 标注兼容层 |
| `server/src/services/ai/understanding/understandingService.js` | 4 | Understanding 阶段链显式化 |
| `tools/run-agent-foundation-tests.js` | 2 | 加入 goal-contract-v2 测试 |
| `tools/test-agent-model-first-understanding.js` | 2 | 断言更新为 V2 升级结果 |
| `tools/test-cloudbase-ai-router.js` | 1 | 显式置 runs 开关=false（测 legacy 回滚路径） |
| `tools/test-planner-model-adapter.js` | 3 | 静态断言跟随 runtime/plannerCoordinator.js 新边界（强度未减） |
| `tools/test-xiaofu-memory-integration.js` | 1 | 文案断言跟随中性提交文案 |

**Untracked（9）**：`docs/xiaofu-agent/agent-platform-reorientation-audit.md`（审计）、`output/phase5-verification-progress.md`（阶段5 coder 进度）、`server/config/school-search-contract.json`（阶段6契约设计稿）、`server/src/services/ai/runtime/`（阶段3：13 文件）、`server/src/services/ai/understanding/goalContractV2{,.generated}.js`（阶段2）、`server/src/services/ai/verification/verificationPolicy.js`（阶段5）、`tools/generate-goal-contract-v2.js`、`tools/test-goal-contract-v2.js`（阶段2）、`tools/test-xiaofu-runs-transport.js`（阶段1）

## 3. 阶段状态

| 阶段 | 状态 | 验证证据 |
|---|---|---|
| 0 方向级审计 | ✅ 完成 | 文档已交付 |
| 1 传输真相（RunEvent 接入生产链） | ✅ 完成 | 全量回归 120/120、foundation 31/31（当时运行）；收口时定向复测 PASS |
| 2 GoalContract V2 | ✅ 完成 | foundation 31/31 含新测试；收口复测 `test-goal-contract-v2` PASS |
| 3 agentService 拆 12 模块 | ✅ 完成（附保留项） | phase3 套件全绿、final-convergence 全绿；**ai-competition 与全量 regression 在阶段 3 后未重跑** |
| 4 Provider 权威控制面 | 🟡 代码基本落地、**缺专项测试与全量验证** | 五元组/单选=链首/阶段链/probe/verified/后台 UI 均在代码中；收口定向测试（readiness、runtime-matrix、policy、shadow-eval、admin 四项）全 PASS；`tools/test-provider-control-plane.js` **未创建**（coder 超时） |
| 5 Verification 语义化 | 🟡 部分完成 | 已落盘：`verification/verificationPolicy.js`、manifest 16 工具策略、加载校验（load smoke 过）；**未落盘**：`toolResultVerifier.js`、verificationCoordinator 接线、verification RunEvent、出发链核验、全部专项测试 |
| 6 搜索统一 Search Contract | 🔴 仅契约设计稿 | 仅 `school-search-contract.json`（school-search.v1：entityTypes/requestFields/responseFields/decision/navigation/migrationNote）；生成器、服务端统一实现、客户端去重、测试全部未做 |
| 7-12 | ⬜ 未开始 | — |

## 4. 新增模块用途与调用关系

**`server/src/services/ai/runtime/`（阶段 3，13 文件）**：agentService.chat 的协调层。`chat()` → `requestContextAssembler`（请求准备）→ `understandingCoordinator`（理解+规则兜底）→ `goalContractResolver`（V2 转换+槽位回填）→ `plannerCoordinator`（modelGenerate 注入+kernel）→ `toolExecutor`/`skillRouter` → `verificationCoordinator` → `providerOrchestrator`（Provider 链+降级）→ `responseComposerBridge`（响应组装）→ `memoryCoordinator`（记忆提交）；`runEventPublisher`/`actionReceiptCoordinator`/`shared` 横向支撑。对外 API 19 个导出签名不变。

**阶段 2**：`goalContractV2.js`（手写核心：normalize/validate/fromV1Contract/fromIntent/toLegacyV2 适配器族）+ `goalContractV2.generated.js`（manifest 生成：GOAL_IDS/ENTITY_ROLES/GOAL_EFFECTS/SCHEMA）。agentService 在 understanding 后经 `fromV1Contract` 转 V2 存入 working memory；协议输出形态不变。

**阶段 4**：`getAuthoritativeProviderConfig(env)`（providerConfigService）→ admin status API + adminPages UI；`resolveStageChain(stage, runtimeConfig)`（providerChainService）← understandingService/plannerModelAdapter/structuredInferenceService 三个调用点；`probeProvider` ← `POST /api/admin/ai-provider/probe`；`saveConfig` 内 `recomputeChainForPrimary` 保证单选=链首。

**阶段 5（已落盘部分）**：`verification/verificationPolicy.js`（策略 normalize/校验）← capabilityManifestService 加载 manifest 时校验。**尚无运行时消费者**——策略字段目前是"死配置"，这是阶段 5 最关键的未完成点。

## 5. 多 coder 重叠修改的文件

- `package.json`：阶段 1（主会话）+ 阶段 2 coder 各加脚本，均为追加式，无冲突
- `server/src/routes/ai.js`：阶段 4 coder 独占（readiness verified），与阶段 1 的 runs 路由无交集
- `understandingService.js`、`plannerModelAdapter.js`、`structuredInferenceService.js`：阶段 4 独占（阶段链），与阶段 3 的 runtime 拆分无交集（阶段 3 未改这三文件内部）
- 无同一函数被两个 coder 修改的情况；所有重叠均为文件级追加

## 6. 已运行测试及真实结果

**收口时运行（2026-07-28 00:1x，全部实际运行）**：
- 语法检查：全部变更 JS `node --check` 通过；7 个核心模块 `require` 加载冒烟通过
- 定向测试 10/10 PASS：test-provider-readiness、test-provider-runtime-matrix、test-ai-provider-policy、test-provider-shadow-eval、test-planner-model-adapter、test-agent-model-first-understanding、test-goal-contract-v2、test-xiaofu-runs-transport、test-agent-run-events、test-agent-terminal-truth
- admin 4/4 PASS：check-admin-inline-script、check-admin-page、test-admin-ai-provider-ux、test-admin-api-contract
- `check:teacher-search-contract`：current
- 敏感信息扫描：git diff + 全部未跟踪文件，Token/Key/Cookie/OpenID/密码模式零命中

**此前运行（阶段 1-3 验收时）**：全量 regression 120/120、foundation 31/31、phase3 套件全绿、final-convergence 全绿、ai-competition 通过（阶段 1 时）

**未运行**：阶段 3 之后的 ai-competition 与全量 regression；阶段 4/5/6 改动后的任何重型套件。`test:agent-release-gate` 从未运行。

## 7. 当前失败测试

无已知失败——收口时运行的定向测试全部通过。但这**不代表全量套件绿**（见上节"未运行"）。复现命令：`npm run test:agent-regression`（约 10 分钟）、`npm run test:ai-competition`。

## 8. Provider / Verification / Search Contract 完成度

- **Provider（阶段 4）**：代码 ~90% 落地。已验证：既有 provider 测试全 PASS、admin UI 静态检查过。未验证：单选=第一跳的端到端保存→调用链实测（缺 test-provider-control-plane.js）、probe 的真实网络行为（需凭据环境）、阶段链在 trial 的真实调用顺序
- **Verification（阶段 5）**：~30%。策略定义与加载校验完成但无运行时消费者；核验事件、出发链核验、测试全部未做
- **Search Contract（阶段 6）**：~10%。仅契约 JSON 设计稿，无任何代码消费者

## 9. 下一会话的最小续作入口（按序）

1. **先跑门禁确认基线**：`npm run test:agent-foundation && npm run test:agent-phase3 && npm run test:agent-final-convergence && npm run test:ai-competition && npm run test:agent-regression`——若有失败，先区分"本分支引入"还是"基线已有"，修本分支引入的
2. **补阶段 4 专项测试**：新建 `tools/test-provider-control-plane.js`（设计已在代码中：保存单选→`getProviderChain` 链首断言、`getAuthoritativeProviderConfig` 五元组形态、`resolveStageChain` 三阶段、probe 桩测试、public 恒 mock），跑通后阶段 4 才算完成
3. **阶段 5 续作**：实现 `verification/toolResultVerifier.js`（消费 verificationPolicy.js 已 normalize 的策略）→ 接线 `runtime/verificationCoordinator.js` → runEventCatalog 加 `verification.started/completed` + `agentActivityState.js` 映射 → `test-agent-verification.js`
4. **阶段 6 续作**：`tools/generate-school-search-contract.js` 生成器 → 全校页四类搜索走服务端 → 删客户端重复过滤 → URL 构建统一 → `test-search-contract-unified.js`
5. 阶段 7-12 按原任务书推进；**coder 委派必须要求写进度文件**（本次 3 个 coder 均出现 20-40 分钟静默停滞，进度文件机制只在最后恢复的 coder 上生效过一次）

## 10. 已知风险与注意事项

- manifest 的 verification 策略字段已生效于加载校验：若策略 JSON 有误服务会启动失败——目前 load smoke 通过，但改 manifest 后必须重跑加载冒烟
- `school-search-contract.json` 尚无消费者，删除它不影响任何运行代码
- 三个后台 coder（agent-7/8/9）已停止且不再 resume；其上下文保留在会话档案中，如需可凭 agent_id 恢复，但建议按第 9 节重做未完成部分（更小、更可验证）
- 本检查点不保证全量回归绿；发布/合并前必须过 `test:agent-release-gate`
