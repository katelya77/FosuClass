# 校园智序 · 小序 — 当前 ADP 检查点

更新时间：2026-08-19 +08:00（R50.2B 收尾）

当前阶段：`CampusFlow ADP R50.2B / Unified Native Widget + Console Cutover Bundle`（PR #49 保持 OPEN / UNMERGED、**本轮不部署 CloudBase**；真实 Tencent ADP Widget 导出集成待后续正式导出后执行，见下方 R50.2B 节）

## R50.2B 状态（收尾，2026-08-19）

- **范围**：统一原生结果卡 `campus-result-unified-v1`（Schedule / Risk / Insight 三域 Envelope 投影）+ 控制台一次性切换包（`console-bundle`）+ 12 家族验收矩阵 + Prompt 输出策略 §5（fast-track 8 任务全部完成；PR #49 保持 OPEN / UNMERGED，**本轮不部署 CloudBase**）。
- **Envelope（T1~T3）**：`r50.2/widget/` 提供 `campus-result-envelope.schema.json`（v1）+ `envelope.js`（11 公开字段：version / variant / status / title / subtitle / verified / summary / context / sections / actions / displayMeta）+ `tool-variant-map.json`（13 工具→8 变体）+ `variant-adapters.js`（10 fixtures）+ `action-builder.js`（仅官方 sys.chat，payload 只含用户语义 query）；focused 门禁 **30/30 PASS**。
- **Native widget 契约（T4）**：`widget/native/campus-result-unified-v1/`（contract.json 契约 `fosuclass-adp-widget-contract/v4`、kind `campus-result-unified`、widgetId=null + `FAIL_CLOSED_REAL_TENCENT_EXPORT_ONLY`、10 样例、adapter.py 投影式 fail-closed 适配器：泄漏 envelope → route=fallback）；`test-r50-2b-widget-contract.js` **10/10 PASS**（含 python 运行时冒烟）。
- **Prompt（T5）**：`shared/output-policy.md` 增 §5 统一结果卡（11 项白名单 / sys.chat-only / empty·error·simulated 标记）；schedule-space / risk-planning / campus-insight 各 +1 输出边界；重编译 → `r50.2/prompts/*.final.md` 与编译产物字节一致；`r50.2/prompt-candidate-gate.js` 基线 **PASS**（候选模式 SKIP，无候选）；`prompt-candidates/README.md` 候选纪律。`r50.1/prompts` Paste Pack 同步刷新（P9 门禁 9/9 PASS，遵循 R50.2A `2e3eed3` 先例）。
- **控制台切换包（T6）**：`r50.2/console-bundle/`（prompts 4 份 + widget 资产 6 份 + 单会话清单）+ `R50.2B-ADP-BATCH-CUTOVER.md`（预检 / 10 步切换表 / 可选 AI 优化 / 回滚 / 发布纪律）。
- **验收矩阵（T7）**：`r50.2/R50.2B-CONSOLE-ACCEPTANCE-MATRIX.md` 12 家族 + `test-r50-2b-acceptance-matrix.js` **4/4 PASS**（12 行完整性 / variant 合法+全覆盖 / 13 工具可产出 / 家族 12 sys.chat+Main-first）。
- **回归（T8）**：R50.2A 兼容 **116/116**、聚焦 R50.2B **30/30**、widget 契约 **10/10**、验收矩阵 **4/4**、runtime-e2e PASS（6 fixtures + 6 真实 WidgetID + risk route 03）、compiler --check **4 files**、manifest 重生成 **281 files**（新增 15 个 unified-widget 资产；同步排除 `__pycache__` 生成物）。**遗留门禁（真实导出依赖，非失败）**：`audit-widget-contract.js` 需真实 `<file.widget>`、`test-native-import-preview-contract.js` 期望 6 个 `.widget` 文件——统一卡按契约不伪造导出，未注册入 `widget-registry.json` / `native-widget-import-bundle-manifest.json`（真实 Tencent 导出后补齐）。
- **提交（1 commit，HEAD 见最终报告）**：`feat(adp): R50.2B unified native widget + console cutover bundle`（T1~T8 全部内容 + `2026-08-19-r50.2b-final-report.md`）。
- **判定**：`R50.2B REPO GOLDEN`（repo 全绿；唯一未执行项为真实 Tencent `.widget` 导出门禁，属 pending-export 而非失败）；**Console GOLDEN 未宣称**——待用户按 `R50.2B-ADP-BATCH-CUTOVER.md` 执行 10 步切换 + 12 家族验收（D1~D6 真机沿用 R50.1 模板）。
- **待办（用户动作）**：执行 Batch Cutover（console-bundle 粘贴 + 验收矩阵勾选）；后续导出真实 Tencent ADP Widget 后补齐 `.widget` 门禁与注册表。

## R50.2A 状态（收尾，2026-08-19）

- **范围**：Interaction Semantics（可选房间参数归一化）+ Prompt Hardening（四 Agent Prompt 瘦身/去实现细节）+ 协议冒烟 vs 产品 E2E 分层（PR #49 保持 OPEN / UNMERGED，**本轮不部署 CloudBase**）。
- **交互语义**：`r49-ma/tools/adapter/adapter.js` 新增 `normalizeAgentToolInput` / `normalizeOptionalBySchema` / `OMIT` / `isSemanticallyEmpty`——按 schema 可选性把 `null`/空白串/`[]`/`{}` 归一为缺省；必填值与合法数值不得抹除。调课不带目标教室时不再触发假教室查询、不再强制教室澄清。RED→GREEN：RED 7 失败（`test-r50-2-optional-normalization.js` 首批）→ GREEN 50/50。
- **Intent 族**：`shared/intent-policy.md` 定义 5 个目标族（BROWSE_LIST / SEARCH_ENTITY / AVAILABILITY_DISCOVERY / GROUP_PLANNING / RESCHEDULE_SIMULATION）与 Main→Schedule/Risk 路由规则；39/39 语义门禁 PASS。
- **Prompt 硬化（T4）**：shared 7 策略去除 TS 块与实现模块名（temporal-core.js / ranking-core.js / query_entity_search）；core-safety 增「澄清仅限必填语义」边界；output-policy 增「可汇总已验证工具结果数字、禁止发明新动态事实」；四 Agent 域 Prompt 重写为 角色与边界 / 工具绑定 / 目标→工具 / 澄清与失败 / 输出边界 / 高级设置 六段。主 Prompt 尺寸：main-orchestrator 4134→3862、schedule-space 2158→2107、risk-planning 2042→2139、campus-insight 1984→2016（字符）。R50-P1..P10 / R51-P1..P9 / R50.2A-P1..P5 全部保留。
- **快照（T5）**：`r50.2/prompts/*.final.md` 4 份与编译器导出逐字节一致（main-orchestrator 21204 B / schedule-space 18776 B / risk-planning 19003 B / campus-insight 18657 B），快照相等契约入 `test-r50-2-interaction-semantics.js`（6/6 PASS）。
- **E2E 分层（T7）**：`test-r50-1-e2e-matrix.js` 重设计——H1 `[protocol-smoke]`（固定 fixture lesson）与 H2 `[product-e2e]`（动态 `campus_entity_search` → `campus_schedule_query` → `items[0].lessonId` → 无教室调课，断言不发明教室、无写入动作）；15/15 PASS；矩阵文档同步分层说明。
- **AI 一键优化纪律（T6）**：`r50.2/R50.2A-ADP-AI-PROMPT-OPTIMIZATION-GUIDE.md`——平台生成文案只作候选，逐 Agent diff 语义不变量后选择性合并，一次一个 Agent。
- **全量回归 = 全绿**：r49-ma **295/295**（274 基线 + R50.2A 21）；聚焦 9 文件 **88/88**；adp-kit `npm test` 全链 PASS（mcp 52/52 + check + typecheck + check:openapi 14 工具、golden 33/33 v1 sha1:fefef4bf425b、widget/r4/r5、cloudfunctions test-http），**唯一基线失败 = `sync-assets-manifest --check`**（改动前已存在；本轮提交不含 manifest/submission-package，证据保留）；compiler --check **4 files**；root 四门禁 test:agent-foundation **42/42**、test:agent-regression **197/197**（首跑 `test-agent-memory-autonomy.js` 环境性失败 → 单独重跑 PASS 28 cases + 全量重跑 PASS，判定 transient 非代码问题）、test:ai-competition PASS、test:agent-final-convergence all passed；`git diff --check` 干净。
- **提交（8 commits，HEAD 见报告）**：2b55ef0（T1 gate+矩阵）、fad1b60（T2 归一化 RED→GREEN）、06790a1（T3 intent 族）、2e3eed3（T4 prompt 硬化，+376/−667）、4992604（T5 快照）、aa97e92（T6 优化纪律指南）、b82330c（T7 协议冒烟 vs 产品 E2E）、T8 收尾提交（检查点 + 最终报告）。
- **判定**：`R50.2A REPO GOLDEN`（repo 全绿，唯一失败项为已分类 B 类基线）；**Console GOLDEN 未宣称**——待用户按 `r50.2/R50.2A-ADP-AI-PROMPT-OPTIMIZATION-GUIDE.md` 流程粘贴基线并逐 Agent 评估候选。
- **待办（用户动作）**：按指南做 Console 基线粘贴 + AI 一键优化候选评估（一次一个 Agent）；D1~D6 真机验收沿用 R50.1 模板。

## R50.1.2 状态（收尾，2026-08-18）

- **范围**：Control-Plane SSOT Closure —— R50.1.1 已修 CUTOVER/ACCEPTANCE/契约测试，但 ChatGPT 独立审计发现 `generate-tool-visibility.js` 手工 BINDINGS 与 `R50.1-TOOL-MODEL-VISIBILITY.md` 仍含 pre-fix 旧绑定（entity_search→课程空间+洞察、academic_context→Main、common_free_time→课程空间+洞察、reschedule_feasibility→课程空间）。Runtime / Prompt / CampusTools 算法无问题，纯控制面文档/生成器漂移。
- **SSOT 建立**：`r50.1/agent-tool-bindings.json`（`version=R50.1.2`；13 unique / 14 bindings；agents.main=[]、schedule 7、risk 4、insight 3；sharedTools={campus_academic_context:[schedule,risk]}）。绑定关系不再在 Markdown/JS 中硬编码。
- **生成器重写**：`r50.1/generate-tool-visibility.js` 删除手工 `BINDINGS`，从 SSOT 派生绑定列（`bindingsOf`），参数 required/optional/console-only 仍以 OpenAPI 为真源、baseDate 仍 console-only、Direct Result 全 OFF；新增 `--check` 幂等模式。
- **Visibility 文档已重新生成**：6 行绑定 = entity_search→课程空间（Schedule）／academic_context→课程空间（Schedule）＋风险规划（Risk）／common_free_time→课程空间（Schedule）／room_utilization→校园洞察（Insight）／reschedule_feasibility→风险规划（Risk）／group_plan→课程空间（Schedule），含 13/14 + 唯一共享 + Main 不绑定陈述；禁止出现的旧错误组合已全部消失。
- **RED→GREEN**：probe（`git show 8170049` 旧文档+旧生成器只读）＝ **PRE-FIX FAIL**（4 工具绑定错误 + 生成器含手工 BINDINGS + 未读 SSOT）／ **POST-FIX PASS**（6 工具全对，含 room_utilization/group_plan 正确项）。
- **R50.1.2 契约门 = 12/12 PASS**：`test-r50-1-2-control-plane-ssot.js`（A SSOT 13/14 自洽、B Main=0、C Schedule 7、D Risk 4、E Insight 3、F academic_context 唯一跨域共享、G 其余不重复、H CUTOVER=SSOT、I ACCEPTANCE=SSOT、J Visibility=SSOT、K 生成器 --check 幂等、L OpenAPI adp-import 13 ops=SSOT unique set；解析真实 tool set，非关键词匹配）。
- **全量回归 = 全绿**：r49-ma **274/274**（262 基线 + R50.1.1 3 + R50.1.2 12）；mcp **52/52 + check + typecheck + check:openapi（14 工具）**；golden **33/33**（v1、sha1:fefef4bf425b、verified=100%）；compiler --check **4 files**；sync --check **11 files**；test-http **PASS**；`git diff --check` 干净。
- **CI**：PR #49 @ 8170049 = **5/5 SUCCESS**（Xiaofu Agent CI / Competition ADP Widget CI / Public Security Gate ×2 / Admin CI）；push 后对新 HEAD 重跑。
- **最终报告**：`r50.1/2026-08-18-r50.1.2-final-report.md`（RED/GREEN 证据 + SSOT 表 + 12 契约 + 验证矩阵）。
- **判定**：**`R50.1.2 CONTROL-PLANE GOLDEN`**（repo + CI 全绿）；**Console GOLDEN 未宣布**——待用户按 `r50.1/R50.1-CONSOLE-ACCEPTANCE.md` 执行 D1~D6（Agent Cutover 按规范绑定表 + 4 个 final Prompt 粘贴）。
- **待办（用户动作）**：D1~D6 真机验收；R50.2（Widget 等）未启动。


## R50.1.1 状态（收尾，2026-08-18）

- **范围**：修复 R50.1-ADP-CONSOLE-CUTOVER §3 绑定表漂移（根因 A：Prompt/测试从未错，文档手工表错：Schedule 缺 academic_context、错含 reschedule_feasibility；Risk 错含 schedule_query/entity_search；假声明「每个 Agent Tool 恰好出现一次」）+ contracts.ts 类型契约滞后（根因 B：v1|v2 不含 v3）。修复仅动控制面文档 + 类型契约 + 锁契约测试，不触碰 runtime。
- **HEAD Semantics**：`implementationBase=19da961`／`initialHead=verificationHead=d462031`（fast-forward，与 ChatGPT 确认 HEAD 一致）／`reportCommit=intentionally omitted / self-referential`。
- **规范绑定表（13 unique / 14 bindings）**：Main=0（仅 KnowledgeRetrievalAnswer + Agent 转移）；Schedule 7 = schedule_query / schedule_range_query / classroom_search / entity_search / academic_context / common_free_time_query / group_plan；Risk 4 = risk_check / day_plan / academic_context / reschedule_feasibility；Insight 3 = overview / teacher_load_query / room_utilization_query。`campus_academic_context` 为唯一合法跨域共享（Schedule+Risk），无其它跨域重复。
- **RED→GREEN 证据**：PRE-FIX（`git show 19da961` 只读快照 + 复用正式测试解析逻辑的 probe）= **FAIL**（Schedule 行漂移 + 假唯一性声明 + 缺 14 绑定陈述）；POST-FIX（HEAD）= **PASS**。
- **R50.1.1 回归门 = 3/3 PASS**：`test-r50-1-1-console-contract-consistency.js`（CUTOVER + ACCEPTANCE 绑定表 = 规范映射，顺序敏感）。
- **v3 类型契约**：`contracts.ts` `CompetitionDataVersion = v1|v2|v3`、`DATA_VERSIONS=[v1,v2,v3]`、`DATA_VERSION` 默认保持 `competition-demo-v1`（runtime 由 `loadDataset()` meta.dataVersion 决定）；`test/data-version-contract.test.js` 纳入 mcp `npm test` 门（52/52）。
- **全量回归 = 全绿（262/262 修正后）**：r49-ma 全套 **262/262**（首跑 261/262 —— ChatGPT 9f7738f 引入真实回归：`test-version-contract.js` 仍断言 v1|v2 → 本轮修复为 v1/v2/v3 联合断言，重跑全绿）；mcp **52/52 + check（tsc 无错）+ check:openapi（14 工具）**；golden **33/33**（v1、sha1:fefef4bf425b、verified=100%）；sync --check **11 files**；test-http **PASS**；compiler --check **4 files**；顶层 `npm test --prefix adp-kit` 全链 PASS，唯一基线失败 = `sync-assets-manifest --check`（B 类 pre-existing：manifest 自 R49 未同步，19da961..HEAD 对 manifest/submission-package 零改动；证据保留不静默吞）。
- **submission-package 审计**：生成器 `build-submission-package.js` 已运行（build 57 files PASS + validate findings=0 + SHA256SUMS 自洽），产物 diff（+2054 行）全部为 R49/R50 时代 pre-existing 快照漂移（`git diff 19da961..HEAD -- submission-package` = 空），已 `git checkout` 还原；评审包锚定 v1，v3 类型声明不改变评审包行为，R50.1.1 无需进包。
- **4 个 final Prompt 未修改**：`git diff 19da961..HEAD -- r50.1/prompts` = 空；`r50.1/` 目录仅 CUTOVER + ACCEPTANCE 两文档变更。
- **CI（PR #49 @ d462031）= 5/5 SUCCESS**：Xiaofu Agent CI（agent-release-gate）、Competition ADP Widget CI（widget-contract）、Public Security Gate ×2、Admin CI（admin-checks）；push 后对新 HEAD 重跑。
- **最终报告**：`r50.1/2026-08-18-r50.1.1-final-report.md`（§3 规范绑定表 + RED/GREEN 证据 + B 类基线分类 + HEAD 语义）。
- **判定**：`R50.1.1 REPO GOLDEN`（repo + CI 全绿，唯一失败项为已分类 B 类基线）；**Console GOLDEN 未宣布**——待用户按 `r50.1/R50.1-CONSOLE-ACCEPTANCE.md` 执行 D1~D6（Agent Cutover 按规范绑定表 + 4 个 final Prompt 粘贴）。
- **待办（用户动作）**：D1~D6 真机验收；R50.2（Widget 等）未启动。


## R50.1 状态（本机收敛中，2026-08-18）

- **范围**：Agent Prompt Convergence + 13-Tool ADP Console Cutover + Generic E2E（PR #49 保持 OPEN / UNMERGED；**本轮不部署 CloudBase**）。
- **§1.3 HEAD Semantics**：`implementationHead=9db8447`（T3~T7 代码实现）／`currentBranchHead=38dfee5`／`reportCommit=38dfee5`（R50.1 收尾提交 0fdb2f0 / 97aa086 / 38dfee5 后回填）。
- **Prompt 收敛门禁 = 19/19 PASS**：`test-r50-prompt-architecture.js` P1~P10 + `test-r50-1-prompt-convergence.js` R51-P1~P9（branding 统一 校园智序·小序、去案例化第二轮、model= 硬编码删除并冻结 DeepSeek V4 Flash 为 Console Baseline、Paste Pack 纯净度、final.md 与编译器导出字节一致）。
- **Generic E2E Matrix = 14/14 PASS**：`test-r50-1-e2e-matrix.js`（A 实体搜索 / B Temporal Context / C 课表 / D 空教室 / E 共同空闲 / F 群体计划 / G 风险 / H 调课模拟 / I 排名 / J 跨域组合 / K-L Context Model），V3 数据动态发现实体，表驱动 + 语义断言。
- **R50 全测试组 = 55/55 PASS**（P/R51/E2E/R50-1~6/CTX-01~07/ADP smoke 8）。
- **Paste Pack（Prompt 部分）已生成**：`competition/adp-kit/r50.1/prompts/*.final.md`（main-orchestrator / schedule-space / risk-planning / campus-insight，编译器 `--export-final` 导出，与 `--print-final` 字节一致；长度 11377/9920/9778/9949）。
- **Paste Pack 6 文档 + 参数可见性表已生成**：`r50.1/`（CUTOVER / E2E-MATRIX / PROMPT-PASTE-GUIDE / RUNTIME-CONFIG / TOOL-MODEL-VISIBILITY（`generate-tool-visibility.js` 从 OpenAPI 真源幂等生成，baseDate=仅 Console）/ CONSOLE-ACCEPTANCE（D1~D6 真机证据表））。
- **全量回归 = 全绿**：r49-ma **259/259**、mcp **51/51 + check（tsc 无错）**、golden **33/33**（oracleSourceSha256 审计回填 `79bda318…`，classification A、semanticDrift=0）、sync --check **11 files**（已同步 data.js 注释）、test-http **PASS**、compiler --check **PASS**、`git diff --check` 干净。
- **最终报告**：`r50.1/2026-08-18-r50.1-final-report.md`（23 项核对清单；§1.3 HEAD 已回填）。
- **待办（用户动作）**：按 `r50.1/R50.1-CONSOLE-ACCEPTANCE.md` 执行控制台真机验收 D1~D6（工具 Cutover + 4 份 final Prompt 粘贴）。

## R50.0 状态（本轮，2026-08-18）

- **Coze agent T3~T7 已审计落地（5 commits，HEAD=9db8447）**：Semantic Core（temporal-core.js / ranking-core.js / context-model.js）、6 个新 CampusTools（TOOL_DEFS 15、Agent Tool Façade 13、`ADP_CONTRACT_VERSION=R50.0`）、competition-demo-v3 数据集（生成器/schema/validator）、OpenAPI 全量 13 ops + r50 delta 恰 6 ops（$ref 自包含、无凭据）、CloudBase V3 runtime cutover（index.js 默认 v3；sync 脚本 RUNTIME_FILES 8 + DATA_FILES v1/v2/v3）。**T8a/T8b/T8c/T9 已提交（HEAD=939c990，2026-08-18，用户授权 push，PR #49 保持 OPEN）**。
- **测试全绿**：r49-ma `node --test "tests/*.js"` = **236/236**（含 Coze 新增 test-temporal-core / test-ranking-core / test-context-model / test-r50-new-tools / test-dataset-quality + 本轮新增 test-r50-prompt-architecture 10 契约）；mcp `npm test` = **51/51**、`npm run check` 绿；`git diff --check` 干净；`sync-campusflow-function.js --check` = **11 文件一致 PASS**；`test-http-function.js` = **health 200 / 13 个 Agent Tool Façade / V3 runtime PASS**。
- **Golden 33/33 重审 = 分类 A（2026-08-18）**：oracleSourceSha256 更新为 `4cc58e0b…`（R50 合法源码变更），33/33 case 语义 0 漂移、dataVersion=competition-demo-v1 / sha1:fefef4bf425b 未变；`lastOracleReview={date:2026-08-18, classification:"A", semanticDrift:0, changedCases:[], datasetAnchor:"competition-demo-v1 / sha1:fefef4bf425b（未变）"}` 已写入；`eval-golden.js` 33/33 PASS。
- **T8a Prompt 架构（新交付）**：`r50/agents/shared/` 7 个 policy（core-safety / intent-policy / temporal-policy / entity-policy / context-policy / ranking-policy / output-policy）+ `r50/agents/` 4 个组合 Prompt（main-orchestrator / schedule-space / risk-planning / campus-insight，13 工具路由、去 Case 化、无比赛实体字面）+ `r50/build-agent-prompts.js` 编译器（确定性生成 `agents/compiled/*.compiled.md`，`--check` 漂移检测）。
- **T8b Prompt 一致性门禁（新交付）**：`r49-ma/tests/test-r50-prompt-architecture.js` 10/10（架构存在性、编译器确定性、shared 注入、13 工具绑定无越权、Temporal/排名/self-risk/fresh-tool-call 语义契约、去 Case 化、高级设置保留）。
- **T8c Console 升级手册（新交付）**：`r50/R50.0-ADP-CONSOLE-UPGRADE.md`（7→13 工具表、delta JSON 导入、新 6 工具单独验证清单、Agent 绑定映射、Direct Result 全 OFF、/health 三字段、V2/V3 状态、Prompt 暂不手工替换、回滚路径）。
- **CloudBase 部署：已完成并远程验证（2026-08-18，用户授权）**：`tcb fn deploy campusflowAdpTools --dir competition/adp-kit/cloudfunctions/campusflowAdpTools --httpFn --path /campusflow-adp-tools --force`（临时 cloudbaserc 追加条目后已还原；未写 envVariables，线上 token 等环境变量保持不变）。远程 `/health` 实测 = **目标值一致**：`status=ok / dataVersion=competition-demo-v3 / dataHash=sha1:842b7959e808 / tools=14 / agentTools=13 / adpContractVersion=R50.0`。**6 个新 façade remote smoke 全部 PASS**（真实 token 仅内存使用，未打印/落盘）：entity_search（5 教师）、academic_context（future_weeks → temporalContext）、common_free_time_query（2 教师共同空闲 8 窗口）、room_utilization_query（1..4 周 top3）、reschedule_feasibility（lesson-001 what-if）、group_plan（2 教师 + 容量 ≥60 → 8 候选），全部 success=true / verified=true / dataVersion=competition-demo-v3。
- **最终报告**：`r50/2026-08-18-r50.0-final-report.md`（27 项达标清单；2026-08-18 复核：HEAD 更新至 939c990、§8 补 #25「不改 Endpoint/Token」、全量验证重跑仍绿）。

## R49.4.1 状态（历史，2026-08-17）

- **仓库收敛 = READY**（TDD：`test-r49-4-1-prompt-consistency.js` 先红后绿）：4 份 Prompt（main-orchestrator / campus-insight / schedule-space / risk-planning）与 03-HANDOFF / 04-CONTEXT 策略、E2E 矩阵、fixtures、drilldown 测试全部对齐 **source-aware 语义**——教师负载排名真源 = `campus_teacher_load_query`；`rankContext.sourceTool` 如实记录（禁止写死 `campus_overview`）；`campus_overview` 仅承担固定窗口整体态势（不作为任意教师周窗口排名的替代来源）；多周窗口不是有效 risk week（未给周次 → Main 澄清，绝不静默 week=1）；D4 新会话单句链（teacher_load(1,1) → Top1 → schedule week=1）入矩阵与验收模板。
- **新增增量 OpenAPI**：`r49-ma/tools/openapi/campus-agent-tools.r49.4-existing-plugin-additions.json`（恰 2 operations，与全量 `campus-agent-tools.adp-import.json` 同 server、$ref 自包含、无明文凭据；派生一致性已入 `test-adp-import-openapi.js`）。
- **手动清单同步**：`R49-MA-ADP-MANUAL-CONFIG-CHECKLIST.md`（§1.2/§1.4 工具绑定补全、§4 现行 7 Façade 表 + delta 导入说明、§6 D4 与 Console Gate、§8.1 R49.4.1 重贴提示、§9 历史注记）。
- **测试**：r49-ma 全套 `node --test "tests/*.js"` = **171/171**（含新增 prompt-consistency 4 契约、drilldown source-aware 重写、import delta 4 契约）；`npm test --prefix competition/adp-kit` 全链其余步骤 PASS（golden 33/33、submission 54 文件 0 findings、widget CI、artifact 校验），**唯一基线失败**：末步 `sync-assets-manifest --check`（改动前已存在——用户快照提交 `7593322` 内的 submission-package/manifest 漂移；`git diff c0478c5..HEAD` 证明本轮 14 个改动文件不含 submission-package 与 generated-assets-manifest.json；跑套件后已 `git checkout` 逐字节还原 submission-package，`git status` 仅剩本轮 3 个预期文件）。
- **Console Acceptance 模板就绪**：`r49-ma/reports/2026-08-17-r49.4.1-console-acceptance.md`（路径 A 增量推荐 / 路径 B 全量兜底、禁止先删旧插件、D1~D5 证据表、Console Gate 判定、回滚路径）。
- **R49.4-GOLDEN 尚未宣布**：需用户控制台实测（插件 7 工具截图 + D1~D5 真实工具调用证据），仓库侧不代跑、不伪造 console PASS。

## 真实 ADP / Runtime 状态（2026-08-17 实测）

- 仓库分支：`feat/campusflow-adp-integration`；**R49.3 patch 前 HEAD = `7208a5e`**；PR #49 保持 `OPEN / UNMERGED`（禁止 merge）。
- CloudBase HTTP Function `/health`（只读 GET，2026-08-17，R49.4 部署后实测）：`status=ok`、`dataVersion=competition-demo-v2`、`dataHash=sha1:4f3bbbb45d1f`、`tools=9`、`agentTools=7`、`adpContractVersion=R49.4`（R49.4.1 不重部署）。
- 鉴权验证：假 Bearer token POST `/api/campus_risk_check` → 401（token 模式仍在；环境变量未因部署被覆盖）。
- ADP 契约：`r49-ma/tools/openapi/campus-agent-tools.adp-import.json`（R49.4，7 operations）；增量升级用 `campus-agent-tools.r49.4-existing-plugin-additions.json`（R49.4.1，2 operations）。
- Widget / Workflow：01～04 R3 与 05 状态沿用 2026-08-14 记录（`TENCENT_WORKFLOW_DEBUG_PASS`；05 等待平台恢复后收口）。
- 平台事件（历史）：2026-08-14 `10013 add vectors failed` 仍记录于 `2026-08-14-adp-workflow-vector-service-incident.md`；与后续修复相互独立。

## R49.2 修复内容（2026-08-17）

- 根因（A 类，非部署漂移）：ADP 平台把缺失的可选整数参数归一化为 0；旧版只处理 `weekday=0`，
  `periodStart=0 / periodEnd=0` 被当作真实节次约束 `[0,0]`，把全部课程过滤成空结果。
  → `campus_risk_check(self, T09, week1)` 曾与 `campus_overview` 冲突事实不一致（本地与 CloudBase 均复现）。
- 修复：`cloudfunctions/campusflowAdpTools` 与 `mcp/campus-tools-mcp` 两处 `src/tools.js`（字节一致）
  对 `weekday / periodStart / periodEnd = 0` 一律视为未指定；`findAvailableClassrooms` 缺节次范围保持
  INVALID_PARAM fail-closed；`preferredStudyDuration=0` 校验不删除。
- 版本：`adpContractVersion` R49.1.1 → **R49.2**（agent-tools ×2、server ×2、测试期望同步）。
- 新增测试：`r49-ma/tests/test-semantic-consistency.js`（12 项语义 + ADP 0 值回归 + compare_schedules 直调，15/15 通过）。
- 证据：修复前 ADP 全 0 载荷 → conflictCount=0（EMPTY_RESULT）；修复后同载荷 → conflictCount=1
  （lesson-018 vs lesson-051 @2026-09-02 周三 5-6 节）、rushWarningCount=1（lesson-051→lesson-052，20 分钟）。
  schedule 同型掩码同步修复（T09 week1 weekday5 带 0 值 → 现正确返回 lesson-015）。

## 验证结论（2026-08-17）

- 本地 Runtime 15/15 语义用例全绿；导出包凭据审计通过（见 `2026-08-17-campus-tools-adp-plugin-export-audit.md`）。
- **部署决定：已完成**。2026-08-17 用户授权后，用本机已登录的 tcb CLI 3.5.6 将 `campusflowAdpTools`（cloudfunctions 目录，HTTP 函数）部署到环境 `cloud1-d3g17rpe7566d3d5c`：
  `tcb fn deploy campusflowAdpTools --dir competition/adp-kit/cloudfunctions/campusflowAdpTools --httpFn --path /campusflow-adp-tools --force`
  （临时在根 cloudbaserc.json 追加函数条目以跳过交互；未写 envVariables，线上 CAMPUS_API_TOKEN 等环境变量保持不变；部署后已还原 cloudbaserc.json）。
  部署后 `/health` 实测 `adpContractVersion=R49.2`，随后进入控制台验收。

## G0 / G1 Gate 状态（R49.2 / G1.1 Hardening，2026-08-17）

- **R49.2-G0 = PASS**：`/health` 实测 `adpContractVersion=R49.2`（R49.2 部署后）；risk 0-mask 载荷 → conflictCount=1（T09 真机）✅；schedule 0-mask 载荷 → lesson-015（T09 w1 wd5 真机）✅。
- **G1 Gate 表（硬回归 A~H + 13 core case 预跑状态）**：

| # | Gate | 状态 | 备注 |
|---|---|---|---|
| 1 | Schedule 基础查询（CASE A/H） | ✅ PASS | T09 整周/单日/换周均走工具 |
| 2 | Schedule FOLLOW_UP 语义 | ✅ PASS | 第 3 轮从 risk 切回 schedule，weekday=3 重调工具 |
| 3 | Fresh tool recall（新 Turn 改 slot 必须重调） | ⚠️ NEED HARDENING | 本轮（R49.2.1）在三个域 Agent prompt 落 fresh-tool-call 铁律 + 契约测试 |
| 4 | Classroom 校区规范名（校区A） | ✅ PASS | 9 间教室，节次/容量过滤正确 |
| 5 | Campus alias（A校区 / A / campus-a） | ❌ FAIL → 本轮修复 | 真机 `campus="A"` 曾 ENTITY_NOT_FOUND；R49.2.1 `resolveCampus` 已修复，待部署复验 |
| 6 | Risk SELF（CASE B/D 第 3 轮） | ✅ PASS | self 不要求第二对象 |
| 7 | Risk COMPARE（CASE E） | ✅ PASS | 仅显式双对象才 compare |
| 8 | DayPlan date-only（CASE C 第 1 轮） | ✅ PASS | date 必填路径正常 |
| 9 | DayPlan 下一天（CASE C 第 2/3 轮） | ✅ 行为 PASS（evidence 待补截屏） | 09-04→09-05→09-06 推进成功；补证 fresh campus_day_plan(date=…) 逐轮调用 |
| 10 | Insight busiest campus（core #4） | ✅ PASS | 单域 overview，不下钻个人 schedule |
| 11 | Insight teacher Top3 / Top1（CASE D 第 1 轮） | ✅ PASS（并列说明正确） | Top1=teacherLoadTop[0] 真实值（当前=教师009，不写死）；并列 tie 语义修复在 R49.3（position 语义） |
| 12 | Insight overall risk | ✅ PASS | 全局风险数字确定性返回 |

- **G1.1（R49.2.1）交付 = PASS**：校区别名确定性解析（resolveCampus）；classroom 0-mask（resolveTimeRange 读 input）；CASE D 教师 Top1 链；fresh-tool-call 铁律；控制台事实同步；R49.2.1 已部署并经 /health 与远程功能复测验证（详见上节证据）。

## G2-PREFLIGHT 状态（2026-08-17）→ **PASS（已全部收口）**

- **Widget CI stale validator = FIXED**：`validateKnowledge()` 改以 `knowledge/taxonomy.json` 为真源（动态 expectedKnowledgeFiles、文件名无重复、声明文件必须存在、knowledge/ 下 NN-*.md 与 taxonomy EXACT MATCH、内容结构校验保留）；08 标题结构整理对齐 REQUIRED_KNOWLEDGE_SECTIONS（语义事实未变、未写死动态校园事实）；顺带修复潜伏 stale 断言（application-config data_version v1→v2，R49 起已为 v2）。本地 Widget CI 等价链 4 步全绿；**GitHub Actions widget-contract 已转绿（PASS）**。
- **Golden source hash review = FIXED**：33/33 Golden cases 重跑，结构化 diff 结论 = **分类 A**（仅 source hash 改变、语义输出全部一致、0 个 changed case、数据集锚点 competition-demo-v1 / sha1:fefef4bf425b 未变）；`oracleSourceSha256` 已按审计流程更新并写入 `lastOracleReview` 审计字段；`eval-golden.js` 33/33 PASS。
- **CASE B deterministic stale escape design = FIXED**：compare intent（比较T09和另一位老师第1周风险）→ 缺第二对象 NEED_CLARIFICATION（Main 唯一澄清出口）→ 用户不回第二对象直接问空教室 → Main 判定 NEW_TASK、staleContextEscaped=true、drop second_entity_pending/comparisonMode/risk_local_state → campus_classroom_search（含 A校区 别名 R49.2.1 解析）。矩阵 + fixture + CHECKLIST 已同步，fixture consistency 8/8 PASS。
- **G2 人工验收模板 = READY**：`r49-ma/reports/2026-08-17-g2-multi-agent-console-run.md`（17 列记录表 + 检查要点 + 结论区）。

## G2 真人控制台测试结果（2026-08-17 用户实测，只记录真实现象）

- **CASE A = PASS**：T09第1周整周课表 → 检查他的风险 → 那看看他周三的课；schedule → risk(self) → schedule fresh tool recall 正常；T09 week1: conflictCount=1、rushWarningCount=1。
- **CASE B = PASS**：risk compare 澄清态（Main 澄清第二对象）→ 用户不回答 → 「A校区2026-09-03第5-6节有哪些60人以上空教室」；Main 识别 NEW_TASK，stale risk compare state escape → 课程空间 → campus_classroom_search。
- **CASE C = behavior PASS / evidence 待补截屏**：2026-09-04 → 下一天 2026-09-05 → 再下一天 2026-09-06 日期推进成功，保留 fresh campus_day_plan 铁律；需补证：逐轮必须观察到 fresh `campus_day_plan(date=2026-09-05)` / `campus_day_plan(date=2026-09-06)` 调用（不能仅凭历史文本作答）。
- **CASE D = FAIL / G2 BLOCKER（R49.3 修复完成，待真机复测）**：
  1. **Top1 tie semantics 错误**：教师009/教师011 指标并列（lessonOccurrences=27、periodUnits=54 相同），Main 误判「Top1 不唯一」发起澄清（教师009/教师011/两位都看）→ 违反 position 语义契约。
  2. **overviewWindow → academicWeek 污染**：「未来四周」的聚合窗口 count=4 被错误继承为 campus_schedule_query 的 week=4（跨域 slot semantic collision）。

## R49.3 / G2-D 修复内容（2026-08-17，本轮）

- 判定：**非 Runtime 问题**——`teacherLoadTop` 底层排序已正确（lessonOccurrences DESC → periodUnits DESC → teacherName zh-CN tie-break，重复调用逐字节一致），overview actions 已给 week=1 语义；问题在 Agent 状态层。**未修改任何 src，CloudBase 不部署（保持 R49.2.1）**。
- **Top1 tie semantics**：Top1/Top2/Top3 = `teacherLoadTop[0..2]` **position 语义**（与指标是否并列无关）；单排位引用（Top1/第一名/最高那个/排第一那个/Top2/第二名/第二个/Top3/第三名）**NO CLARIFICATION**；仅明确多对象短语（他们/这两位/并列第一的两个/两位都…）进多对象逻辑；并列事实如实说明（「教师009与教师011并列最高。按当前稳定排序，Top1=教师009，Top2=教师011」）；排位实体禁止硬编码。
- **overviewWindow / academicWeek 隔离**：`overviewWindow={kind:"future_weeks",count:4}` 为聚合窗口，不得继承为 week；跨域下钻可继承 activeEntity/selectedRank 实体，必须 drop overview-local state；用户未显式指定教学周 → `drilldownAcademicWeek=1`（对齐 overview actions week=1）。
- **Rank Selection State**：rankContext `{ source, list="teacherLoadTop", selectedRank, entities:[top[0],top[1],top[2]] }` 进入 handoff 信封（03 §2/§6.1/§6.2）；rank 别名与多对象判定参考实现 `r49-ma/tools/rank-semantics.js`（纯函数，测试与 Prompt 同源）。
- **同步文件**：`agents/main-orchestrator.md`、`agents/campus-insight.md`、`agents/schedule-space.md`、`agents/risk-planning.md`、`03-HANDOFF-POLICY.md`、`04-CONTEXT-POLICY.md`、`09-MULTI-AGENT-E2E-MATRIX.md`（CASE D 重写 + D-2/D-3 变体 + CASE C evidence 契约）、`tests/fixtures/multi-turn-cases.json`（CASE D 更新 + rankDrilldown 段）、新增 `tests/test-drilldown-rank-semantics.js`（A~H 回归）、`test-g1-hardening.js`/`test-fixtures-consistency.js` 增强、`R49-MA-ADP-MANUAL-CONFIG-CHECKLIST.md`（R49.3 节）、G2 报告模板（真实 A/B/C/D 记录）。
- 无 Runtime src 修改 → **不部署 CloudBase**；PR #49 KEEP OPEN / UNMERGED；不进入 Model A/B。

## R49.4 / 多校匿名数据枢纽（2026-08-17，本轮）

- **G2 CASE D 复测已收口**：multi-turn fixture CASE D 重写为 **D1(insight `campus_teacher_load_query` rankingWindow 1..4)→D2(schedule `campus_schedule_range_query` detailWindow 1..4)→D3(schedule `campus_schedule_query` detailWindow 1..1 week=1)→D5(clarify 时间窗口)**；`test-drilldown-rank-semantics.js` 契约 4 / `test-g1-hardening.js` 11-12 / `test-fixtures-consistency.js` / `09-MULTI-AGENT-E2E-MATRIX.md` / G2 报告模板同步；**并列不澄清 + 窗口继承 + 风险未给周次→Main 澄清（绝不默认 week=1）**。
- **新增 2 个 Agent Tool Façade（共 7 个）**：`campus_teacher_load_query`（多周窗口负载 TopN）、`campus_schedule_range_query`（多周范围课表）；`adpContractVersion` **R49.2.1 → R49.4**；`r49-ma/tools/openapi/campus-agent-tools.adp-import.json` 已是 7 operations。
- **数据枢纽（`r49-ma/data-hub/`）**：canonical-schema.json（draft-07 匿名命名空间 v2）、week-expression.js（1..20 单/双/离散周次解析）、validator.js、source-detector.js（OLE2/XLS 签名识别、中性描述）、adapters（base fail-closed + portal-family-qz-legacy 中性适配）、provider-capabilities.json（credentialed=false / rawImportAllowed=false / anonymous-only）、privacy-policy.json（personal-import 存储排除）。测试：`tests/fixtures/synthetic-legacy-timetable.json`（教师A01-A03、2026级示例1~3班、示例课程A-D、校区A/B/C）+ `test-r49-4-data-hub.js`（8 契约）。
- **匿名边界（`test-r49-4-anonymity-boundary.js`，7 契约）**：镜像 builder 的 `submissionInputFiles()` 接受过滤器全量扫描 submission-package + r49-ma；真实学校身份仅存于 3 个 gate 校验器文件的 deny-list（`GATE_FILES_BY_PATH` 豁免），绝不复制进生成的比赛资产；凭据模式（quoted 值 + dummy 豁免 + 必填 padding 的 base64）；`.xls/.xlsx` 扩展名 + 个人文件名模式（`*课表*`、学号 `\d{6,}` 等）拒绝；`build-submission-package.js` 新增 `PERSONAL_IMPORT_EXCLUDED = ["personal-import","raw-import","private-import","personal-timetables"]` 目录硬守卫；`10-MIGRATION-RISK-REGISTER.md` #16 更新。
- **本地验证全绿**：r49-ma `node --test "tests/*.js"` = **162/162**；mcp `npm test` = **51/51**；mcp `check`（tsc）/`typecheck`/`check:openapi` 全绿；`sync-campusflow-function.js --check` = **8 文件一致 PASS**；`test-http-function.js` = **health 200 / tools=9 / 7 Agent Tool Façade 冒烟 PASS**；`npm test --prefix competition/adp-kit` 全链 PASS（eval:golden 33/33、submission 54 文件 0 findings、widget CI、artifact 校验）**唯一基线失败**：末步 `sync-assets-manifest --check` 因用户未提交的 `generated-assets-manifest.json`/submission-package 漂移（改动前已存在，与 R49.4 无关；跑套件前已备份并逐字节还原用户漂移，`git status` 恢复原样）。
- **ADP 清单更新**：`R49-MA-ADP-MANUAL-CONFIG-CHECKLIST.md`（§0 绑定 7 工具；§4 工具表 7 Façade；§6 D1~D5 验证；§8.1 重写为 R49.4 插件+Prompt 更新节，含两个新工具参数可见性表与「工具调用结果直接返回给用户=OFF」；§9 部署状态补 R49.4）；`06-ADP-MANUAL-CONFIG-CHECKLIST.md` 要点 4/6/7 同步。
- **CloudBase 部署：已完成并远程验证（2026-08-17）**：用户 `tcb login` 后执行 `tcb fn deploy campusflowAdpTools --dir competition/adp-kit/cloudfunctions/campusflowAdpTools --httpFn --path /campusflow-adp-tools --force`（临时 cloudbaserc 条目后逐字节还原；未写 envVariables）。远程 `/health` 实测 = **目标值一致**：`status=ok / dataVersion=competition-demo-v2 / dataHash=sha1:4f3bbbb45d1f / tools=9 / agentTools=7 / adpContractVersion=R49.4`。**8 项鉴权复验全部通过**（用户提供真实 token，仅内存使用）：teacher load W1..W1（Top1=教师003 6/12，教师009 rank2 并列）、W1..W4（Top1=教师009 27/54、Top2=教师011 27/54 稳定排序）、schedule_range 教师009 1..4（27 items，academicWeek 1-4 齐全）、T09 week1 self risk（conflictCount=1 / rushWarningCount=1 / selfCompare=true 基线）、schedule T09 w1 wd5=lesson-015、classroom 校区A 1-2节≥60=8 间、day_plan 2026-09-05=0 items（周六）、overview（weekCount=4 / 220 / 12 师 / 36 房 / 3 校区）。无 token/错 token → 401（token 模式仍强制）；函数冷启动正常即线上 token 未被覆盖。
- ADP 控制台待办：导入/更新插件为 7 operations，重新粘贴 4 Agent Prompt（8.1 节），应用首页按 D1~D5 复测 CASE D；**不进入 Model A/B**。

## G0 / G1 Gate 状态（2026-08-17）
- **R49.2.1 验证证据（2026-08-17 本机）**：r49-ma `node --test "tests/*.js"` = **117/117**（含新增 `test-g1-hardening.js` 13 项：别名等价 A/B/C、未知校区 fail-closed、classroom 0-mask 三态、preferredStudyDuration=0 铁律、T09 整周 6 节 vs 周三 3 节重调、Top1 链路 overview→schedule→risk(self) conflictCount=1、overview 无个人下钻）；cloudfunctions `test-http-function.js` = 1/1；mcp `npm test` = **36/36**；mcp `check`+`typecheck`+`check:openapi` 全绿；`git diff --check` 干净。基线失败证据：mcp `query_schedule weekday=0` 在 HEAD（R49.2 commit 04d5c87）即失败（32/33），根因=R49.2 语义变更未同步测试，已按新契约同步该用例（成功+整周 4 条+weekday 不回显 0）。Golden `eval-golden.js`：`oracleSourceSha256` 断言曾失败（expected fb3182… / actual 7c5744…，因 tools.js 源码合法变更）→ **已在 G2-PREFLIGHT 完成人工重审（分类 A）并审计更新 golden 文件**，现 33/33 PASS（见「G2-PREFLIGHT 状态」节）。
- **R49.2.1 部署完成（2026-08-17）**：`tcb fn deploy campusflowAdpTools --dir competition/adp-kit/cloudfunctions/campusflowAdpTools --httpFn --path /campusflow-adp-tools --force`（临时 cloudbaserc 条目后已还原）。`/health` 实测：`adpContractVersion=R49.2.1`、`status=ok`、`dataVersion=competition-demo-v2`、`dataHash=sha1:4f3bbbb45d1f`、`tools=7`、`agentTools=5`。
- **R49.2.1 远程功能复测（Bearer token 内存提取，未打印/落盘）**：① `find_available_classrooms campus="A校区" w1 wd1 1-2节` → 200 success，campusName=校区A，10 间（本地同参 10 间，一致）；② `campus_risk_check self T09 week1` → conflictCount=1、rushWarningCount=1、selfCompare=true（与 R49.2 真机事实一致）；③ `campus_schedule_query T09 w1 wd5` → lesson-015。
- 下一 Gate：**G2 CASE D real-console PASS**（用户按 R49.3 契约重新测试 CASE D / D-2 / D-3：并列不澄清、week=1、conflictCount=1/rushWarningCount=1 恢复）→ 补 CASE C evidence 截屏 → 全绿后跑 A~H + 13 core 全量收口 → 才考虑模型 A/B（不进入 Model A/B）。

## 最终应用边界（沿用）

- active target：01～04 R3 + 05（05 待平台恢复收口）；`schedule_risk_check` 只进 03。
- 数据真源：`competition-demo-v2 / sha1:4f3bbbb45d1f`（05 准备期 2026-08-25～08-30 必须为 0 课）。
- Widget Direct Output = OFF；真实 WidgetID/AgentID 未取得前保持占位符 + FAIL CLOSED。

## 当前保全策略（沿用）

- 不删除已成功导入且可运行的 01～04 R3；不生成新 ZIP 规避 `10013`。
- 平台写链恢复前：主线 = 01～04 Runtime E2E、应用 Router、跨 Workflow handoff、量化评测与比赛演示。
- 下一 Gate：
  1. ~~用户手动重部署 CloudBase HTTP Function 至 R49.2~~ **已完成（2026-08-17，`/health` 确认 `adpContractVersion=R49.2`）**；
  2. ADP 控制台按 R49.2 契约重新核对 5 个 Façade 绑定（参数可见性表见 `R49-MA-ADP-MANUAL-CONFIG-CHECKLIST.md` §4.1）；
  3. 应用首页（非单工作流调试）跑 `09-MULTI-AGENT-E2E-MATRIX.md` 硬回归 A~H + 13 核心 case；
  4. 平台 `10013` 恢复后完成 05 收口与知识库重新绑定。
