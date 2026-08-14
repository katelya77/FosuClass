# ADP R4 Runtime E2E Checklist

本清单区分本地合同 PASS 与腾讯 ADP Runtime PASS；未在腾讯当前赛事空间执行前不得标记 Runtime PASS。

| 场景 | 必定可复现输入 | 预期 Workflow | Tool | Widget / ID | 必须出现 | 禁止出现 |
|---|---|---|---|---|---|---|
| Schedule | 教师003第1周周一的课 | 01-多维课表查询-R3 | query_schedule | Schedule `23fbc659efe3482fab588d754e4420a4` | 2门课、已核验、competition-demo-v1 | 文本冒充 Widget、weekday=0 |
| Classroom | 校区A第1周周一第5-6节有哪些空教室 | 02-空教室规划-R3 | find_available_classrooms | Classroom `d781773ab49c4b15a5a4b99f0e28a748` | 筛选条件、空教室、已核验 | 空 WidgetID、OBJECT WidgetParam |
| Conflict | 教师003第1周周一跨校区赶不赶得上 | 03-课程冲突比较-R3 | compare_schedules self-compare | Conflict `86e9ea7eb9e0458cb69a5d08aa767163` | 时间冲突0、赶场1 | 要求第二对象、教师003 vs 教师003 |
| DayPlan | 帮我安排2026-09-04的一天 | 04-今日校园计划-R3 | generate_day_plan | DayPlan `9e334031b8bc47e9ab349244f9bca421` | 课程、空档、自习建议 | 模型补造计划 |
| Choice | 查询教师（稳定歧义候选 fixture） | 原任务 Recovery | resolve_entity | Choice `b2726b1796294285b9f2daffc6d75dc7` | 候选项、继续原任务 | 直接猜实体 |
| Error | 帮我查空教室（缺日期/节次） | 02 Recovery | pre-tool MISSING_PARAM | Error `906df4c8d24548fabb8bd8a080de76d2` | 中文恢复说明、修改条件 | 必填 queryId、系统长错误 |
| Hero Pilot | 从8月25日开始看看未来几周校园教学运行情况 | 05-校园教学态势-R1 | get_campus_teaching_overview | CampusOverview `PENDING_REAL_EXPORT` | 准备期0课、4×5矩阵、verified | 08-25～08-30造课、伪造ID |

## Action 回流

1. Hero「查看第1周」→ `intent=schedule_week` → 01。
2. Hero「查空教室」→ `intent=classroom_find` → 02。
3. Hero「检查风险」→ `intent=schedule_risk_check` → 03。
4. Conflict「查看当天课表」→ `intent=schedule_day` → 01；必须保留教师、周、星期/日期。
5. 每条 sys.chat 文本同时保留完整自然 query 与 `【小序ActionV2】query=...|intent=...`。
