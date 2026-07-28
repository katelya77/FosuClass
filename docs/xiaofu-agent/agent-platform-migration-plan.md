# 小佛助手 Agent 平台化迁移：续作总计划（M0–M7）

> **基线**：`main @ 33ae65fc`（"feat: unify Xiaofu model-first task agent chain (#35)"）
> **检查点**：`83917ae2`（`chore(xiaofu): checkpoint agent platform migration phases 1-6`）
> **当前分支**：`refactor/xiaofu-agent-platform-v2`（未推送、未合并、未部署）
> **用户批准日期**：2026-07-28
> **注意**：M7 删除过期审计快照**仍需二次授权**（届时先列清单报批，见批准决定第 5 条）。

本计划从检查点 `83917ae2` 继续，不重做阶段 1—3，不重新全仓审计。

---

## 0. 用户批准决定（2026-07-28，七项）

1. **批准计划整体**：M0→M7 的里程碑边界、执行顺序、文件范围、热点文件管控和测试策略。不得未经批准改变里程碑边界、增加新的架构体系，或重新实施已完成的阶段 1—3。
2. **M0 的 C/D 类测试处置：逐案报批**。发现"旧测试与新架构不一致"或"测试本身存在缺陷"时：先提供旧断言、新架构契约、main 对照结果和修改建议；等用户明确批准后再修改测试；不得降低断言强度；测试更新必须独立 commit。
3. **M1 暴露真实代码缺陷时允许就地修复**，但须满足：每个真实缺陷单独定位；先保留测试由红到绿的证据；一个缺陷一个独立 commit；不得扩大到 Verification、Search、Memory、小程序 UI 等其他里程碑；如修复涉及既有公共接口、数据结构或计划禁止修改的文件，必须先暂停并向用户报告。
4. **release-gate**：确认 `test:agent-release-gate` 首次执行放在 M7。届时若出现历史存量问题，必须按 A/B/C/D 分类，不能归咎于当前分支，也不能为变绿弱化门禁。
5. **M7 删除过期审计快照：暂不预先授权**。到 M7 时先列出拟删除的 6 篇文档、删除理由、替代文档和 Git 可恢复方式，等用户再次明确批准后才能删除。
6. **M3 全校页离线策略：批准保留 last-known-good 本地缓存兜底**。服务端搜索失败、断网或超时时不得造成全校页完全不可用；降级结果必须有真实状态标识，不能冒充在线最新结果。
7. **并行窗口：批准唯一窗口 M3-T1 搜索契约生成器 ∥ M4-T1 FollowUpResolver**。约束：两个任务修改文件完全不重叠；各自使用独立 coder；不得继续派生子 coder；不得提前进入后续任务；完成后由主 Agent 串行审查、测试和集成。除该窗口外，所有里程碑严格单 coder 串行执行。

---

## 1. 检查点核实结果（2026-07-27 实测）

| 核实项 | 结果 | 证据 |
|---|---|---|
| HEAD == 83917ae2 | ✅ | `git rev-parse HEAD` = `83917ae22d0900a4d98e70f86c4feb7afda7084d` |
| 分支 | ✅ | `refactor/xiaofu-agent-platform-v2`，基于 `main @ 33ae65fc` |
| 工作树干净 | ✅ | `git status --porcelain` 空输出；交接文档所列 9 个 untracked 已全部进入检查点提交 |
| 变更清单 | ✅ 一致 | `git diff --name-status 33ae65fc..83917ae2` = 49 路径（27 M + 22 A）；交接文档"36 路径"是把 `runtime/` 13 文件按 1 条计，口径换算后完全一致 |
| 交接文档阶段完成度 vs 代码 | ✅ 基本一致 | 见第 2 节逐项核对 |
| 半写入 / 重复体系 / 接口不一致 | 未发现新增问题 | 既有平行路径均为交接文档与审计文档已记录在案者，按计划在 M3–M6 收敛 |

**核实中产生的 4 条记录（只记录，不在本计划外修改）：**

1. `tools/run-agent-regression-tests.js:9` 只自动发现 `test-ai-* / test-xiaofu-* / test-agent-*` 命名的测试。`tools/test-provider-control-plane.js`、未来的 `test-search-contract-unified.js` **不在自动发现范围**，必须显式接入 runner 或 npm 复合脚本。
2. 回归 runner 以 `AI_AGENT_ENABLED=false` 注入子进程（`run-agent-regression-tests.js:31`），需要 Agent 开启的测试必须按 `test-provider-runtime-matrix.js` 的 `withEnv` 模式自行管理环境。
3. `providerRuntimeConfigStore.RUNTIME_CONFIG_KEYS` 白名单不含 `AI_UNDERSTANDING_PROVIDER / AI_PLANNER_PROVIDER / AI_RESPONSE_PROVIDER`。**经核实不是缺陷**：阶段字段经 `PROFILE_FIELD_TO_ENV`（`providerConfigService.js:132-134`）持久化在 `AI_PROVIDER_ENVIRONMENTS` Profile JSON 内，并由 `profileToEnvUpdates`（:414-423）→ `getRuntimeConfigForEnvironment`（:851-881）投影为扁平键供 `resolveStageChain` 消费，链路闭环。
4. `runEventCatalog.js:30` 已有 `result.verifying`（由 `agentKernel.js:276,466` 发射）。阶段 5 的事件应**增量新增** `verification.started/completed`，不改名、不删既有事件。

---

## 2. 阶段 4—6 真实代码状态（逐文件核对）

### 阶段 4 Provider 控制面 —— 代码 ~90% 落地，缺专项测试（与交接文档一致）

已落盘并核对到行号：

- `server/src/services/ai/providerConfigService.js`
  - `getAuthoritativeProviderConfig(env)` :899-932 —— 五元组 `environment/primaryProvider/fallbackProviders/effectiveChain/configVersion` + `stageAssignments{understanding,planner,response}`；public 恒 `{mock, [], ["mock"], 全 mock}`
  - `recomputeChainForPrimary(provider, previousChain)` :292，`saveConfig` 内调用点 :809 —— 单选=链首
  - `PROFILE_FIELD_TO_ENV` :124-152 —— 含三个阶段 Provider 字段映射
- `server/src/services/ai/providerChainService.js`
  - `STAGE_CONFIG_KEYS` :22-26（understanding/planner/response → `AI_*_PROVIDER`）
  - `resolveStageChain(stage, runtimeConfig, runtimeMode)` :116-127 —— 阶段非空→`[stageProvider, ...主链剔除]`；public→`["mock"]`
  - `probeProvider(name, input)` :379-432 —— 支持 `probeGenerate` 桩；public 直接 `PUBLIC_PROVIDER_FORBIDDEN`；写同一进程指标存储
  - `isProviderVerified` :130-134（lastSuccessAt 语义）
  - `getStatus` :532-549 —— `configuredAvailable`（配置且未到期且熔断未开）与 `verified`（真实成功）分离；`p50LatencyMs/p95LatencyMs`；熔断 `closed/open/half-open` :179-195,223；`resetForTest` :551
  - `classifyFailure` / `generateWithChain`（含 `circuit_open` skip attempts :447-449）
- `server/src/modules/ai-provider/routes.js:49-90` —— `POST /api/admin/ai-provider/probe`，public 环境 400 拒绝；`test-coze`、`diagnose-enhanced` 同文件
- `server/src/routes/admin.js:653` —— status API 输出 `authoritative` 五元组（**后台与运行时同源已接线**）
- `server/src/routes/adminPages.js` —— 阶段分配下拉、readiness-matrix 表、"已配置未验证"徽标、立即探测按钮（交接文档 + admin 4 项静态检查 PASS）
- 三个阶段链调用点：`understandingService.js`、`plannerModelAdapter.js`、`structuredInferenceService.js`

**缺口（唯一）**：`tools/test-provider-control-plane.js` 不存在（`ls` 确认）。单选=第一跳的端到端断言、阶段链行为锁定、probe 桩测试、public 恒零调用断言均无专项测试覆盖。

### 阶段 5 Verification 语义化 —— ~30%，策略是"死配置"（与交接文档一致）

- 已落盘：`server/src/services/ai/verification/verificationPolicy.js`（200 行纯函数语法校验：5 个策略键、4 种后置条件谓词 `fieldNonEmpty/fieldMatchesSlot/numericRange/timeOrder`、3 种 emptyResultPolicy 模式）
- 已落盘：manifest 16 个事实工具的 verification 策略字段；`capabilityManifestService` 加载时校验（load smoke 过）
- **未落盘**：`verification/toolResultVerifier.js`（策略运行时消费者）、`runtime/verificationCoordinator.js` 接线（现文件仅 53 行 pendingClarification + goalContract 胶水）、`verification.started/completed` RunEvent、`agentActivityState.js` 映射、出发链核验、全部专项测试
- `output/phase5-verification-progress.md` 证实 coder 停在 toolResultVerifier 起点

### 阶段 6 Search Contract —— ~10%，仅设计稿（与交接文档一致）

- 已落盘：`server/config/school-search-contract.json`（school-search.v1：4 类 entityTypes、requestFields/responseFields、decision 常数、navigation 语义、与 teacher-search.v1 兼容的 migrationNote）
- **未落盘**：生成器、服务端统一实现、全校页走服务端、客户端去重、URL 构建统一、测试
- 现状锚点（M3 依据）：全校页数据链 = `server/src/routes/fosu.js:702` `/release-pack/index/:type` + `miniprogram/services/releasePackService.js` + `pages/school/school.js` 本地过滤；URL 构建双份 = `miniprogram/services/scheduleNavigator.js:36` + `scheduleNavigationService.js:47`；`miniprogram/utils/classroomSearch.js` ≡ `server/src/services/ai/classroomSearch.js` 逐字节复制

---

## 3. 全局执行纪律（全程有效）

1. 默认同一时刻只有 1 个写代码的 coder；仅允许 1 个经批准的"双 coder 文件零重叠"窗口（M3-T1 ∥ M4-T1，见第 5 节）。
2. coder 不得派生子 coder；1 个 coder = 1 个原子任务 + 定向测试 + 进度文件（`output/agent-platform-mX-progress.md`，每完成一步追加一行）。
3. 共享 schema / 公共接口 / 热点文件（见第 6 节表）一律由主 Agent 串行修改，不委派。
4. 原子任务只跑定向测试；里程碑收尾跑阶段集成测试；全量五门禁只在 M0、M6 收尾、M7 运行。
5. 每里程碑单独 commit；不 push、不 PR、不 merge、不部署、不上传体验版。
6. 禁止删/跳/弱化测试来变绿；禁止输出或提交 Token/Key/Cookie/OpenID/密码。
7. 交付语言严格分级：已写代码 / mock 已验证 / staging live 已验证 / 真机已验证 / 已上传体验版 / 已发布生产。

---

## 4. 里程碑计划

### M0 — 检查点基线认证

**目标**：用五项门禁证明 `83917ae2` 的真实测试基线，产出带证据的基线认证文档。
**非目标**：不新增任何功能、不修任何代码（含测试）、不跑 `test:agent-release-gate`（留到 M7 首跑）。

**前置依赖**：无（工作树干净即可）。

**当前已有实现**：五门禁脚本全部存在（`package.json:466,473,594,617,482`）；阶段 1—3 验收时全绿，阶段 3 之后 ai-competition 与全量 regression 未重跑（交接文档 §6）。

**五项门禁（准确命令 + 预计作用范围）**：

| # | 命令 | 作用范围 | 量级 |
|---|---|---|---|
| 1 | `npm run test:agent-foundation` | 策展核心套件（含 goal-contract-v2、understanding、planner-adapter 等） | 上次 31 项 |
| 2 | `npm run test:agent-phase3` | Runtime Truth 24 文件（run-events、activity-state、terminal-truth、readiness、runtime-matrix、coze、runtime-ui、memory-integration、reminders 等） | 24 项 |
| 3 | `npm run test:agent-final-convergence` | Planner / Observation Loop / Hybrid RAG / Response Composer / Memory Upsert / 最终 UI | 1 个 runner |
| 4 | `npm run test:ai-competition` | trial/dev 竞赛合规链 | 1 个 runner |
| 5 | `npm run test:agent-regression` | 自动发现 `test-ai-/test-xiaofu-/test-agent-` + 10 个补充，约 115+ 文件 | ~10 分钟 |

**失败分类规则（四类，先分类后处置）**：

- **A 本分支引入的回归**：与 main 基线对比（用 `git worktree add ../fosuclass-baseline-main 33ae65fc` 建只读对照工作区，跑同一个失败测试文件；不 stash、不动当前树；仅在出现失败且确需 A 类取证时才创建）。确认后只定位和报告，M0 内不擅自修复。
- **B 环境问题**：缺凭据/存储路径/端口等。记录精确前置条件，用文档化环境重跑一次；仍失败则标记为"环境受限未验证"，不得写成通过。
- **C 旧测试与新架构不一致**：证据 = 断言引用已被阶段 1—3 移除/改名的路径或文案。**不允许直接改**，先出对比证据（旧断言、新架构契约、main 对照结果、修改建议）报用户批准，获批后作为独立原子任务改测试且不得降低断言强度，独立 commit。
- **D 测试本身缺陷**：同 C 的处理流程（逐案报批），标注缺陷性质。

**禁止**：删除、跳过、注释、放宽断言来变绿；把 B 类伪装成通过；在 M0 修业务代码。

**实施任务拆分（全部主 Agent 串行执行，不派 coder、不派后台子 Agent）**：

- M0-T1：跑门禁 1+2，原始输出存档（`.tmp/m0/`，不提交）；证据摘要写入 `output/agent-platform-m0-baseline.md`。
- M0-T2：跑门禁 3+4，存档。
- M0-T3：跑门禁 5（~10 分钟），存档。
- M0-T4：若有失败 → 逐条按 A/B/C/D 分类取证；A 类只定位报告；C/D 类报用户批准。全绿则直接写认证结论。

**每项门禁记录**：完整命令、开始/结束时间、运行时长、exit code、通过/失败数量、首个真实错误。五门禁严格串行，前一个结束后再启动下一个，不得并发。

**里程碑集成测试**：五门禁本身即集成测试。
**验收标准**：五门禁全绿；或每个失败都有分类 + 证据 + 用户签署的处置决定，且 A 类已清零。
**回滚方法**：无代码改动可回滚；删除 `output/agent-platform-m0-baseline.md` 即还原。
**建议 commit**：`chore(agent): certify checkpoint 83917ae2 baseline (M0)`（仅迁移计划 + M0 证据文档；commit 前跑敏感信息扫描，不提交含 Token/Key/Cookie/OpenID/密码的测试日志；存在未分类清楚的失败时先不 commit，先汇报）。
**是否允许并行**：否（门禁串行跑，避免资源竞争污染耗时断言）。
**并行文件重叠**：不适用。

---

### M1 — 完成 Provider 控制面（阶段 4 收口）

**目标**：补齐阶段 4 唯一缺口 `tools/test-provider-control-plane.js`，把五元组/单选=链首/阶段链/probe/readiness/指标/熔断/public 零调用/Shadow 隔离/后台同源全部锁进行为测试。
**非目标**：不碰 Verification、Search、Memory、小程序 UI；不重构 Provider 实现；不顺手改 manifest。

**前置依赖**：M0 基线认证完成（A 类为零）。

**当前已有实现**：见第 2 节阶段 4 清单——全部被测对象已在代码中，本里程碑只写测试（+ 测试暴露真实缺陷时的独立修复）。

**需要新增或修改的准确文件**：

| 文件 | 动作 | 归属 |
|---|---|---|
| `tools/test-provider-control-plane.js` | 新增（唯一业务交付物） | coder（1 个，两个串行原子任务） |
| `package.json` | 加 `"test:provider-control-plane": "node tools/test-provider-control-plane.js"` | 主 Agent |
| `tools/run-agent-foundation-tests.js` | 把新测试接入 foundation 套件（回归 runner 不自动发现该命名，见核实记录 1） | 主 Agent |
| `output/agent-platform-m1-progress.md` | coder 进度文件 | coder |

**条件性修改（仅当新测试暴露真实缺陷，按批准决定第 3 条执行）**：`providerConfigService.js` / `providerChainService.js` / `providerReadinessService.js` / `providerRuntimeConfigStore.js` / `agentReadinessService.js` / `server/src/routes/admin.js` / `adminPages.js` / `ai.js` / `modules/ai-provider/routes.js`。每个缺陷 = 单独定位 + 红→绿证据 + 独立原子任务 + 独立 commit；涉及既有公共接口、数据结构或禁止修改文件时必须先暂停报告。

**明确禁止修改**：`server/src/services/ai/verification/**`、`runtime/**`、`agent-capability-manifest.json`、`school-search-contract.json`、`miniprogram/**`、`agentService.js`、`toolRegistry.js`、`memory/**`、`skillRegistry.js`、`agentKernel.js`、providers 四个实现文件。

**对外接口和数据结构（测试锁定的既有契约，不新造）**：

- `getAuthoritativeProviderConfig(env)` → `{environment, primaryProvider, fallbackProviders[], effectiveChain[], stageAssignments{understanding,planner,response}, configVersion}`
- `resolveStageChain(stage, runtimeConfig, runtimeMode)` → 有序 Provider 名数组
- `probeProvider(name, {runtimeMode, providerRuntimeConfig, timeoutMs, probeGenerate?})` → `{provider, health:"ok"|"degraded"|"disabled"|"forbidden", latencyMs, reasonCode}`
- `getStatus(mode, cfg)` → 每项含 `configuredAvailable / verified / p50LatencyMs / p95LatencyMs / circuitBreaker{state,openedAt,nextProbeAt} / lastSuccessAt / lastFailureAt / callCount`
- `POST /api/admin/ai-provider/probe` → `{success, data:{…, environment, verified, checkedAt}}`；public → 400 `PROBE_PUBLIC_FORBIDDEN`

**实施任务拆分（原子任务）**：

- **M1-T1（coder #1，任务 A）**：主 Agent 先读 `tools/test-provider-readiness.js` 提取存储隔离模式（`FOSU_AI_PROVIDER_CONFIG_PATH` 等重定向到临时目录）交给 coder；coder 新建测试文件并完成断言组 ①—⑤：
  1. **五元组形态**：trial fixture → 五键齐全、`effectiveChain = [primary, ...fallbacks]`、`stageAssignments` 三键；public → `{mock, [], ["mock"], 全 mock}`。
  2. **单选=第一跳**：`recomputeChainForPrimary` 三种输入（空旧链 / 旧链无 primary / primary 在旧链中部）链首均为单选值；`getAuthoritativeProviderConfig().effectiveChain[0] === primaryProvider`；与 `getProviderChain(runtimeMode, 投影后配置)[0]` 三者一致。
  3. **Understanding / Planner / Response 显式链**：经 profile→扁平键投影后，`resolveStageChain("understanding"|"planner"|"response")` 链首=阶段 Provider、余项=主链剔除重复；阶段字段为空→主链原序；阶段值非法→主链；未知 stage 参数→主链。
  4. **probe 桩**：`probeGenerate` 成功桩 → `health:"ok"` 且 `isProviderVerified` 变 true；失败桩 → `health:"degraded"` 且 reasonCode 来自 `classifyFailure`；`mock` → ok；未知名 → `PROVIDER_UNKNOWN`；未配置 → `NOT_CONFIGURED`。
  5. **probe / readiness**：public 模式 probe → `PUBLIC_PROVIDER_FORBIDDEN` 且不触网络（桩计数为 0）；成功 probe 后 `getStatus` 该项 `verified:true`；`configuredAvailable` 与 `verified` 语义分离（已配置未验证 vs 已验证各造一例）。
  定向测试：`node tools/test-provider-control-plane.js`（自管理 env，`withEnv` 模式）。
- **M1-T2（coder #1，任务 B，与 T1 串行同文件续写）**：断言组 ⑥—⑪：
  6. **recent_success / 指标**：桩成功 N 次后 `lastSuccessAt` 非空、`callCount` 递增、`p50/p95` 为有限数且 p95≥p50；`resetForTest` 后归零（隔离）。
  7. **error_classification**：`classifyFailure` 对超时/鉴权/配额/网络/未知五类错误的稳定映射锁定（以现实现为准记录行为）。
  8. **circuit state**：连续失败桩触发 closed→open；open 时 `generateWithChain` 跳过该项且 attempts 含 `{status:"skipped", reason:"circuit_open"}`；`nextProbeAt` 过后 half-open（测试内可控时间或短窗口）。
  9. **public 恒零外部调用**：public + `AI_PROVIDER=deepseek` + 三阶段字段全部设置 → `resolveStageChain` 三阶段均 `["mock"]`、`getProviderChain` 为 `["mock"]`、probe forbidden；provider 模块 generateStructured 桩计数恒 0。
  10. **Shadow Eval 不参与回复和记忆**：shadow 开启时主应答 `answer/provider` 字段不被 shadow 改写；shadow 失败不影响主结果；静态断言 `providerChainService.js` 不 `require` 任何 memory 模块（沿用 `test-planner-model-adapter.js` 的源码静态断言手法）。
  11. **后台 UI 与运行时配置同源**：静态断言 `admin.js` 调用 `getAuthoritativeProviderConfig`（:653）、`adminPages.js` 引用 readiness-matrix 与 probe 端点；行为断言：同一 trial profile fixture 下 `authoritative.effectiveChain[0]`、`authoritative.stageAssignments.*` 与 `resolveStageChain` 各阶段链首一致。
  定向测试：同 T1。
- **M1-T3（条件任务，主 Agent 或 coder 逐缺陷执行）**：T1/T2 暴露的真实缺陷，每个缺陷一个原子修复 + 复跑定向测试 + 单独 commit（`fix(agent): …`），并在进度文件记录"测试红→修复→绿"证据。若无缺陷，本任务跳过并记录。
- **M1-T4（主 Agent）**：`package.json` 加脚本 + 接入 `run-agent-foundation-tests.js` → 跑里程碑集成测试 → commit。

**里程碑集成测试**：`npm run test:agent-foundation` + 既有 provider/admin 定向四项（`test-provider-readiness`、`test-provider-runtime-matrix`、`test-provider-shadow-eval`、`test-ai-provider-policy` + admin 4 项 `test:admin-inline-script / test:admin-page / test:admin-ai-provider-ux / test:admin-api-contract`）。
**验收标准**：新测试全绿且覆盖全部确认点；既有 provider/admin 测试零行为回归；foundation 绿；敏感信息扫描零命中（测试 fixture 不得含真实 Key 形态字符串）。
**回滚方法**：`git revert` M1 各 commit（测试文件与脚本接线均为追加式；缺陷修复单独 revert）。
**建议 commit**：`test(agent): add provider control plane certification suite (M1, phase 4 closeout)`；缺陷修复另算。
**是否允许并行**：否。T1/T2 同文件串行；`package.json` 与 foundation runner 属热点，主 Agent 独占。
**并行文件重叠**：不适用。

---

### M2 — 完成 Verification / Runtime Truth（阶段 5 收口）

**目标**：让 manifest 16 个工具的 verification 策略从"死配置"变成运行时真实核验：新增 `toolResultVerifier`，接入 chat 流，发真实 RunEvent，核验结果进入响应的 verification/partial 字段与终态胶囊。
**非目标**：不改 16 个工具的 manifest 策略内容（除非加载校验报错）；不做搜索统一（M3）；不动 follow-up 解析器（M4）；不改小程序页面组件。

**前置依赖**：M1 完成（provider 控制面行为已锁定，避免 verification 失败与 provider 失败归因混淆）。

**当前已有实现**：
- `verification/verificationPolicy.js`（纯校验，含 `parsePostcondition` 可直接复用）
- manifest 策略字段 + `capabilityManifestService` 加载校验
- `runtime/verificationCoordinator.js`（53 行，仅 pendingClarification/goalContract 胶水）——天然接线点
- `runEventCatalog.js` 事件目录（含既有 `result.verifying`）+ `aguiAdapter.js` EVENT_MAP + `miniprogram/services/agentActivityState.js` 状态映射
- `deriveExecutionOutcome`（`runtime/responseComposerBridge.js:137`）——终态推导消费点
- `skillRegistry.defaultResultVerifier`（`skillRegistry.js:18-48`，浅校验，保留为兜底）

**需要新增或修改的准确文件**：

| 文件 | 动作 | 任务 |
|---|---|---|
| `server/src/services/ai/verification/toolResultVerifier.js` | 新增：消费已 normalize 策略，输出结构化核验结果 | M2-T1 |
| `tools/test-agent-verification.js` | 新增专项测试（命名命中回归自动发现） | M2-T1/T3 |
| `server/src/services/ai/runtime/verificationCoordinator.js` | 修改：新增 `verifyToolResults(execution, intent, goalContract)` 并接入 chat 流 | M2-T2 |
| `server/src/services/ai/runtime/toolExecutor.js` | 修改：收集每个工具的 `{toolId, result}` 供核验（仅透传，不改执行逻辑） | M2-T2 |
| `server/src/services/ai/runEventCatalog.js` | 追加 `verification.started / verification.completed`（不删不改既有事件） | M2-T2（主 Agent 审） |
| `server/src/services/ai/aguiAdapter.js` | EVENT_MAP 追加两事件映射 | M2-T2 |
| `miniprogram/services/agentActivityState.js` | 新事件 → `verifying` 活动态映射 | M2-T2 |
| `server/src/services/ai/verification/departureChainVerifier.js` | 新增：出发链实体-时间-地点交叉核验（"下一节课+出发时间"类链式目标） | M2-T3 |
| `tools/run-agent-phase3-tests.js` | 接入新专项测试 | M2-T4（主 Agent） |
| `server/src/services/ai/planner/goalContract.js` | 仅当 T2 整合需要：outcome 规则消费位置迁注（保留导出兼容，不改行为） | 条件性，主 Agent |

**明确禁止修改**：`agentService.js` 的 19 个导出签名、`memory/memoryController.js`、ActionReceipt 校验链、manifest 的 tool id/intent/skill 结构、`miniprogram/pages/**`、`xiaofuAgentRouter.js`、provider 控制面全部文件（M1 已冻结）。

**对外接口和数据结构**：

- `toolResultVerifier.verify({ toolId, policy, result, intent, goalContract })` →
  `{ status: "verified" | "partial" | "failed" | "empty_accepted", ok: boolean, violations: [{ code, detail, field? }], evidence: { fields: string[], approximateFlags: [{ field, label }] } }`
- RunEvent 载荷：`verification.started { toolCount }`；`verification.completed { status, violationCount, toolId? }`（不含原始课表数据，遵守脱敏边界）
- 响应侧：核验结果汇入 `deriveExecutionOutcome` 的既有 `verification/partial` 输出，协议 `agent.v1/v2` 字段不变、只更真实

**实施任务拆分**：

- M2-T1（coder）：`toolResultVerifier.js` + 单测主体。覆盖：outputSchema required/类型浅校验、四种后置条件谓词（含 `fieldMatchesSlot` 对 intent slots/constraints 比对）、`emptyResultPolicy` 三模式、`partialCompletionPolicy`、`evidencePolicy` 字段与 approximateFlags 透出。定向测试：`node tools/test-agent-verification.js`。
- M2-T2（coder，与 T1 串行；热点文件 runEventCatalog 由主 Agent 审 diff）：coordinator 接线 + toolExecutor 透传 + 事件目录/AG-UI/activityState 三处映射。定向测试：`node tools/test-agent-verification.js` + `node tools/test-agent-run-events.js` + `node tools/test-agent-activity-state.js`。
- M2-T3（coder）：`departureChainVerifier.js`（链式目标实体-时间-地点交叉核验）+ 对应测试段。定向测试：`node tools/test-agent-verification.js`。
- M2-T4（主 Agent）：接入 phase3 runner → 里程碑集成测试 → commit。

**里程碑集成测试**：`npm run test:agent-phase3` + `npm run test:agent-foundation` + `node tools/test-agent-final-convergence` 相关段（按 AGENTS.md，Run Events 改动必须 phase3）。
**验收标准**：桩工具执行可证明策略真实被评估（红绿各一例）；runs 事件流出现 `verification.started/completed`；响应 verification/partial 字段与核验状态一致；foundation + phase3 全绿；`test:agent-final-convergence` 不回退。
**回滚方法**：`git revert` M2 各 commit；策略字段无消费者时天然惰性，回滚即回到 M1 态。
**建议 commit**：`feat(agent): wire verification policy runtime consumer with truth events (M2, phase 5 closeout)`。
**是否允许并行**：T1 与 T3 文件零重叠（verifier vs departureChainVerifier + 测试不同段）**可并行 2 个 coder**；T2 必须等 T1 完成串行；T4 主 Agent 收尾。
**并行文件重叠**：T1=`verification/toolResultVerifier.js`+测试 §A；T3=`verification/departureChainVerifier.js`+测试 §B——`test-agent-verification.js` 为共享文件，约定 T1 先建文件、T3 仅追加独立 describe 段，或拆为两个测试文件（实施时由主 Agent 裁定，默认拆两个文件彻底去重叠）。

---

### M3 — 完成 Search Contract 与全校页统一（阶段 6 收口）

**目标**：`school-search-contract.json` 从设计稿变成单源生成链；四类搜索（teacher/class/classroom/course）服务端唯一实现，全校页与 Agent 同源；客户端删除重复过滤/精确命中/候选决策；URL 构建统一。
**非目标**：不动 Release Pack 构建/发布/版本校验/静态源回退/last-known-good；不改 teacher-search.v1 既有契约链兼容性；不动 Agent 运行时模块（除 toolRegistry 搜索工具的消费切换）。

**前置依赖**：M1（provider 无关性已锁定）。与 M2 无文件依赖，但按执行纪律仍排在 M2 后串行（toolRegistry 与 M4 也有交集，避免三里程碑交叉）。

**当前已有实现**：
- 契约设计稿 `server/config/school-search-contract.json`（school-search.v1）
- 可复制的既有模式：`tools/generate-teacher-search-contract.js`（生成 + `--check` + `check:teacher-search-contract` CI 守卫 + `test-teacher-search-contract-unified.js`）
- 全校页数据链：`server/src/routes/fosu.js:702` `/release-pack/index/:type`、`:740` detail；客户端 `releasePackService.js` + `pages/school/school.js` 本地过滤
- Agent 侧搜索：`toolRegistry.js` 四类搜索实现、`server/src/services/schoolCatalogService.js`
- URL 构建双份：`scheduleNavigator.js:36 buildScheduleViewUrl` + `scheduleNavigationService.js:47`
- 逐字节重复：`miniprogram/utils/classroomSearch.js` ≡ `server/src/services/ai/classroomSearch.js`

**需要新增或修改的准确文件**：

| 文件 | 动作 | 任务 |
|---|---|---|
| `tools/generate-school-search-contract.js` | 新增：以 `server/config/school-search-contract.json` 为源，生成服务端 + 小程序两侧消费模块，支持 `--check` | M3-T1 |
| 生成物（路径实施时对齐 teacher 模式，预计 `server/src/services/generated/schoolSearchContract.generated.js` + `miniprogram/services/generated/schoolSearchContract.generated.js`） | 新增（生成器产出） | M3-T1 |
| `server/src/services/schoolSearchContractService.js` | 新增：四类统一过滤谓词/精确命中/唯一-多候选决策/决策常数消费，进程内供 Agent 与路由共用 | M3-T2 |
| `server/src/routes/fosu.js` | 新增 `GET /release-pack/search`（scheduleLimiter），全校页 HTTP 入口 | M3-T3 |
| `server/src/services/ai/toolRegistry.js` | 四类搜索工具改消费 contract service（进程内调用，行为等价） | M3-T3 |
| `miniprogram/services/releasePackService.js` | 搜索改走服务端端点；失败保留 last-known-good 本地缓存兜底（批准决定第 6 条：降级结果必须有真实状态标识，不得冒充在线最新结果） | M3-T4 |
| `miniprogram/pages/school/school.js` | 删除本地重复过滤/精确命中/候选决策，消费服务端响应 + 契约常数 | M3-T4 |
| `miniprogram/services/scheduleNavigationService.js` / `scheduleNavigator.js` | URL 构建收敛为单一实现并消费契约 navigation 语义；服务端复用契约（不跨端 require） | M3-T5 |
| `miniprogram/utils/classroomSearch.js` ⇄ `server/src/services/ai/classroomSearch.js` | 改为单源生成（纳入 T1 生成器） | M3-T5 |
| `tools/test-search-contract-unified.js` | 新增：契约 check、四类 Agent↔HTTP 结果一致性、URL 单一实现、重复代码消失断言 | M3-T6 |
| `package.json` | `generate:school-search-contract` / `check:school-search-contract` / `test:search-contract-unified` | 主 Agent |

**明确禁止修改**：Release Pack 构建/发布/回滚链（`releaseService.js`、`releasePackService` 服务端部分、admin release 路由）、`agent-capability-manifest.json`、阶段 4/5 已冻结文件、`memory/**`、会话 REST API。

**对外接口和数据结构**：
- `GET /api/fosu/release-pack/search?type&q&term&releaseVersion&…` → 契约 responseFields 超集 `{success,type,contractVersion:"school-search.v1",items,total,decision:{unique|candidate|none},…}`
- 进程内：`schoolSearchContractService.search({type, q, filters…})` → 同构结果（Agent 工具与 HTTP 同一函数）
- 决策常数唯一来源：契约 `decision{candidateOpenMax:3, actionCap:4, candidateListMax:8, offlineCandidateMax:6}`

**实施任务拆分**：T1 生成器（coder）→ T2 服务端 service（coder）→ T3 路由 + toolRegistry 切换（coder，toolRegistry 热点单独占一个任务）→ T4 客户端切换 + 删重（coder）→ T5 URL 统一 + classroomSearch 单源（coder）→ T6 测试 + 接线（主 Agent 收尾）。每步定向测试：T1 `node tools/generate-school-search-contract.js --check`；T2–T5 `node tools/test-search-contract-unified.js` 对应段；T6 全量该测试 + `npm run check:teacher-search-contract`（兼容守卫）。
**里程碑集成测试**：`npm run test:agent-unified-chain` + `npm run test:agent-foundation`。
**验收标准**：全校页四类搜索走服务端且离线兜底可用；Agent 与 HTTP 同查询同结果（测试断言）；客户端三处重复逻辑删除（grep 证据）；URL 构建单一实现；`check:school-search-contract` 入 foundation 或 unified-chain 守卫。
**回滚方法**：`git revert` M3 各 commit；客户端兜底逻辑保留使回滚后旧链仍可用。
**建议 commit**：`feat(school,agent): unify four-type school search on generated contract service (M3, phase 6 closeout)`。
**是否允许并行**：T1 与 M4-T1 是本计划唯一批准的跨里程碑双 coder 窗口（文件零重叠，见第 5 节）；M3 内部 T2 依赖 T1 生成物、T3 依赖 T2、T4 依赖 T3，均串行。
**并行文件重叠**：M3-T1（`tools/generate-school-search-contract.js` + 生成物 + 契约 JSON 不动）与 M4-T1（planner/memory 文件）零重叠。

---

### M4 — Memory / FollowUpResolver 收敛

**目标**：4 个并存 follow-up 解析器收敛为单一 FollowUpResolver（消费 GoalContract V2 + Thread Working State）；working memory 字段与 V2 对齐（含 pendingClarification 形态）。
**非目标**：不改 MemoryController load/commit 路径与 ActionReceipt 四重校验；不做客户端记忆 UI；不动 conversation schema 既有版本语义（只许追加字段）。

**前置依赖**：M2 完成（`runtime/verificationCoordinator.js` 的 pendingClarification 胶水与 goalContractResolver 是共享热点，必须串行）。

**当前已有实现**：`planner/followUpResolver.js`（:182 主实现候选）、`toolRegistry.js:870`（自称 Legacy）、`understanding/goalResolver.js:59-65,132-141`、`runtime/goalContractResolver.js:24 enrichIntentFromWorkingMemory`；`workingMemory.js normalizeStoredGoalContract`（V2 存储 + V1 升级，阶段 2 已落）；`runtime/verificationCoordinator.js` pendingClarification 状态机。

**需要新增或修改的准确文件**：
- `server/src/services/ai/planner/followUpResolver.js`（升级为唯一实现，V2 感知）— M4-T1
- `server/src/services/ai/toolRegistry.js`（:870 legacy 解析器改为委托或删除调用点）— M4-T2
- `server/src/services/ai/understanding/goalResolver.js`（follow-up 段退役，保留其余）— M4-T2
- `server/src/services/ai/runtime/goalContractResolver.js`（`enrichIntentFromWorkingMemory` 的追问继承部分迁入唯一解析器；非追问回填保留）— M4-T2
- `server/src/services/ai/memory/workingMemory.js`（V2 对齐字段，含 pendingClarification）— M4-T3
- `tools/test-agent-followup-resolver.js`（新增）— M4-T1/T3

**明确禁止修改**：`memory/memoryController.js`、ActionReceipt 链、conversation 存储 schema 破坏性变更、verification verifier 内部（M2 已冻结）、`agentService.js` 导出面。

**对外接口和数据结构**：`followUpResolver.resolve({ message, goalContractV2, workingState, pendingClarification })` → `{ resolvedIntent, inheritedEntities[], followUpMode, provenance }`；四个旧入口全部委托到该函数或删除。

**实施任务拆分**：T1 唯一解析器 + 单测（coder）→ T2 三处旧解析器退役/委托（coder，串行；toolRegistry 热点独占）→ T3 working memory V2 对齐 + 测试（coder）→ T4 主 Agent 集成收尾。定向测试：`node tools/test-agent-followup-resolver.js` + `node tools/test-xiaofu-memory-integration.js` + `node tools/test-agent-personal-memory.js`。
**里程碑集成测试**：`npm run test:agent-phase2`（会话记忆，AGENTS.md 强制）+ `npm run test:agent-foundation` + 定向。
**验收标准**：全仓 grep 仅剩一个 follow-up 主实现；既有记忆/追问测试零行为回归（或经批准的 C 类测试更新）；V1 存储升级路径不变。
**回滚方法**：`git revert` M4 各 commit。
**建议 commit**：`refactor(agent): converge follow-up resolution on single GoalContract-V2 resolver (M4)`。
**是否允许并行**：仅 M4-T1 可与 M3-T1 并行（见 M3）；M4 内部串行。
**并行文件重叠**：与 M3-T1 零重叠（planner/memory vs 搜索生成器）。

---

### M5 — 小程序 AG-UI 风格事件消费层

**目标**：事件协议单源化（runEventCatalog → AG-UI 映射 → 网关共用一份生成物）；小程序 UI 状态完全由服务端真实事件驱动；清除客户端残余合成状态与伪造语义（离线伪造 agent.v2/runId/steps/verified、提醒拦截改偏好、双份标签表）。
**非目标**：不重写 UI 布局；不引 AG-UI 官方 SDK（对齐思想，自研适配器收敛）；不动服务端内核；xiaofuAgentRouter 离线降级保留但压缩为"纯降级缓存应答"。

**前置依赖**：M2（客户端要消费 verification 新事件）、M3（Agent 搜索结果形态稳定后客户端卡片才稳定）。

**当前已有实现**：生产链已走 runs + RunEvent 轮询（阶段 1，含 `AI_AGENT_RUNS_TRANSPORT_ENABLED` 回滚开关）；`aguiAdapter.js`（EVENT_MAP :8-25，含 `result.verifying`→STEP_STARTED）；`cloudfunctions/xiaofuAgentGateway/index.js:15-25` 第二份 EVENT_MAP（手工同步）；`agentActivityState.js` 十态映射；thinking 门控合规（仅 `provider.started`）。

**需要新增或修改的准确文件**：
- `tools/generate-agent-event-map.js`（新增：以 `runEventCatalog.js` 为源生成 AG-UI 映射 + 网关 EVENT_MAP，`--check` 守卫）— M5-T1
- `server/src/services/ai/aguiAdapter.js`（改消费生成物）— M5-T2
- `cloudfunctions/xiaofuAgentGateway/index.js`（改消费生成物；鉴权/环境裁决与主入口对齐，禁止无 session 提权 trial）— M5-T2
- `miniprogram/services/aiAssistantService.js`（离线路径去伪造：不再造 runId/steps/`verified:true`，统一 degraded 标注；提醒拦截正则退役，改发服务端 write-effect 目标 + 执行确认 + 回传 ActionReceipt）— M5-T3
- `miniprogram/services/aiTransportRouter.js`（残余合成文案清查）— M5-T3
- `miniprogram/pages/ai-assistant/ai-assistant.js` + `packageXiaofu/**`（工具/卡片中文标签改从 Manifest 生成物消费，删双份维护表 :278-341 与 xiaofu-agent-run :1-22）— M5-T4
- 标签生成物（纳入 M5-T1 生成器或独立小生成器）— M5-T1
- `tools/test-agent-event-map-contract.js`（新增；命名命中回归自动发现）— M5-T5

**明确禁止修改**：服务端 runtime/** 与内核；runEventCatalog 事件语义（只许生成消费，不改目录本身——如需新事件回 M2 类流程单独批准）；语音合规链；`xiaofuAgentRouter.js` 的离线意图能力之外不扩容。

**对外接口和数据结构**：生成物 `aguiEventMap.generated.js`（server 侧）+ 网关同源副本；事件→UI 十态映射表（understanding/planning/tool_running/verifying/waiting_confirmation/waiting_receipt/completed/degraded/failed/cancelled）全部由服务端事件驱动。

**实施任务拆分**：T1 生成器 + check（coder）→ T2 双消费端切换 + 网关收紧（coder）→ T3 客户端去伪造 + 提醒语义收回服务端（coder，最大风险任务，单独占）→ T4 标签单源化（coder）→ T5 契约测试 + 集成（主 Agent）。定向测试：T1 `node tools/generate-agent-event-map.js --check`；T2/T3 `node tools/test-xiaofu-runs-transport.js` + `node tools/test-xiaofu-runtime-ui.js` + `node tools/test-agent-activity-state.js`；T4 `npm run test:xiaofu-agent-ui`；T5 新增契约测试。
**里程碑集成测试**：`npm run test:agent-phase3` + `npm run test:xiaofu-agent-ui` + `npm run test:agent-foundation`。
**验收标准**：两份 EVENT_MAP 手工同步消失（check 守卫）；离线应答 grep 无伪造 runId/`verified:true`；提醒全流程服务端 GoalContract + ActionReceipt 回传；标签单一来源；runs 传输回滚开关仍可用。
**回滚方法**：`AI_AGENT_RUNS_TRANSPORT_ENABLED=false` 运行时可回滚传输层；代码层 `git revert` M5 各 commit。
**建议 commit**：`feat(xiaofu): single-source AG-UI event map and purge client-side synthesized states (M5)`。
**是否允许并行**：否（T2/T3/T4 均触客户端服务层同一批文件，串行）。
**并行文件重叠**：不适用。

---

### M6 — Skill / Tool / MCP Registry 与 Durable Execution

**目标**：意图→工具映射三套并为 Manifest 单源；kernel 内 `useToolChain` 旧链与 Planner 双实现收敛为单一 PlannerCoordinator 路径；提醒/审批/等待回执建模为轻量 Durable 任务（持久化 step + wait-for-event + resume）。
**非目标**：不引 LangChain/LangGraph/向量库/远程可写 MCP（AGENTS.md 明令）；MCP 保持 `tools/fosu-kb-mcp` 受保护后台 API 只读模式，不注册 publish/rollback；同步对话链保持轻量，不迁重型工作流。

**前置依赖**：M3、M4、M5 全部完成（消费者迁净后才拆旧路径）。

**当前已有实现**：manifest `intent.allowedTools`（权威源）+ `toolRegistry.buildPlanForIntent`（:1944）+ `capabilityRouter` 正则权重（:18-48）三套并存；kernel 双执行架构；`planSchema.MAX_REPLAN=2` 与 `plannerPolicy.js:22`/AGENTS.md 声称 ≤1 的文档-代码矛盾（审计 3.5，需在收敛时一并修正文档口径）。

**需要新增或修改的准确文件**：
- `server/src/services/ai/toolRegistry.js`（buildPlanForIntent 改从 manifest 派生；legacy 分支删除）— M6-T1（热点独占）
- `server/src/services/ai/capabilityRouter.js`（正则权重降级为 Manifest 派生的兜底层）— M6-T2
- `server/src/services/ai/agentKernel.js` + `runtime/plannerCoordinator.js`（useToolChain 旧链移除，单一协调路径；业务恢复逻辑下放 skill 定义）— M6-T3
- `server/src/services/ai/durable/`（新增 `taskStore.js` / `waitForEvent.js` / `resume.js`）+ `server/src/routes/ai.js` resume 端点 — M6-T4
- `tools/test-agent-tool-plan-manifest.js`、`tools/test-agent-durable-execution.js`（新增）— 随各任务
- 文档口径修正（MAX_REPLAN 矛盾）— M6-T3 附属

**明确禁止修改**：manifest 生成链 CI 守卫本身、知识库控制面 API、providers、阶段 4/5 冻结面、`miniprogram/**`（本里程碑纯服务端）。

**对外接口和数据结构**：durable task `{ taskId, kind:"reminder"|"approval"|"receipt_wait", status:"pending"|"waiting"|"resumed"|"done"|"expired", waitEvent, resumeToken, expiresAt }`；resume 端点鉴权沿用会话 Principal。

**实施任务拆分**：T1→T2→T3→T4 全串行（全是热点），每个任务定向测试 + 主 Agent 集成收尾。
**里程碑集成测试**：全量五门禁（关键架构里程碑，按纪律第 4 条）+ `npm run test:agent-phase2`。
**验收标准**：grep 证明映射单源；五门禁全绿；durable 任务跨进程重启可 resume（测试模拟）；MAX_REPLAN 文档与代码一致。
**回滚方法**：`git revert` M6 各 commit；durable 表为新增存储，回滚前导出或弃置（无既有数据）。
**建议 commit**：`refactor(agent): single-source tool planning and lightweight durable execution (M6)`。
**是否允许并行**：否。
**并行文件重叠**：不适用。

---

### M7 — 集成测试、文档收敛、预发交付

**目标**：首次运行 `test:agent-release-gate`；全量五门禁终验；文档收敛（交接文档刷新为完成报告、迁移计划标注状态、过期审计快照清理）；敏感信息终扫；分级交付报告。
**非目标**：不 push、不 PR、不 merge、不部署、不上传体验版（等用户明确指令）。

**前置依赖**：M0–M6 全部验收。

**需要新增或修改的准确文件**：
- `docs/xiaofu-agent/agent-platform-implementation-handoff.md`（刷新为最终交接）
- `docs/xiaofu-agent/agent-platform-migration-plan.md`（各里程碑状态标注）
- 审计 §6.1 所列 6 篇过期审计快照（删除，**需 M7 届时二次授权**：先列拟删除清单、删除理由、替代文档和 Git 可恢复方式，用户再次明确批准后执行）
- `AGENTS.md`（仅当 M1–M6 改动了其中所述约定时才更新，如 MAX_REPLAN 口径）
- `output/agent-platform-final-delivery.md`（交付报告：实际运行命令、通过数、失败原因、未验证项、回滚路径、验证分级）

**里程碑集成测试**：`npm run test:agent-release-gate`（首跑；历史存量问题按 A/B/C/D 分类，不归咎当前分支，不为变绿弱化门禁）+ 全量五门禁。
**验收标准**：release-gate 绿或失败项按 M0 四类分类处置完毕；敏感扫描零命中；交付报告齐全。
**回滚方法**：逐里程碑 revert 路径汇总进交付报告。
**建议 commit**：`docs(agent): finalize platform migration delivery report and closeout (M7)`。
**是否允许并行**：否。

---

## 5. 推荐执行顺序

**M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7**，依赖依据：

1. **M2 必须先于 M4**：共享热点 `runtime/verificationCoordinator.js`（M2 接线 / M4 对齐 pendingClarification）与 `runtime/goalContractResolver.js`（M2 核验读 goalContract / M4 迁追问逻辑），串行避免互踩。
2. **M5 依赖 M2**：客户端要消费 `verification.started/completed` 新事件与映射；依赖 M3：Agent 搜索结果形态统一后卡片/标签才稳定。
3. **M6 排最后**：拆 `useToolChain` 旧链、收 toolRegistry 的前提是 M3（搜索工具改消费）与 M4（legacy follow-up 退役）已把消费者迁净。
4. **M3 与 M4 内容独立但共享 `toolRegistry.js`**（M3-T3 搜索切换 / M4-T2 legacy 退役）→ 两里程碑整体串行；唯一批准并行窗口：**M3-T1（搜索契约生成器）∥ M4-T1（followUpResolver 唯一实现）**，文件零重叠，其余任务仍按里程碑边界串行——即并行窗口不改变"M3 验收后才进 M4 后续任务"的主线。窗口约束（批准决定第 7 条）：两任务文件完全不重叠、各自独立 coder、不得派生子 coder、不得提前进入后续任务、完成后主 Agent 串行审查测试集成。
5. **M0 不做任何修复**；M1 只允许"测试 + 缺陷独立修复"，保证阶段 4 冻结面之后 M2 有稳定地基。

---

## 6. 热点文件与冲突风险表

| 文件 | 涉及里程碑 | 风险 | 管控 |
|---|---|---|---|
| `package.json` | M1–M6 均加脚本 | 每里程碑必触 | **主 Agent 独占串行改**，禁止 coder 写 |
| `tools/run-agent-foundation-tests.js` | M1、M3（check 守卫）、M5 | 套件接线冲突 | 主 Agent 独占 |
| `tools/run-agent-phase3-tests.js` | M2、M5 | 同上 | 主 Agent 独占 |
| `server/src/services/ai/runEventCatalog.js` | M2 加事件 → M5 作生成源 | 事件语义被生成器固化后难改 | M2 主 Agent 审 diff；M5 只读消费 |
| `miniprogram/services/agentActivityState.js` | M2 映射 → M5 十态 | 两里程碑交叉 | 串行，M5 以 M2 映射为输入 |
| `server/src/services/ai/toolRegistry.js` | M3-T3 / M4-T2 / M6-T1 | 最高危共享文件 | 三个里程碑严格串行，各自独占一个原子任务，禁止并行 |
| `server/src/services/ai/runtime/verificationCoordinator.js` | M2 接线 / M4 对齐 | 交叉 | M2 验收后才进 M4 |
| `server/src/services/ai/runtime/goalContractResolver.js` | M2 读 / M4 迁 | 交叉 | 同上 |
| `server/src/routes/fosu.js` | 仅 M3 | 低 | — |
| `miniprogram/pages/school/school.js` | 仅 M3 | 中（大文件删逻辑） | 单 coder 单任务 + 兜底保留 |
| `miniprogram/services/aiAssistantService.js` | M5（阶段 1 已改过） | 中 | 单任务 + runs 开关可回滚 |
| `server/src/services/ai/providerChainService.js` / `providerConfigService.js` | M1 后冻结 | M2+ 不得再碰 | 冻结面写进各里程碑禁止清单 |
| `server/config/agent-capability-manifest.json` | 全期只读（除非加载校验报错） | 改错→启动失败 | 任何触碰后必须重跑 manifest load smoke |

---

## 7. 状态跟踪

| 里程碑 | 状态 | 证据 |
|---|---|---|
| M0 | ✅ 完成（064de232） | `output/agent-platform-m0-baseline.md`，五门禁全绿 |
| M1 | ✅ 完成（c6c2b301） | `output/agent-platform-m1-progress.md`，`tools/test-provider-control-plane.js` 11/11 PASS，已接入 foundation 套件；未发现真实缺陷，M1-T3 跳过 |
| M2 | ✅ 完成（cdf1b276） | `output/agent-platform-m2-progress.md`；toolResultVerifier + departureChainVerifier 落盘并接线；`test-agent-verification` 6 组 + `test-agent-departure-chain-verification` 9 组全绿，均接入 phase3 套件；phase3 26 文件 / foundation 32/32 / final-convergence 全绿；`runEventCatalog.js` diff 主 Agent 已审（纯追加）。遗留：`get_course_route` manifest `emptyResultPolicy.codes` 缺口冻结留 M3 裁定 |
| M3 | ✅ 代码与测试完成（待 commit，需用户确认） | `output/agent-platform-m3-progress.md`；school-search 契约单源生成链 + 服务端统一 service + `/release-pack/search` 路由 + Agent 工具同源 + 客户端切换（离线 local-fallback 真实降级标识）+ URL 单实现 + classroomSearch 单源；`test-search-contract-unified` 15 组全绿并入 unified-chain/foundation 守卫；unified-chain 全绿、foundation 33/33。遗留：11 个 school/cache 链测试基线红（HEAD 对照确认非本分支引入，留 M7 分类）；request.js GET dedupe 竞态隐患（搜索链已规避，其余未动）；M2 遗留 `get_course_route` manifest `emptyResultPolicy.codes` 缺口待本里程碑后由 manifest 负责方裁定 |
| M4–M7 | 未开始（M4-T1 已在并行窗口完成：followUpResolver V2 唯一实现 + 10 组测试绿，调用点退役待 M4-T2） | `output/agent-platform-m4-progress.md` |
