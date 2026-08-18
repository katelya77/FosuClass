# 校园智序 · 小序 — 当前 ADP 检查点

更新时间：2026-08-18 +08:00

当前阶段：`CampusFlow ADP R50.0 / Semantic Core + 13 Agent Tools`（仓库收敛已完成；**Runtime 待用户授权部署**：CloudBase 保持 R49.4 已部署状态 tools=9 / agentTools=7 / adpContractVersion=R49.4；T3~T7 本地代码与 T8a/T8b/T8c 交付已全绿，见下方 R50.0 节）

## R50.0 状态（本轮，2026-08-18）

- **Coze agent T3~T7 已审计落地（5 commits，HEAD=9db8447）**：Semantic Core（temporal-core.js / ranking-core.js / context-model.js）、6 个新 CampusTools（TOOL_DEFS 15、Agent Tool Façade 13、`ADP_CONTRACT_VERSION=R50.0`）、competition-demo-v3 数据集（生成器/schema/validator）、OpenAPI 全量 13 ops + r50 delta 恰 6 ops（$ref 自包含、无凭据）、CloudBase V3 runtime cutover（index.js 默认 v3；sync 脚本 RUNTIME_FILES 8 + DATA_FILES v1/v2/v3）。
- **测试全绿**：r49-ma `node --test "tests/*.js"` = **236/236**（含 Coze 新增 test-temporal-core / test-ranking-core / test-context-model / test-r50-new-tools / test-dataset-quality + 本轮新增 test-r50-prompt-architecture 10 契约）；mcp `npm test` = **51/51**、`npm run check` 绿；`git diff --check` 干净；`sync-campusflow-function.js --check` = **11 文件一致 PASS**；`test-http-function.js` = **health 200 / 13 个 Agent Tool Façade / V3 runtime PASS**。
- **Golden 33/33 重审 = 分类 A（2026-08-18）**：oracleSourceSha256 更新为 `4cc58e0b…`（R50 合法源码变更），33/33 case 语义 0 漂移、dataVersion=competition-demo-v1 / sha1:fefef4bf425b 未变；`lastOracleReview={date:2026-08-18, classification:"A", semanticDrift:0, changedCases:[], datasetAnchor:"competition-demo-v1 / sha1:fefef4bf425b（未变）"}` 已写入；`eval-golden.js` 33/33 PASS。
- **T8a Prompt 架构（新交付）**：`r50/agents/shared/` 7 个 policy（core-safety / intent-policy / temporal-policy / entity-policy / context-policy / ranking-policy / output-policy）+ `r50/agents/` 4 个组合 Prompt（main-orchestrator / schedule-space / risk-planning / campus-insight，13 工具路由、去 Case 化、无比赛实体字面）+ `r50/build-agent-prompts.js` 编译器（确定性生成 `agents/compiled/*.compiled.md`，`--check` 漂移检测）。
- **T8b Prompt 一致性门禁（新交付）**：`r49-ma/tests/test-r50-prompt-architecture.js` 10/10（架构存在性、编译器确定性、shared 注入、13 工具绑定无越权、Temporal/排名/self-risk/fresh-tool-call 语义契约、去 Case 化、高级设置保留）。
- **T8c Console 升级手册（新交付）**：`r50/R50.0-ADP-CONSOLE-UPGRADE.md`（7→13 工具表、delta JSON 导入、新 6 工具单独验证清单、Agent 绑定映射、Direct Result 全 OFF、/health 三字段、V2/V3 状态、Prompt 暂不手工替换、回滚路径）。
- **CloudBase 部署：已完成并远程验证（2026-08-18，用户授权）**：`tcb fn deploy campusflowAdpTools --dir competition/adp-kit/cloudfunctions/campusflowAdpTools --httpFn --path /campusflow-adp-tools --force`（临时 cloudbaserc 追加条目后已还原；未写 envVariables，线上 token 等环境变量保持不变）。远程 `/health` 实测 = **目标值一致**：`status=ok / dataVersion=competition-demo-v3 / dataHash=sha1:842b7959e808 / tools=14 / agentTools=13 / adpContractVersion=R50.0`。**6 个新 façade remote smoke 全部 PASS**（真实 token 仅内存使用，未打印/落盘）：entity_search（5 教师）、academic_context（future_weeks → temporalContext）、common_free_time_query（2 教师共同空闲 8 窗口）、room_utilization_query（1..4 周 top3）、reschedule_feasibility（lesson-001 what-if）、group_plan（2 教师 + 容量 ≥60 → 8 候选），全部 success=true / verified=true / dataVersion=competition-demo-v3。
- **最终报告**：`r50/2026-08-18-r50.0-final-report.md`（27 项达标清单，见该文件）。

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
