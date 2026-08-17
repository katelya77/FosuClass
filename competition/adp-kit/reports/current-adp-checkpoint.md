# 校园智序 · 小序 — 当前 ADP 检查点

更新时间：2026-08-17 +08:00

当前阶段：`CampusFlow ADP R49.2.1 / G1.1 已 PASS` → `R49.3 / G2 Multi-Agent Handoff Convergence（G2-PREFLIGHT 收口）`

## 真实 ADP / Runtime 状态（2026-08-17 实测）

- 仓库分支：`feat/campusflow-adp-integration`（head `a5b6e4f` + 本次 G2-PREFLIGHT 改动）；PR #49 保持 `OPEN / UNMERGED`。
- CloudBase HTTP Function `/health`（只读 GET，2026-08-17）：
  - **部署前**：`status=ok`、`dataVersion=competition-demo-v2`、`dataHash=sha1:4f3bbbb45d1f`、`tools=7`、`agentTools=5`、`adpContractVersion=R49.1.1`（线上旧版，含 0 值掩码 bug）。
  - **部署后（2026-08-17 已用 tcb CLI 部署 R49.2）**：同一 URL `https://cloud1-d3g17rpe7566d3d5c-1442900641.ap-shanghai.app.tcloudbase.com/campusflow-adp-tools/health` 返回 `adpContractVersion=R49.2`，数据哈希未变；CLI 新链接 `https://cloud1-d3g17rpe7566d3d5c.service.tcloudbase.com/campusflow-adp-tools/health` 同样 200。
  - 鉴权验证：假 Bearer token POST `/api/campus_risk_check` → 401（token 模式仍在；环境变量未因部署被覆盖）。
- ADP 契约：`r49-ma/tools/openapi/campus-agent-tools.adp-import.json`（R49.2，description 已加固）。
- Widget / Workflow：01～04 R3 与 05 状态沿用 2026-08-14 记录（`TENCENT_WORKFLOW_DEBUG_PASS`；05 等待平台恢复后收口）。
- 平台事件（历史）：2026-08-14 `10013 add vectors failed` 仍记录于 `2026-08-14-adp-workflow-vector-service-incident.md`；该 incident 与本次 0 值掩码修复相互独立，互不影响判断。

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
| 9 | DayPlan 下一天（CASE C 第 2 轮） | ⏳ 待 G2 真机 | 确定性 date+1 已实现，控制台真机复验留 G2 全局调试 |
| 10 | Insight busiest campus（core #4） | ✅ PASS | 单域 overview，不下钻个人 schedule |
| 11 | Insight teacher Top3 / Top1（CASE D 第 1 轮） | ✅ PASS | Top1=teacherLoadTop[0] 真实值（当前=教师009，不写死） |
| 12 | Insight overall risk | ✅ PASS | 全局风险数字确定性返回 |

- **G1.1（R49.2.1）交付 = PASS**：校区别名确定性解析（resolveCampus）；classroom 0-mask（resolveTimeRange 读 input）；CASE D 教师 Top1 链；fresh-tool-call 铁律；控制台事实同步；R49.2.1 已部署并经 /health 与远程功能复测验证（详见上节证据）。

## G2-PREFLIGHT 状态（2026-08-17）

- **Widget CI stale validator = FIXED**：`validateKnowledge()` 改以 `knowledge/taxonomy.json` 为真源（动态 expectedKnowledgeFiles、文件名无重复、声明文件必须存在、knowledge/ 下 NN-*.md 与 taxonomy EXACT MATCH、内容结构校验保留）；08 标题结构整理对齐 REQUIRED_KNOWLEDGE_SECTIONS（语义事实未变、未写死动态校园事实）；顺带修复潜伏 stale 断言（application-config data_version v1→v2，R49 起已为 v2）。本地 Widget CI 等价链 4 步全绿（test-widget-adapter / generate-samples / validate-kit / samples committed-identical）。
- **Golden source hash review = FIXED**：33/33 Golden cases 重跑，结构化 diff 结论 = **分类 A**（仅 source hash 改变、语义输出全部一致、0 个 changed case、数据集锚点 competition-demo-v1 / sha1:fefef4bf425b 未变）；`oracleSourceSha256` 已按审计流程更新并写入 `lastOracleReview` 审计字段；`eval-golden.js` 33/33 PASS。
- **CASE B deterministic stale escape design = FIXED**：改为 compare intent（比较T09和另一位老师第1周风险）→ 缺第二对象 NEED_CLARIFICATION（Main 唯一澄清出口）→ 用户不回第二对象直接问空教室 → Main 判定 NEW_TASK、staleContextEscaped=true、drop second_entity_pending/comparisonMode/risk_local_state → campus_classroom_search（含 A校区 别名 R49.2.1 解析）。矩阵 + fixture（8 hardCases 不变）+ CHECKLIST 已同步，fixture consistency 8/8 PASS。
- **G2 人工验收模板 = READY**：`r49-ma/reports/2026-08-17-g2-multi-agent-console-run.md`（空模板，17 列记录表 + 检查要点 + 结论区，未伪造真机结果）。

## G0 / G1 Gate 状态（2026-08-17）
- **R49.2.1 验证证据（2026-08-17 本机）**：r49-ma `node --test "tests/*.js"` = **117/117**（含新增 `test-g1-hardening.js` 13 项：别名等价 A/B/C、未知校区 fail-closed、classroom 0-mask 三态、preferredStudyDuration=0 铁律、T09 整周 6 节 vs 周三 3 节重调、Top1 链路 overview→schedule→risk(self) conflictCount=1、overview 无个人下钻）；cloudfunctions `test-http-function.js` = 1/1；mcp `npm test` = **36/36**；mcp `check`+`typecheck`+`check:openapi` 全绿；`git diff --check` 干净。基线失败证据：mcp `query_schedule weekday=0` 在 HEAD（R49.2 commit 04d5c87）即失败（32/33），根因=R49.2 语义变更未同步测试，已按新契约同步该用例（成功+整周 4 条+weekday 不回显 0）。Golden `eval-golden.js`：`oracleSourceSha256` 断言失败（expected fb3182… / actual 7c5744…），因 tools.js 源码合法变更（别名+0-mask）→ **需人工重审后重生成，未自动重生成**。
- **R49.2.1 部署完成（2026-08-17）**：`tcb fn deploy campusflowAdpTools --dir competition/adp-kit/cloudfunctions/campusflowAdpTools --httpFn --path /campusflow-adp-tools --force`（临时 cloudbaserc 条目后已还原）。`/health` 实测：`adpContractVersion=R49.2.1`、`status=ok`、`dataVersion=competition-demo-v2`、`dataHash=sha1:4f3bbbb45d1f`、`tools=7`、`agentTools=5`。
- **R49.2.1 远程功能复测（Bearer token 内存提取，未打印/落盘）**：① `find_available_classrooms campus="A校区" w1 wd1 1-2节` → 200 success，campusName=校区A，10 间（本地同参 10 间，一致）；② `campus_risk_check self T09 week1` → conflictCount=1、rushWarningCount=1、selfCompare=true（与 R49.2 真机事实一致）；③ `campus_schedule_query T09 w1 wd5` → lesson-015。
- 下一 Gate：~~R49.2.1 部署后 /health 复验~~ **已完成** → ~~控制台按新契约真机复测 G1~~（远程功能复测已代偿核心 3 项）→ **G2 Multi-Agent Handoff Convergence 全局调试**（应用首页逐条跑 09 矩阵 A~H + 13 core case，使用 `2026-08-17-g2-multi-agent-console-run.md` 模板逐 Turn 记录；重点：CASE B 新设计 compare 澄清态 stale escape、CASE D 教师 Top1 链、CASE C 下一天、§5 Widget 按钮链）。

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
