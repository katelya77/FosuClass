const aiAssistantService = require("../../services/aiAssistantService");
const aiVoiceInputService = require("../../services/aiVoiceInputService");
const conversationStore = require("../../services/conversationStore");
const contextManager = require("../../services/xiaofuContextManager");
const xiaofuFloatService = require("../../services/xiaofuFloatService");
const cloudbaseConfig = require("../../config/cloudbase");
const demoData = require("./demo-data");
const { courseTimes } = require("../../data/courseTimes");
const { copyToClipboard: copyTextToClipboard, normalizeCopyText } = require("../../utils/clipboard");

const PRIVACY_TIP_KEY = "FOSU_AI_PRIVACY_TIP_CONFIRMED";
const TASK_PANEL_CACHE_KEY = "FOSU_AI_TASK_PANEL_GROUPS_CACHE";
const TASK_PANEL_CACHE_VERSION = "2026-07-campus-agent-v4";
const TASK_PANEL_DEBOUNCE_MS = 180;
const TASK_ACTION_DEBOUNCE_MS = 180;
const SEND_DEDUPE_MS = 420;
const PRIVACY_SUMMARY_TEXT = "仅发送课程名、教师、教室、星期、节次、教学周；不发送学号、姓名、密码或原始文件。";
const MAX_MESSAGE_COUNT = 20;
const PERSONAL_SYNC_URL = "/pages/personal-sync/personal-sync";
const PERSONAL_SYNC_XLS_URL = "/pages/personal-sync/personal-sync?tab=xls";
const ICON_BASE = "/assets/icons/ai-tasks";
const ICONS = {
  today: `${ICON_BASE}/today.svg`,
  room: `${ICON_BASE}/room.svg`,
  teacher: `${ICON_BASE}/teacher.svg`,
  xls: `${ICON_BASE}/xls.svg`,
  classroom: `${ICON_BASE}/classroom.svg`,
  course: `${ICON_BASE}/course.svg`,
  study: `${ICON_BASE}/study.svg`,
  diagnosis: `${ICON_BASE}/diagnosis.svg`,
  app: `${ICON_BASE}/app.svg`,
  term: `${ICON_BASE}/term.svg`,
};

const CAPABILITY_KINDS = {
  DIRECT_TOOL: "direct_tool",
  SUPPLEMENT_PARAMS: "supplement_params",
  NAVIGATE: "navigate",
  GENERATIVE_QA: "generative_qa",
  LOCAL_ACTION: "local_action",
};

const AI_CAPABILITY_REGISTRY = [
  {
    id: "today",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.today,
    label: "今日课表",
    quickLabel: "今日课表",
    className: "today",
    taskGroup: "个人课表",
    taskLabel: "今日安排",
    taskDesc: "需要个人课表或指定对象",
    guideGroup: "个人课表",
    guideExamples: ["今天有什么课"],
    welcomeExample: "今天有什么课",
    message: "今天有什么课",
  },
  {
    id: "tomorrow",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.today,
    label: "明日课表",
    guideGroup: "个人课表",
    guideExamples: ["明天有什么课"],
    message: "明天有什么课？",
  },
  {
    id: "nextCourse",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.today,
    label: "下一节课",
    guideGroup: "个人课表",
    guideExamples: ["下一节课"],
    message: "下一节课",
  },
  {
    id: "weekSchedule",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.today,
    label: "本周课表",
    guideGroup: "个人课表",
    guideExamples: ["本周课表"],
    message: "本周课表",
  },
  {
    id: "gapBetweenCourses",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.study,
    label: "课间间隔",
    message: "两节课之间有多久？",
  },
  {
    id: "emptyRoomNow",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.room,
    label: "空教室",
    quickLabel: "空教室",
    className: "room",
    taskGroup: "课表查询",
    taskLabel: "查教室占用",
    taskDesc: "先说明时间或教室",
    message: "现在有空教室吗？",
  },
  {
    id: "continuousEmptyRoom",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.room,
    label: "连续空教室",
    message: "找连续两节空教室",
  },
  {
    id: "meetingTime",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.study,
    label: "共同空闲",
    taskGroup: "个人课表",
    taskLabel: "自习时间推荐",
    taskDesc: "需要开启课表摘要",
    message: "帮我推荐连续 2 节自习时间",
  },
  {
    id: "teacherSchedule",
    kind: CAPABILITY_KINDS.SUPPLEMENT_PARAMS,
    iconPath: ICONS.teacher,
    label: "查老师",
    quickLabel: "查老师",
    className: "teacher",
    taskGroup: "课表查询",
    taskLabel: "查教师课表",
    taskDesc: "输入教师姓名更准确",
    guideGroup: "课表查询",
    guideExamples: ["查教师课表"],
    message: "查教师课表",
    draft: "查教师课表",
    missingText: "请补充教师姓名后发送",
  },
  {
    id: "classSchedule",
    kind: CAPABILITY_KINDS.SUPPLEMENT_PARAMS,
    iconPath: ICONS.classroom,
    label: "查班级课表",
    quickLabel: "查班级",
    className: "classroom",
    taskGroup: "课表查询",
    taskLabel: "查班级课表",
    taskDesc: "输入完整班级更准确",
    guideGroup: "课表查询",
    guideExamples: ["查班级本周课表"],
    message: "查班级本周课表",
    draft: "查班级本周课表",
    missingText: "请补充班级名称后发送",
  },
  {
    id: "classroomOccupancy",
    kind: CAPABILITY_KINDS.SUPPLEMENT_PARAMS,
    iconPath: ICONS.classroom,
    label: "查教室占用",
    quickLabel: "查教室",
    className: "room",
    taskGroup: "课表查询",
    taskLabel: "查教室占用",
    taskDesc: "输入教室和时间",
    guideGroup: "课表查询",
    guideExamples: ["查教室明天是否有课"],
    message: "查教室明天是否有课",
    draft: "查教室明天是否有课",
    missingText: "请补充教室或楼栋后发送",
  },
  {
    id: "courseSchedule",
    kind: CAPABILITY_KINDS.SUPPLEMENT_PARAMS,
    iconPath: ICONS.course,
    label: "查课程安排",
    taskGroup: "课表查询",
    taskLabel: "查课程安排",
    taskDesc: "输入课程名称更准确",
    guideGroup: "课表查询",
    guideExamples: ["查课程安排"],
    message: "查课程安排",
    draft: "查课程安排",
    missingText: "请补充课程名称后发送",
  },
  {
    id: "placeC7",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.app,
    label: "教学楼位置",
    message: "某教学楼在哪里？",
  },
  {
    id: "xianxiSouthMap",
    kind: CAPABILITY_KINDS.NAVIGATE,
    iconPath: ICONS.app,
    label: "仙溪南区地图",
    url: "/pages/campus-map/campus-map?map=xianxiSouth",
  },
  {
    id: "jiangwanPlaces",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.app,
    label: "江湾地点",
    message: "江湾校区主要地点",
  },
  {
    id: "nextCourseLocation",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.app,
    label: "下一节课位置",
    message: "下一节课在哪里？",
  },
  {
    id: "campusWeather",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.term,
    label: "校区天气",
    taskGroup: "实时信息",
    taskLabel: "校区天气",
    taskDesc: "下雨、温度、带伞和出行建议",
    guideGroup: "实时信息",
    guideExamples: ["仙溪校区今天会下雨吗"],
    welcomeExample: "仙溪校区今天会下雨吗",
    message: "仙溪校区今天会下雨吗？",
  },
  {
    id: "umbrellaAdvice",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.term,
    label: "带伞建议",
    taskGroup: "实时信息",
    taskLabel: "今天要不要带伞",
    taskDesc: "优先查询天气，不走学校官网概况",
    guideGroup: "实时信息",
    guideExamples: ["今天要不要带伞", "下一节课要带伞吗"],
    welcomeExample: "今天要不要带伞",
    message: "今天要不要带伞",
  },
  {
    id: "teachingWeek",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.term,
    label: "教学周",
    taskGroup: "个人课表",
    taskLabel: "当前教学周",
    taskDesc: "查看当前是第几周",
    guideGroup: "个人课表",
    guideExamples: ["当前是第几教学周"],
    message: "当前是第几教学周？",
  },
  {
    id: "dataStatus",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.diagnosis,
    label: "数据状态",
    taskGroup: "个人课表",
    taskLabel: "课表数据状态",
    taskDesc: "查看学期、版本和更新时间",
    guideGroup: "个人课表",
    guideExamples: ["课表数据更新到什么时候", "当前是第几教学周"],
    message: "课表数据是否最新？",
  },
  {
    id: "personalSync",
    kind: CAPABILITY_KINDS.NAVIGATE,
    iconPath: ICONS.xls,
    label: "个人课表同步",
    quickLabel: "导入课表",
    className: "xls",
    taskGroup: "个人课表",
    taskLabel: "导入个人课表",
    taskDesc: "打开同步主入口",
    guideGroup: "个人课表",
    guideExamples: ["如何导入个人课表"],
    url: PERSONAL_SYNC_URL,
    message: "如何导入个人课表",
    fallbackMessage: "如何导入个人课表",
  },
  {
    id: "xlsImport",
    kind: CAPABILITY_KINDS.NAVIGATE,
    iconPath: ICONS.xls,
    label: "XLS 文件导入",
    quickLabel: "XLS导入",
    className: "xls",
    taskGroup: "个人课表",
    taskLabel: "XLS 文件导入",
    taskDesc: "表格/文件导入入口",
    url: PERSONAL_SYNC_XLS_URL,
    message: "XLS文件导入怎么用？",
    fallbackMessage: "如何导入个人课表",
  },
  {
    id: "appHelp",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.app,
    label: "怎么使用",
    taskGroup: "使用与数据",
    taskLabel: "小佛能做什么",
    taskDesc: "查看能力和问法",
    guideGroup: "使用与数据",
    guideExamples: ["小佛能做什么", "如何问得更准确"],
    welcomeExample: "这个小程序怎么用？",
    message: "这个小程序怎么用？",
  },
  {
    id: "enableFloat",
    kind: CAPABILITY_KINDS.LOCAL_ACTION,
    iconPath: ICONS.app,
    label: "开启浮窗",
    taskGroup: "使用与数据",
    taskLabel: "开启小佛AI浮窗",
    taskDesc: "恢复右下角可拖拽小佛入口",
    message: "开启小佛AI浮窗",
  },
  {
    id: "termSync",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.term,
    label: "数据来源",
    taskGroup: "使用与数据",
    taskLabel: "数据来源说明",
    taskDesc: "了解课表与知识来源",
    guideGroup: "使用与数据",
    guideExamples: ["数据来源说明"],
    message: "数据来源说明",
  },
  {
    id: "jwcEntry",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.app,
    label: "教务入口",
    taskGroup: "校园知识",
    taskLabel: "教务系统入口",
    taskDesc: "查看教务相关入口",
    guideGroup: "校园知识",
    guideExamples: ["教务系统在哪里"],
    message: "教务系统在哪里进？",
  },
  {
    id: "campusLocations",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.app,
    label: "校区与地图",
    taskGroup: "校园知识",
    taskLabel: "校区与地图",
    taskDesc: "了解校区和位置",
    guideGroup: "校园知识",
    guideExamples: ["佛大有哪些校区"],
    message: "佛大有哪些校区？",
  },
  {
    id: "collegeDepartments",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.study,
    label: "学院部门",
    taskGroup: "校园知识",
    taskLabel: "学院与部门",
    taskDesc: "查看学院部门入口",
    guideGroup: "校园知识",
    guideExamples: ["佛大有哪些学院和部门"],
    message: "佛大有哪些学院和部门？",
  },
  {
    id: "libraryService",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.term,
    label: "图书馆服务",
    taskGroup: "校园知识",
    taskLabel: "图书馆服务",
    taskDesc: "查图书馆入口与服务边界",
    guideGroup: "校园知识",
    guideExamples: ["图书馆服务"],
    message: "图书馆服务",
  },
  {
    id: "commonSystems",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.app,
    label: "常用系统",
    taskGroup: "校园知识",
    taskLabel: "常用系统入口",
    taskDesc: "查教务、门户等公开入口",
    guideGroup: "校园知识",
    guideExamples: ["常用系统入口"],
    message: "常用系统入口",
  },
  {
    id: "serviceGuide",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.term,
    label: "办事指南",
    message: "常用办事指南在哪里？",
  },
  {
    id: "askBetter",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.study,
    label: "问法建议",
    taskGroup: "使用与数据",
    taskLabel: "如何问得更准确",
    taskDesc: "获得更稳的回答",
    guideGroup: "使用与数据",
    guideExamples: ["如何问得更准确"],
    message: "如何问得更准确？",
  },
];

const AI_CAPABILITY_BY_ID = AI_CAPABILITY_REGISTRY.reduce((map, item) => {
  map[item.id] = item;
  return map;
}, {});

function buildQuickAction(id, quickId) {
  const ability = AI_CAPABILITY_BY_ID[id] || {};
  return {
    id: quickId || id,
    abilityId: id,
    iconPath: ability.iconPath,
    label: ability.quickLabel || ability.label,
    message: ability.message,
    draft: ability.draft,
    url: ability.url,
    className: ability.className || "",
    kind: ability.kind,
  };
}
const QUICK_ACTIONS = [
  buildQuickAction("today"),
  buildQuickAction("classSchedule", "class"),
  buildQuickAction("classroomOccupancy", "room"),
  buildQuickAction("campusWeather", "weather"),
  buildQuickAction("personalSync", "xls"),
];

const WELCOME_EXAMPLES = [
  "查班级本周课表",
  "今天有什么课",
  "当前是第几教学周",
  "仙溪校区今天会下雨吗",
  "教务系统在哪里",
  "小佛能做什么",
];

function buildTaskPanelGroups() {
  return [
    {
      title: "课表查询",
      abilityIds: ["classSchedule", "teacherSchedule", "classroomOccupancy", "courseSchedule"],
    },
    {
      title: "个人课表",
      abilityIds: ["today", "tomorrow", "weekSchedule", "personalSync", "dataStatus"],
    },
    {
      title: "实时信息",
      abilityIds: ["campusWeather", "umbrellaAdvice"],
    },
    {
      title: "校园知识",
      abilityIds: ["jwcEntry", "campusLocations", "collegeDepartments", "libraryService", "commonSystems"],
    },
    {
      title: "使用与数据",
      abilityIds: ["appHelp", "personalSync", "enableFloat", "askBetter", "termSync"],
    },
  ].map((group) => ({
    title: group.title,
    items: group.abilityIds.map((id) => {
      const ability = AI_CAPABILITY_BY_ID[id] || {};
      return {
        abilityId: id,
        kind: ability.kind,
        iconPath: ability.iconPath,
        label: ability.taskLabel || ability.label,
        desc: ability.taskDesc || "",
        message: ability.message,
        draft: ability.draft,
        url: ability.url,
        fallbackMessage: ability.fallbackMessage,
        requiresKeyword: ability.kind === CAPABILITY_KINDS.SUPPLEMENT_PARAMS,
        missingText: ability.missingText,
      };
    }),
  }));
}

const TASK_PANEL_GROUPS = buildTaskPanelGroups();

function buildCapabilityGuideGroups() {
  return [
    "课表查询",
    "个人课表",
    "实时信息",
    "校园知识",
    "使用与数据",
  ].map((title) => ({
    title,
    items: AI_CAPABILITY_REGISTRY
      .filter((ability) => ability.guideGroup === title)
      .reduce((items, ability) => {
        (ability.guideExamples || []).forEach((text) => items.push(text));
        return items;
      }, []),
  })).filter((group) => group.items.length);
}

const CAPABILITY_GUIDE_GROUPS = buildCapabilityGuideGroups();

const TABBAR_PENDING_QUERY = {
  "/pages/school/school": "FOSU_AI_PENDING_SCHOOL_QUERY",
  "/pages/today/today": "FOSU_AI_PENDING_TODAY_QUERY",
};

const PROVIDER_LABELS = {
  "cloudbase-hunyuan": "已核验课表数据",
  hunyuan: "已核验课表数据",
  "tencent-hunyuan": "已核验课表数据",
  mock: "已使用本地规则",
  deepseek: "已核验课表数据",
  coze: "已核验课表数据",
  unknown: "正在整理结果",
};

const SAFETY_MODE_LABELS = {
  "tool-grounded": "已核验",
  fallback: "降级模式",
  "fallback-mock": "已降级",
};

const TOOL_LABELS = {
  search_empty_rooms: "空教室",
  get_today_courses: "今日课表",
  get_campus_weather: "天气",
  get_course_weather_advice: "天气建议",
  search_campus_place: "校园地图",
  get_campus_route: "校园地图",
  get_classroom_location: "校园地图",
  search_school_index: "全校索引",
  search_school_schedule_local: "全校课表",
  fosu_rag_retrieve: "校园知识库",
  get_schedule_detail: "课表详情",
  diagnose_data_status: "数据状态",
  explain_personal_import: "导入指引",
  recommend_meeting_time: "时间推荐",
  clarify_missing_slot: "追问",
  safety_guard: "安全拦截",
};

const CARD_TYPE_LABELS = {
  empty_room: "空教室",
  schedule_result: "课表",
  schedule: "课表",
  schedule_status: "数据状态",
  clarification: "追问",
  schedule_candidate: "候选",
  personal_schedule: "个人课表",
  school_knowledge: "校园知识",
  navigation: "入口",
  help: "帮助",
  import_guide: "导入指引",
  not_found: "未找到",
  teacher: "教师",
  course: "课程",
  weather: "天气",
  weather_card: "天气",
  diagnosis: "数据状态",
  guide: "指引",
  reminder: "提醒",
  generic: "结果",
};

const CARD_TITLE_FALLBACKS = {
  empty_room: "空教室推荐",
  schedule_result: "课表结果",
  schedule: "今日课程",
  schedule_status: "课表数据状态",
  clarification: "需要补充信息",
  schedule_candidate: "请选择对象",
  personal_schedule: "个人课表",
  school_knowledge: "校园知识",
  navigation: "校园入口",
  help: "使用帮助",
  import_guide: "导入个人课表",
  not_found: "未找到结果",
  teacher: "教师查询",
  course: "课程查询",
  weather: "校区天气",
  weather_card: "校区天气",
  diagnosis: "数据状态",
  guide: "使用指引",
  reminder: "时间推荐",
  generic: "结果",
};

const ACTION_LABEL_FALLBACKS = {
  navigate: "查看详情",
  switchTab: "打开页面",
  retry: "重新尝试",
  copy: "复制",
  ask: "继续追问",
  openSheet: "打开面板",
  toggleFloat: "调整浮窗",
  noop: "查看",
};

const ACTION_TYPE_ALIASES = {
  bind: "navigate",
  navigate: "navigate",
  switchtab: "switchTab",
  copy: "copy",
  retry: "retry",
  ask: "ask",
  opensheet: "openSheet",
  togglefloat: "toggleFloat",
  noop: "noop",
};
const INVALID_DISPLAY_TEXT = new Set(["[object Object]", "undefined", "null", "NaN"]);

function cloneTaskPanelGroups() {
  return JSON.parse(JSON.stringify(TASK_PANEL_GROUPS));
}

function readTaskPanelGroupsCache() {
  try {
    const cached = wx.getStorageSync(TASK_PANEL_CACHE_KEY);
    if (!cached || cached.version !== TASK_PANEL_CACHE_VERSION || !Array.isArray(cached.groups)) return null;
    return cached.groups;
  } catch (error) {
    return null;
  }
}

function writeTaskPanelGroupsCache(groups) {
  try {
    wx.setStorageSync(TASK_PANEL_CACHE_KEY, {
      version: TASK_PANEL_CACHE_VERSION,
      savedAt: Date.now(),
      groups,
    });
  } catch (error) {
    // 静态任务缓存失败不影响页面使用。
  }
}

function findAbilityByText(text) {
  const target = String(text || "").trim();
  if (!target) return null;
  return AI_CAPABILITY_REGISTRY.find((ability) => {
    if (ability.message === target || ability.draft === target || ability.fallbackMessage === target) return true;
    return (ability.guideExamples || []).some((example) => example === target) ||
      ability.welcomeExample === target ||
      ability.label === target ||
      ability.quickLabel === target ||
      ability.taskLabel === target;
  }) || null;
}

function actionFromAbility(ability, fallbackText) {
  const source = ability || findAbilityByText(fallbackText);
  if (!source) {
    return {
      kind: CAPABILITY_KINDS.GENERATIVE_QA,
      message: String(fallbackText || "").trim(),
    };
  }
  return {
    id: source.id,
    kind: source.kind,
    message: source.message || source.fallbackMessage || fallbackText || source.label,
    draft: source.draft || fallbackText || source.message || source.label,
    url: source.url || "",
    missingText: source.missingText || "请补充必要信息后发送",
  };
}

function buildFloatContextSlots(floatContext, currentSlots) {
  const source = floatContext && typeof floatContext === "object" && !Array.isArray(floatContext)
    ? floatContext
    : {};
  const targetName = safeText(source.targetName || source.title || source.route || "", 100);
  if (!targetName) return contextManager.normalizeContextSlots(currentSlots);
  const targetType = safeText(source.targetType || "navigation", 40) || "navigation";
  return contextManager.mergeContextSlots(currentSlots, {
    lastIntent: "page_context",
    lastTargetType: targetType,
    lastTargetName: targetName,
    lastWeek: null,
    lastWeekday: null,
    lastQueryResult: {
      title: safeText(source.title || targetName, 80),
      targetName,
      route: safeText(source.route || "", 120),
      query: safeText(source.query || "", 160),
    },
    lastSource: "xiaofu-float",
  });
}

function createDebounced(fn, wait) {
  let timer = null;
  return function debounced(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  };
}

function timeText() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function decodeQuery(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (error) {
    return String(value || "");
  }
}

function primitiveDisplayText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function safeText(value, maxLength, fallback) {
  let text = primitiveDisplayText(value);
  if (!text && value && typeof value === "object" && !Array.isArray(value)) {
    ["text", "label", "title", "value"].some((key) => {
      const candidate = primitiveDisplayText(value[key]);
      if (!candidate) return false;
      text = candidate;
      return true;
    });
  }
  if (!text) text = primitiveDisplayText(fallback);
  text = aiAssistantService.redactSensitiveText(text).trim();
  if (!text || INVALID_DISPLAY_TEXT.has(text)) {
    text = aiAssistantService.redactSensitiveText(primitiveDisplayText(fallback)).trim();
  }
  if (!text || INVALID_DISPLAY_TEXT.has(text)) return "";
  const limit = Number(maxLength || 0);
  return limit > 0 ? text.slice(0, limit) : text;
}

function getSectionTime(section) {
  const target = Number(section);
  return courseTimes.find((item) => Number(item.section) === target) || null;
}

function inferSectionPair(source) {
  const item = source || {};
  let start = Number(item.startSection || item.sectionStart || 0) || 0;
  let end = Number(item.endSection || item.sectionEnd || start || 0) || 0;
  if ((!start || !end) && Array.isArray(item.sections) && item.sections.length) {
    const sections = item.sections.map((value) => Number(value)).filter((value) => Number.isFinite(value));
    start = sections[0] || start;
    end = sections[sections.length - 1] || end || start;
  }
  if ((!start || !end) && (item.sectionText || item.value || item.subtitle)) {
    const match = String(item.sectionText || item.value || item.subtitle || "").match(/第?\s*(\d{1,2})\s*(?:[-~～至到]\s*(\d{1,2}))?\s*节/);
    if (match) {
      start = Number(match[1]);
      end = Number(match[2] || match[1]);
    }
  }
  return start && end ? { start, end } : null;
}

function inferSectionText(source) {
  const direct = safeText(source && source.sectionText, 40);
  if (direct) return direct;
  const pair = inferSectionPair(source);
  if (!pair) return "";
  return pair.start === pair.end ? `第${pair.start}节` : `第${pair.start}-${pair.end}节`;
}

function inferCourseTimeRange(source) {
  const direct = safeText(source && (source.timeRange || source.timeText), 40);
  if (/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/.test(direct)) return direct;
  const pair = inferSectionPair(source);
  if (!pair) return "";
  const start = getSectionTime(pair.start);
  const end = getSectionTime(pair.end);
  return start && end ? `${start.start}-${end.end}` : "";
}

function mapProviderLabel(provider) {
  const normalized = String(provider || "unknown").toLowerCase();
  if (normalized.indexOf("mock") >= 0 || normalized.indexOf("local") >= 0) return "已使用本地规则";
  if (normalized && normalized !== "unknown") return "已核验课表数据";
  return "正在整理结果";
}

function mapSafetyModeLabel(mode) {
  const normalized = String(mode || "tool-grounded").toLowerCase();
  if (SAFETY_MODE_LABELS[normalized]) return SAFETY_MODE_LABELS[normalized];
  if (normalized.indexOf("fallback") >= 0) return "降级模式";
  if (normalized.indexOf("tool") >= 0 || normalized.indexOf("grounded") >= 0) return "已核验";
  return "安全模式";
}

function mapToolName(name) {
  const normalized = String(name || "").toLowerCase();
  if (normalized === "search_school_index") return "正在查询全校课程";
  if (TOOL_LABELS[normalized]) return TOOL_LABELS[normalized];
  if (/查询|课程|教室|课表|教学周|导入|数据/.test(String(name || ""))) return String(name || "");
  return "校园工具";
}

function mapCardTypeLabel(type) {
  return CARD_TYPE_LABELS[String(type || "generic").toLowerCase()] || "结果";
}

function inferEvidenceLabel(source = {}) {
  const names = (Array.isArray(source.toolCalls) ? source.toolCalls : [])
    .map((item) => String(item && (item.name || item.tool || item.type) || "").toLowerCase());
  const cardTypes = (Array.isArray(source.cards) ? source.cards : [])
    .map((item) => String(item && item.type || "").toLowerCase());
  const text = names.concat(cardTypes).join("|");
  if (/diagnose_data_status|schedule_status|数据状态/.test(text)) return "数据状态";
  if (/navigation|入口|官网/.test(text)) return "已找到校园入口";
  if (/weather|天气/.test(text)) return "已获取天气数据";
  if (/campus|map|route|location|地图|地点|位置/.test(text)) return "已查询校园地图";
  if (/empty|空教室/.test(text)) return "已核验教室占用";
  if (/fosu_rag_retrieve|school_knowledge|知识/.test(text)) return "校园知识";
  if (/guide|import|help|说明|帮助|指引/.test(text)) return "使用说明";
  if (/school|schedule|today|tomorrow|week|term|teacher|course|classroom|detail|课表|课程|教师|教室|教学周|校历|查询全校/.test(text)) {
    return "已核验课表数据";
  }
  const intent = source.metrics && source.metrics.intentName || "";
  if (/navigation/.test(String(intent).toLowerCase())) return "已找到校园入口";
  if (/weather/.test(String(intent).toLowerCase())) return "已获取天气数据";
  return "";
}

function statusText(status) {
  const normalized = String(status || "").toLowerCase();
  if (["success", "ok", "done"].includes(normalized)) return "完成";
  if (["failed", "error"].includes(normalized)) return "失败";
  if (normalized === "skipped") return "跳过";
  if (normalized === "running") return "调用中";
  return "已调用";
}

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (["failed", "error"].includes(normalized)) return "failed";
  if (normalized === "skipped") return "skipped";
  if (normalized === "running") return "running";
  return "success";
}

function typeClass(type) {
  return String(type || "generic").toLowerCase().replace(/_/g, "-").replace(/[^a-z0-9-]/g, "") || "generic";
}

function normalizeSafety(safety) {
  const source = safety || {};
  const provider = source.resolvedProvider || source.provider || source.lastProvider || source.providerName || "unknown";
  const desiredProvider = source.desiredProvider || source.provider || provider;
  const mode = source.mode || source.safetyMode || "tool-grounded";
  const fallbackReason = safeText(source.fallbackReason || "", 80);
  const providerDecisionReason = "";
  const externalUsed = source.externalProviderUsed === true;
  const providerLabel = fallbackReason ? "已使用本地规则" : (externalUsed ? "已核验课表数据" : "已核验课表数据");
  let text = "已核验课表数据";
  if (fallbackReason) {
    text = "已使用本地规则";
  } else if (externalUsed) {
    text = "正在整理结果";
  }
  return {
    provider,
    resolvedProvider: provider,
    desiredProvider,
    mode,
    externalProviderUsed: externalUsed,
    fallbackReason,
    providerDecisionReason,
    providerLabel,
    modeLabel: mapSafetyModeLabel(mode),
    text,
    pendingClarification: source.pendingClarification || null,
    clearPendingClarification: source.clearPendingClarification === true,
  };
}

function normalizeMetrics(metrics) {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return null;
  const latencyMs = Number(metrics.latencyMs);
  return {
    latencyMs: Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : 0,
    intentName: metrics.intentName || "",
    externalProviderUsed: metrics.externalProviderUsed === true,
  };
}

function normalizeToolCall(tool, index) {
  const source = tool || {};
  const label = mapToolName(source.name || source.tool || source.type || "");
  const stateText = statusText(source.status);
  return {
    key: `${label}-${stateText}-${index}`,
    displayName: label,
    displayStatus: stateText,
    displayText: `已核验：${label}`,
    statusClass: statusClass(source.status),
  };
}

function normalizeTaskStep(step, index) {
  const source = step || {};
  const label = safeText(source.label || source.name || "", 48, `步骤 ${index + 1}`);
  const status = safeText(source.status || "done", 16);
  return {
    key: safeText(source.key || source.name || `task-${index}`, 48, `task-${index}`),
    displayName: label,
    displayStatus: status,
    displayText: label,
    statusClass: status === "failed" ? "failed" : (status === "running" ? "running" : "success"),
  };
}

function buildEvidenceText(evidence, evidenceLabel) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return "";
  const parts = [];
  if (evidence.term) parts.push(`学期 ${safeText(evidence.term, 32)}`);
  if (evidence.currentWeek) parts.push(`教学周 ${safeText(evidence.currentWeek, 16)}`);
  if (evidence.checkedAt) {
    const checkedTime = safeText(String(evidence.checkedAt).slice(11, 16), 8);
    if (checkedTime) parts.push(`检查 ${checkedTime}`);
  }
  const label = safeText(evidenceLabel || "", 32);
  if (label) parts.unshift(label);
  else if (evidence.verified || evidence.toolCount) parts.push("已核验课表数据");
  return parts.length ? parts.join(" · ") : "";
}

function isMissingWeatherValue(value) {
  const text = String(value == null ? "" : value).trim();
  return !text || text === "--" || text === "NaN" || text === "null" || text === "undefined";
}

function weatherValueText(value, unit) {
  if (isMissingWeatherValue(value)) return "暂无该项数据";
  const text = String(value).trim();
  const suffix = unit || "";
  if (!suffix) return text;
  if (suffix === "℃" && /(?:℃|°)$/.test(text)) return text;
  if (suffix === "°" && /(?:℃|°)$/.test(text)) return text;
  if (suffix === "%" && /%$/.test(text)) return text;
  if (suffix === "km/h" && /(?:km\/h|公里\/小时)$/i.test(text)) return text;
  if (suffix === "mm" && /(?:mm|毫米)$/i.test(text)) return text;
  return `${text}${suffix}`;
}

function normalizeWeatherPayload(source) {
  const weather = source && typeof source.weather === "object" && !Array.isArray(source.weather)
    ? source.weather
    : {};
  const timeline = Array.isArray(weather.next6Hours) ? weather.next6Hours : [];
  const status = safeText(weather.weatherText || weather.status || source.subtitle || "", 24);
  const iconClass = /雨|雷|降水/.test(status)
    ? "rain"
    : (/云|阴/.test(status) ? "cloud" : "sun");
  return {
    campus: safeText(weather.campus || source.title || "校区天气", 32),
    weatherText: status || "天气待确认",
    updatedLabel: safeText(weather.updatedLabel || weather.updatedAt || "", 32),
    cachedText: weather.cached ? "使用最近数据" : "实时天气",
    temperatureC: safeText(weather.temperatureC, 12),
    apparentTemperatureC: safeText(weather.apparentTemperatureC, 12),
    highC: safeText(weather.highC, 12),
    lowC: safeText(weather.lowC, 12),
    humidity: safeText(weather.humidity, 12),
    windSpeedKmh: safeText(weather.windSpeedKmh, 12),
    precipitationMm: safeText(weather.precipitationMm, 12),
    rainProbabilityMax24h: safeText(weather.rainProbabilityMax24h, 12),
    targetLabel: safeText(weather.targetLabel || "今天", 12),
    temperatureText: weatherValueText(weather.temperatureText || weather.temperatureC, "℃"),
    apparentTemperatureText: weatherValueText(weather.apparentTemperatureText || weather.apparentTemperatureC, "℃"),
    highText: weatherValueText(weather.highText || weather.highC, "℃"),
    lowText: weatherValueText(weather.lowText || weather.lowC, "℃"),
    humidityText: weatherValueText(weather.humidityText || weather.humidity, "%"),
    windSpeedText: weatherValueText(weather.windSpeedText || weather.windSpeedKmh, "km/h"),
    precipitationText: weatherValueText(weather.precipitationText || weather.precipitationMm, "mm"),
    rainProbabilityText: weatherValueText(weather.rainProbabilityText || weather.rainProbabilityMax24h, "%"),
    advice: safeText(weather.advice || weather.travelAdvice || "", 90),
    sourceText: safeText(weather.sourceText || weather.provider || source.sourceUrl || "", 60),
    sourceId: safeText(weather.sourceId || source.sourceUrl || "", 80),
    next6Hours: timeline.slice(0, 6).map((item, index) => ({
      key: `${item.time || index}-${index}`,
      time: safeText(item.time || "", 12),
      temperatureC: safeText(item.temperatureC, 12),
      rainProbability: safeText(item.rainProbability, 12),
      temperatureText: weatherValueText(item.temperatureText || item.temperatureC, "°"),
      rainProbabilityText: weatherValueText(item.rainProbabilityText || item.rainProbability, "%"),
    })),
    iconClass,
  };
}

function normalizeCardItem(item, index, cardType) {
  const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  const subtitle = safeText(source.subtitle || source.desc || source.detail || "", 140);
  let displaySubtitle = String(cardType || "") === "empty_room"
    ? subtitle.replace(/(?:\s*·\s*)?容量未知/g, "").replace(/^\s*·\s*|\s*·\s*$/g, "")
    : subtitle;
  const courseLike = ["schedule", "schedule_result", "teacher", "course", "reminder", "generic"].indexOf(String(cardType || "")) >= 0;
  const section = courseLike ? inferSectionText(source) : "";
  const timeRange = courseLike ? inferCourseTimeRange(source) : "";
  let value = safeText(source.value || source.time || source.status || "", 60);
  const valueLooksLikeSection = /第?\s*\d{1,2}\s*(?:[-~～至到]\s*\d{1,2})?\s*节/.test(value);
  if (timeRange && (!value || valueLooksLikeSection)) {
    value = timeRange;
  }
  if (timeRange && section && displaySubtitle.indexOf(section) < 0) {
    displaySubtitle = [section, displaySubtitle].filter(Boolean).join(" · ");
  }
  const normalized = {
    key: `${safeText(source.title || source.name || "item", 60, "item")}-${index}`,
    title: safeText(source.title || source.name || "", 80),
    subtitle: safeText(displaySubtitle, 140),
    value,
  };
  return normalized.title || normalized.subtitle || normalized.value ? normalized : null;
}

function normalizeCardAction(action, index) {
  const source = action && typeof action === "object" && !Array.isArray(action) ? action : {};
  const rawType = safeText(source.type || "noop", 20, "noop").toLowerCase();
  const type = ACTION_TYPE_ALIASES[rawType] || "noop";
  const label = safeText(source.label, 30, ACTION_LABEL_FALLBACKS[type] || ACTION_LABEL_FALLBACKS.noop) ||
    ACTION_LABEL_FALLBACKS[type] ||
    ACTION_LABEL_FALLBACKS.noop;
  return {
    label,
    type,
    url: safeText(source.url || "", 240),
    text: safeText(source.text || "", 600),
    fallbackText: safeText(source.fallbackText || "", 600),
    confirm: normalizeActionConfirm(source.confirm),
    toast: safeText(source.toast || "", 40),
    analyticsName: safeText(source.analyticsName || "", 80),
    payload: source.payload && typeof source.payload === "object" && !Array.isArray(source.payload) ? source.payload : {},
    originalIndex: index,
  };
}

function normalizeActionConfirm(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const content = safeText(value, 120);
    return content ? { title: "确认操作", content } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const content = safeText(value.content || value.text || "", 140);
  if (!content) return null;
  return {
    title: safeText(value.title || "确认操作", 40, "确认操作") || "确认操作",
    content,
    confirmText: safeText(value.confirmText || "继续", 8, "继续") || "继续",
    cancelText: safeText(value.cancelText || "取消", 8, "取消") || "取消",
  };
}

function firstCopyableText(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  for (let index = 0; index < list.length; index += 1) {
    const text = normalizeCopyText(list[index]);
    if (text) return text;
  }
  return "";
}

function resolveActionCopyText(action, card, message) {
  const safeAction = action && typeof action === "object" && !Array.isArray(action) ? action : {};
  const safeCard = card && typeof card === "object" && !Array.isArray(card) ? card : {};
  const safeMessage = message && typeof message === "object" && !Array.isArray(message) ? message : {};
  const payload = safeAction.payload && typeof safeAction.payload === "object" && !Array.isArray(safeAction.payload)
    ? safeAction.payload
    : {};
  return firstCopyableText([
    payload.text,
    safeAction.text,
    safeAction.url,
    payload.url,
    safeCard.copyText,
    safeCard.summary,
    safeAction.fallbackText,
    safeMessage.content,
  ]);
}

function cardItemsSummary(source) {
  const items = Array.isArray(source && source.items) ? source.items : [];
  return items.slice(0, 8).map((item) => {
    const entry = item && typeof item === "object" && !Array.isArray(item) ? item : {};
    return [
      safeText(entry.title || entry.name || "", 80),
      safeText(entry.value || entry.time || "", 60),
      safeText(entry.subtitle || entry.desc || entry.detail || "", 120),
    ].filter(Boolean).join(" ");
  }).filter(Boolean).join("\n");
}

function buildCardCopyText(source, message, maxLength) {
  const text = [
    safeText(message && message.content || "", 1000),
    safeText(source && source.copyText || "", 1000),
    safeText(source && (source.summary || source.subtitle || source.title) || "", 500),
    cardItemsSummary(source),
  ].filter(Boolean).join("\n");
  return safeText(text, maxLength || 1200);
}

function firstCardEntryUrl(source) {
  const links = Array.isArray(source && source.relatedLinks) ? source.relatedLinks : [];
  for (let index = 0; index < links.length; index += 1) {
    const url = safeText(links[index] && links[index].url || "", 240);
    if (url) return url;
  }
  return safeText(source && (source.url || source.actionUrl || source.sourceUrl) || "", 240);
}

function buildDefaultCardActions(source, type, message) {
  const cardType = String(type || "");
  const variant = safeText(source && source.variant || "", 30);
  const title = safeText(source && source.title || "", 80);
  const sourceUrl = safeText(source && source.sourceUrl || "", 240);
  const entryUrl = firstCardEntryUrl(source);
  const answerText = buildCardCopyText(source, message, 1200);
  if (variant === "error" && ["school_knowledge", "navigation"].indexOf(cardType) >= 0) return [];
  if (cardType === "import_guide") {
    return [
      { type: "navigate", label: "打开个人课表同步", url: PERSONAL_SYNC_URL },
      { type: "navigate", label: "查看 XLS 文件导入", url: PERSONAL_SYNC_XLS_URL },
      { type: "copy", label: "复制导入说明", payload: { text: answerText || "打开个人课表同步主入口，按页面提示选择导入方式；明确需要表格或文件导入时再进入 XLS 文件导入。" } },
      { type: "ask", label: "继续问今天课程", payload: { message: "今天有什么课" } },
    ];
  }
  if (cardType === "help") {
    return [
      { type: "copy", label: "复制说明", payload: { text: answerText } },
      { type: "ask", label: "继续问课表", payload: { message: "今天有什么课" } },
      { type: "openSheet", label: "更多任务", payload: { sheet: "task" } },
    ];
  }
  if (cardType === "navigation") {
    const actions = [];
    if (entryUrl) {
      actions.push(/^\/pages\//.test(entryUrl)
        ? { type: "navigate", label: "打开入口", url: entryUrl }
        : { type: "copy", label: "复制入口", payload: { text: entryUrl } });
    }
    if (sourceUrl && sourceUrl !== entryUrl) actions.push({ type: "copy", label: "复制来源", payload: { text: sourceUrl } });
    actions.push({ type: "ask", label: "继续追问", payload: { message: `${title || "这个入口"}怎么用` } });
    return actions;
  }
  if (cardType === "school_knowledge") {
    const actions = [];
    if (answerText) actions.push({ type: "copy", label: "复制回答", payload: { text: answerText } });
    if (sourceUrl) actions.push({ type: "copy", label: "复制来源", payload: { text: sourceUrl } });
    if (entryUrl && entryUrl !== sourceUrl && /^\/pages\//.test(entryUrl)) {
      actions.push({ type: "navigate", label: "相关入口", url: entryUrl });
    }
    actions.push({ type: "ask", label: "继续追问", payload: { message: `${title || "这个问题"}还有哪些相关入口` } });
    return actions;
  }
  if (["schedule_result", "schedule", "personal_schedule"].indexOf(cardType) >= 0) {
    const actions = [];
    if (entryUrl && /^\/pages\//.test(entryUrl)) actions.push({ type: "navigate", label: "查看完整课表", url: entryUrl });
    else actions.push({ type: "navigate", label: "查看完整课表", url: "/pages/today/today" });
    if (answerText) actions.push({ type: "copy", label: "复制课表摘要", payload: { text: answerText } });
    actions.push({ type: "ask", label: "继续查本周", payload: { message: "本周课表" } });
    actions.push({ type: "ask", label: "继续查明天", payload: { message: "明天有什么课" } });
    return actions;
  }
  if (cardType === "schedule_status") {
    return [
      { type: "navigate", label: "查看全校课表", url: "/pages/school/school" },
      { type: "copy", label: "复制状态", payload: { text: answerText } },
    ];
  }
  if (cardType === "weather") {
    const weather = source && source.weather || {};
    const advice = safeText(weather.advice || source.copyText || answerText, 800);
    return [
      { type: "copy", label: "复制天气建议", payload: { text: advice } },
      { type: "retry", label: "重新获取天气" },
      { type: "ask", label: "继续问带伞", payload: { message: "今天要不要带伞" } },
      { type: "ask", label: "明天适合跑步吗", payload: { message: "明天适合跑步吗" } },
    ];
  }
  if (cardType === "clarification") {
    return [
      { type: "ask", label: "补充老师姓名", payload: { message: "查教师课表：" } },
      { type: "ask", label: "补充教室", payload: { message: "查教室占用：" } },
      { type: "ask", label: "补充班级", payload: { message: "查班级本周课表：" } },
    ];
  }
  if (cardType === "not_found") {
    return [
      { type: "ask", label: "换个关键词", payload: { message: "我换一个关键词查询" } },
      { type: "navigate", label: "打开全校课表", url: "/pages/school/school" },
    ];
  }
  return answerText ? [{ type: "copy", label: "复制回答", payload: { text: answerText } }] : [];
}

function isInactiveScheduleItem(item) {
  const source = item || {};
  const status = String(source.status || source.weekStatus || source.activeStatus || source.weekReason || "").toLowerCase();
  return source.active === false ||
    source.isActive === false ||
    source.weekActive === false ||
    source.inactive === true ||
    source.uncertain === true ||
    source.weekUncertain === true ||
    /inactive|not-active|uncertain|missing-week|非本周|不在本周|周次不确定/.test(status);
}

function extractInactiveFilteredCount(card) {
  const source = card || {};
  const metrics = source.metrics && typeof source.metrics === "object" && !Array.isArray(source.metrics) ? source.metrics : {};
  const direct = Number(source.inactiveFilteredCount || metrics.inactiveFilteredCount || 0);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  const badges = Array.isArray(source.badges) ? source.badges : [];
  for (const badge of badges) {
    const match = String(badge || "").match(/(?:过滤|filtered)[^\d]*(\d+)/i);
    if (match) return Number(match[1]) || 0;
  }
  return 0;
}

function cardKey(messageId, card, index) {
  return `${messageId}:${index}:${safeText(card && (card.title || card.type) || "card", 40)}`;
}

function normalizeCard(card, messageId, index, expandedCards, message) {
  const source = card && typeof card === "object" && !Array.isArray(card) ? card : {};
  const rawType = safeText(source.type || "generic", 30, "generic").toLowerCase() || "generic";
  const type = rawType === "weather_card" ? "weather" : rawType;
  const rawTitle = safeText(source.title || "", 80);
  const subtitle = safeText(source.subtitle || "", 140);
  const scheduleLike = type === "schedule" || type === "schedule_result" || /今日|课程|课表|today|schedule/i.test(rawTitle);
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const filteredRawItems = scheduleLike ? rawItems.filter((item) => !isInactiveScheduleItem(item)) : rawItems;
  const items = filteredRawItems
    .map((item, itemIndex) => normalizeCardItem(item, itemIndex, type))
    .filter(Boolean);
  const rawActions = (Array.isArray(source.actions) ? source.actions : []).concat(buildDefaultCardActions(source, type, message));
  const seenActions = {};
  const actions = rawActions.map(normalizeCardAction)
    .filter((action) => action && action.label && action.type !== "noop")
    .filter((action) => {
      const key = `${action.type}|${action.url}|${action.label}|${action.payload && action.payload.text || ""}|${action.payload && action.payload.message || ""}`;
      if (seenActions[key]) return false;
      seenActions[key] = true;
      return true;
    })
    .slice(0, 4)
    .map((action, actionIndex) => Object.assign({}, action, { originalIndex: actionIndex }));
  const badges = Array.isArray(source.badges)
    ? source.badges.map((item) => safeText(item, 36)).filter(Boolean).slice(0, 2)
    : [];
  const weatherPayload = type === "weather" ? normalizeWeatherPayload(source) : null;
  const hasDisplayContent = rawTitle || subtitle || badges.length || items.length || actions.length || weatherPayload;
  if (!hasDisplayContent) return null;

  const key = cardKey(messageId, source, index);
  const expanded = Boolean(expandedCards && expandedCards[key]);
  const visibleLimit = expanded ? 12 : 5;
  const visibleItems = items.slice(0, visibleLimit);
  const inactiveFilteredCount = Math.max(extractInactiveFilteredCount(source), rawItems.length - filteredRawItems.length);
  const filteredHint = inactiveFilteredCount > 0 ? `已过滤 ${inactiveFilteredCount} 门非本周课程` : "";
  const title = scheduleLike && source.allFinished === true
    ? "今日课程已结束"
    : (rawTitle || CARD_TITLE_FALLBACKS[type] || CARD_TITLE_FALLBACKS.generic);
  const disclaimer = type === "school_knowledge" || type === "navigation"
    ? "信息以知识库来源和学校官方页面为准"
    : (type === "schedule_status" ? "数据状态来自本机缓存和发布包元信息"
      : (type === "help" || type === "clarification" || type === "personal_schedule"
        ? "回答会保留在当前对话中"
        : "课表以学校教务系统为准"));
  const primaryActions = actions.slice(0, 1);
  const secondaryActions = actions.slice(1, 4);
  const errorClass = source.variant === "error" || /服务暂时不可用|服务暂不可用/.test(title) ? "card-error" : "";
  return Object.assign({}, source, {
    key,
    title: safeText(title, 80, CARD_TITLE_FALLBACKS[type] || CARD_TITLE_FALLBACKS.generic),
    subtitle,
    badges,
    items,
    actions,
    typeLabel: mapCardTypeLabel(type),
    typeClass: typeClass(type),
    weather: weatherPayload,
    weatherIconClass: weatherPayload && weatherPayload.iconClass || "",
    visibleItems,
    hiddenItemCount: Math.max(0, items.length - visibleItems.length),
    overflowText: expanded ? "收起" : `展开 ${items.length - visibleItems.length} 条`,
    overflowExpanded: expanded,
    primaryActions,
    secondaryActions,
    actionLayoutClass: primaryActions.length === 1 ? "one-action" : "",
    errorClass,
    filteredHint,
    disclaimer,
  });
}

function normalizeMessageForDisplay(message, expandedCards, previousMessage) {
  const source = message || {};
  const id = source.id || `m-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const evidenceLabel = inferEvidenceLabel(source);
  const normalizedSafety = source.safety ? normalizeSafety(source.safety) : null;
  const displaySafety = normalizedSafety ? Object.assign(normalizedSafety, {
    text: evidenceLabel || normalizedSafety.text,
  }) : null;
  const metrics = normalizeMetrics(source.metrics);
  const role = source.role === "user" ? "user" : "assistant";
  const displayTaskSteps = Array.isArray(source.taskSteps)
    ? source.taskSteps.slice(0, 6).map(normalizeTaskStep)
    : [];
  const displayToolCalls = displayTaskSteps.length
    ? displayTaskSteps
    : (Array.isArray(source.toolCalls) ? source.toolCalls.slice(0, 4).map(normalizeToolCall) : []);
  return Object.assign({}, source, {
    id,
    role,
    content: safeText(source.content || "", 1200),
    cards: Array.isArray(source.cards) ? source.cards : [],
    displayCards: Array.isArray(source.cards)
      ? source.cards.slice(0, 5).map((card, index) => normalizeCard(card, id, index, expandedCards, source)).filter(Boolean)
      : [],
    suggestions: Array.isArray(source.suggestions) ? source.suggestions.slice(0, 6).map((item) => safeText(item, 60)).filter(Boolean) : [],
    toolCalls: Array.isArray(source.toolCalls) ? source.toolCalls : [],
    taskSteps: Array.isArray(source.taskSteps) ? source.taskSteps : [],
    evidence: source.evidence || null,
    evidenceText: buildEvidenceText(source.evidence, evidenceLabel),
    displayToolCalls,
    safety: source.safety || null,
    displaySafety,
    metrics,
    metricsText: metrics ? `耗时 ${metrics.latencyMs} ms` : "",
    showAvatar: role === "assistant" && (!previousMessage || previousMessage.role === "user"),
    timeText: source.timeText || timeText(),
  });
}

function normalizeMessagesForDisplay(messages, expandedCards) {
  if (!Array.isArray(messages)) return [];
  return messages.map((item, index) => normalizeMessageForDisplay(item, expandedCards, messages[index - 1]));
}

function trimMessages(messages) {
  return Array.isArray(messages) ? messages.slice(-MAX_MESSAGE_COUNT) : [];
}

function makeMessage(role, content, patch) {
  return Object.assign({
    id: `${role}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    role,
    content,
    cards: [],
    suggestions: [],
    toolCalls: [],
    safety: null,
    timeText: timeText(),
  }, patch || {});
}

function formatConversationTime(value) {
  const time = Date.parse(value || "");
  if (!time) return "";
  const diffMs = Date.now() - time;
  if (diffMs < 60000) return "刚刚";
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}分钟前`;
  const date = new Date(time);
  const today = new Date();
  const pad = (number) => String(number).padStart(2, "0");
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function buildConversationDisplayList(activeConversationId) {
  return conversationStore.getConversationList().map((item) => ({
    conversationId: item.conversationId,
    title: item.title,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    updatedAtText: formatConversationTime(item.updatedAt || item.createdAt),
    messageCount: item.messageCount,
    active: item.conversationId === activeConversationId,
  }));
}

function isNewConversationCommand(text) {
  const value = String(text || "").replace(/\s+/g, "");
  return /^(新建|创建|新开|开启|开一个)(一个)?(新)?对话$/.test(value) ||
    value === "新建一个对话" ||
    value === "创建新对话";
}

function parseActionUrl(url) {
  const target = String(url || "");
  const parts = target.split("?");
  const path = parts[0] || "";
  const queryText = parts.slice(1).join("?");
  const query = {};
  if (queryText) {
    queryText.split("&").forEach((pair) => {
      if (!pair) return;
      const kv = pair.split("=");
      const key = decodeQuery(kv[0] || "");
      if (!key) return;
      query[key] = decodeQuery(kv.slice(1).join("=") || "");
    });
  }
  return { path, query, raw: target };
}

function buildPrivacyState(allowed, expanded, firstTipVisible) {
  const enabled = allowed === true;
  return {
    allowPersonalContext: enabled,
    privacyStatusText: enabled ? "仅发送脱敏课表摘要" : "默认不发送课表摘要",
    privacyCompactClass: enabled ? "enabled" : "disabled",
    privacyActionText: enabled ? "已允许" : "已关闭",
    composerNote: enabled ? "摘要开启：仅发送脱敏课表摘要" : "摘要关闭：默认不发送个人课表摘要",
    privacyActionLabel: firstTipVisible ? "知道了" : (expanded ? "收起" : "说明"),
  };
}

function resolveProviderState(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    const safety = message && (message.displaySafety || (message.safety && normalizeSafety(message.safety)));
    if (safety) {
      return {
        providerLabel: safety.providerLabel,
        providerModeLabel: safety.modeLabel,
        lastProvider: safety.provider,
        lastExternalProviderUsed: safety.externalProviderUsed === true,
        lastFallbackReason: safety.fallbackReason || "",
      };
    }
  }
  return {
    providerLabel: "已核验课表数据",
    providerModeLabel: "已核验",
    lastProvider: "unknown",
    lastExternalProviderUsed: false,
    lastFallbackReason: "",
  };
}

function buildHeaderSubtitle(state) {
  const source = state || {};
  if (source.lastFallbackReason) {
    return "本地规则可用";
  }
  if (source.lastExternalProviderUsed) {
    return "正在整理结果";
  }
  if (source.allowPersonalContext === true) {
    return "校园知识 · 全校课表 · 摘要已开";
  }
  return "校园知识 · 全校课表 · 数据状态";
}

function bottomScrollPatch(animated) {
  return {
    scrollTop: Date.now(),
    scrollIntoView: "message-bottom-anchor",
    scrollWithAnimation: animated !== false,
  };
}

function buildXiaofuFloatState() {
  const enabled = xiaofuFloatService.isEnabled();
  return {
    xiaofuFloatEnabled: enabled,
    xiaofuFloatToggleText: enabled ? "关闭小佛AI浮窗" : "开启小佛AI浮窗",
    xiaofuFloatToggleDesc: enabled ? "关闭后不再显示，可在这里或设置页重新开启" : "恢复右下角可拖拽入口",
  };
}

Page({
  data: {
    quickActions: QUICK_ACTIONS,
    welcomeExamples: WELCOME_EXAMPLES,
    capabilityGuideGroups: CAPABILITY_GUIDE_GROUPS,
    taskPanelGroups: [],
    taskPanelReady: false,
    taskPanelLoading: false,
    messages: [],
    conversations: [],
    activeConversationId: "",
    activeConversationTitle: "新对话",
    activeConversationContext: contextManager.createEmptyContextSlots(),
    expandedCards: {},
    inputValue: "",
    inputFocus: false,
    sending: false,
    sendingStatusText: "正在整理结果…",
    showTaskPanel: false,
    showConversationSheet: false,
    showCapabilityGuide: false,
    showHeaderMenu: false,
    showPrivacySheet: false,
    slowRequest: false,
    showPrivacyTip: false,
    privacyExpanded: false,
    privacyText: PRIVACY_SUMMARY_TEXT,
    privacyStatusText: "课表摘要默认关闭",
    privacyCompactClass: "disabled",
    privacyActionText: "摘要关闭",
    privacyActionLabel: "说明",
    allowPersonalContext: false,
    providerLabel: "AI",
    providerModeLabel: "已核验",
    lastExternalProviderUsed: false,
    lastFallbackReason: "",
    lastProvider: "unknown",
    headerSubtitle: "已核验课表数据",
    historyTrimNotice: false,
    hasHeroLogo: true,
    xiaofuFloatEnabled: true,
    xiaofuFloatToggleText: "开启小佛AI浮窗",
    xiaofuFloatToggleDesc: "恢复右下角可拖拽入口",
    demoMode: "",
    scrollTop: 0,
    scrollIntoView: "",
    scrollWithAnimation: true,
    composerNote: "默认不发送个人课表摘要",
    voiceInputVisible: false,
    voiceRecording: false,
    voiceRecognizing: false,
    voiceStatusText: "",
  },

  onLoad(options) {
    this._aiPageUnloaded = false;
    this._activeAiRequestId = "";
    this._lastSubmitAt = 0;
    this._lastSubmitText = "";
    this._isComposing = false;
    this._recorderManager = null;
    this.debouncedOpenTaskPanel = createDebounced(() => this.openTaskPanelNow(), TASK_PANEL_DEBOUNCE_MS);
    this.debouncedSendTaskMessage = createDebounced((message, sendOptions) => {
      this.sendMessage(message, sendOptions);
    }, TASK_ACTION_DEBOUNCE_MS);
    const showPrivacyTip = wx.getStorageSync(PRIVACY_TIP_KEY) !== true;
    const allowPersonalContext = aiAssistantService.isPersonalContextAllowed();
    const demoMode = demoData.normalizeDemoMode(options && options.demo);
    const activeConversation = conversationStore.getActiveConversation();
    const floatContext = options && options.from === "float" ? xiaofuFloatService.consumePendingContext() : null;
    const activeContextSlots = floatContext
      ? buildFloatContextSlots(floatContext, activeConversation.contextSlots)
      : contextManager.normalizeContextSlots(activeConversation.contextSlots);
    const sourceMessages = demoMode ? demoData.getDemoMessages(demoMode) : activeConversation.messages;
    const messages = normalizeMessagesForDisplay(trimMessages(sourceMessages), this.data.expandedCards);
    const providerState = resolveProviderState(messages);
    const privacyState = buildPrivacyState(allowPersonalContext, false, showPrivacyTip);
    const nextState = Object.assign({
      messages,
      showPrivacyTip,
      privacyExpanded: false,
      showPrivacySheet: false,
      demoMode,
      conversations: buildConversationDisplayList(activeConversation.conversationId),
      activeConversationId: activeConversation.conversationId,
      activeConversationTitle: activeConversation.title,
      activeConversationContext: activeContextSlots,
    }, privacyState, providerState, buildXiaofuFloatState());
    nextState.headerSubtitle = buildHeaderSubtitle(nextState);

    this.setData(Object.assign(nextState, bottomScrollPatch(false)));
    this.initVoiceInput();

    const question = decodeQuery(options && (options.q || options.question || ""));
    if (!demoMode && question) {
      setTimeout(() => this.sendMessage(question), 260);
    }
  },

  onShow() {
    this._aiPageUnloaded = false;
    const privacyState = buildPrivacyState(
      aiAssistantService.isPersonalContextAllowed(),
      this.data.privacyExpanded,
      this.data.showPrivacyTip
    );
    const nextState = Object.assign({}, privacyState, resolveProviderState(this.data.messages), buildXiaofuFloatState());
    nextState.headerSubtitle = buildHeaderSubtitle(Object.assign({}, this.data, nextState));
    this.setData(nextState);
  },

  onUnload() {
    this._aiPageUnloaded = true;
    this._activeAiRequestId = "";
  },

  refreshConversationState(activeConversation) {
    const conversation = activeConversation || conversationStore.getActiveConversation();
    this.setData({
      activeConversationId: conversation.conversationId,
      activeConversationTitle: conversation.title,
      activeConversationContext: contextManager.normalizeContextSlots(conversation.contextSlots),
      conversations: buildConversationDisplayList(conversation.conversationId),
    });
  },

  openConversationSheet() {
    this.setData({
      showConversationSheet: true,
      showCapabilityGuide: false,
      showTaskPanel: false,
      showPrivacySheet: false,
      showHeaderMenu: false,
      privacyExpanded: false,
      conversations: buildConversationDisplayList(this.data.activeConversationId),
    });
  },

  closeConversationSheet() {
    this.setData({ showConversationSheet: false });
  },

  createNewConversation(options) {
    if (this.data.sending) {
      wx.showToast({ title: "请等待当前回复完成", icon: "none" });
      return null;
    }
    const conversation = conversationStore.createConversation();
    this.setData({
      messages: [],
      inputValue: "",
      sending: false,
      slowRequest: false,
      historyTrimNotice: false,
      showConversationSheet: false,
      showHeaderMenu: false,
      activeConversationId: conversation.conversationId,
      activeConversationTitle: conversation.title,
      activeConversationContext: contextManager.normalizeContextSlots(conversation.contextSlots),
      conversations: buildConversationDisplayList(conversation.conversationId),
      scrollTop: Date.now(),
      scrollIntoView: "message-bottom-anchor",
      scrollWithAnimation: false,
    });
    if (!options || options.toast !== false) {
      wx.showToast({ title: "已新建对话", icon: "none" });
    }
    return conversation;
  },

  switchConversationById(conversationId) {
    if (!conversationId || conversationId === this.data.activeConversationId) {
      this.setData({ showConversationSheet: false });
      return;
    }
    if (this.data.sending) {
      wx.showToast({ title: "请等待当前回复完成", icon: "none" });
      return;
    }
    const conversation = conversationStore.setActiveConversation(conversationId);
    const messages = normalizeMessagesForDisplay(trimMessages(conversation.messages), this.data.expandedCards);
    const providerState = resolveProviderState(messages);
    const nextState = Object.assign({
      messages,
      activeConversationId: conversation.conversationId,
      activeConversationTitle: conversation.title,
      activeConversationContext: contextManager.normalizeContextSlots(conversation.contextSlots),
      conversations: buildConversationDisplayList(conversation.conversationId),
      showConversationSheet: false,
      historyTrimNotice: false,
      scrollTop: Date.now(),
      scrollIntoView: "message-bottom-anchor",
      scrollWithAnimation: false,
    }, providerState);
    nextState.headerSubtitle = buildHeaderSubtitle(Object.assign({}, this.data, nextState));
    this.setData(nextState);
  },

  onConversationTap(event) {
    this.switchConversationById(event.currentTarget.dataset.conversationId);
  },

  renameConversation(event) {
    const conversationId = event.currentTarget.dataset.conversationId;
    const conversation = (conversationStore.getStore().conversations || []).find((item) => item.conversationId === conversationId);
    if (!conversation) return;
    wx.showModal({
      title: "重命名对话",
      editable: true,
      placeholderText: "输入对话标题",
      content: conversation.title || "",
      success: (res) => {
        if (!res.confirm) return;
        const next = conversationStore.renameConversation(conversationId, res.content || "");
        if (!next) return;
        this.refreshConversationState(
          next.conversationId === this.data.activeConversationId ? next : conversationStore.getActiveConversation()
        );
      },
    });
  },

  clearConversation(event) {
    const conversationId = event && event.currentTarget && event.currentTarget.dataset.conversationId || this.data.activeConversationId;
    wx.showModal({
      title: "清空当前对话",
      content: "只清空这个对话的消息和上下文，不影响其他对话和课表数据。",
      confirmText: "清空",
      success: (res) => {
        if (!res.confirm) return;
        const next = conversationStore.clearConversation(conversationId);
        aiAssistantService.clearPendingClarification();
        if (conversationId === this.data.activeConversationId) {
          this.setMessages([], {
            activeConversationContext: contextManager.normalizeContextSlots(next && next.contextSlots),
            historyTrimNotice: false,
          }, { save: false });
        }
        this.refreshConversationState(next || conversationStore.getActiveConversation());
      },
    });
  },

  deleteConversation(event) {
    const conversationId = event.currentTarget.dataset.conversationId;
    if (!conversationId) return;
    wx.showModal({
      title: "删除对话",
      content: "删除后无法恢复，但不会影响课表数据。",
      confirmText: "删除",
      confirmColor: "#c62828",
      success: (res) => {
        if (!res.confirm) return;
        const store = conversationStore.deleteConversation(conversationId);
        const activeConversation = store.conversations.find((item) => item.conversationId === store.activeConversationId) ||
          store.conversations[0];
        const messages = normalizeMessagesForDisplay(trimMessages(activeConversation.messages), this.data.expandedCards);
        const providerState = resolveProviderState(messages);
        const nextState = Object.assign({
          messages,
          activeConversationId: activeConversation.conversationId,
          activeConversationTitle: activeConversation.title,
          activeConversationContext: contextManager.normalizeContextSlots(activeConversation.contextSlots),
          conversations: buildConversationDisplayList(activeConversation.conversationId),
          showConversationSheet: true,
          historyTrimNotice: false,
          scrollTop: Date.now(),
          scrollIntoView: "message-bottom-anchor",
          scrollWithAnimation: false,
        }, providerState);
        nextState.headerSubtitle = buildHeaderSubtitle(Object.assign({}, this.data, nextState));
        this.setData(nextState);
      },
    });
  },

  onInput(event) {
    this.setData({ inputValue: event.detail.value });
  },

  onCompositionStart() {
    this._isComposing = true;
  },

  onCompositionEnd() {
    this._isComposing = false;
  },

  onComposerConfirm(event) {
    if (this._isComposing) return;
    const value = event && event.detail && event.detail.value;
    this.sendMessage(value == null ? this.data.inputValue : value, { source: "confirm" });
  },

  onInsertNewline() {
    if (this.data.sending) return;
    const current = String(this.data.inputValue || "");
    this.setData({
      inputValue: `${current}\n`,
      inputFocus: true,
    });
  },

  initVoiceInput() {
    const visible = aiVoiceInputService.isVoiceInputAvailable(cloudbaseConfig, typeof wx !== "undefined" ? wx : null);
    this.setData({
      voiceInputVisible: visible,
      voiceStatusText: visible ? "" : "",
    });
    if (!visible || typeof wx === "undefined" || typeof wx.getRecorderManager !== "function") return;
    const recorder = wx.getRecorderManager();
    this._recorderManager = recorder;
    recorder.onStart && recorder.onStart(() => {
      this.setData({ voiceRecording: true, voiceRecognizing: false, voiceStatusText: "正在录音" });
    });
    recorder.onStop && recorder.onStop((res) => this.handleVoiceRecordStop(res));
    recorder.onError && recorder.onError(() => {
      this.setData({ voiceRecording: false, voiceRecognizing: false, voiceStatusText: "识别失败" });
      wx.showToast({ title: "录音失败", icon: "none" });
    });
  },

  ensureRecordPermission() {
    return new Promise((resolve) => {
      wx.authorize({
        scope: "scope.record",
        success: () => resolve(true),
        fail: () => {
          wx.showModal({
            title: "需要录音权限",
            content: "语音只用于本次转文字，识别完成后会删除临时文件。",
            confirmText: "打开设置",
            cancelText: "取消",
            success: (res) => {
              if (!res.confirm) return resolve(false);
              wx.openSetting({
                success: (setting) => resolve(Boolean(setting.authSetting && setting.authSetting["scope.record"])),
                fail: () => resolve(false),
              });
            },
            fail: () => resolve(false),
          });
        },
      });
    });
  },

  onVoiceTap() {
    if (!this.data.voiceInputVisible) {
      wx.showToast({ title: "当前环境暂不支持语音识别", icon: "none" });
      return;
    }
    if (this.data.sending || this.data.voiceRecognizing) return;
    if (this.data.voiceRecording) {
      this.stopVoiceRecording();
      return;
    }
    this.startVoiceRecording();
  },

  startVoiceRecording() {
    if (this.data.voiceRecording || this.data.sending) return;
    this.ensureRecordPermission().then((allowed) => {
      if (!allowed || !this._recorderManager) return;
      this.setData({ voiceStatusText: "正在录音" });
      this._voiceRecordStartedAt = Date.now();
      this._recorderManager.start({
        duration: Number(cloudbaseConfig.AI_VOICE_MAX_DURATION_MS || 15000) || 15000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: "mp3",
      });
    });
  },

  stopVoiceRecording() {
    if (!this._recorderManager || !this.data.voiceRecording) return;
    this._recorderManager.stop();
  },

  cancelVoiceRecording() {
    if (this._recorderManager && this.data.voiceRecording) {
      this._voiceCancelled = true;
      this._recorderManager.stop();
    }
    this.setData({ voiceRecording: false, voiceRecognizing: false, voiceStatusText: "" });
  },

  handleVoiceRecordStop(res) {
    if (this._voiceCancelled) {
      this._voiceCancelled = false;
      return;
    }
    const durationMs = Number(res && res.duration || 0) || Math.max(0, Date.now() - Number(this._voiceRecordStartedAt || Date.now()));
    this.setData({ voiceRecording: false });
    if (durationMs < aiVoiceInputService.MIN_DURATION_MS) {
      this.setData({ voiceRecognizing: false, voiceStatusText: "录音时间太短" });
      wx.showToast({ title: "录音时间太短", icon: "none" });
      return;
    }
    this.setData({ voiceRecognizing: true, voiceStatusText: "正在识别" });
    aiVoiceInputService.transcribeRecording({
      tempFilePath: res && res.tempFilePath,
      durationMs,
      fileSize: res && res.fileSize,
      format: "mp3",
    }).then((result) => {
      const text = String(result && result.text || "").trim();
      if (!text) throw new Error("EMPTY_VOICE_TEXT");
      this.setData({
        inputValue: text,
        inputFocus: true,
        voiceRecognizing: false,
        voiceStatusText: "识别完成",
      });
    }).catch(() => {
      this.setData({ voiceRecognizing: false, voiceStatusText: "识别失败" });
      wx.showToast({ title: "识别失败，可继续文字输入", icon: "none" });
    });
  },

  queueTaskMessage(message, options) {
    if (!message) return;
    if (this.debouncedSendTaskMessage) {
      this.debouncedSendTaskMessage(message, options || {});
      return;
    }
    this.sendMessage(message, options);
  },

  dispatchCapabilityAction(rawAction, fallbackText, options = {}) {
    const action = actionFromAbility(rawAction && rawAction.abilityId ? AI_CAPABILITY_BY_ID[rawAction.abilityId] : rawAction, fallbackText);
    if (!action.message && !action.url && !action.draft) return;
    const closePatch = {
      showTaskPanel: false,
      showCapabilityGuide: false,
      showConversationSheet: false,
    };

    if (action.kind === CAPABILITY_KINDS.LOCAL_ACTION) {
      this.setData(closePatch);
      if (action.id === "enableFloat") {
        this.enableXiaofuFloat();
      }
      if (action.message) {
        this.queueTaskMessage(action.message);
      }
      return;
    }

    if (action.kind === CAPABILITY_KINDS.SUPPLEMENT_PARAMS) {
      if (action.message) {
        this.setData(closePatch);
        this.queueTaskMessage(action.message);
        return;
      }
      this.setData({
        inputValue: action.draft || action.message || fallbackText || "",
        inputFocus: true,
        ...closePatch,
      });
      wx.showToast({ title: action.missingText || "请补充必要信息后发送", icon: "none" });
      return;
    }

    if (action.kind === CAPABILITY_KINDS.NAVIGATE && action.url && action.message) {
      this.setData(closePatch);
      this.queueTaskMessage(action.message || fallbackText || action.draft);
      return;
    }

    if (action.kind === CAPABILITY_KINDS.NAVIGATE && action.url) {
      this.setData(closePatch);
      this.navigateByUrl(action.url);
      return;
    }

    if (options.closeGuide) this.setData({ showCapabilityGuide: false });
    if (options.closeTaskPanel) this.setData({ showTaskPanel: false });
    this.queueTaskMessage(action.message || fallbackText || action.draft);
  },

  onQuickAction(event) {
    const actionId = event.currentTarget.dataset.actionId;
    const action = QUICK_ACTIONS.find((item) => item.id === actionId || item.abilityId === actionId);
    if (!action) return;
    this.dispatchCapabilityAction(action, action.message || action.label);
  },

  onWelcomeExampleTap(event) {
    const question = event.currentTarget.dataset.question;
    if (question) this.dispatchCapabilityAction(findAbilityByText(question), question);
  },

  onTaskPanelItemTap(event) {
    const groupIndex = Number(event.currentTarget.dataset.groupIndex);
    const taskIndex = Number(event.currentTarget.dataset.taskIndex);
    const group = this.data.taskPanelGroups[groupIndex] || {};
    const task = Array.isArray(group.items) ? group.items[taskIndex] : null;
    if (!task) return;
    this.dispatchCapabilityAction(task, task.message || task.fallbackMessage || task.label, { closeTaskPanel: true });
  },

  onSuggestionTap(event) {
    const suggestion = event.currentTarget.dataset.suggestion;
    if (suggestion) this.queueTaskMessage(suggestion);
  },

  onSubmit() {
    this.sendMessage(this.data.inputValue);
  },

  setMessages(nextMessages, patch, options) {
    const trimmed = Array.isArray(nextMessages) && nextMessages.length > MAX_MESSAGE_COUNT;
    const sourceMessages = trimMessages(nextMessages);
    const messages = normalizeMessagesForDisplay(sourceMessages, this.data.expandedCards);
    const providerState = resolveProviderState(messages);
    const nextState = Object.assign({
      messages,
      scrollTop: Date.now(),
      scrollIntoView: "message-bottom-anchor",
      scrollWithAnimation: !(options && options.instantScroll),
      historyTrimNotice: this.data.historyTrimNotice || trimmed,
    }, providerState, patch || {});
    nextState.headerSubtitle = buildHeaderSubtitle(Object.assign({}, this.data, nextState));
    this.setData(nextState);
    if (options && options.save) {
      const savedConversation = conversationStore.saveConversationMessages(
        this.data.activeConversationId,
        sourceMessages,
        nextState.activeConversationContext || this.data.activeConversationContext
      );
      if (savedConversation) {
        this.setData({
          activeConversationTitle: savedConversation.title,
          activeConversationContext: contextManager.normalizeContextSlots(savedConversation.contextSlots),
          conversations: buildConversationDisplayList(savedConversation.conversationId),
        });
      }
    }
  },

  sendMessage(rawText, options) {
    const message = String(rawText || "").trim();
    if (!message || this.data.sending) return;
    if (!this.data.demoMode && isNewConversationCommand(message)) {
      this.createNewConversation();
      return;
    }
    const sendOptions = options || {};
    const isRetrySend = Number.isFinite(Number(sendOptions.retryAssistantIndex));
    const now = Date.now();
    if (!isRetrySend && this._lastSubmitText === message && now - Number(this._lastSubmitAt || 0) < SEND_DEDUPE_MS) return;
    this._lastSubmitText = message;
    this._lastSubmitAt = now;

    const requestId = `ai-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    this._activeAiRequestId = requestId;
    let baseMessages = (this.data.messages || []).slice();
    let appendUserMessage = true;
    if (isRetrySend) {
      const retryIndex = Number(sendOptions.retryAssistantIndex);
      const retryMessage = baseMessages[retryIndex];
      if (retryMessage && retryMessage.role === "assistant") {
        const previous = baseMessages[retryIndex - 1];
        baseMessages.splice(retryIndex, 1);
        appendUserMessage = !(previous && previous.role === "user" && previous.content === message);
      }
    } else {
      const lastIndex = baseMessages.length - 1;
      const lastMessage = baseMessages[lastIndex];
      const previous = baseMessages[lastIndex - 1];
      const lastCard = lastMessage && Array.isArray(lastMessage.cards) ? lastMessage.cards[0] : null;
      if (
        lastMessage &&
        lastMessage.role === "assistant" &&
        lastCard &&
        lastCard.variant === "error" &&
        previous &&
        previous.role === "user" &&
        previous.content === message
      ) {
        baseMessages.pop();
        appendUserMessage = false;
      }
    }

    const userMessage = appendUserMessage ? makeMessage("user", message) : null;
    const nextMessages = appendUserMessage ? baseMessages.concat(userMessage) : baseMessages;
    this.setMessages(nextMessages, {
      inputValue: "",
      inputFocus: false,
      sending: true,
      slowRequest: false,
      sendingStatusText: "正在理解问题",
    }, { save: !this.data.demoMode });

    if (this.data.demoMode) {
      setTimeout(() => {
        const response = demoData.getDemoResponse(this.data.demoMode, message);
        const assistantMessage = makeMessage("assistant", response.answer || "我已经整理好演示结果。", {
          cards: Array.isArray(response.cards) ? response.cards : [],
          suggestions: Array.isArray(response.suggestions) ? response.suggestions : [],
          toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls : [],
          taskSteps: Array.isArray(response.taskSteps) ? response.taskSteps : [],
          evidence: response.evidence || null,
          safety: response.safety || null,
          metrics: response.metrics || null,
        });
        this.setMessages(nextMessages.concat(assistantMessage), {
          sending: false,
          slowRequest: false,
        }, { save: false });
      }, 160);
      return;
    }

    const isRequestActive = () => !this._aiPageUnloaded && this._activeAiRequestId === requestId;
    const slowTimer = setTimeout(() => {
      if (!isRequestActive()) return;
      this.setData({ slowRequest: true });
    }, 7000);

    let streamAssistantId = "";
    let streamContent = "";
    let streamTimer = null;
    let lastStreamFlushAt = 0;
    const clearStreamTimer = () => {
      if (streamTimer) {
        clearTimeout(streamTimer);
        streamTimer = null;
      }
    };
    const flushStream = (force) => {
      if (!isRequestActive()) return;
      if (!streamContent) return;
      const elapsed = Date.now() - lastStreamFlushAt;
      if (!force && elapsed < 80) {
        if (!streamTimer) {
          streamTimer = setTimeout(() => {
            streamTimer = null;
            flushStream(true);
          }, 80 - elapsed);
        }
        return;
      }
      clearStreamTimer();
      lastStreamFlushAt = Date.now();
      if (!streamAssistantId) streamAssistantId = `assistant-stream-${lastStreamFlushAt}`;
      const current = (this.data.messages || []).slice();
      const existingIndex = current.findIndex((item) => item.id === streamAssistantId);
      const streamingMessage = makeMessage("assistant", streamContent, {
        id: streamAssistantId,
        cards: [],
        suggestions: [],
        toolCalls: [],
        safety: {
          provider: "public",
          resolvedProvider: "public",
          externalProviderUsed: false,
          mode: "tool-grounded",
        },
      });
      if (existingIndex >= 0) {
        current[existingIndex] = Object.assign({}, current[existingIndex], streamingMessage, {
          timeText: current[existingIndex].timeText || streamingMessage.timeText,
        });
      } else {
        current.push(streamingMessage);
      }
      this.setMessages(current, {}, { save: false });
    };
    const callbacks = {
      onStatus: (status) => {
        if (!isRequestActive()) return;
        const text = status && status.text || "";
        if (text) this.setData({ sendingStatusText: text });
      },
      onDelta: (delta, fullText) => {
        if (!isRequestActive()) return;
        streamContent = fullText || `${streamContent}${delta || ""}`;
        flushStream(false);
      },
    };

    const clientContext = aiAssistantService.buildClientContext({
      conversationId: this.data.activeConversationId,
      contextSlots: this.data.activeConversationContext,
    });

    aiAssistantService.chat(message, clientContext, { callbacks })
      .then((response) => {
        if (!isRequestActive()) return;
        flushStream(true);
        const safety = response && response.safety || {};
        if (safety.pendingClarification) {
          aiAssistantService.setPendingClarification(safety.pendingClarification);
        } else if (safety.clearPendingClarification || response && response.metrics && response.metrics.intentName !== "clarify_missing_slot") {
          aiAssistantService.clearPendingClarification();
        }
        const assistantMessage = makeMessage("assistant", response.answer || "我已经整理好结果。", {
          cards: Array.isArray(response.cards) ? response.cards : [],
          suggestions: Array.isArray(response.suggestions) ? response.suggestions : [],
          toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls : [],
          taskSteps: Array.isArray(response.taskSteps) ? response.taskSteps : [],
          evidence: response.evidence || null,
          safety,
          metrics: response.metrics || null,
        });
        let finalMessages = (this.data.messages || []).slice();
        if (streamAssistantId) {
          const existingIndex = finalMessages.findIndex((item) => item.id === streamAssistantId);
          if (existingIndex >= 0) {
            finalMessages.splice(existingIndex, 1, assistantMessage);
          } else {
            finalMessages.push(assistantMessage);
          }
        } else {
          finalMessages.push(assistantMessage);
        }
        const nextContext = contextManager.updateFromResponse(this.data.activeConversationContext, response);
        this.setMessages(finalMessages, {
          activeConversationContext: nextContext,
          sending: false,
          slowRequest: false,
          sendingStatusText: "正在整理结果…",
        }, { save: true });
      })
      .catch((error) => {
        if (!isRequestActive()) return;
        flushStream(true);
        const assistantMessage = makeMessage("assistant", "", {
          cards: [{
            type: "generic",
            variant: "error",
            title: "服务暂时不可用，已保留你的问题。",
            subtitle: "可以重试，或先使用全校课表/空教室页面。",
            badges: [],
            items: [],
            actions: [
              { label: "重试", type: "retry", url: "", payload: { message } },
              { label: "打开全校课表", type: "navigate", url: "/pages/school/school", payload: {} },
              { label: "打开空教室", type: "navigate", url: "/pages/empty-room/empty-room", payload: {} },
            ],
          }],
          suggestions: [],
          safety: { provider: "mock", mode: "fallback" },
        });
        let finalMessages = (this.data.messages || []).slice();
        if (streamAssistantId) {
          const existingIndex = finalMessages.findIndex((item) => item.id === streamAssistantId);
          if (existingIndex >= 0) {
            finalMessages.splice(existingIndex, 1, assistantMessage);
          } else {
            finalMessages.push(assistantMessage);
          }
        } else {
          finalMessages.push(assistantMessage);
        }
        this.setMessages(finalMessages, {
          sending: false,
          slowRequest: false,
          sendingStatusText: "正在整理结果…",
        }, { save: true });
      })
      .finally(() => {
        clearTimeout(slowTimer);
        clearStreamTimer();
        if (this._activeAiRequestId === requestId) {
          this._activeAiRequestId = "";
        }
      });
  },

  dismissPrivacyTip() {
    wx.setStorageSync(PRIVACY_TIP_KEY, true);
    const privacyState = buildPrivacyState(this.data.allowPersonalContext, false, false);
    const nextState = Object.assign({
      showPrivacyTip: false,
      privacyExpanded: false,
      showPrivacySheet: false,
    }, privacyState);
    nextState.headerSubtitle = buildHeaderSubtitle(Object.assign({}, this.data, nextState));
    this.setData(nextState);
  },

  togglePrivacyTip() {
    const expanded = !this.data.showPrivacySheet;
    const privacyState = buildPrivacyState(this.data.allowPersonalContext, expanded, this.data.showPrivacyTip);
    this.setData(Object.assign({
      privacyExpanded: expanded,
      showPrivacySheet: expanded,
      showTaskPanel: false,
      showCapabilityGuide: false,
      showHeaderMenu: false,
      showConversationSheet: false,
    }, privacyState));
  },

  openPrivacySheet() {
    const privacyState = buildPrivacyState(this.data.allowPersonalContext, true, this.data.showPrivacyTip);
    this.setData(Object.assign({
      privacyExpanded: true,
      showPrivacySheet: true,
      showTaskPanel: false,
      showCapabilityGuide: false,
      showHeaderMenu: false,
      showConversationSheet: false,
    }, privacyState));
  },

  closePrivacySheet() {
    const privacyState = buildPrivacyState(this.data.allowPersonalContext, false, false);
    this.setData(Object.assign({
      privacyExpanded: false,
      showPrivacySheet: false,
      showPrivacyTip: false,
    }, privacyState));
  },

  openTaskPanel() {
    if (this.debouncedOpenTaskPanel) {
      this.debouncedOpenTaskPanel();
      return;
    }
    this.openTaskPanelNow();
  },

  openTaskPanelNow() {
    const cachedGroups = readTaskPanelGroupsCache();
    this.setData({
      showTaskPanel: true,
      showPrivacySheet: false,
      showCapabilityGuide: false,
      showHeaderMenu: false,
      showConversationSheet: false,
      privacyExpanded: false,
      taskPanelReady: Boolean(cachedGroups),
      taskPanelLoading: !cachedGroups,
      taskPanelGroups: cachedGroups || this.data.taskPanelGroups,
    });
    if (cachedGroups) return;

    setTimeout(() => {
      if (!this.data.showTaskPanel) return;
      const groups = cloneTaskPanelGroups();
      writeTaskPanelGroupsCache(groups);
      this.setData({
        taskPanelGroups: groups,
        taskPanelReady: true,
        taskPanelLoading: false,
      });
    }, 32);
  },

  closeTaskPanel() {
    this.setData({ showTaskPanel: false });
  },

  openCapabilityGuide() {
    this.setData({
      showCapabilityGuide: true,
      showTaskPanel: false,
      showPrivacySheet: false,
      showHeaderMenu: false,
      showConversationSheet: false,
      privacyExpanded: false,
    });
  },

  closeCapabilityGuide() {
    this.setData({ showCapabilityGuide: false });
  },

  openHeaderMenu() {
    this.setData({
      showHeaderMenu: true,
      showCapabilityGuide: false,
      showTaskPanel: false,
      showPrivacySheet: false,
      showConversationSheet: false,
      privacyExpanded: false,
    });
  },

  closeHeaderMenu() {
    this.setData({ showHeaderMenu: false });
  },

  enableXiaofuFloat() {
    xiaofuFloatService.enableEverywhere();
    this.setData(Object.assign({
      showHeaderMenu: false,
      showTaskPanel: false,
      showCapabilityGuide: false,
    }, buildXiaofuFloatState()));
    wx.showToast({ title: "已开启小佛AI浮窗", icon: "none" });
  },

  toggleXiaofuFloat() {
    const nextEnabled = !xiaofuFloatService.isEnabled();
    if (nextEnabled) {
      xiaofuFloatService.enableEverywhere();
    } else {
      xiaofuFloatService.setEnabled(false);
    }
    this.setData(Object.assign({
      showHeaderMenu: false,
      showTaskPanel: false,
      showCapabilityGuide: false,
    }, buildXiaofuFloatState()));
    wx.showToast({ title: nextEnabled ? "已开启小佛AI浮窗" : "已关闭小佛AI浮窗", icon: "none" });
  },

  onCapabilityExampleTap(event) {
    const text = event.currentTarget.dataset.text;
    if (!text) return;
    this.dispatchCapabilityAction(findAbilityByText(text), text, { closeGuide: true });
  },

  openCampusMapFromGuide() {
    this.setData({ showCapabilityGuide: false });
    this.navigateByUrl("/pages/campus-map/campus-map");
  },

  closeSheets() {
    this.setData({
      showTaskPanel: false,
      showCapabilityGuide: false,
      showPrivacySheet: false,
      showHeaderMenu: false,
      showConversationSheet: false,
      privacyExpanded: false,
    });
  },

  applyPersonalContextAllowed(allowed) {
    aiAssistantService.setPersonalContextAllowed(allowed);
    const privacyState = buildPrivacyState(allowed, this.data.privacyExpanded, this.data.showPrivacyTip);
    const nextState = Object.assign({}, privacyState);
    nextState.headerSubtitle = buildHeaderSubtitle(Object.assign({}, this.data, nextState));
    this.setData(nextState);
    wx.showToast({ title: allowed ? "已开启摘要" : "已关闭摘要", icon: "none" });
  },

  onPersonalContextToggle(event) {
    const allowed = event.detail.value === true;
    if (!allowed) {
      this.applyPersonalContextAllowed(false);
      return;
    }
    wx.showModal({
      title: "允许分析本机课表摘要？",
      content: PRIVACY_SUMMARY_TEXT,
      confirmText: "允许",
      cancelText: "取消",
      success: (res) => {
        if (res.confirm) {
          this.applyPersonalContextAllowed(true);
          return;
        }
        this.applyPersonalContextAllowed(false);
      },
      fail: () => this.applyPersonalContextAllowed(false),
    });
  },

  onHeroLogoError() {
    if (this.data.hasHeroLogo) this.setData({ hasHeroLogo: false });
  },

  clearHistory() {
    this.setData({ showHeaderMenu: false });
    wx.showModal({
      title: "清空当前对话",
      content: "仅清空当前对话的消息和上下文，不影响其他对话和课表数据。",
      confirmText: "清空",
      success: (res) => {
        if (!res.confirm) return;
        const next = conversationStore.clearConversation(this.data.activeConversationId);
        aiAssistantService.clearPendingClarification();
        this.setMessages([], {
          activeConversationContext: contextManager.normalizeContextSlots(next && next.contextSlots),
          historyTrimNotice: false,
        }, { save: false });
        this.refreshConversationState(next || conversationStore.getActiveConversation());
      },
    });
  },

  onCardOverflow(event) {
    const key = event.currentTarget.dataset.cardKey;
    if (!key) return;
    const expandedCards = Object.assign({}, this.data.expandedCards);
    expandedCards[key] = !expandedCards[key];
    const messages = normalizeMessagesForDisplay(this.data.messages, expandedCards);
    this.setData({
      expandedCards,
      messages,
      scrollTop: Date.now(),
      scrollIntoView: "message-bottom-anchor",
      scrollWithAnimation: true,
    });
  },

  onCardAction(event) {
    const messageIndex = Number(event.currentTarget.dataset.messageIndex);
    const cardIndex = Number(event.currentTarget.dataset.cardIndex);
    const actionIndex = Number(event.currentTarget.dataset.actionIndex);
    const message = this.data.messages[messageIndex] || {};
    const card = (message.displayCards || [])[cardIndex] || {};
    const action = (card.actions || [])[actionIndex] || {};
    this.executeCardAction(action, { messageIndex, cardIndex, actionIndex, message, card });
  },

  executeCardAction(action, context) {
    const safeAction = action && typeof action === "object" && !Array.isArray(action) ? action : {};
    if (safeAction.confirm) {
      wx.showModal({
        title: safeAction.confirm.title || "确认操作",
        content: safeAction.confirm.content || "",
        confirmText: safeAction.confirm.confirmText || "继续",
        cancelText: safeAction.confirm.cancelText || "取消",
        success: (res) => {
          if (res.confirm) this.performCardAction(safeAction, context || {});
        },
        fail: () => this.showActionFallback("操作已取消"),
      });
      return;
    }
    this.performCardAction(safeAction, context || {});
  },

  performCardAction(action, context) {
    const type = action.type || "noop";
    const payload = action.payload && typeof action.payload === "object" && !Array.isArray(action.payload)
      ? action.payload
      : {};
    if (type === "retry") {
      const message = firstCopyableText([payload.message, action.fallbackText, this.findLastUserMessage()]);
      if (!message) {
        this.showActionFallback("暂无可重试的问题");
        return;
      }
      this.sendMessage(message, {
        retryAssistantIndex: Number(context && context.messageIndex),
      });
      return;
    }
    if (type === "copy") {
      this.copyToClipboard(resolveActionCopyText(action, context && context.card, context && context.message));
      return;
    }
    if (type === "ask") {
      const nextMessage = firstCopyableText([payload.message, action.text, action.fallbackText, action.label]);
      if (!nextMessage) {
        this.showActionFallback("暂无可追问内容");
        return;
      }
      this.queueTaskMessage(nextMessage);
      return;
    }
    if (type === "navigate" || type === "switchTab") {
      const url = firstCopyableText([action.url, payload.url]);
      if (!url) {
        this.showActionFallback("暂时无法打开该入口");
        return;
      }
      this.navigateByUrl(url, {
        forceSwitchTab: type === "switchTab",
        toast: action.toast,
      });
      return;
    }
    if (type === "toggleFloat") {
      this.applyFloatAction(payload);
      return;
    }
    if (type === "openSheet") {
      this.openActionSheet(payload);
      return;
    }
    this.showActionFallback(action.toast || "暂时无法执行该操作");
  },

  showActionFallback(title) {
    wx.showToast({ title: title || "操作失败，请稍后再试", icon: "none" });
  },

  openActionSheet(payload) {
    const sheet = safeText(payload && (payload.sheet || payload.name || payload.target), 40).toLowerCase();
    if (["task", "tasks", "taskpanel"].indexOf(sheet) >= 0) {
      this.openTaskPanelNow();
      return;
    }
    if (["conversation", "conversations", "chat"].indexOf(sheet) >= 0) {
      this.openConversationSheet();
      return;
    }
    if (["help", "capability", "capabilities"].indexOf(sheet) >= 0) {
      this.openCapabilityGuide();
      return;
    }
    if (["privacy", "schedule-summary"].indexOf(sheet) >= 0) {
      this.openPrivacySheet();
      return;
    }
    if (["menu", "more"].indexOf(sheet) >= 0) {
      this.openHeaderMenu();
      return;
    }
    this.showActionFallback("暂时无法打开该面板");
  },

  applyFloatAction(payload) {
    const explicitEnabled = payload && typeof payload.enabled === "boolean" ? payload.enabled : null;
    const nextEnabled = explicitEnabled === null ? !xiaofuFloatService.isEnabled() : explicitEnabled;
    if (nextEnabled) {
      xiaofuFloatService.enableEverywhere();
    } else {
      xiaofuFloatService.setEnabled(false);
    }
    this.setData(Object.assign({}, buildXiaofuFloatState()));
    wx.showToast({ title: nextEnabled ? "已开启小佛AI浮窗" : "已关闭小佛AI浮窗", icon: "none" });
  },

  onCopyMessage(event) {
    const messageIndex = Number(event.currentTarget.dataset.messageIndex);
    const message = this.data.messages[messageIndex] || {};
    this.copyToClipboard(message.content || "");
  },

  copyToClipboard(text, options) {
    return copyTextToClipboard(text, options || {});
  },

  findLastUserMessage() {
    const list = this.data.messages || [];
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (list[index].role === "user") return list[index].content;
    }
    return "";
  },

  navigateByUrl(url, options) {
    const navOptions = options || {};
    const parsed = parseActionUrl(url);
    if (!parsed.path) return;
    if (/^https?:\/\//i.test(parsed.raw)) {
      this.copyToClipboard(parsed.raw);
      return;
    }
    const storageKey = TABBAR_PENDING_QUERY[parsed.path];
    if (storageKey || navOptions.forceSwitchTab) {
      if (parsed.query && Object.keys(parsed.query).length) {
        try {
          if (storageKey) {
            wx.setStorageSync(storageKey, Object.assign({}, parsed.query, { fromAiAssistant: true, ts: Date.now() }));
          }
        } catch (error) {
          // switchTab still opens the target page.
        }
      }
      wx.switchTab({
        url: parsed.path,
        success: () => {
          if (navOptions.toast) wx.showToast({ title: navOptions.toast, icon: "none" });
        },
        fail: (error) => {
          console.warn("[ai-action] switchTab failed", error);
          wx.showToast({ title: "暂时无法打开该页面", icon: "none" });
        },
      });
      return;
    }
    wx.navigateTo({
      url: parsed.raw,
      success: () => {
        if (navOptions.toast) wx.showToast({ title: navOptions.toast, icon: "none" });
      },
      fail: (error) => {
        console.warn("[ai-action] navigateTo failed", error);
        wx.showToast({ title: "暂时无法打开该页面，可复制入口再试", icon: "none" });
      },
    });
  },
});

if (typeof module !== "undefined") {
  module.exports = {
    normalizeCard,
    normalizeCardItem,
    normalizeMessagesForDisplay,
    resolveActionCopyText,
  };
}
