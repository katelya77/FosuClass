# Agent Tool Examples（输入/输出示例）

> 每个工具给出 success / clarification / no_result / error 四态示例。真实调用路径为 CampusTools REST：`POST {base_url}/api/<campusTool>`，Bearer token。

## 1. campus_schedule_query

| 态 | 示例 |
|---|---|
| success | 输入 `{entityType:"teacher", entityName:"教师009", week:1, weekday:3}` → `{success:true, dataVersion:"competition-demo-v2", items:[{weekday:3, weekdayName:"周三", date:"2026-09-02", periodStart:7, periodEnd:8, courseName:"科学计算", roomName:"A1-101", campusName:"校区A", teacherNames:["教师009"], className:"2025级A班"}], evidence:{verified:true}}` |
| clarification | 输入 `{entityType:"teacher", entityName:""}` → `{error:{code:"MISSING_PARAM", message:"缺少必填参数 entityName"}}` → Agent 回 NEED_CLARIFICATION |
| no_result | 某周某日无课 → `{success:true, items:[], evidence:{note:"EMPTY_RESULT"}}` |
| error | `{entityName:"教师099"}` → `{error:{code:"ENTITY_NOT_FOUND", message:"未找到实体"}}` |

## 2. campus_classroom_search

| 态 | 示例 |
|---|---|
| success | `{campus:"校区A", date:"2026-09-03", periodStart:5, periodEnd:6, minCapacity:60}` → items 为满足条件的空教室（roomName/building/capacity/freePeriodText） |
| clarification | 缺时间且无法解析 weekday → `{error:{code:"MISSING_PARAM", message:"空教室查询需要明确的 weekday（或由 date 推导）"}}` |
| no_result | 条件无空教室 → `{success:true, items:[], evidence:{note:"EMPTY_RESULT"}}` |
| error | 校区不存在 → `{error:{code:"ENTITY_NOT_FOUND", message:"未找到校区「校区X」"}}` |

## 3. campus_risk_check（self/compare）

| 态 | 示例 |
|---|---|
| success(self) | `{mode:"self", entityType:"teacher", entityName:"教师009", week:1}` → `{success:true, summary:{conflictCount:0, selfCompare:true, rushWarningCount:1, hasConflict:false}, rushWarnings:[{entity:"教师009", weekday:3, from:"…", to:"…", gapMinutes:10}]}` |
| success(compare) | `{mode:"compare", entityType:"teacher", entityName:"教师003", secondEntityType:"teacher", secondEntityName:"教师009", week:1}` → summary 含 conflictCount / hasConflict / two_object |
| clarification | `{mode:"compare", entityType:"teacher", entityName:"教师003"}`（缺 second）→ schema 校验失败 → NEED_CLARIFICATION(missingFields=["secondEntityType","secondEntityName"]) |
| no_result | 无冲突无赶场 → `{success:true, items:[], summary:{hasConflict:false}}` |
| error | 实体不存在 / 周次越界 |

> **self 模式关键**：`required` 仅 entityType+entityName；adapter 在 self 模式确定性复制 `second=first` 后调用 `compare_schedules`，因此「检查他的风险」绝不触发「请提供第二个比较对象」。

## 4. campus_day_plan

| 态 | 示例 |
|---|---|
| success | `{visitorId:"user-demo-001", date:"2026-09-04"}` → items 含课程 + 空档(gap + studyRooms) + 跨校区 tip |
| no_result | 空日 → `{success:true, items:[], evidence:{note:"EMPTY_RESULT"}}` → 显示「当天暂无已核验安排」 |
| clarification | 缺 date → MISSING_PARAM |
| error | 演示用户不存在 → ENTITY_NOT_FOUND |

## 5. campus_overview

| 态 | 示例 |
|---|---|
| success | `{}` → items:[{window:{2026-08-25~2026-09-27}, summary:{weekCount:4, lessonOccurrences:~220, teacherCount:12, roomCount:36, campusCount:3}, campusResources:[…], teacherLoadTop:[…], peakSlot:{…}, risks:{conflictCount,rushCount,continuousLoadCount}}] |
| error | windowStart 越界 → `{error:{code:"INVALID_PARAM", message:"R4 Hero 首版仅支持固定窗口 2026-08-25 至 2026-09-27"}}` |

> 注意：`campus_overview` 首版为固定窗口；未来如需可变窗口，由 CampusTools 演进（不属本轮）。
