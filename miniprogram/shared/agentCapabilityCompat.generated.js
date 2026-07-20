// Generated from server/config/agent-capability-manifest.json. Do not edit by hand.
const MANIFEST_SCHEMA_VERSION = "agent-capabilities.v1";
const PROTOCOL_VERSIONS = Object.freeze([
  "agent.v1",
  "agent.v2"
]);
const CANONICAL_INTENTS = Object.freeze([
  "clarify_missing_slot",
  "get_today_courses",
  "get_tomorrow_courses",
  "get_next_course",
  "get_week_schedule",
  "get_teaching_week",
  "get_term_calendar",
  "search_empty_rooms",
  "search_continuous_empty_rooms",
  "search_school_index",
  "get_schedule_detail",
  "recommend_meeting_time",
  "diagnose_data_status",
  "explain_personal_import",
  "get_campus_weather",
  "get_course_weather_advice",
  "search_campus_place",
  "get_campus_route",
  "get_classroom_location",
  "next_course_location",
  "rag_search",
  "project_qa",
  "conversational_help",
  "generate_image",
  "campus_multi_step_advice"
]);
const OFFLINE_INTENT_MAP = Object.freeze({
  "schedule_query": "search_school_index",
  "personal_schedule": "get_today_courses",
  "schedule_status": "diagnose_data_status",
  "weather": "get_campus_weather",
  "school_knowledge": "rag_search",
  "navigation": "search_campus_place",
  "app_navigation": "conversational_help",
  "help": "conversational_help",
  "quick_action": "conversational_help",
  "smalltalk": "conversational_help",
  "ambiguous": "clarify_missing_slot",
  "search_teacher_schedule": "search_school_index",
  "search_class_schedule": "search_school_index",
  "search_classroom_schedule": "search_school_index",
  "search_course_schedule": "search_school_index",
  "teaching_week": "get_teaching_week"
});

function toCanonicalIntent(intentName) {
  const value = String(intentName || "");
  return CANONICAL_INTENTS.indexOf(value) >= 0 ? value : (OFFLINE_INTENT_MAP[value] || "clarify_missing_slot");
}

module.exports = {
  CANONICAL_INTENTS,
  MANIFEST_SCHEMA_VERSION,
  OFFLINE_INTENT_MAP,
  PROTOCOL_VERSIONS,
  toCanonicalIntent,
};
