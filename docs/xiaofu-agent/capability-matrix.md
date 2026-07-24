# 小佛助手能力矩阵

## 1. 权威性说明

本文件是便于评审的可读视图，不是运行时配置。唯一权威源是 `server/config/agent-capability-manifest.json`；修改能力时必须先改 Manifest，再运行生成脚本和一致性测试，不能在本文或小程序端手工新增一套定义。

当前 Manifest：

- Schema：`agent-capabilities.v1`
- 协议：`agent.v1`、`agent.v2`
- 规范模式：`public`、`trial`、`dev`
- 兼容模式：`competition -> trial`（当活动 Provider 环境为 dev 时映射为 dev）
- 规模：31 个 Intent、24 个 Skill、31 个 Tool、8 类端上 Action、9 类卡片动作、32 条小程序能力注册（含 5 个快捷动作）
- 端上执行：`xiaofuActionBus`（小程序）+ `actionCommandContract`（服务端）双层白名单校验，详见 `capability-contract-design.md` 与 `capability-contract.generated.md`
- 服务端 Card 白名单：`empty_room`、`schedule`、`teacher`、`course`、`weather`、`diagnosis`、`guide`、`reminder`、`generic`

下表中 `P/T/D` 表示 public/trial/dev 均可执行；“Provider”表示外部生成式表达层权限，而不是 Tool 是否可用。

## 2. Canonical Intent 与 Skill

| Canonical Intent | 中文能力 | 事实任务 | Skill | 允许 Tool | 必需/可选槽位 | 模式 | 外部 Provider | Card | 降级策略 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `clarify_missing_slot` | 补充查询条件 | 否 | `clarify_query` | `clarify_missing_slot` | 无 / `slot` | P/T/D | 禁止 | generic | 本地追问 |
| `get_today_courses` | 今日课表 | 是 | `today_schedule` | `get_today_courses` | 无 / `week,date` | P/T/D | 禁止 | schedule | 本机缓存个人课表 |
| `get_tomorrow_courses` | 明日课表 | 是 | `tomorrow_schedule` | `get_tomorrow_courses` | 无 / `week,date` | P/T/D | 禁止 | schedule | 本机缓存个人课表 |
| `get_next_course` | 下一节课 | 是 | `next_course` | `get_next_course` | 无 / `week,date` | P/T/D | 禁止 | schedule | 本机缓存个人课表 |
| `get_week_schedule` | 本周课表 | 是 | `week_schedule` | `get_week_schedule` | 无 / `week` | P/T/D | 禁止 | schedule | 本机缓存个人课表 |
| `get_teaching_week` | 教学周 | 是 | `teaching_week` | `get_teaching_week` | 无 / `date` | P/T/D | 禁止 | generic | 已发布学期校历 |
| `get_term_calendar` | 学期校历 | 是 | `term_calendar` | `get_term_calendar` | 无 / `term` | P/T/D | 禁止 | generic | 已发布学期校历 |
| `search_empty_rooms` | 空教室 | 是 | `find_empty_room` | `search_empty_rooms`,`diagnose_data_status` | 无 / `week,weekday,sections,campus,building` | P/T/D | 禁止 | empty_room, diagnosis | last-known-good Release Pack |
| `search_continuous_empty_rooms` | 连续空教室 | 是 | `find_continuous_empty_room` | `search_continuous_empty_rooms`,`diagnose_data_status` | 无 / `week,weekday,duration,campus,building` | P/T/D | 禁止 | empty_room, diagnosis | last-known-good Release Pack |
| `search_school_index` | 全校课表检索 | 是 | `search_school_schedule` | `search_school_index`,`get_schedule_detail` | 无 / `type,q,week,weekday` | P/T/D | 禁止 | teacher, course, schedule, generic | last-known-good Release Pack |
| `get_schedule_detail` | 课表详情 | 是 | `search_school_schedule` | `get_schedule_detail` | `id` / `type,term` | P/T/D | 禁止 | schedule, generic | last-known-good Release Pack |
| `recommend_meeting_time` | 会议时间推荐 | 是 | `recommend_meeting_time` | `recommend_meeting_time`,`search_empty_rooms` | 无 / `week,weekday,duration,campus` | P/T/D | 禁止 | reminder, empty_room | 仅确定性课表结果 |
| `diagnose_data_status` | 课表数据诊断 | 是 | `schedule_data_diagnosis` | `diagnose_data_status` | 无 / `term,releaseVersion` | P/T/D | 禁止 | diagnosis | 本地状态入口 |
| `explain_personal_import` | 个人课表导入帮助 | 否 | `personal_schedule_import_help` | `explain_personal_import` | 无 / `mode` | P/T/D | 禁止 | guide | 本地 XLS 导入入口 |
| `get_campus_weather` | 校区天气 | 是 | `campus_weather` | `get_campus_weather` | 无 / `campus,dateHint` | P/T/D | 禁止 | weather | 天气不可用提示 |
| `get_course_weather_advice` | 课程天气建议 | 是 | `course_weather_advice` | `get_course_weather_advice` | 无 / `campus,dateHint` | P/T/D | 禁止 | weather, schedule | 课表结果 + 天气不可用提示 |
| `search_campus_place` | 校园地点 | 是 | `campus_place_navigation` | `search_campus_place` | 无 / `q` | P/T/D | 禁止 | generic | 本地校园地图入口 |
| `get_campus_route` | 校园路线 | 是 | `campus_place_navigation` | `get_campus_route` | 无 / `from,to` | P/T/D | 禁止 | generic | 本地校园地图入口 |
| `get_classroom_location` | 教室位置 | 是 | `campus_place_navigation` | `get_classroom_location` | 无 / `classroom` | P/T/D | 禁止 | generic | 本地校园地图入口 |
| `next_course_location` | 下一节课地点 | 是 | `next_course_location` | `get_next_course`,`get_classroom_location` | 无 / `classroom` | P/T/D | 禁止 | schedule, generic | 课表 + 导航入口 |
| `rag_search` | 已发布校园知识检索 | 是 | `knowledge_search` | `rag_search` | 无 / `q` | P/T/D | 禁止 | guide, generic | 已发布 lexical search |
| `project_qa` | 项目帮助问答 | 否 | `knowledge_search` | 无 | 无 / `q` | P/T/D | 仅 T/D 可选 | guide, generic | 已发布项目帮助 |
| `conversational_help` | 对话与能力帮助 | 否 | `knowledge_search` | 无 | 无 / 无 | P/T/D | 仅 T/D 可选 | guide, generic | 确定性帮助 |
| `generate_image` | 图片生成 | 否 | `image_generation` | `generate_image` | 无 / `prompt` | T/D | 仅 T/D | generic | public 不支持 |
| `campus_multi_step_advice` | 校园多步骤建议 | 是 | `campus_multi_step_advice` | `get_tomorrow_courses`,`search_empty_rooms`,`get_campus_weather`,`search_campus_place` | 无 / `week,weekday,campus,building` | P/T/D | 禁止 | schedule, empty_room, weather, generic | 返回可用的部分确定性结果 |

需要个人课表最小摘要的 Intent 是：`get_today_courses`、`get_tomorrow_courses`、`get_next_course`、`get_week_schedule`、`recommend_meeting_time`、`get_course_weather_advice`、`next_course_location`、`campus_multi_step_advice`。是否实际发送摘要还受用户授权和服务端 `AI_ALLOW_PERSONAL_CONTEXT` 控制。

## 3. 内置 Skill 合约

每个运行时 Skill 都具有：

```text
id
version
description
supportedIntents
requiredSlots
optionalSlots
allowedTools
runtimeModes
providerPolicy
planBuilder
resultVerifier
fallbackPolicy
outputCardTypes
```

`skillRegistry.js` 从 Manifest 创建 Skill 元数据，并为每个 Skill 绑定真实的 `planBuilder` 和 `resultVerifier`。计划执行前会检查：

1. Skill 在当前模式可用；
2. 计划长度不超过 6；
3. 每个 Tool 属于该 Skill 白名单；
4. Tool 在当前模式可用；
5. 事实 Intent 有工具调用证据。

默认规则仍复用 `toolRegistry.buildPlanForIntent` 和现有多步骤 Tool Chain，不要求模型动态规划。后续模型 Planner 必须生成同一 Skill 合约允许的计划，不能绕开它。

## 4. 客户端兼容映射

以下映射由 Manifest 生成，用于离线 Router 和旧命名兼容：

| 旧/客户端名 | Canonical Intent |
| --- | --- |
| `schedule_query` | `search_school_index` |
| `personal_schedule` | `get_today_courses`（离线层会根据“明天/下一节/本周”进一步细化） |
| `schedule_status` | `diagnose_data_status`（教学周问法进一步细化为 `get_teaching_week`） |
| `weather` | `get_campus_weather`（结合下一节课时细化为 `get_course_weather_advice`） |
| `school_knowledge` | `rag_search` |
| `navigation` | `search_campus_place` |
| `app_navigation`,`help`,`quick_action`,`smalltalk` | `conversational_help` |
| `ambiguous` | `clarify_missing_slot` |
| `search_teacher_schedule`,`search_class_schedule`,`search_classroom_schedule`,`search_course_schedule` | `search_school_index` |
| `teaching_week` | `get_teaching_week` |

在线回答的 canonical Intent 直接来自服务端；这张兼容映射不参与在线决策。

## 5. 一致性门禁

`npm run test:agent-foundation` 中的 Manifest 测试会阻止以下漂移：

- Protocol 中存在 Manifest 未声明的 Intent 或 Tool；
- Manifest Intent 未进入协议；
- Tool Registry 可执行 Tool 未进入 Manifest，或 Manifest Tool 不可执行；
- Skill/Intent 引用不存在或当前模式不可用的 Tool；
- Intent 引用不存在的 Skill 或 Card；
- 小程序生成映射与 Manifest 不一致，或映射到未知 Intent；
- public 能力被错误配置为允许外部 Provider。

生成物检查命令也可单独运行：

```text
node tools/generate-agent-capability-compat.js --check
```
