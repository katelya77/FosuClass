# R51 Mission E2E Matrix（2026-08-19）

13 行高价值 E2E：目标 → 能力 DAG → Agent 序列 → 必需 fresh 工具调用 → 完成判据 → 禁止行为。
实现于 `r49-ma/tests/test-r51-e2e-mission-matrix.js`（E1–E13，全绿）。

| # | 用户目标（语义） | 能力 DAG | Agent 序列 | 必需 fresh 工具调用 | 完成判据（criteria） | 禁止行为 |
|---|---|---|---|---|---|---|
| E1 | 看某老师课表（单周） | SCHEDULE_DETAIL | Main→Schedule→Main | campus_schedule_query ×1 | scheduleFacts | 多调用任何其他工具 |
| E2 | 同域 follow-up，槽位不变 | （复用） | Main→Schedule→Main | 0（复用 verified result） | scheduleFacts | 重复发起相同查询 |
| E3 | 动态槽位变化（周→某天） | SCHEDULE_DETAIL(fresh) | Main→Schedule→Main | campus_schedule_query ×1（新槽位） | scheduleFacts(weekday) | 截取旧整周结果回答当天 |
| E4 | 课表+风险 | SCHEDULE_DETAIL→RISK_CHECK | Main→Schedule→Main→Risk→Main | schedule_query, risk_check | scheduleFacts+riskFacts | 只查课表即收口 |
| E5 | 课表+风险+教室 | SCHEDULE_DETAIL→RISK_CHECK→SPACE_DISCOVERY | Main→S→Main→R→Main→S→Main | schedule, risk, classroom_search | +spaceFacts | 跳过风险或教室 |
| E6 | 四周教师负载 Top1→课表 | TEACHER_LOAD_RANKING→SCHEDULE_DETAIL | Main→Insight→Main→Schedule→Main | teacher_load_query(1..4), schedule(选中对象) | rankingFacts+scheduleFacts | overview 替代排名；用排名计数当周 |
| E7 | 四周负载 Top1→课表→风险 | RANKING→SCHEDULE_DETAIL→RISK_CHECK | Main→I→Main→S→Main→R→Main | teacher_load, schedule, risk_check | +riskFacts | 排名完成即收口 |
| E8 | 两人共同空闲→教室→候选方案 | ENTITY_RESOLUTION→COMMON_AVAILABILITY→SPACE_DISCOVERY→GROUP_PLANNING | Main→S→Main（×4） | entity_search, common_free_time, classroom_search, group_plan | resolvedEntities+availability+space+groupPlanFacts | 只有共同空闲即收口 |
| E9 | 调课模拟（课程可解析） | ENTITY_RESOLUTION→RESCHEDULE_SIMULATION | Main→S→Main→R→Main | entity_search, reschedule_feasibility | resolvedEntities+rescheduleSimFacts | 先澄清；把模拟描述为已执行 |
| E10 | 调课模拟（课程不可解析） | （澄清） | Main（澄清出口） | 0（无实体，不伪造） | 澄清候选后再规划 | 猜一个课程继续 |
| E11 | 新业务域 NEW_TASK | （stale escape） | Main 重建 | 0（清旧域状态） | 新域 criteria | 继承旧 facts/排位/窗口 |
| E12 | 必需能力空/错 | （受控失败） | Main（失败路径） | 0（不伪装成功） | failed 状态，可恢复提示 | 宣称完成/继续编造 |
| E13 | Widget 动作→Main→下一能力 | RISK_CHECK（继承） | Widget→Main→Risk→Main | risk_check（新回合） | riskFacts | payload 携带内部 id/JSON |

## 规则来源

- 能力 DAG 来自 `r51/mission/planner.js`（COMPOSITIONS / SINGLES），序列来自 DOMAIN_BINDINGS。
- 「必需 fresh 工具调用」来自 `r51/mission/fresh-guard.js` 的 DYNAMIC_SLOT_KEYS 判定。
- 「完成判据」来自 `r51/mission/completion.js`（criteria 全部满足才 complete）。
- Agent 序列：Main→Child→Main，无 Child→Child，Main 不调用 CampusTools。