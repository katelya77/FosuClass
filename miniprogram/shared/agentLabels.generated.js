// Generated from server/config/agent-capability-manifest.json. Do not edit by hand.
// Regenerate: node tools/generate-agent-event-map.js
// TOOL_LABELS keys = manifest.tools; label = manifest.tools[toolId].displayName, then manifest.intents[toolId].displayName, falling back to the tool id when the manifest carries no Chinese name.
// CARD_TYPE_LABELS keys = manifest.cardTypes; label = manifest.cardTypeLabels[cardType], falling back to the card type key when the manifest carries no Chinese label.
const TOOL_LABELS = Object.freeze({
  "get_today_courses": "今日课表",
  "get_tomorrow_courses": "明日课表",
  "get_next_course": "下一节课",
  "get_week_schedule": "本周课表",
  "get_teaching_week": "教学周",
  "get_term_calendar": "学期校历",
  "search_empty_rooms": "空教室",
  "search_continuous_empty_rooms": "连续空教室",
  "search_school_index": "全校课表检索",
  "get_schedule_detail": "课表详情",
  "diagnose_data_status": "数据状态",
  "explain_personal_import": "导入指引",
  "recommend_meeting_time": "时间推荐",
  "clarify_missing_slot": "追问",
  "get_campus_weather": "天气",
  "get_course_weather_advice": "天气建议",
  "search_campus_place": "校园地图",
  "get_campus_route": "校园地图",
  "get_classroom_location": "校园地图",
  "get_today_schedule": "今日课表",
  "get_course_route": "课程路线",
  "inspect_schedule_conflicts": "课表冲突检查",
  "detect_schedule_changes": "课表变化检测",
  "navigate_miniprogram_page": "页面跳转",
  "create_course_reminder": "创建课程提醒",
  "update_course_reminder": "更新课程提醒",
  "delete_course_reminder": "删除课程提醒",
  "list_course_reminders": "课程提醒列表",
  "update_user_preference": "更新用户偏好",
  "rag_search": "校园知识检索",
  "generate_image": "图片生成",
  "set_current_schedule": "设置首页课表"
});

const CARD_TYPE_LABELS = Object.freeze({
  "empty_room": "空教室",
  "schedule": "课表",
  "teacher": "教师",
  "course": "课程",
  "weather": "校区天气",
  "diagnosis": "数据状态",
  "guide": "指引",
  "reminder": "提醒",
  "generic": "结果"
});

module.exports = {
  TOOL_LABELS,
  CARD_TYPE_LABELS,
};
