const DETERMINISTIC_INTENTS = new Set([
  "get_today_courses",
  "get_next_course",
  "search_teacher_schedule",
  "search_class_schedule",
  "search_classroom_schedule",
  "search_course_schedule",
  "search_empty_rooms",
  "teaching_week",
  "diagnose_data_status",
  "explain_personal_import",
  "recommend_meeting_time",
]);

const GENERATIVE_INTENTS = new Set([
  "project_qa",
  "conversational_help",
]);

const FACT_RULES = [
  { intentName: "explain_personal_import", pattern: /(xls|excel|表格|导入|个人课表|教务系统|强智|同步个人)/i },
  { intentName: "diagnose_data_status", pattern: /(诊断|数据.+失败|加载失败|打不开|空白|没有数据|缓存|版本|release|数据源)/i },
  { intentName: "recommend_meeting_time", pattern: /(共同空闲|一起有空|会议时间|自习时间|空闲时间|约时间)/i },
  { intentName: "search_empty_rooms", pattern: /(空教室|自习室|哪里有空|教室.*空|空房间|可用教室)/i },
  { intentName: "get_next_course", pattern: /(下一节|下节课|等下.*课|接下来.*课)/i },
  { intentName: "get_today_courses", pattern: /(今天.*课|今日.*课|今天还有课|今天课表|今日安排|今天上什么)/i },
  { intentName: "search_teacher_schedule", pattern: /(老师|教师|任课).*(课表|课程|在哪|上课|安排)|查.*(老师|教师)/i },
  { intentName: "search_classroom_schedule", pattern: /(教室|课室|楼|c\d|b\d|a\d).*(课表|占用|课程|上课|安排)|查.*(教室|课室)/i },
  { intentName: "search_class_schedule", pattern: /(班级|专业|学院|年级).*(课表|课程|安排)|查.*班.*课/i },
  { intentName: "search_course_schedule", pattern: /(课程|科目).*(安排|谁教|在哪|什么时候|课表)|查.*课程/i },
  { intentName: "teaching_week", pattern: /(教学周|第几周|当前周|现在.*周|校历|开学|学期周)/i },
];

const PROJECT_RULES = [
  { intentName: "project_qa", pattern: /(FosuClass|佛课小表|小佛|小序|项目|架构|Release Pack|Oracle|CloudBase|云开发|混元|DeepSeek|Coze|比赛|隐私|安全|开源|README)/i },
  { intentName: "conversational_help", pattern: /(怎么用|如何使用|帮助|功能|入口|说明|你是谁|介绍一下|能做什么|使用指南|新手)/i },
];

function normalizeText(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function classifyAiRoute(message, context = {}) {
  const text = normalizeText(message);
  const pending = context && context.pendingClarification;
  if (pending && pending.intentName === "search_school_index") {
    return {
      route: "oracle-tool",
      intentName: "search_school_index",
      reason: "pending deterministic clarification",
      deterministic: true,
      generative: false,
    };
  }
  const factRule = FACT_RULES.find((rule) => rule.pattern.test(text));
  if (factRule) {
    return {
      route: "oracle-tool",
      intentName: factRule.intentName,
      reason: "matched deterministic campus fact rule",
      deterministic: true,
      generative: false,
    };
  }
  const projectRule = PROJECT_RULES.find((rule) => rule.pattern.test(text));
  if (projectRule) {
    return {
      route: "cloudbase-hunyuan",
      intentName: projectRule.intentName,
      reason: "matched project/help generative rule",
      deterministic: false,
      generative: true,
    };
  }
  return {
    route: "cloudbase-hunyuan",
    intentName: "conversational_help",
    reason: "default conversational route",
    deterministic: false,
    generative: true,
  };
}

function isDeterministicIntent(intentName) {
  return DETERMINISTIC_INTENTS.has(String(intentName || ""));
}

function isGenerativeIntent(intentName) {
  return GENERATIVE_INTENTS.has(String(intentName || ""));
}

module.exports = {
  DETERMINISTIC_INTENTS,
  GENERATIVE_INTENTS,
  classifyAiRoute,
  isDeterministicIntent,
  isGenerativeIntent,
};
