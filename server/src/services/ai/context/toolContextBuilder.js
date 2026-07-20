/**
 * Build concise tool descriptions for planner / composer.
 */

const TOOL_DESCRIPTIONS = Object.freeze({
  get_today_courses: {
    when: "用户问今天有什么课、今日课表",
    whenNot: "问明天/本周/某教师时不要用",
    returns: "今日课程列表或需导入个人课表提示",
    source: "个人课表摘要（用户授权）",
  },
  get_tomorrow_courses: {
    when: "用户问明天课程、明天下午是否有课",
    whenNot: "问今天或本周全览时优先其它工具",
    returns: "明日课程列表",
    source: "个人课表摘要",
  },
  get_next_course: {
    when: "下一节课在哪、马上要上什么课",
    whenNot: "查全天课表时用 get_today_courses",
    returns: "下一节课时间地点",
    source: "个人课表摘要 + 当前时间",
  },
  get_week_schedule: {
    when: "本周课表、这一周有哪些课",
    whenNot: "仅问今天/明天时不必拉整周",
    returns: "本周课程",
    source: "个人课表摘要",
  },
  get_teaching_week: {
    when: "现在第几教学周、教学周是多少",
    whenNot: "不要用于回答具体课程事实",
    returns: "当前教学周数字与学期信息",
    source: "Release Pack / 校历",
  },
  search_empty_rooms: {
    when: "找空教室、哪里有空教室",
    whenNot: "已有明确连续时段需求时优先 continuous",
    returns: "空教室列表",
    source: "全校课表占用索引",
  },
  search_continuous_empty_rooms: {
    when: "连续两节/多节空教室、自习长时段",
    whenNot: "只问当前是否空时可用 search_empty_rooms",
    returns: "连续空闲教室",
    source: "全校课表占用索引",
  },
  get_campus_weather: {
    when: "校区天气、会不会下雨、带伞吗",
    whenNot: "非天气问题时不要调用",
    returns: "校区天气摘要",
    source: "天气服务",
  },
  search_campus_place: {
    when: "某地点在哪、怎么走、建筑位置",
    whenNot: "教室占用查询用 empty room / classroom tools",
    returns: "地点与导航提示",
    source: "校园地图",
  },
  get_classroom_location: {
    when: "某教室在哪栋楼",
    whenNot: "查是否空闲用 empty room tools",
    returns: "教室位置",
    source: "校园地图",
  },
  search_school_index: {
    when: "查班级/教师/课程课表（全校索引）",
    whenNot: "个人今日课用 get_today_courses；缺教师名时先 clarify",
    returns: "索引匹配结果",
    source: "全校课表索引",
  },
  rag_search: {
    when: "产品怎么用、隐私、导入说明、非课表事实的公开知识",
    whenNot: "课程/教室/教学周等事实必须用对应事实工具",
    returns: "知识片段与引用",
    source: "已发布公开知识库",
  },
  clarify_missing_slot: {
    when: "缺少必要参数（教师名、校区、时段等）",
    whenNot: "参数已齐全时不要 clarify",
    returns: "结构化追问",
    source: "对话策略",
  },
  diagnose_data_status: {
    when: "数据是否最新、为什么查不到",
    whenNot: "正常事实查询优先直接工具",
    returns: "数据状态诊断",
    source: "Release Pack 状态",
  },
  explain_personal_import: {
    when: "如何导入个人课表、教务系统怎么同步",
    whenNot: "已导入后的查课请求",
    returns: "导入指引",
    source: "产品知识",
  },
});

function buildToolCatalog(toolNames = [], options = {}) {
  const max = Math.max(1, Number(options.maxTools || 24) || 24);
  const names = (Array.isArray(toolNames) ? toolNames : []).slice(0, max);
  return names.map((name) => {
    const desc = TOOL_DESCRIPTIONS[name] || {
      when: `调用 ${name}`,
      whenNot: "无明确需求时不要调用",
      returns: "工具结果",
      source: "校园服务",
    };
    return {
      name,
      description: [
        `use when: ${desc.when}`,
        `do not use when: ${desc.whenNot}`,
        `returns: ${desc.returns}`,
        `source: ${desc.source}`,
      ].join(" | "),
    };
  });
}

function buildToolPromptLines(toolNames = []) {
  return buildToolCatalog(toolNames).map((t) => `- ${t.name}: ${t.description}`);
}

module.exports = {
  TOOL_DESCRIPTIONS,
  buildToolCatalog,
  buildToolPromptLines,
};
