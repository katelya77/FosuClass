#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const kb = require("../server/src/services/ai/knowledgeBaseService");

const ALL_SCOPES = ["public", "trial", "dev"];

function nowIso() {
  return new Date().toISOString();
}

function versionStamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function normalizeId(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function action(label, url, payload = {}) {
  return { type: "navigate", label, url, payload };
}

function card(type, title, subtitle = "", actions = []) {
  return {
    type,
    title,
    subtitle,
    badges: ["本地规则", "工具优先"],
    items: [],
    actions,
  };
}

function rule(input) {
  const id = input.id || `assistant-rule-${normalizeId(input.title)}`;
  const reply = input.reply || input.body || "";
  return {
    id,
    sourceId: id,
    type: "rule",
    title: input.title,
    status: "draft",
    scope: input.scope || ALL_SCOPES,
    tags: input.tags || ["assistant-local-rule"],
    keywords: input.keywords || [],
    synonyms: input.synonyms || [],
    patterns: input.patterns || [],
    intentName: input.intentName || "",
    toolName: input.toolName || "",
    cardType: input.cardType || "",
    priority: input.priority || 100,
    body: input.body || reply,
    reply,
    suggestions: input.suggestions || ["查今日课表", "查空教室", "怎么导入个人课表？"],
    action: input.action || {},
    card: input.card || {},
    updatedAt: nowIso(),
  };
}

function doc(input) {
  const id = input.id || `assistant-doc-${normalizeId(input.title)}`;
  return {
    id,
    sourceId: id,
    type: "doc",
    title: input.title,
    status: "draft",
    scope: input.scope || ALL_SCOPES,
    tags: input.tags || ["assistant-seed-doc"],
    keywords: input.keywords || [],
    synonyms: input.synonyms || [],
    priority: input.priority || 20,
    body: input.body,
    updatedAt: nowIso(),
  };
}

function readMiniprogramKnowledgeSummary() {
  try {
    const localKb = require("../miniprogram/data/fosuKnowledgeBase");
    return {
      version: localKb.version || "",
      updatedAt: localKb.updatedAt || "",
      docCount: Array.isArray(localKb.docs) ? localKb.docs.length : 0,
      categoryCount: Array.isArray(localKb.categories) ? localKb.categories.length : 0,
    };
  } catch (error) {
    return {
      version: "",
      updatedAt: "",
      docCount: 0,
      categoryCount: 0,
      error: error && error.message || "local knowledge module unavailable",
    };
  }
}

function buildSeedEntries() {
  const rules = [
    rule({
      id: "assistant-rule-capability-intro",
      title: "小佛助手能力介绍",
      keywords: ["你能做什么", "佛课小表能做什么", "小佛助手", "怎么用", "使用帮助"],
      synonyms: ["能力介绍", "功能介绍", "校园助手", "佛课小表"],
      patterns: ["(你|小佛).*(能做|会做|能查)", "佛课小表.*(功能|能做什么|怎么用)"],
      intentName: "project_qa",
      cardType: "guide",
      priority: 160,
      body: "介绍小佛助手能力时，可以说明它能帮你查今日/明日/本周课表、下一节课、班级/教师/教室/课程课表、空教室、教学周、校历、天气、校园地图、个人课表导入和数据状态。涉及课程、教室、教师、空教室和教学周事实时，必须转交工具核验。",
      reply: "我是小佛助手，可以帮你查课表、找空教室、看教学周和校历、查询天气和校园地点，也能引导你导入个人课表。涉及具体课程、教师、教室和空教室时，我会先用工具核验，再把结果整理成卡片。",
      suggestions: ["查今日课表", "查空教室", "C7在哪？"],
      card: card("guide", "小佛助手能力", "工具优先，结果以卡片展示", [
        action("打开全校查询", "/pages/school/school"),
        action("导入个人课表", "/pages/personal-sync/personal-sync"),
      ]),
    }),
    rule({
      id: "assistant-rule-today-schedule",
      title: "今日课表",
      keywords: ["今天课表", "今日课表", "今天有什么课", "今天还上课吗", "今天安排"],
      synonyms: ["今天课程", "今日安排", "今天还剩什么课"],
      patterns: ["(今天|今日).*(课表|课程|安排|上什么课)", "今天.*还有.*课"],
      intentName: "get_today_courses",
      toolName: "get_today_courses",
      cardType: "schedule",
      priority: 150,
      body: "今日课表规则只负责触发 `get_today_courses`，课程事实来自用户授权的个人课表摘要。",
      suggestions: ["下一节课是什么？", "今天有空教室吗？"],
      action: action("查看今日安排", "/pages/today/today"),
      card: card("schedule", "今日课表", "基于个人课表摘要核验", [action("查看今日安排", "/pages/today/today")]),
    }),
    rule({
      id: "assistant-rule-tomorrow-schedule",
      title: "明日课表",
      keywords: ["明天课表", "明日课表", "明天有什么课", "明天安排"],
      synonyms: ["明天课程", "明日安排", "明天上课"],
      patterns: ["(明天|明日).*(课表|课程|安排|上什么课)"],
      intentName: "get_tomorrow_courses",
      toolName: "get_tomorrow_courses",
      cardType: "schedule",
      priority: 148,
      body: "明日课表规则只触发工具查询，不在知识库写入明天课程事实。",
      suggestions: ["明天下午有空教室吗？", "本周课表"],
      action: action("查看课表", "/pages/today/today"),
      card: card("schedule", "明日课表", "基于个人课表摘要核验", [action("查看课表", "/pages/today/today")]),
    }),
    rule({
      id: "assistant-rule-next-course",
      title: "下一节课",
      keywords: ["下一节课", "下节课", "马上上什么课", "接下来什么课"],
      synonyms: ["下一门课", "接下来上课", "还剩什么课"],
      patterns: ["(下一节|下节|接下来|马上).*(课|课程)", "还.*什么课"],
      intentName: "get_next_course",
      toolName: "get_next_course",
      cardType: "schedule",
      priority: 148,
      body: "下一节课规则触发个人课表摘要工具，地点和时间以工具结果为准。",
      suggestions: ["下一节课教室在哪？", "今天课表"],
      action: action("查看今日安排", "/pages/today/today"),
      card: card("schedule", "下一节课", "基于个人课表摘要核验", [action("查看今日安排", "/pages/today/today")]),
    }),
    rule({
      id: "assistant-rule-week-schedule",
      title: "本周课表",
      keywords: ["本周课表", "这一周课表", "整周课表", "本周安排"],
      synonyms: ["这周课程", "周课表", "一周安排"],
      patterns: ["(本周|这周|这一周|整周).*(课表|课程|安排)"],
      intentName: "get_week_schedule",
      toolName: "get_week_schedule",
      cardType: "schedule",
      priority: 145,
      body: "本周课表规则触发个人课表摘要工具，教学周和课程事实由工具核验。",
      suggestions: ["今天有什么课？", "现在第几周？"],
      action: action("查看课表", "/pages/today/today"),
      card: card("schedule", "本周课表", "基于当前教学周核验", [action("查看课表", "/pages/today/today")]),
    }),
    rule({
      id: "assistant-rule-class-schedule",
      title: "查班级课表",
      keywords: ["班级课表", "行政班课表", "25动物医学6班", "25动医6", "动医6班"],
      synonyms: ["查班级", "专业班级课表", "某班课表"],
      patterns: ["\\d{2}.*(班|专业).*课表", "(动医|动物医学).*\\d.*班", "查.*班.*课表"],
      intentName: "search_school_index",
      toolName: "search_school_index",
      cardType: "generic",
      priority: 142,
      body: "班级课表规则触发全校索引查询，班级名称和课程详情必须来自已发布课表索引和详情。",
      suggestions: ["查25动物医学6班课表", "查教师课表"],
      action: action("打开全校查询", "/pages/school/school?type=class"),
      card: card("generic", "班级课表查询", "从全校课表索引核验", [action("打开全校查询", "/pages/school/school?type=class")]),
    }),
    rule({
      id: "assistant-rule-teacher-schedule",
      title: "查教师课表",
      keywords: ["教师课表", "老师课表", "任课老师", "查老师"],
      synonyms: ["查教师", "老师上课", "教师安排"],
      patterns: ["查.*(老师|教师).*课表", "(老师|教师).*(课表|安排|上课)"],
      intentName: "search_school_index",
      toolName: "search_school_index",
      cardType: "teacher",
      priority: 140,
      body: "教师课表规则触发全校教师索引查询，教师和课程事实来自已发布课表数据。",
      suggestions: ["查某老师课表", "查教室课表"],
      action: action("打开教师查询", "/pages/school/school?type=teacher"),
      card: card("teacher", "教师课表查询", "从教师索引核验", [action("打开教师查询", "/pages/school/school?type=teacher")]),
    }),
    rule({
      id: "assistant-rule-classroom-schedule",
      title: "查教室课表",
      keywords: ["教室课表", "教室占用", "C7-203", "B8教室", "查教室"],
      synonyms: ["教室安排", "教室使用情况", "课室占用"],
      patterns: ["[A-Z]\\d{1,2}[-栋楼]?\\d{0,4}.*(课表|占用|安排)", "查.*(教室|课室).*课表"],
      intentName: "search_school_index",
      toolName: "search_school_index",
      cardType: "generic",
      priority: 140,
      body: "教室课表规则触发全校教室索引查询，楼栋和占用事实来自已发布课表数据。",
      suggestions: ["查C7-203教室", "现在有空教室吗？"],
      action: action("打开教室查询", "/pages/school/school?type=classroom"),
      card: card("generic", "教室课表查询", "从教室索引核验", [action("打开教室查询", "/pages/school/school?type=classroom")]),
    }),
    rule({
      id: "assistant-rule-course-schedule",
      title: "查课程课表",
      keywords: ["课程课表", "课程安排", "查课程", "高等数学", "大学英语"],
      synonyms: ["查课名", "课程上课时间", "课程任课"],
      patterns: ["查.*(课程|课名|科目).*(课表|安排)?", "(高等数学|大学英语|体育|实验).*课"],
      intentName: "search_school_index",
      toolName: "search_school_index",
      cardType: "course",
      priority: 138,
      body: "课程课表规则触发全校课程索引查询，课程事实来自已发布课表数据。",
      suggestions: ["查高等数学课程", "查教师课表"],
      action: action("打开课程查询", "/pages/school/school?type=course"),
      card: card("course", "课程课表查询", "从课程索引核验", [action("打开课程查询", "/pages/school/school?type=course")]),
    }),
    rule({
      id: "assistant-rule-empty-room",
      title: "空教室",
      keywords: ["空教室", "自习室", "哪里没课", "可用教室", "找教室"],
      synonyms: ["空课室", "自习位置", "有空教室吗"],
      patterns: ["(空教室|自习室|可用教室|哪里没课)", "(现在|今天|下午|晚上).*空.*教室"],
      intentName: "search_empty_rooms",
      toolName: "search_empty_rooms",
      cardType: "empty_room",
      priority: 150,
      body: "空教室规则触发空教室索引工具，教室可用事实来自已发布空教室索引。",
      suggestions: ["C7附近现在有空教室吗？", "找连续两节空教室"],
      action: action("查看空教室", "/pages/empty-room/empty-room"),
      card: card("empty_room", "空教室查询", "从空教室索引核验", [action("查看空教室", "/pages/empty-room/empty-room")]),
    }),
    rule({
      id: "assistant-rule-continuous-empty-room",
      title: "连续空教室",
      keywords: ["连续空教室", "连续两节", "连续三节", "连着空", "连堂空教室"],
      synonyms: ["连续自习室", "连着两节空教室", "长时间自习"],
      patterns: ["连续.*(空教室|自习室)", "连着.*(空教室|自习室)", "(两节|2节|三节|3节).*空教室"],
      intentName: "search_continuous_empty_rooms",
      toolName: "search_continuous_empty_rooms",
      cardType: "empty_room",
      priority: 149,
      body: "连续空教室规则触发连续节数筛选，结果来自空教室工具。",
      suggestions: ["找连续2节空教室", "找下午连续空教室"],
      action: action("查看空教室", "/pages/empty-room/empty-room"),
      card: card("empty_room", "连续空教室", "按连续节数筛选", [action("查看空教室", "/pages/empty-room/empty-room")]),
    }),
    rule({
      id: "assistant-rule-teaching-week",
      title: "教学周",
      keywords: ["第几周", "教学周", "当前周", "现在第几教学周"],
      synonyms: ["本周是第几周", "当前教学周", "学期周次"],
      patterns: ["(现在|今天|当前).*(第几周|教学周)", "第几.*教学周"],
      intentName: "get_teaching_week",
      toolName: "get_teaching_week",
      cardType: "generic",
      priority: 135,
      body: "教学周规则触发教学周工具，周次事实来自学期配置和日期计算。",
      suggestions: ["本周课表", "校历"],
      card: card("generic", "教学周", "从学期配置计算", []),
    }),
    rule({
      id: "assistant-rule-term-calendar",
      title: "校历",
      keywords: ["校历", "学期日历", "什么时候开学", "什么时候放假", "学期安排"],
      synonyms: ["教学日历", "开学日期", "放假安排"],
      patterns: ["(校历|学期日历|教学日历)", "(开学|放假|学期).*(日期|安排|什么时候)"],
      intentName: "get_term_calendar",
      toolName: "get_term_calendar",
      cardType: "guide",
      priority: 132,
      body: "校历规则触发学期日历工具，日期事实来自学期配置。",
      suggestions: ["现在第几教学周？", "本周课表"],
      card: card("guide", "学期校历", "从学期配置核验", []),
    }),
    rule({
      id: "assistant-rule-weather",
      title: "天气查询和建议",
      keywords: ["天气", "下雨", "带伞", "高温", "降雨", "出行建议"],
      synonyms: ["校区天气", "天气建议", "雨伞提醒"],
      patterns: ["(天气|下雨|带伞|降雨|高温|雷暴)", "(仙溪|江湾|河滨).*天气"],
      intentName: "get_campus_weather",
      toolName: "get_campus_weather",
      cardType: "weather",
      priority: 146,
      body: "天气规则必须触发天气工具并返回天气卡片；天气事实来自天气服务。",
      suggestions: ["仙溪天气", "下一节课前要带伞吗？"],
      card: card("weather", "校区天气", "调用天气卡片", []),
    }),
    rule({
      id: "assistant-rule-campus-map",
      title: "校园地图、地点查询、路线和教室位置",
      keywords: ["校园地图", "地点查询", "怎么走", "在哪", "教室位置", "C7在哪", "图书馆位置"],
      synonyms: ["路线", "导航", "地点", "楼栋位置", "校区地图"],
      patterns: ["(地图|地点|位置|路线|怎么走|在哪)", "[A-Z]\\d{1,2}.*(在哪|位置|怎么走)"],
      intentName: "search_campus_place",
      toolName: "search_campus_place",
      cardType: "generic",
      priority: 144,
      body: "校园地图规则触发地图/地点工具；教室和楼栋位置以结构化地图数据为准。",
      suggestions: ["C7在哪？", "仙溪图书馆怎么走？"],
      action: action("打开校园地图", "/packageMaps/pages/campus-map/campus-map"),
      card: card("generic", "校园地图", "查询地点和教室位置", [action("打开校园地图", "/packageMaps/pages/campus-map/campus-map")]),
    }),
    rule({
      id: "assistant-rule-next-course-location",
      title: "下一节课位置",
      keywords: ["下一节课教室在哪", "下节课怎么走", "接下来上课位置"],
      synonyms: ["下一节课地图", "下节课位置", "教室怎么走"],
      patterns: ["(下一节|下节|接下来).*课.*(在哪|位置|怎么走|地图)"],
      intentName: "next_course_location",
      toolName: "get_next_course",
      cardType: "schedule",
      priority: 147,
      body: "下一节课位置规则先查个人课表的下一节课，再查教室位置；不在知识库写死上课地点。",
      suggestions: ["下一节课是什么？", "C7在哪？"],
      action: action("查看今日安排", "/pages/today/today"),
      card: card("schedule", "下一节课位置", "课表和地图组合查询", [action("查看今日安排", "/pages/today/today")]),
    }),
    rule({
      id: "assistant-rule-personal-import",
      title: "个人课表导入和同步",
      keywords: ["导入个人课表", "同步课表", "XLS导入", "Excel课表", "个人课表"],
      synonyms: ["课表导入", "文件导入", "表格导入", "同步个人安排"],
      patterns: ["(导入|同步).*(个人)?课表", "(XLS|Excel|表格|文件).*课表"],
      intentName: "explain_personal_import",
      toolName: "explain_personal_import",
      cardType: "guide",
      priority: 150,
      body: "个人课表导入规则触发导入说明工具。正式版不得在聊天框接收学号、密码或其他敏感凭证。",
      suggestions: ["打开个人课表同步", "今天有什么课？"],
      action: action("打开个人课表同步", "/pages/personal-sync/personal-sync"),
      card: card("guide", "个人课表导入", "不接收账号密码", [action("打开个人课表同步", "/pages/personal-sync/personal-sync")]),
    }),
    rule({
      id: "assistant-rule-data-status",
      title: "数据是否最新和异常诊断",
      keywords: ["数据最新吗", "数据异常", "加载失败", "为什么查不到", "课表不对", "空教室数据"],
      synonyms: ["数据状态", "数据诊断", "缓存异常", "课表是否最新"],
      patterns: ["数据.*(最新|异常|失败|不对)", "(加载失败|查不到|课表不对|缓存)"],
      intentName: "diagnose_data_status",
      toolName: "diagnose_data_status",
      cardType: "diagnosis",
      priority: 136,
      body: "数据状态规则触发诊断工具，状态事实来自 active release、索引和缓存检查。",
      suggestions: ["检查数据状态", "重新查空教室"],
      card: card("diagnosis", "数据状态", "检查课表索引和空教室索引", []),
    }),
    rule({
      id: "assistant-rule-privacy",
      title: "隐私说明",
      keywords: ["隐私", "会保存密码吗", "会上传课表吗", "账号密码", "安全吗", "个人信息"],
      synonyms: ["隐私安全吗", "数据安全", "密码安全", "课表摘要"],
      patterns: ["(隐私|安全|个人信息|账号|密码)", "(保存|上传|读取).*(课表|密码|个人信息)"],
      intentName: "rag_search",
      toolName: "rag_search",
      cardType: "guide",
      priority: 130,
      body: "隐私规则从知识库返回公开隐私说明。若用户输入账号、密码或其他敏感凭证，应先由安全过滤拦截。",
      suggestions: ["怎么导入个人课表？", "小佛助手能做什么？"],
      card: card("guide", "隐私与安全", "最小必要信息原则", []),
    }),
    rule({
      id: "assistant-rule-clarify",
      title: "无法识别时的友好追问",
      keywords: ["帮我查一下", "看看课表", "找个教室", "查课", "安排一下"],
      synonyms: ["不完整问题", "缺少关键词", "追问"],
      patterns: ["^(帮我)?查(一下)?$", "^找个教室$", "^看看课表$"],
      intentName: "clarify_missing_slot",
      toolName: "clarify_missing_slot",
      cardType: "guide",
      priority: 80,
      body: "无法识别或缺少槽位时，追问用户要查教师、班级、教室、课程、空教室还是个人课表。",
      suggestions: ["查今日课表", "查C7-203教室", "找空教室"],
      card: card("guide", "需要补充条件", "请补充教师、班级、教室、课程或时间", []),
    }),
  ];

  const docs = [
    doc({
      id: "assistant-doc-overview",
      title: "佛课小表功能总览",
      keywords: ["佛课小表", "功能总览", "小佛助手", "校园查询"],
      priority: 60,
      body: [
        "# 佛课小表功能总览",
        "佛课小表提供全校课表查询、个人课表摘要、空教室查询、教学周和校历、天气提醒、校园地图、数据状态说明和常见问题帮助。",
        "小佛助手负责把这些能力组织成自然语言入口和卡片结果。课程、教师、教室、空教室、教学周等事实必须来自工具链或用户授权的个人课表摘要。",
      ].join("\n\n"),
    }),
    doc({
      id: "assistant-doc-formal-local-rules",
      title: "正式版本地规则说明",
      keywords: ["正式版", "本地规则", "公开发布", "工具优先"],
      priority: 58,
      body: [
        "# 正式版本地规则说明",
        "正式版使用本地规则、已发布知识库和已有工具卡片处理用户问题。规则负责理解入口和追问，工具负责核验事实，卡片负责展示结果。",
        "正式版不向用户展示内部实现细节，也不让说明文档编造课程、教室、教师、空教室、教学周或校历事实。",
      ].join("\n\n"),
    }),
    doc({
      id: "assistant-doc-schedule-query",
      title: "课表查询说明",
      keywords: ["课表查询", "今日课表", "明日课表", "班级课表", "教师课表", "教室课表", "课程课表"],
      priority: 56,
      body: [
        "# 课表查询说明",
        "用户可以问今日课表、明日课表、下一节课、本周课表，也可以按班级、教师、教室、课程查询全校课表。",
        "个人今日/明日/本周课表需要用户先导入或授权个人课表摘要。全校班级、教师、教室、课程查询以已发布课表索引和详情为准。",
      ].join("\n\n"),
    }),
    doc({
      id: "assistant-doc-empty-room",
      title: "空教室查询说明",
      keywords: ["空教室", "连续空教室", "自习室", "可用教室"],
      priority: 55,
      body: [
        "# 空教室查询说明",
        "用户可以按日期、节次、楼栋和连续节数查询空教室，例如“现在有空教室吗”“C7附近连续两节空教室”。",
        "空教室结果来自已发布的空教室索引。没有结果时，应提示用户换楼栋、换节次或检查数据状态。",
      ].join("\n\n"),
    }),
    doc({
      id: "assistant-doc-weather-card",
      title: "天气卡片说明",
      keywords: ["天气", "天气卡片", "带伞", "出行建议"],
      priority: 54,
      body: [
        "# 天气卡片说明",
        "天气问题必须调用天气工具并返回天气卡片。卡片可展示校区、天气文字、温度、降水、更新时间和出行建议。",
        "天气也可以和下一节课、空教室、路线建议组合，但课程和教室事实仍来自对应工具。",
      ].join("\n\n"),
    }),
    doc({
      id: "assistant-doc-personal-import",
      title: "个人课表导入说明",
      keywords: ["个人课表", "导入", "同步", "XLS", "Excel"],
      priority: 54,
      body: [
        "# 个人课表导入说明",
        "用户需要先打开个人课表同步入口，按页面指引导入或同步本地个人课表。小佛助手不会在聊天框接收学号、密码或其他敏感凭证。",
        "导入后，今日课表、明日课表、下一节课、本周课表和自习时间推荐会使用最小必要课表摘要。",
      ].join("\n\n"),
    }),
    doc({
      id: "assistant-doc-data-source",
      title: "数据来源与更新说明",
      keywords: ["数据来源", "更新", "数据最新", "已发布课表数据", "缓存"],
      priority: 52,
      body: [
        "# 数据来源与更新说明",
        "全校课表、索引、详情和空教室来自已发布的数据包和本地缓存。小佛助手只能说明数据状态，不应在知识库里写死课程事实。",
        "当用户问数据是否最新或为什么加载失败时，应调用数据诊断工具，展示索引数量、空教室索引和当前数据状态。",
      ].join("\n\n"),
    }),
    doc({
      id: "assistant-doc-campus-map",
      title: "校园地图使用说明",
      keywords: ["校园地图", "地点查询", "路线", "教室位置", "C7", "图书馆"],
      priority: 52,
      body: [
        "# 校园地图使用说明",
        "用户可以查询校区地点、楼栋、教室位置和大致路线，例如“C7在哪”“图书馆怎么走”。",
        "地图数据用于定位和入口跳转；未维护精确坐标时，应明确说明只能提供参考位置。",
      ].join("\n\n"),
    }),
    doc({
      id: "assistant-doc-faq",
      title: "常见问题 FAQ",
      keywords: ["FAQ", "常见问题", "查不到", "怎么问", "为什么没有结果"],
      priority: 50,
      body: [
        "# 常见问题 FAQ",
        "如果查不到教师、班级、教室或课程，建议换更短关键词、检查名称是否完整，或打开全校查询页面继续筛选。",
        "如果空教室没有结果，建议换楼栋、换节次、减少连续节数，或检查数据状态。",
        "如果今日课表为空，建议先确认是否已经导入个人课表摘要。",
      ].join("\n\n"),
    }),
    doc({
      id: "assistant-doc-privacy",
      title: "隐私与安全说明",
      keywords: ["隐私", "安全", "账号密码", "敏感凭证", "个人课表"],
      priority: 50,
      body: [
        "# 隐私与安全说明",
        "聊天框不应接收学号、密码或其他敏感凭证。用户需要导入个人课表时，应进入个人课表同步页面。",
        "个人课表摘要只包含完成查询所需的课程名、教师、教室、星期、节次和周次等最小字段。用户可重新导入或清理本地数据。",
      ].join("\n\n"),
    }),
    doc({
      id: "assistant-doc-trial-dev-internal",
      title: "体验版/开发版内部说明",
      scope: ["trial", "dev"],
      keywords: ["体验版", "开发版", "Provider", "DeepSeek", "Coze", "CloudBase"],
      priority: 20,
      body: [
        "# 体验版/开发版内部说明",
        "体验版和开发版可启用增强理解能力，用于槽位补全、表达组织和调试。可选 Provider 包括 DeepSeek、CloudBase OpenAI 和 Coze。",
        "外部模型不得编造课程、教师、教室、空教室、教学周或校历事实；事实任务必须使用工具链结果。",
        "本说明仅用于 trial/dev 范围，不能发布到 public 范围。",
      ].join("\n\n"),
    }),
  ];

  return {
    rules,
    docs,
    sources: {
      inventory: "docs/assistant-local-rule-inventory.md",
      toolRegistry: "server/src/services/ai/toolRegistry.js",
      mockProvider: "server/src/services/ai/providers/mockProvider.js",
      miniprogramKnowledge: readMiniprogramKnowledgeSummary(),
    },
  };
}

function upsertEntries(bucket, entries) {
  entries.forEach((entry) => {
    const normalized = kb.normalizeEntry(entry, entry.type || "doc");
    const index = bucket.findIndex((item) => item.id === normalized.id || item.sourceId === normalized.sourceId);
    if (index >= 0) {
      bucket[index] = kb.normalizeEntry(Object.assign({}, bucket[index], normalized, { status: "draft", updatedAt: nowIso() }), normalized.type);
    } else {
      bucket.push(kb.normalizeEntry(Object.assign({}, normalized, { status: "draft", updatedAt: nowIso() }), normalized.type));
    }
  });
}

function loadStore() {
  try {
    if (fs.existsSync(kb.DATA_PATH)) {
      return kb.normalizeDocument(JSON.parse(fs.readFileSync(kb.DATA_PATH, "utf8")));
    }
  } catch (error) {
    // Fall through to the service defaults.
  }
  return kb.normalizeDocument({});
}

function run(argv = process.argv.slice(2)) {
  const publish = argv.includes("--publish");
  const dryRun = argv.includes("--dry-run");
  const seed = buildSeedEntries();
  const store = loadStore();
  upsertEntries(store.draft.rules, seed.rules);
  upsertEntries(store.draft.docs, seed.docs);

  const warnings = []
    .concat(store.draft.rules)
    .concat(store.draft.docs)
    .flatMap((entry) => kb.validateEntrySecurity(entry).risks.map((risk) => Object.assign({ entryId: entry.id }, risk)));
  const blocking = warnings.filter((risk) => risk.level === "block");
  if (blocking.length) {
    const error = new Error(`Assistant local-rule seed blocked: ${blocking.map((item) => `${item.entryId}:${item.code}`).join(", ")}`);
    error.risks = blocking;
    throw error;
  }

  const summary = {
    success: true,
    dryRun,
    publish,
    dataPath: kb.DATA_PATH,
    seedRuleCount: seed.rules.length,
    seedDocCount: seed.docs.length,
    draftRuleCount: store.draft.rules.length,
    draftDocCount: store.draft.docs.length,
    warnings,
    sources: seed.sources,
  };

  if (!dryRun) {
    const saved = kb.saveStore(store);
    summary.draftRuleCount = saved.draft.rules.length;
    summary.draftDocCount = saved.draft.docs.length;
    summary.updatedAt = saved.updatedAt;
    if (publish) {
      const published = kb.publish({
        versionId: `assistant-local-rules-${versionStamp()}`,
        label: "assistant-local-rules-seed",
      });
      summary.publishedVersionId = published.store.published.versionId;
      summary.publishedAt = published.store.published.publishedAt;
      summary.publishedRuleCount = published.store.published.rules.length;
      summary.publishedDocCount = published.store.published.docs.length;
      summary.publishWarnings = published.risks || [];
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      message: error && error.message || String(error),
      risks: error && error.risks || [],
    }, null, 2));
    process.exit(1);
  }
}

module.exports = {
  buildSeedEntries,
  run,
};
