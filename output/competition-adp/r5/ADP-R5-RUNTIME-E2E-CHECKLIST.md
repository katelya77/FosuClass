# ADP R5 Runtime E2E Checklist

状态必须分开记录：`LOCAL_CONTRACT_PASS`、`TENCENT_WORKFLOW_DEBUG_PASS`、`TENCENT_APPLICATION_E2E_PASS`。

| 场景 | 输入 | Workflow | Tool | Widget / ID | 当前状态 | 必须出现 |
|---|---|---|---|---|---|---|
| Schedule | 教师003第1周周一的课 | 01-R3 | query_schedule | Schedule `23fbc659efe3482fab588d754e4420a4` | TENCENT_WORKFLOW_DEBUG_PASS | 2门课、verified、competition-demo-v1 |
| Classroom | 校区A第1周周一第5-6节有哪些空教室 | 02-R3 | find_available_classrooms | Classroom `d781773ab49c4b15a5a4b99f0e28a748` | TENCENT_WORKFLOW_DEBUG_PASS | 筛选条件、原生卡 |
| Conflict | 教师003第1周周一跨校区赶不赶得上 | 03-R3 | compare_schedules self-compare | Conflict `86e9ea7eb9e0458cb69a5d08aa767163` | TENCENT_WORKFLOW_DEBUG_PASS | 冲突0、赶场1、不要求第二对象 |
| DayPlan | 帮我安排2026-09-04的一天 | 04-R3 | generate_day_plan | DayPlan `9e334031b8bc47e9ab349244f9bca421` | TENCENT_WORKFLOW_DEBUG_PASS | 课程、空档、自习建议 |
| Choice | 稳定歧义 fixture | 原任务 Recovery | resolve_entity | Choice `b2726b1796294285b9f2daffc6d75dc7` | PENDING_USER_APPLICATION_E2E | 候选确认后回原任务 |
| Error | 查空教室（缺日期/节次） | 02 Recovery | MISSING_PARAM | Error `906df4c8d24548fabb8bd8a080de76d2` | PENDING_USER_APPLICATION_E2E | 中文恢复；不要求 queryId |
| Hero | 从8月25日开始看看未来几周校园教学运行情况 | 05-R1 | get_campus_teaching_overview | CampusOverview `876474681d584d95b4a99da929dfb3b1` | LOCAL_CONTRACT_PASS | 准备期0课、126次、4×5、教师/资源/风险、已核验 |

## Hero application chain

1. Hero「查空教室」必须发送 `intent=classroom_find|week=1` 并进入 02；补充周一第5-6节。
2. 「检查风险」必须发送 `intent=schedule_risk_check|entityType=teacher|entityName=教师003|week=1` 并进入 03 self-compare。
3. Conflict「查看当天课表」必须发送 `intent=schedule_day` 并进入 01，保留教师003、第1周、周一。
4. `帮我把当天空档安排成连续自习` 必须进入 04 并沿用已确认日期。
5. 腾讯应用级全链完成前，整体状态保持 `PENDING_USER_E2E`。
