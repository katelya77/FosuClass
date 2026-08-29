# Capability Contract（生成文件，请勿手改）

来源: `server/config/agent-capability-manifest.json`（schemaVersion: agent-capabilities.v1）

本文档由 `node tools/generate-capability-contract.js` 生成；修改请改 Manifest 后重新生成。

## 运行模式

| 模式 | 说明 | 外部 Provider |
| --- | --- | --- |
| public | 正式版 | 禁止 |
| trial | 体验版 | 允许 |
| dev | 开发版 | 允许 |
| competition | 比赛版兼容名 | aliasFor: trial |

## Intents

| Intent | 名称 | 事实任务 | Skill | 工具 | 公开版 | 降级策略 |
| --- | --- | --- | --- | --- | --- | --- |
| clarify_missing_slot | 补充查询条件 | 否 | clarify_query | clarify_missing_slot | 允许 | local-clarification |
| get_today_courses | 今日课表 | 是 | today_schedule | get_today_courses | 允许 | cached-personal-schedule |
| get_tomorrow_courses | 明日课表 | 是 | tomorrow_schedule | get_tomorrow_courses | 允许 | cached-personal-schedule |
| get_next_course | 下一节课 | 是 | next_course | get_next_course | 允许 | cached-personal-schedule |
| get_week_schedule | 本周课表 | 是 | week_schedule | get_week_schedule | 允许 | cached-personal-schedule |
| get_teaching_week | 教学周 | 是 | teaching_week | get_teaching_week | 允许 | published-term-calendar |
| get_term_calendar | 学期校历 | 是 | term_calendar | get_term_calendar | 允许 | published-term-calendar |
| search_empty_rooms | 空教室 | 是 | find_empty_room | search_empty_rooms, diagnose_data_status | 允许 | last-known-good-release-pack |
| search_continuous_empty_rooms | 连续空教室 | 是 | find_continuous_empty_room | search_continuous_empty_rooms, diagnose_data_status | 允许 | last-known-good-release-pack |
| search_school_index | 全校课表检索 | 是 | search_school_schedule | search_school_index, get_schedule_detail | 允许 | last-known-good-release-pack |
| get_schedule_detail | 课表详情 | 是 | search_school_schedule | get_schedule_detail | 允许 | last-known-good-release-pack |
| recommend_meeting_time | 会议时间推荐 | 是 | recommend_meeting_time | recommend_meeting_time, search_empty_rooms | 允许 | deterministic-schedule-only |
| diagnose_data_status | 课表数据诊断 | 是 | schedule_data_diagnosis | diagnose_data_status | 允许 | local-status-entry |
| explain_personal_import | 个人课表导入帮助 | 否 | personal_schedule_import_help | explain_personal_import | 允许 | local-import-entry |
| get_campus_weather | 校区天气 | 是 | campus_weather | get_campus_weather | 允许 | weather-unavailable-notice |
| get_course_weather_advice | 课程天气建议 | 是 | course_weather_advice | get_course_weather_advice | 允许 | schedule-with-weather-unavailable-notice |
| search_campus_place | 校园地点 | 是 | campus_place_navigation | search_campus_place | 允许 | local-campus-map-entry |
| get_campus_route | 校园路线 | 是 | campus_place_navigation | get_campus_route | 允许 | local-campus-map-entry |
| get_classroom_location | 教室位置 | 是 | campus_place_navigation | get_classroom_location | 允许 | local-campus-map-entry |
| next_course_location | 下一节课地点 | 是 | next_course_location | get_next_course, get_classroom_location | 允许 | schedule-with-navigation-entry |
| manage_course_reminders | 课程提醒管理 | 是 | course_reminders | create_course_reminder, update_course_reminder, delete_course_reminder, list_course_reminders | 允许 | app-only-reminder |
| course_action_advice | 课程出发建议 | 是 | course_action_advice | get_next_course, get_tomorrow_courses, get_course_route, get_course_weather_advice, navigate_miniprogram_page | 允许 | schedule-with-explicit-route-assumption |
| inspect_schedule_health | 课表健康检查 | 是 | schedule_health | inspect_schedule_conflicts, navigate_miniprogram_page | 允许 | local-schedule-summary-only |
| detect_schedule_changes | 课表变化检测 | 是 | schedule_health | detect_schedule_changes, navigate_miniprogram_page | 允许 | local-schedule-summary-only |
| conversation_memory | 会话记忆 | 否 | personal_memory | - | 允许 | local-memory-only |
| update_user_preference | 更新用户偏好 | 否 | personal_memory | update_user_preference | 允许 | local-memory-only |
| rag_search | 校园知识检索 | 是 | knowledge_search | rag_search | 允许 | published-lexical-search |
| project_qa | 项目帮助问答 | 否 | knowledge_search | - | 允许 | published-project-help |
| conversational_help | 对话与能力帮助 | 否 | knowledge_search | - | 允许 | deterministic-help |
| generate_image | 图片生成 | 否 | image_generation | generate_image | 禁止 | unsupported-in-public |
| campus_multi_step_advice | 校园多步骤建议 | 是 | campus_multi_step_advice | get_today_courses, get_tomorrow_courses, search_empty_rooms, get_campus_weather, search_campus_place | 允许 | partial-deterministic-results |
| set_current_schedule | 设置首页课表 | 否 | schedule_target_action | set_current_schedule | 允许 | explicit-user-command-required |

## Tools

| Tool | operation | confirmation | safety | runtimeModes | 有 inputSchema |
| --- | --- | --- | --- | --- | --- |
| get_today_courses | read | none | low | public/trial/dev | 否 |
| get_tomorrow_courses | read | none | low | public/trial/dev | 否 |
| get_next_course | read | none | low | public/trial/dev | 否 |
| get_week_schedule | read | none | low | public/trial/dev | 否 |
| get_teaching_week | read | none | low | public/trial/dev | 否 |
| get_term_calendar | read | none | low | public/trial/dev | 否 |
| search_empty_rooms | read | none | low | public/trial/dev | 否 |
| search_continuous_empty_rooms | read | none | low | public/trial/dev | 否 |
| search_school_index | read | none | low | public/trial/dev | 否 |
| get_schedule_detail | read | none | low | public/trial/dev | 否 |
| diagnose_data_status | read | none | low | public/trial/dev | 否 |
| explain_personal_import | read | none | medium | public/trial/dev | 否 |
| recommend_meeting_time | read | none | low | public/trial/dev | 否 |
| clarify_missing_slot | read | none | low | public/trial/dev | 否 |
| get_campus_weather | read | none | low | public/trial/dev | 否 |
| get_course_weather_advice | read | none | low | public/trial/dev | 否 |
| search_campus_place | read | none | low | public/trial/dev | 否 |
| get_campus_route | read | none | low | public/trial/dev | 否 |
| get_classroom_location | read | none | low | public/trial/dev | 否 |
| get_today_schedule | read | none | medium | public/trial/dev | 是 |
| get_course_route | read | none | medium | public/trial/dev | 是 |
| inspect_schedule_conflicts | read | none | medium | public/trial/dev | 是 |
| detect_schedule_changes | read | none | medium | public/trial/dev | 是 |
| navigate_miniprogram_page | read | none | low | public/trial/dev | 是 |
| create_course_reminder | write | required | high | public/trial/dev | 是 |
| update_course_reminder | write | required | high | public/trial/dev | 是 |
| delete_course_reminder | write | required | high | public/trial/dev | 是 |
| list_course_reminders | read | none | medium | public/trial/dev | 是 |
| update_user_preference | write | explicit_user_command | medium | public/trial/dev | 是 |
| rag_search | read | none | low | public/trial/dev | 否 |
| generate_image | read | none | medium | trial/dev | 否 |
| set_current_schedule | write | explicit_user_command | medium | public/trial/dev | 是 |

## Actions（Action Command）

| Action | 名称 | operation | confirmation | targetPolicy |
| --- | --- | --- | --- | --- |
| navigate | 页面跳转 | read | none | page_url_whitelist |
| openSheet | 打开面板 | read | none | sheet_enum_whitelist |
| fillComposer | 填入待发送文本 | read | none | none |
| fillForm | 填写表单字段 | read | none | form_field_whitelist |
| requestSubscribe | 请求订阅授权 | write | required | subscribe_scene_whitelist |
| confirmWrite | 写操作确认 | write | required | write_intent_whitelist |
| copy | 复制结果 | read | none | none |
| retry | 重试安全任务 | read | none | retryable_task_whitelist |
| setCurrentSchedule | 设置首页课表 | write | explicit_user_command | schedule_target_whitelist |
| importStudentSchedule | 导入个人课表 | write | required | personal_import_session |
| resyncStudentSchedule | 重新同步个人课表 | write | required | personal_import_session |
| saveCustomCourse | 保存自定义课程 | write | required | custom_course_whitelist |
| deleteCustomCourse | 删除自定义课程 | write | required | custom_course_whitelist |
| saveStudentArrangement | 保存调课编辑 | write | required | personal_arrangement_whitelist |
| clearLocalCache | 清除本地缓存 | write | required | cache_scope_whitelist |
| resetToNewUser | 重置为新用户 | write | required | local_data_reset |
| submitFeedback | 提交意见反馈 | write | required | feedback_channel |
| refreshBootstrapData | 刷新基础数据 | read | none | bootstrap_refresh |
| createCourseReminder | 创建课程提醒 | write | required | reminder_whitelist |
| deleteReminder | 删除课程提醒 | write | required | reminder_whitelist |
| clearAgentMemory | 清除小序记忆 | write | required | agent_memory_scope |

## Card Actions（卡片按钮 → Action Command 映射）

| 卡片按钮 | 映射 Command | 说明 |
| --- | --- | --- |
| navigate | navigate | 跳转白名单页面 |
| switchTab | navigate | 跳转 tabBar 页面（navigate 的 tab 变体） |
| retry | retry | 重试安全任务 |
| openSheet | openSheet | 打开面板 |
| toggleFloat | openSheet | 切换悬浮助手（面板类 UI 控制） |
| confirmReminder | confirmWrite | 提醒写确认（confirmWrite 的特化） |
| manageReminders | openSheet | 管理提醒（openSheet reminders 的特化） |
| ask | （协议层特殊类型） | 追问按钮，纯对话交互 |
| noop | （协议层特殊类型） | 空操作占位 |

## Skills

| Skill | 版本 | 说明 | providerPolicy |
| --- | --- | --- | --- |
| today_schedule | 1.0.0 | 查询今日个人课表 | never |
| tomorrow_schedule | 1.0.0 | 查询明日个人课表 | never |
| next_course | 1.0.0 | 查询下一节课 | never |
| next_course_location | 1.0.0 | 查询下一节课及教室位置 | never |
| week_schedule | 1.0.0 | 查询本周个人课表 | never |
| teaching_week | 1.0.0 | 查询教学周 | never |
| term_calendar | 1.0.0 | 查询学期校历 | never |
| search_school_schedule | 1.0.0 | 查询全校课程索引与详情 | never |
| find_empty_room | 1.0.0 | 查询空教室 | never |
| find_continuous_empty_room | 1.0.0 | 查询连续空闲教室 | never |
| recommend_meeting_time | 1.0.0 | 基于课表与空教室推荐会议时间 | never |
| campus_multi_step_advice | 1.0.0 | 组合课表、空教室、天气和地点建议 | never |
| schedule_data_diagnosis | 1.0.0 | 诊断课表发布数据状态 | never |
| personal_schedule_import_help | 1.0.0 | 安全说明个人课表导入 | never |
| campus_weather | 1.0.0 | 查询校区天气 | never |
| course_weather_advice | 1.0.0 | 结合课程地点提供天气建议 | never |
| campus_place_navigation | 1.0.0 | 查询校内地点、路线和教室位置 | never |
| course_reminders | 1.0.0 | 规划、查看和管理上课提醒；所有写操作必须先确认 | never |
| course_action_advice | 1.0.0 | 组合下一节/明日课程、校园位置和天气，生成带明确假设的出发建议 | never |
| schedule_health | 1.0.0 | 检查个人课表中的冲突、重复、缺失教室、异常周次和连续赶课 | never |
| personal_memory | 1.0.0 | 管理用户明确要求记住的偏好，并在当前对话中恢复最近上下文 | never |
| knowledge_search | 1.0.0 | 检索已发布校园知识和项目帮助 | allowed-expression-only |
| clarify_query | 1.0.0 | 追问缺失查询条件 | never |
| image_generation | 1.0.0 | 体验环境受控图片生成 | allowed |
| schedule_target_action | 1.0.0 | 设置首页当前课表：解析班级目标（唯一匹配才执行，多候选澄清），由客户端执行真实切换并回传回执，服务端收到成功回执才提交记忆与最终答复 | never |
