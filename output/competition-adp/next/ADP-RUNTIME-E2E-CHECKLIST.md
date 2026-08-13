# ADP Runtime E2E Checklist

> 本清单由 competition-demo-v1、Golden 与 compiler recovery contract 自动生成。
> LOCAL PASS 不等于腾讯 ADP Runtime PASS；每例必须在腾讯 ADP 草稿环境观察原生 Widget 与 Action 回流。

## 1. Schedule — `schedule-teacher003-week1-mon`

- Fixture 来源：`evaluation/golden-cases.js`
- 用户输入：`教师003第1周周一的课`
- 预期 Agent 路由：`schedule_day / 01`
- 预期 Workflow：`01-多维课表查询-Final`
- 预期 Tool：`query_schedule`
- Tool 固定输入：`{"entityType":"teacher","entityName":"教师003","week":1,"weekday":1}`
- 预期 Widget：`小序-课表票据-V2`
- 真实 WidgetID：`23fbc659efe3482fab588d754e4420a4`
- 必须出现：`教师003`；`第1周`；`周一`；`2026-08-31`；`程序设计基础`；`计算机组成原理`；`第5-6节`；`第7-8节`；`校区A`；`校区B`；`已核验`；`competition-demo-v1`
- 不得出现：`星期0`；`周0`；`weekday=0`；`TOOL_FAILURE`；`纯文本成功结果`
- 点击 Action：`检查风险`
- Action 后 sys.chat 输入：`{"query":"检查教师003第1周周一是否存在时间冲突或跨校区赶场","intent":"schedule_risk_check","entityType":"teacher","entityName":"教师003","week":1,"weekday":1,"date":"2026-08-31"}`
- Action 后预期 Workflow：`03-课程冲突比较-Final`
- 腾讯 Runtime 结果：`[ ] Widget 动态渲染 PASS`  `[ ] sys.chat 回流 PASS`  `[ ] 下一 Workflow PASS`

## 2. Classroom — `classroom-campus-a-week1-mon-1-2`

- Fixture 来源：`evaluation/golden-cases.js`
- 用户输入：`校区A第1周周一第1-2节至少60人的空教室`
- 预期 Agent 路由：`02`
- 预期 Workflow：`02-空教室规划-Final`
- 预期 Tool：`find_available_classrooms`
- Tool 固定输入：`{"campus":"校区A","week":1,"weekday":1,"periodStart":1,"periodEnd":2,"capacity":60}`
- 预期 Widget：`小序-空教室票据-V2`
- 真实 WidgetID：`9eb1ec5e1deb416ab5aba320359439a5`
- 必须出现：`校区A`；`第1周`；`周一`；`第1-2节`；`8`；`A1-102`；`competition-demo-v1`
- 不得出现：`课表票据`；`教师003`；`weekday=0`；`纯文本成功结果`
- 点击 Action：`换个校区`
- Action 后 sys.chat 输入：`{"query":"请重新选择空教室查询校区"}`
- Action 后预期 Workflow：`02-空教室规划-Final`
- 腾讯 Runtime 结果：`[ ] Widget 动态渲染 PASS`  `[ ] sys.chat 回流 PASS`  `[ ] 下一 Workflow PASS`

## 3. Conflict — `conflict-teacher003-self-week1-mon`

- Fixture 来源：`evaluation/golden-cases.js`
- 用户输入：`检查教师003第1周周一是否存在时间冲突或跨校区赶场`
- 预期 Agent 路由：`schedule_risk_check / 03 self-compare`
- 预期 Workflow：`03-课程冲突比较-Final`
- 预期 Tool：`compare_schedules`
- Tool 固定输入：`{"firstType":"teacher","firstName":"教师003","secondType":"teacher","secondName":"教师003","week":1,"weekday":1}`
- 预期 Widget：`小序-冲突赶场票据-V2`
- 真实 WidgetID：`8d576e5af9b04fdd99804e7fcbff3644`
- 必须出现：`教师003`；`课程安排风险检查`；`冲突 0`；`赶场 1`；`程序设计基础`；`计算机组成原理`；`20`；`competition-demo-v1`
- 不得出现：`教师003 vs 教师003`；`赶场 2`；`01-多维课表查询`；`纯文本成功结果`
- 点击 Action：`查看当天课表`
- Action 后 sys.chat 输入：`{"query":"查询教师003第1周周一的课"}`
- Action 后预期 Workflow：`01-多维课表查询-Final`
- 腾讯 Runtime 结果：`[ ] Widget 动态渲染 PASS`  `[ ] sys.chat 回流 PASS`  `[ ] 下一 Workflow PASS`

## 4. DayPlan — `day-plan-week1-fri`

- Fixture 来源：`evaluation/golden-cases.js`
- 用户输入：`帮我看看2026-09-04的安排，优先校区A并连续自习2节`
- 预期 Agent 路由：`04`
- 预期 Workflow：`04-今日校园计划-Final`
- 预期 Tool：`generate_day_plan`
- Tool 固定输入：`{"visitorId":"visitor-demo-001","date":"2026-09-04","preferredCampus":"校区A","preferredStudyDuration":2}`
- 预期 Widget：`小序-今日校园计划-V2`
- 真实 WidgetID：`f4ff76029d8142caa86fb9baac5314bf`
- 必须出现：`2026-09-04`；`演示用户001`；`2`；`思政通识`；`大学物理B`；`自习`；`competition-demo-v1`
- 不得出现：`真实学号`；`01-多维课表查询`；`纯文本成功结果`
- 点击 Action：`找空教室`
- Action 后 sys.chat 输入：`{"query":"根据今天的空档查找合适的空教室"}`
- Action 后预期 Workflow：`02-空教室规划-Final`
- 腾讯 Runtime 结果：`[ ] Widget 动态渲染 PASS`  `[ ] sys.chat 回流 PASS`  `[ ] 下一 Workflow PASS`

## 5. Choice — `choice-programming-course-ambiguous`

- Fixture 来源：`mock-data/competition-demo-v1.json + deterministic resolve_entity partial match`
- 用户输入：`比较程序设计与高等数学A第1周的课程冲突`
- 预期 Agent 路由：`03 / AMBIGUOUS_ENTITY recovery`
- 预期 Workflow：`03-课程冲突比较-Final`
- 预期 Tool：`compare_schedules`
- Tool 固定输入：`{"firstType":"course","firstName":"程序设计","secondType":"course","secondName":"高等数学A","week":1}`
- 预期 Widget：`小序-候选确认-V2`
- 真实 WidgetID：`f540588933a4459cbe78a6fe99aa022c`
- 必须出现：`程序设计基础`；`程序设计基础实验`；`选择`；`competition-demo-v1`
- 不得出现：`随机候选`；`已核验课程事实`；`纯文本候选列表`
- 点击 Action：`选择程序设计基础`
- Action 后 sys.chat 输入：`{"query":"使用course“程序设计基础”继续刚才的校园任务"}`
- Action 后预期 Workflow：`03-课程冲突比较-Final`
- 腾讯 Runtime 结果：`[ ] Widget 动态渲染 PASS`  `[ ] sys.chat 回流 PASS`  `[ ] 下一 Workflow PASS`

## 6. Error — `error-conflict-missing-second-object`

- Fixture 来源：`03 compiler pre-tool MISSING_PARAM contract`
- 用户输入：`比较教师003第1周周一的课程冲突`
- 预期 Agent 路由：`03 / MISSING_PARAM recovery`
- 预期 Workflow：`03-课程冲突比较-Final`
- 预期 Tool：`compare_schedules (must not execute before required second object exists)`
- Tool 固定输入：`{"firstType":"teacher","firstName":"教师003","week":1,"weekday":1}`
- 预期 Widget：`小序-任务恢复-V2`
- 真实 WidgetID：`3161078fd4d54a27bae65f38cd44c537`
- 必须出现：`需要补充比较对象`；`MISSING_PARAM`；`补充比较对象`；`competition-demo-v1`
- 不得出现：`已核验冲突事实`；`伪造第二对象`；`01-多维课表查询`；`纯文本系统错误`
- 点击 Action：`补充比较对象`
- Action 后 sys.chat 输入：`{"query":"请补充另一个需要比较的班级、教师或教室"}`
- Action 后预期 Workflow：`03-课程冲突比较-Final`
- 腾讯 Runtime 结果：`[ ] Widget 动态渲染 PASS`  `[ ] sys.chat 回流 PASS`  `[ ] 下一 Workflow PASS`
