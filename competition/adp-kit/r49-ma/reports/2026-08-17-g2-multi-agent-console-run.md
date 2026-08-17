# G2 Multi-Agent Handoff Convergence — 人工验收记录

> 使用说明：在 ADP 控制台应用首页（非单工作流调试）逐条执行 09-MULTI-AGENT-E2E-MATRIX.md 的硬回归 A~H 与 13 core case。
> 每 Turn 一行记录；**只允许填写真机实测结果**，禁止伪造、推测或回填。
> 动态事实一律以 CampusTools 确定性输出为准；dataVersion 必须为 competition-demo-v2。
> R49.3 更新：CASE D 增加并列不澄清（position 语义）与 week 隔离（drilldownAcademicWeek=1）两项硬性要求；CASE C 增加 evidence 契约（逐轮观察 fresh campus_day_plan(date=…) 调用）。

- 验收人：用户（真人控制台测试）
- 日期：2026-08-17
- 环境：ADP 控制台应用首页（应用名：校园智序 · 小序）
- 分支/HEAD：feat/campusflow-adp-integration @ 7208a5e（R49.3 修复前实测）
- CloudBase adpContractVersion（/health 实查）：R49.2.1（本轮无 Runtime 改动，不部署）
- 数据真源：competition-demo-v2 / sha1:4f3bbbb45d1f

## 真机结论速览（2026-08-17 用户实测）

- **CASE A = PASS**：T09第1周整周课表 → 检查他的风险 → 那看看他周三的课；schedule → risk(self) → schedule
  fresh tool recall 正常；T09 week1: conflictCount=1、rushWarningCount=1。
- **CASE B = PASS**：risk compare 澄清态（Main 澄清第二对象）→ 用户不回答 → 「A校区2026-09-03第5-6节有哪些60人以上空教室」；
  Main 识别 NEW_TASK，stale risk compare state escape → 课程空间 → campus_classroom_search。
- **CASE C = behavior PASS / evidence 待补截屏**：2026-09-04 → 下一天 2026-09-05 → 再下一天 2026-09-06；
  日期推进成功，保留 fresh campus_day_plan 铁律；需要补证：逐轮必须观察到 fresh `campus_day_plan(date=2026-09-05)` 与 `campus_day_plan(date=2026-09-06)` 调用（不能仅凭历史文本作答）。
- **CASE D = FAIL / G2 BLOCKER（R49.3 已修复设计，待真机复测）**：
  1. **Top1 tie semantics 错误**：教师009/教师011 指标并列（27/54 与 27/54），Main 判定「Top1 不唯一」发起澄清（教师009/教师011/两位都看）。
  2. **overviewWindow → week 污染**：「未来四周」的聚合窗口 count=4 被错误继承为 campus_schedule_query 的 week=4。

## 记录表（每 Turn 一行）

| Case | Turn | User Input | Expected Agent | Actual Agent | Expected Handoff | Actual Handoff | Tool Called | Tool Args | Inherited Slots | Dropped Slots | evidence.verified | dataVersion | Result Summary | PASS/FAIL | Screenshot / Note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 1 | T09老师第1周整周课表 | schedule | schedule | →campus_schedule_query | campus_schedule_query | campus_schedule_query | entity=T09, week=1 | — | — | true | competition-demo-v2 | 整周 6 节 | PASS | fresh tool recall 正常 |
| A | 2 | 检查一下他的风险 | risk(self) | risk(self) | mode=self, 不要求第二对象 | campus_risk_check(self) | campus_risk_check | mode=self, T09, week=1 | entity=T09, week=1 | — | true | competition-demo-v2 | conflictCount=1, rushWarningCount=1 | PASS | |
| A | 3 | 那看看他周三的课 | schedule | schedule | 重调 weekday=3 | campus_schedule_query | campus_schedule_query | entity=T09, week=1, weekday=3 | entity=T09, week=1 | risk-local | true | competition-demo-v2 | 周三 3 节 | PASS | |
| B | 1 | 比较T09老师第1周和另一位老师的风险 | risk(compare 澄清) | Main 澄清第二对象 | NEED_CLARIFICATION | — | —（不调工具） | | | | | competition-demo-v2 | 澄清第二对象 | PASS | |
| B | 2 | A校区2026-09-03第5-6节有哪些60人以上的空教室？ | classroom NEW_TASK escape | classroom | staleContextEscaped=true → campus_classroom_search | campus_classroom_search | campus_classroom_search | campus=别名A校区, date=2026-09-03, periodStart=5, periodEnd=6, capacity≥60 | — | second_entity_pending, comparisonMode, risk_local_state | true | competition-demo-v2 | 空教室列表 | PASS | 不追问第二对象 |
| C | 1 | 帮我安排2026年9月4日的一天 | day_plan | day_plan | campus_day_plan(date=2026-09-04) | campus_day_plan | campus_day_plan | date=2026-09-04 | — | — | true | competition-demo-v2 | 当日计划 | PASS | |
| C | 2 | 下一天呢 | day_plan | day_plan | campus_day_plan(date=2026-09-05) | campus_day_plan | campus_day_plan | date=2026-09-05 | date=09-04 | — | true | competition-demo-v2 | 09-05 计划 | PASS | ⏳ 补 evidence 截屏（fresh 调用） |
| C | 3 | 再下一天 | day_plan | day_plan | campus_day_plan(date=2026-09-06) | campus_day_plan | campus_day_plan | date=2026-09-06 | date=09-05 | — | true | competition-demo-v2 | 09-06 计划 | PASS | ⏳ 补 evidence 截屏（fresh 调用） |
| D | 1 | 未来四周教师负载最高的是谁 | insight(overview) | insight(overview) | rankContext(entities=top[0..2], selectedRank=null) | — | campus_overview | — | — | — | true | competition-demo-v2 | 教师009/教师011 并列最高（27/54 与 27/54） | PASS | 并列说明正确 |
| D | 2 | 看Top1课表 | schedule, entity=teacherLoadTop[0], week=1, NO clarification | ❌ **Main 澄清（教师009/教师011/两位都看）** | campus_schedule_query(entity=教师009, week=1) | ❌ 未按 position 落实体 | —（澄清，未调工具） | | | | | competition-demo-v2 | 并列 → 误判 Top1 不唯一 | **FAIL** | Bug 1：Top1 tie semantics |
| D | 3 | 检查Top1风险 | risk(self), entity=Top1, week=1 | —（被 Bug 1 阻断） | campus_risk_check(mode=self, entity=Top1, week=1) | — | — | | | | | | competition-demo-v2 | 被阻断 | FAIL（承接） | |
| D-alt | 2' | （Bug 2 复现）看Top1课表（若未澄清） | schedule week=1 | ❌ 实际收到 week=4 | campus_schedule_query(week=1) | ❌ campus_schedule_query(week=4) | — | week=4（来自 overviewWindow.count） | overviewWindow.count | — | | competition-demo-v2 | 周次被聚合窗口污染 | **FAIL** | Bug 2：overviewWindow→week pollution |

> `D-alt` 行为为 Bug 2 独立记录（真机轮次因 Bug 1 澄清中断；Bug 2 依据真实会话中 campus_schedule_query 实际收到 week=4 的事实记录）。

## 检查要点（对照 09 矩阵硬性要求，R49.3 版）

- [x] CASE A：第 2 轮 self-risk 不要求第二对象；第 3 轮 risk→schedule 不残留 risk pending（fresh-tool-call 铁律）
- [x] CASE B：Turn 1 compare 缺第二对象 → Main 澄清；Turn 2 新任务立即 escape，不追问第二对象
- [~] CASE C：下一天 = date+1 确定性推进（行为 PASS）；**evidence 契约待补截屏**：逐轮必须观察到 fresh `campus_day_plan(date=2026-09-05)` / `campus_day_plan(date=2026-09-06)`，不得仅凭历史返回文本生成
- [ ] CASE D（R49.3）：**并列不澄清**（Top1=teacherLoadTop[0] position 语义，即使 27/54 与 27/54 并列也 NO CLARIFICATION）；**week 隔离**（drilldownAcademicWeek=1，绝不 4）；第 3 轮 self-risk 不要求第二对象；校区最忙单域不下钻
- [ ] CASE D-2：看Top2课表 → teacherLoadTop[1]，不得调用 Top1
- [ ] CASE D-3：并列第一都有谁 → 如实列并列项、不压缩 Top1、不破坏 rankContext；随后看Top1课表仍落 teacherLoadTop[0]
- [ ] CASE E：仅显式双对象才 compare
- [ ] CASE F：无有效历史必须澄清，不伪造实体
- [ ] CASE G：chat/知识导航不调用动态工具
- [ ] CASE H：动态课表必须调用 CampusTools，禁止 Knowledge 直接回答
- [ ] 13 core case：澄清/chat/knowledge/self/compare/0-mask/别名/日计划推进全部覆盖
- [ ] 所有动态结果展示「已核验 + dataVersion=competition-demo-v2」

## 结论

- 通过 case 数：A / B / C（行为）/ D（3 个变体待复测）
- 失败 case 数：**D（G2 BLOCKER：Top1 tie semantics + overviewWindow→week 污染）**，R49.3 已在 prompt/handoff/context/matrix/fixtures 修复，待真机复测
- 失败明细（case/turn/原因）：D/T2 并列误澄清；D/T2 week=4 污染（详见记录表）
- 遗留问题 / 需要回滚项：无 Runtime 改动，无需回滚；CloudBase 保持 R49.2.1
- 验收结论：**FAIL**（仅 CASE D 两项语义 blocker；修复后复测 CASE D/D-2/D-3 → 全绿后重跑 A~H + 13 core 收口）
