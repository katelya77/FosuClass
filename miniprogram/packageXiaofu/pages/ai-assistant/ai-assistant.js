const aiAssistantService = require("../../../services/aiAssistantService");
const aiVoiceInputService = require("../../../services/aiVoiceInputService");
const conversationStore = require("../../../services/conversationStore");
const contextManager = require("../../../services/xiaofuContextManager");
const xiaofuFloatService = require("../../../services/xiaofuFloatService");
const agentMemoryClient = require("../../../services/agentMemoryClient");
const agentReadinessClient = require("../../../services/agentReadinessClient");
const agentRunClient = require("../../../services/agentRunClient");
const agentClientErrorMapper = require("../../../services/agentClientErrorMapper");
const courseReminderClient = require("../../../services/courseReminderClient");
const scheduleChangeTracker = require("../../../services/scheduleChangeTracker");
const cloudbaseConfig = require("../../../config/cloudbase");
const demoData = require("./demo-data");
const { courseTimes } = require("../../../data/courseTimes");
const xiaofuPresentation = require("../../services/xiaofuPresentationAdapter");
const xiaofuMessageActions = require("../../services/xiaofuMessageActions");
const xiaofuConversationViewModel = require("../../services/xiaofuConversationViewModel");

const PRIVACY_TIP_KEY = "FOSU_AI_PRIVACY_TIP_CONFIRMED";
const TASK_PANEL_CACHE_KEY = "FOSU_AI_TASK_PANEL_GROUPS_CACHE";
const TASK_PANEL_CACHE_VERSION = "2026-07-campus-query-v7";
const TASK_PANEL_DEBOUNCE_MS = 180;
const TASK_ACTION_DEBOUNCE_MS = 180;
const SEND_DEDUPE_MS = 420;
const PRIVACY_SUMMARY_TEXT = "仅使用课程名、教师、教室、星期、节次、教学周；不包含学号、姓名、密码或原始文件。";
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
    missingText: "请补充教师姓名后查询",
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
    missingText: "请补充班级名称后查询",
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
    missingText: "请补充教室或楼栋后查询",
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
    missingText: "请补充课程名称后查询",
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
    url: "/packageMaps/pages/campus-map/campus-map?map=xianxiSouth",
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
    taskGroup: "校园服务",
    taskLabel: "校区天气",
    taskDesc: "下雨、温度、带伞和出行建议",
    guideGroup: "校园服务",
    guideExamples: ["仙溪校区今天会下雨吗"],
    welcomeExample: "仙溪校区今天会下雨吗",
    message: "仙溪校区今天会下雨吗？",
  },
  {
    id: "umbrellaAdvice",
    kind: CAPABILITY_KINDS.DIRECT_TOOL,
    iconPath: ICONS.term,
    label: "带伞建议",
    taskGroup: "校园服务",
    taskLabel: "今天要不要带伞",
    taskDesc: "优先查询天气，不走学校官网概况",
    guideGroup: "校园服务",
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
    className: "sync",
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
    taskGroup: "使用帮助",
    taskLabel: "可以查询什么",
    taskDesc: "查看范围和关键词",
    guideGroup: "使用帮助",
    guideExamples: ["可以查询什么", "如何问得更准确"],
    welcomeExample: "如何使用校园查询",
    message: "如何使用校园查询",
  },
  {
    id: "enableFloat",
    kind: CAPABILITY_KINDS.LOCAL_ACTION,
    iconPath: ICONS.app,
    label: "开启浮窗",
    taskGroup: "使用帮助",
    taskLabel: "开启小佛助手浮窗",
    taskDesc: "恢复右下角可拖拽小佛入口",
    message: "开启小佛助手浮窗",
  },
  {
    id: "termSync",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.term,
    label: "数据来源",
    taskGroup: "使用帮助",
    taskLabel: "数据来源说明",
    taskDesc: "了解课表与知识来源",
    guideGroup: "使用帮助",
    guideExamples: ["数据来源说明"],
    message: "数据来源说明",
  },
  {
    id: "jwcEntry",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.app,
    label: "教务入口",
    taskGroup: "校园服务",
    taskLabel: "教务系统入口",
    taskDesc: "查看教务相关入口",
    guideGroup: "校园服务",
    guideExamples: ["教务系统在哪里"],
    message: "教务系统在哪里进？",
  },
  {
    id: "campusLocations",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.app,
    label: "校区与地图",
    taskGroup: "校园服务",
    taskLabel: "校区与地图",
    taskDesc: "了解校区和位置",
    guideGroup: "校园服务",
    guideExamples: ["佛大有哪些校区"],
    message: "佛大有哪些校区？",
  },
  {
    id: "collegeDepartments",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.study,
    label: "学院部门",
    taskGroup: "校园服务",
    taskLabel: "学院与部门",
    taskDesc: "查看学院部门入口",
    guideGroup: "校园服务",
    guideExamples: ["佛大有哪些学院和部门"],
    message: "佛大有哪些学院和部门？",
  },
  {
    id: "libraryService",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.term,
    label: "图书馆服务",
    taskGroup: "校园服务",
    taskLabel: "图书馆服务",
    taskDesc: "查图书馆入口与服务边界",
    guideGroup: "校园服务",
    guideExamples: ["图书馆服务"],
    message: "图书馆服务",
  },
  {
    id: "commonSystems",
    kind: CAPABILITY_KINDS.GENERATIVE_QA,
    iconPath: ICONS.app,
    label: "常用系统",
    taskGroup: "校园服务",
    taskLabel: "常用系统入口",
    taskDesc: "查教务、门户等公开入口",
    guideGroup: "校园服务",
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
    taskGroup: "使用帮助",
    taskLabel: "如何问得更准确",
    taskDesc: "获得更稳的回答",
    guideGroup: "使用帮助",
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
  buildQuickAction("personalSync", "sync"),
];

const WELCOME_EXAMPLES = [
  "查班级本周课表",
  "今天有什么课",
  "当前是第几教学周",
  "仙溪校区今天会下雨吗",
  "教务系统在哪里",
  "可以查询什么",
];

const WELCOME_TASK_CARDS = [
  { id: "today", title: "看今天安排", desc: "今日课程一览", question: "今天有什么课" },
  { id: "empty", title: "找空教室", desc: "连续可用时段", question: "现在有连续空教室吗" },
  { id: "class", title: "查班级课表", desc: "按班级查询", question: "查班级本周课表" },
  { id: "study", title: "规划自习时间", desc: "课表与空教室", question: "帮我规划今天下午自习时间" },
];

const MEMORY_MODE_LABELS = {
  local_only: "仅保存在本机",
  session_state: "已保存会话状态",
  cloud_sync: "已开启跨设备同步",
};

function mapMemoryModeText(mode) {
  return xiaofuPresentation.mapMemoryStatusText(mode, "menu")
    || MEMORY_MODE_LABELS[String(mode || "local_only")]
    || MEMORY_MODE_LABELS.local_only;
}

function normalizeMemoryPreferenceItems(items) {
  const labels = {
    preferredName: "称呼",
    campus: "常用校区",
    preferredBuilding: "常用楼栋",
    defaultReminderLeadMinutes: "默认提醒",
    answerDetailLevel: "回答偏好",
  };
  const scopeLabels = {
    cloud_sync: "跨设备",
    session_state: "当前对话",
    local: "本机",
    user: "跨设备",
  };
  const map = {};
  (Array.isArray(items) ? items : []).forEach((item) => {
    const source = item && typeof item === "object" ? item : {};
    if (!labels[source.key] && !source.label && !source.category) return;
    const key = source.key;
    if (!key) return;
    let displayValue = source.value;
    if (key === "defaultReminderLeadMinutes") displayValue = `提前 ${source.value} 分钟`;
    let updatedAtText = "";
    if (source.updatedAt) {
      const ms = Date.parse(String(source.updatedAt));
      if (Number.isFinite(ms)) {
        const d = new Date(ms);
        updatedAtText = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      }
    }
    map[key] = {
      key,
      value: source.value,
      displayValue,
      label: labels[key] || source.label || source.category || key,
      category: source.category || labels[key] || key,
      scope: source.scope || "local",
      scopeText: scopeLabels[source.scope] || scopeLabels.local,
      updatedAt: source.updatedAt || "",
      updatedAtText,
      editable: source.editable !== false && Boolean(labels[key]),
    };
  });
  return Object.keys(labels).map((key) => map[key]).filter(Boolean)
    .concat(Object.keys(map).filter((k) => !labels[k]).map((k) => map[k]));
}

function mapMemoryChip(mode) {
  // Product UX: memory is folded into headerStatusLine; never dual-chip.
  return xiaofuPresentation.mapMemoryStatusText(mode, "chip") || "";
}

function applyHeaderStatusPatch(state) {
  const source = state || {};
  const header = xiaofuPresentation.buildHeaderViewModel(source);
  return {
    headerStatusLine: header.statusLine,
    statusChips: header.statusChips,
    memoryChipText: "",
    memoryStatusText: header.memoryStatusText || mapMemoryModeText(source.memoryMode),
    headerSubtitle: header.statusLine,
  };
}

async function detectConnectionStatus() {
  const readiness = await agentReadinessClient.probeAgentStatus();
  const statusMachine = readiness.statusMachine || "public_ready";
  const className = readiness.className
    || (statusMachine === "network_offline" ? "offline"
      : (statusMachine === "server_unreachable" || statusMachine === "enhanced_degraded" ? "warn" : "online"));
  return {
    connectionStatusText: readiness.label || "稳定模式",
    connectionStatusClass: className,
    statusMachine,
    runtimeMode: readiness.runtimeMode || "public",
    enhancedMode: readiness.enhancedMode || "disabled",
    statusChips: Array.isArray(readiness.chips) ? readiness.chips : ["稳定模式"],
    reasonCode: readiness.reasonCode || "",
    runEventsSupported: readiness.runEventsSupported !== false,
  };
}

function mapRuntimeModeLabel(mode, connectionClass, readiness = {}) {
  return xiaofuPresentation.composeHeaderStatus({
    runtimeMode: mode || readiness.runtimeMode,
    connectionStatusClass: connectionClass,
    statusMachine: readiness.statusMachine,
    memoryMode: "local_only",
  }).split(" · ")[0] || "校园助手";
}

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
      title: "校园服务",
      abilityIds: ["campusWeather", "umbrellaAdvice", "jwcEntry", "campusLocations", "libraryService", "commonSystems"],
    },
    {
      title: "使用与数据",
      abilityIds: ["appHelp", "askBetter", "termSync", "enableFloat"],
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
    "校园服务",
    "使用帮助",
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
  mock: "已核验课表数据",
  deepseek: "已核验课表数据",
  coze: "已核验课表数据",
  unknown: "已生成卡片",
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
  fosu_rag_retrieve: "校园信息",
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
  school_knowledge: "校园信息",
  navigation: "常用入口",
  help: "使用说明",
  import_guide: "导入指引",
  not_found: "暂未匹配",
  teacher: "教师",
  course: "课程",
  weather: "校区天气",
  weather_card: "校区天气",
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
  school_knowledge: "校园信息",
  navigation: "常用入口",
  help: "使用帮助",
  import_guide: "导入个人课表",
  not_found: "暂未匹配结果",
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
  ask: "继续追问",
  openSheet: "打开面板",
  toggleFloat: "调整浮窗",
  confirmReminder: "确认提醒",
  manageReminders: "管理提醒",
  noop: "查看",
};

const ACTION_TYPE_ALIASES = {
  bind: "navigate",
  navigate: "navigate",
  switchtab: "switchTab",
  retry: "retry",
  ask: "ask",
  opensheet: "openSheet",
  togglefloat: "toggleFloat",
  confirmreminder: "confirmReminder",
  managereminders: "manageReminders",
  noop: "noop",
};
const INVALID_DISPLAY_TEXT = new Set(["[object Object]", "undefined", "null", "NaN"]);

function cloneTaskPanelGroups() {
  return JSON.parse(JSON.stringify(TASK_PANEL_GROUPS));
}

function hasLegacyPersonalImportTask(groups) {
  if (!Array.isArray(groups)) return true;
  return groups.some((group) => {
    const items = Array.isArray(group && group.items) ? group.items : [];
    return items.some((item) => {
      const label = safeText(item && item.label, 40);
      const url = safeText(item && item.url, 120);
      if (item && item.abilityId === "personalSync" && url && url !== PERSONAL_SYNC_URL) return true;
      if (item && item.abilityId === "xlsImport" && /导入个人课表|个人课表同步/.test(label)) return true;
      return /导入个人课表|个人课表同步/.test(label) && /tab=xls/.test(url);
    });
  });
}

function readTaskPanelGroupsCache() {
  try {
    const cached = wx.getStorageSync(TASK_PANEL_CACHE_KEY);
    if (!cached || cached.version !== TASK_PANEL_CACHE_VERSION || !Array.isArray(cached.groups)) return null;
    if (hasLegacyPersonalImportTask(cached.groups)) return null;
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
    missingText: source.missingText || "请补充必要信息后查询",
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
  if (normalized.indexOf("mock") >= 0 || normalized.indexOf("local") >= 0) return "本地能力结果";
  if (normalized && normalized !== "unknown") return "校园服务结果";
  return "已生成结果";
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
  if (source.fallback === true || source.fallbackLayer === "client" || source.fallbackLayer === "server") {
    if (!source.evidence || !source.evidence.complete) return "本地能力结果";
  }
  const names = (Array.isArray(source.toolCalls) ? source.toolCalls : [])
    .concat(Array.isArray(source.steps) ? source.steps : [])
    .map((item) => String(item && (item.name || item.tool || item.toolName || item.type || item.label) || "").toLowerCase());
  const cardTypes = (Array.isArray(source.cards) ? source.cards : [])
    .map((item) => String(item && item.type || "").toLowerCase());
  const intent = String(
    (source.metrics && (source.metrics.canonicalIntent || source.metrics.intentName))
    || source.intent
    || ""
  ).toLowerCase();
  const text = names.concat(cardTypes).concat([intent]).join("|");
  if (/diagnose_data_status|schedule_status|数据状态/.test(text)) return "数据状态";
  if (/navigation|入口|官网/.test(text)) return "已找到校园入口";
  if (/weather|天气/.test(text)) return "已获取天气数据";
  if (/campus|map|route|location|地图|地点|位置/.test(text)) return "已查询校园地图";
  if (/empty|空教室|continuous/.test(text)) return "已核验教室占用";
  if (/fosu_rag_retrieve|school_knowledge|知识|project_qa|rag/.test(text)) return "来自已发布校园知识";
  if (/guide|import|help|说明|帮助|指引|conversational_help/.test(text)) return "使用说明";
  if (/school|schedule|today|tomorrow|week|term|teacher|course|classroom|detail|课表|课程|教师|教室|教学周|校历|查询全校/.test(text)) {
    return "已核验课表数据";
  }
  return "校园服务结果";
}

function statusText(status) {
  const normalized = String(status || "").toLowerCase();
  if (["success", "ok", "done"].includes(normalized)) return "已生成卡片";
  if (["failed", "error"].includes(normalized)) return "失败";
  if (normalized === "skipped") return "跳过";
  if (normalized === "running") return "任务进行中";
  return "已生成卡片";
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
  const providerLabel = fallbackReason ? "本地能力结果" : (externalUsed ? "校园服务结果" : "已核验结果");
  let text = providerLabel;
  if (fallbackReason) {
    text = "本地能力结果";
  } else if (externalUsed) {
    text = "校园服务结果";
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
  if (rawType === "copy") return null;
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

function firstActionText(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  for (let index = 0; index < list.length; index += 1) {
    const text = safeText(list[index], 600);
    if (text) return text;
  }
  return "";
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
  if (variant === "error" && ["school_knowledge", "navigation"].indexOf(cardType) >= 0) return [];
  if (cardType === "import_guide") {
    return [
      { type: "navigate", label: "打开个人课表同步", url: PERSONAL_SYNC_URL },
      { type: "navigate", label: "查看 XLS 文件导入", url: PERSONAL_SYNC_XLS_URL },
      { type: "ask", label: "继续问今天课程", payload: { message: "今天有什么课" } },
    ];
  }
  if (cardType === "help") {
    return [
      { type: "ask", label: "继续问课表", payload: { message: "今天有什么课" } },
      { type: "openSheet", label: "更多任务", payload: { sheet: "task" } },
    ];
  }
  if (cardType === "navigation") {
    const actions = [];
    if (entryUrl) {
      actions.push({ type: "navigate", label: "打开入口", url: entryUrl });
    }
    actions.push({ type: "ask", label: "继续追问", payload: { message: `${title || "这个入口"}怎么用` } });
    return actions;
  }
  if (cardType === "school_knowledge") {
    const actions = [];
    if (entryUrl && entryUrl !== sourceUrl && /^\/(pages|packageXiaofu|packageMaps)\//.test(entryUrl)) {
      actions.push({ type: "navigate", label: "相关入口", url: entryUrl });
    }
    actions.push({ type: "ask", label: "继续追问", payload: { message: `${title || "这个问题"}还有哪些相关入口` } });
    return actions;
  }
  if (["schedule_result", "schedule", "personal_schedule"].indexOf(cardType) >= 0) {
    const actions = [];
    if (entryUrl && /^\/(pages|packageXiaofu|packageMaps)\//.test(entryUrl)) actions.push({ type: "navigate", label: "查看完整课表", url: entryUrl });
    else actions.push({ type: "navigate", label: "查看完整课表", url: "/pages/today/today" });
    actions.push({ type: "ask", label: "继续查本周", payload: { message: "本周课表" } });
    actions.push({ type: "ask", label: "继续查明天", payload: { message: "明天有什么课" } });
    return actions;
  }
  if (cardType === "schedule_status") {
    return [
      { type: "navigate", label: "查看全校课表", url: "/pages/school/school" },
    ];
  }
  if (cardType === "weather") {
    return [
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
  return [];
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
  const visibleLimit = expanded ? 12 : 3;
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
        ? "结果会保留在当前对话中"
        : "课表以学校教务系统为准"));
  // Product UX: at most 2 visible primary actions; keep full actions for handlers/tests
  const primaryActions = xiaofuPresentation.limitCardActions(actions, 2);
  const secondaryActions = [];
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

function normalizeDisplaySteps(source = {}) {
  const steps = Array.isArray(source.steps) && source.steps.length
    ? source.steps
    : (Array.isArray(source.taskSteps) ? source.taskSteps : []);
  return steps.slice(0, 8).map((step, index) => {
    const label = safeText(step.label || step.reason || step.name || `步骤 ${index + 1}`, 40);
    const tool = safeText(step.tool || step.toolName || "", 40);
    const publicLabel = /_/.test(label) && !/[\u4e00-\u9fff]/.test(label)
      ? mapToolName(label)
      : label;
    return {
      id: safeText(step.id || step.key || `step-${index + 1}`, 40),
      label: publicLabel,
      tool: /_/.test(tool) ? mapToolName(tool) : tool,
      status: step.status || "success",
      durationMs: Number(step.durationMs || 0) || 0,
      errorCode: safeText(step.errorCode || "", 40),
    };
  });
}

function isGenericAssistantCard(card) {
  if (!card) return true;
  const type = String(card.type || "generic");
  const title = String(card.title || "");
  const subtitle = String(card.subtitle || "");
  if (type === "generic" && /^(小佛助手|小佛校园助手|结果)$/.test(title)) return true;
  if (/智能体表达层|来自智能体|自然对话/.test(subtitle)) return true;
  return false;
}

function resolveAssistantIntentName(source) {
  return xiaofuPresentation.resolveIntentName(source || {});
}

function normalizeMessageForDisplay(message, expandedCards, previousMessage, displayContext) {
  const source = message || {};
  const ctx = displayContext || {};
  const id = source.id || `m-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const lastUserText = ctx.lastUserText || (() => {
    if (previousMessage && previousMessage.role === "user") return previousMessage.content || "";
    return "";
  })();
  const resolvedIntentName = resolveAssistantIntentName(source);
  const presentationMode = safeText(source.presentationMode || (source.presentation && source.presentation.presentationMode) || "", 32);
  const plainProbe = Object.assign({}, source, {
    intentName: resolvedIntentName,
    userQuery: source.userQuery || source.query || lastUserText || "",
  });
  const isPlain = presentationMode === "plain"
    || xiaofuPresentation.isPlainPresentation(plainProbe, { lastUserText })
    || (source.role !== "user" && (!source.toolCalls || !source.toolCalls.length)
      && (!source.cards || !source.cards.length || source.cards.every(isGenericAssistantCard))
      && /conversational|project_qa|generic|plain|greeting|chitchat|smalltalk/i.test(resolvedIntentName || presentationMode || ""));
  const evidenceLabel = isPlain ? "" : inferEvidenceLabel(source);
  const normalizedSafety = source.safety ? normalizeSafety(source.safety) : null;
  const displaySafety = !isPlain && normalizedSafety ? Object.assign(normalizedSafety, {
    text: evidenceLabel || normalizedSafety.text,
  }) : null;
  const metrics = normalizeMetrics(source.metrics);
  const role = source.role === "user" ? "user" : "assistant";
  let rawCards = Array.isArray(source.cards) ? source.cards.filter((card) => !isGenericAssistantCard(card)) : [];
  rawCards = xiaofuPresentation.limitDisplayCards(
    rawCards,
    presentationMode || (isPlain ? "plain" : (rawCards.length > 1 ? "composite" : "single_card"))
  );

  const displaySteps = isPlain ? [] : normalizeDisplaySteps(source);
  // Product UX: never dump tool chips into the default message area
  const displayToolCalls = [];
  const fallback = source.fallback === true || source.fallbackLayer === "client" || source.fallbackLayer === "server";
  const evidenceText = isPlain ? "" : buildEvidenceText(source.evidence, evidenceLabel);
  const runSummary = source.runSummary || (source.presentation && source.presentation.runSummary) || null;
  const taskTrajectory = !isPlain
    ? (source.taskTrajectory || (source.presentation && source.presentation.taskTrajectory) || null)
    : null;
  const hasTrajectory = Boolean(taskTrajectory && (
    (taskTrajectory.plan && taskTrajectory.plan.length)
    || (taskTrajectory.execution && taskTrajectory.execution.length)
    || taskTrajectory.understanding
  ));
  const showFullRun = !isPlain && (displaySteps.length > 0 || hasTrajectory) && source.runExpanded === true;
  const runCompactText = runSummary && runSummary.compact
    ? runSummary.compact
    : (displaySteps.length || hasTrajectory ? "已核验" : "");
  const normalizedTrajectory = hasTrajectory ? {
    understanding: safeText(taskTrajectory.understanding || "", 160),
    plan: Array.isArray(taskTrajectory.plan) ? taskTrajectory.plan.slice(0, 5).map((p, i) => ({
      index: p.index || i + 1,
      label: safeText(p.label || "", 80),
    })) : [],
    execution: Array.isArray(taskTrajectory.execution) ? taskTrajectory.execution.slice(0, 6).map((e) => ({
      label: safeText(e.label || "", 80),
      status: e.status === "failed" ? "failed" : "success",
      summary: safeText(e.summary || "", 80),
    })) : [],
    verification: safeText(taskTrajectory.verification || "", 160),
    replanUsed: taskTrajectory.replanUsed === true,
  } : null;

  const prevUser = previousMessage && previousMessage.role === "user" ? previousMessage.content : (ctx.lastUserText || "");
  const turnCount = Number(ctx.turnCount || 0);
  const suggestions = xiaofuPresentation.refineSuggestions(source.suggestions, {
    userText: prevUser || source.userQuery || "",
    isPlain,
    isComposite: rawCards.length > 1 || presentationMode === "composite",
    clickedSuggestions: ctx.clickedSuggestions || [],
    previousSuggestionKey: ctx.previousSuggestionKey || "",
    stableMultiTurn: turnCount >= 4,
    turnCount,
  });

  const displayCards = rawCards
    .map((card, index) => {
      const normalized = normalizeCard(card, id, index, expandedCards, source);
      if (!normalized) return null;
      // Cap visible actions to 2
      if (Array.isArray(normalized.primaryActions)) {
        normalized.primaryActions = xiaofuPresentation.limitCardActions(normalized.primaryActions, 2);
      }
      if (Array.isArray(normalized.secondaryActions)) {
        normalized.secondaryActions = [];
      }
      return normalized;
    })
    .filter(Boolean);

  const rawTime = source.timeText || timeText();
  const resolvedTime = xiaofuPresentation.resolveTimeText(
    { timeText: rawTime },
    previousMessage ? { timeText: previousMessage.timeText } : null,
    rawTime
  );

  return Object.assign({}, source, {
    id,
    role,
    content: safeText(source.content || "", 2000),
    intentName: resolvedIntentName || source.intentName || "",
    userQuery: source.userQuery || lastUserText || "",
    presentationMode: presentationMode || (isPlain ? "plain" : ""),
    cards: rawCards,
    displayCards,
    suggestions,
    toolCalls: Array.isArray(source.toolCalls) ? source.toolCalls : [],
    taskSteps: Array.isArray(source.taskSteps) ? source.taskSteps : [],
    steps: Array.isArray(source.steps) ? source.steps : [],
    displaySteps: showFullRun && !normalizedTrajectory ? displaySteps : [],
    taskTrajectory: normalizedTrajectory,
    trajectoryExpanded: showFullRun && Boolean(normalizedTrajectory),
    runCompactText: !isPlain && !showFullRun ? runCompactText : "",
    hasCollapsedRun: !isPlain && (displaySteps.length > 0 || hasTrajectory) && !showFullRun,
    evidence: isPlain ? null : (source.evidence || null),
    evidenceText,
    evidenceExpanded: source.evidenceExpanded === true,
    evidenceCompact: evidenceText ? (evidenceText.length > 36 ? evidenceText.slice(0, 36) + "…" : evidenceText) : "",
    displayToolCalls,
    safety: source.safety || null,
    displaySafety,
    metrics,
    metricsText: "",
    fallback: fallback && !isPlain,
    fallbackBanner: fallback && !isPlain ? "网络暂不可用，已使用本地能力完成本次任务" : "",
    runStatus: source.status || (fallback ? "degraded" : "completed"),
    memory: source.memory || null,
    showCompactFeedback: false,
    feedbackOpen: false,
    showAvatar: xiaofuPresentation.shouldShowAssistantAvatar({ role }, previousMessage),
    timeText: resolvedTime,
  });
}

function normalizeMessagesForDisplay(messages, expandedCards, displayContext) {
  if (!Array.isArray(messages)) return [];
  const ctx = displayContext || {};
  let previousSuggestionKey = "";
  const turnCount = messages.filter((m) => m && m.role === "user").length;
  return messages.map((item, index) => {
    const previous = messages[index - 1];
    const lastUser = (() => {
      for (let i = index - 1; i >= 0; i -= 1) {
        if (messages[i] && messages[i].role === "user") return messages[i].content;
      }
      return "";
    })();
    const next = normalizeMessageForDisplay(item, expandedCards, previous, {
      clickedSuggestions: ctx.clickedSuggestions || [],
      previousSuggestionKey,
      lastUserText: lastUser,
      turnCount,
    });
    if (next.role === "assistant" && next.suggestions && next.suggestions.length) {
      previousSuggestionKey = xiaofuPresentation.suggestionKey(next.suggestions);
    }
    return next;
  });
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

function readPinnedConversationIds() {
  try {
    const raw = wx.getStorageSync("FOSU_AI_PINNED_CONVERSATIONS") || [];
    return new Set(Array.isArray(raw) ? raw : []);
  } catch (error) {
    return new Set();
  }
}

function buildConversationDisplayList(activeConversationId, mergedList) {
  const source = Array.isArray(mergedList) && mergedList.length
    ? mergedList
    : conversationStore.getConversationList();
  const pinned = readPinnedConversationIds();
  return source.map((item) => {
    const title = item.title && !/^(你好|你好啊|哈喽|hi|hello)$/i.test(String(item.title).trim())
      ? item.title
      : (item.title || "新对话");
    return {
      conversationId: item.conversationId,
      title: title === "你好" || title === "你好啊" ? "校园助手问候" : title,
      preview: item.preview || "",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      updatedAtText: formatConversationTime(item.updatedAt || item.createdAt),
      messageCount: item.messageCount,
      active: item.conversationId === activeConversationId || item.active === true,
      memoryMode: item.memoryMode || "local_only",
      memoryModeText: mapMemoryModeText(item.memoryMode || "local_only"),
      sourceBadge: "本机",
      conflict: item.conflict === true,
      lastTaskType: "",
      pinned: pinned.has(item.conversationId) || item.pinned === true,
    };
  });
}

function buildHeaderSubtitle(state) {
  const source = state || {};
  // Final UI: avoid stacking "增强模式" chip + long "增强理解已就绪" line.
  if (source.statusMachine === "network_offline" || source.connectionStatusClass === "offline") {
    return "离线可用";
  }
  if (source.statusMachine === "server_unreachable") {
    return "本机可用";
  }
  if (source.statusMachine === "enhanced_degraded") {
    return "增强降级";
  }
  // When enhanced chip already shown, do not repeat readiness text.
  if (source.statusMachine === "enhanced_ready") {
    return "";
  }
  return "";
}

function isNewConversationCommand(text) {
  const value = String(text || "").replace(/\s+/g, "");
  return /^(新建|创建|新开|开启|开一个)(一个)?(新)?(查询|对话)$/.test(value) ||
    value === "新建一个查询" ||
    value === "创建新查询" ||
    value === "新建对话" ||
    value === "新建一个对话";
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
    privacyStatusText: enabled ? "已允许使用本机课表" : "未授权使用本机课表",
    privacyCompactClass: enabled ? "enabled" : "disabled",
    privacyActionText: enabled ? "已允许" : "已关闭",
    composerNote: "",
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
    xiaofuFloatToggleText: "小佛浮窗",
    xiaofuFloatToggleDesc: "在其他页面快速唤起",
  };
}

Page({
  data: {
    quickActions: QUICK_ACTIONS,
    welcomeExamples: WELCOME_EXAMPLES,
    welcomeTaskCards: WELCOME_TASK_CARDS,
    capabilityGuideGroups: CAPABILITY_GUIDE_GROUPS,
    taskPanelGroups: [],
    taskPanelReady: false,
    taskPanelLoading: false,
    memorySwitching: false,
    memoryPreferences: [],
    memoryPreferencesLoading: false,
    autoMemoryEnabled: true,
    serverProactiveSuggestion: null,
    messages: [],
    conversations: [],
    activeConversationId: "",
    activeConversationTitle: "新对话",
    conversationTitle: "新对话",
    activeConversationContext: contextManager.createEmptyContextSlots(),
    expandedCards: {},
    inputValue: "",
    inputFocus: false,
    sending: false,
    sendingStatusText: "处理中",
    showQuickTasks: false,
    showTaskPanel: false,
    showConversationSheet: false,
    showCapabilityGuide: false,
    showHeaderMenu: false,
    showMemorySheet: false,
    showReminderSheet: false,
    showPrivacySheet: false,
    connectionStatusText: "检测中",
    connectionStatusClass: "unknown",
    statusMachine: "public_ready",
    statusChips: ["校园助手"],
    headerStatusLine: "校园助手",
    agentActivityState: "idle",
    statusCapsuleText: "待命 · 校园工具可用",
    statusCapsuleDetail: "课表与提醒由本机课表、Release Pack 与校园工具核验。",
    statusCapsuleExpanded: false,
    inAppReminderBanner: null,
    inAppReminderAcknowledging: false,
    proactiveInsight: null,
    contextualActions: [],
    runtimeModeLabel: "校园助手",
    conversationSubtitle: "新对话",
    memoryMode: "local_only",
    memoryStatusText: "仅保存在本机",
    memoryChipText: "",
    liveRunVisible: false,
    liveRunEvents: [],
    liveRunExpanded: false,
    activeRunId: "",
    activePollToken: "",
    slowRequest: false,
    showPrivacyTip: false,
    privacyExpanded: false,
    privacyText: PRIVACY_SUMMARY_TEXT,
    privacyStatusText: "未授权使用本机课表",
    privacyCompactClass: "disabled",
    privacyActionText: "未授权",
    privacyActionLabel: "说明",
    allowPersonalContext: false,
    providerLabel: "本地规则",
    providerModeLabel: "已核验",
    lastExternalProviderUsed: false,
    lastFallbackReason: "",
    lastProvider: "unknown",
    headerSubtitle: "校园助手",
    historyTrimNotice: false,
    hasHeroLogo: true,
    xiaofuFloatEnabled: true,
    xiaofuFloatToggleText: "小佛浮窗",
    xiaofuFloatToggleDesc: "在其他页面快速唤起",
    demoMode: "",
    scrollTop: 0,
    scrollIntoView: "",
    scrollWithAnimation: true,
    composerNote: "",
    showComposerPlus: false,
    clickedSuggestions: [],
    previousSuggestionKey: "",
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
    this._clickedSuggestions = [];
    this._previousSuggestionKey = "";
    this._draftInput = "";
    this.debouncedOpenTaskPanel = createDebounced(() => this.openTaskPanelNow(), TASK_PANEL_DEBOUNCE_MS);
    this.debouncedSendTaskMessage = createDebounced((message, sendOptions) => {
      this.sendMessage(message, sendOptions);
    }, TASK_ACTION_DEBOUNCE_MS);
    const showPrivacyTip = wx.getStorageSync(PRIVACY_TIP_KEY) !== true;
    const allowPersonalContext = aiAssistantService.isPersonalContextAllowed();
    const demoMode = demoData.normalizeDemoMode(options && options.demo);
    const panelName = decodeQuery(options && options.panel).trim().toLowerCase();
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
      showReminderSheet: panelName === "reminders",
      reminderSheetOpenCreate: panelName === "reminders",
    }, privacyState, providerState, buildXiaofuFloatState());
    nextState.conversationTitle = activeConversation.title || "新对话";
    nextState.memoryMode = wx.getStorageSync("FOSU_AI_MEMORY_MODE") || "local_only";
    Object.assign(nextState, applyHeaderStatusPatch(nextState));

    this.setData(Object.assign(nextState, bottomScrollPatch(false)));
    this.refreshProactiveWorkspace();
    this.initVoiceInput();
    this.refreshConnectionStatus();
    this.ensurePersonalContextFromSchedule();
    this.prefetchReminderCapability();

    const question = decodeQuery(options && (options.q || options.question || ""));
    if (!demoMode && question) {
      setTimeout(() => this.sendMessage(question), 260);
    }
  },

  refreshConnectionStatus() {
    detectConnectionStatus().then((status) => {
      if (this._aiPageUnloaded) return;
      const runtimeModeLabel = mapRuntimeModeLabel(status.runtimeMode || this.data.runtimeMode || "public", status.connectionStatusClass, status);
      const headerPatch = applyHeaderStatusPatch({
        runtimeMode: status.runtimeMode || this.data.runtimeMode || "public",
        connectionStatusClass: status.connectionStatusClass,
        statusMachine: status.statusMachine || "public_ready",
        memoryMode: this.data.memoryMode || "local_only",
      });
      const connectionPatch = {};
      if (!this.data.sending && this.data.agentActivityState !== "waiting_confirmation") {
        if (status.statusMachine === "network_offline" || status.connectionStatusClass === "offline") {
          Object.assign(connectionPatch, {
            agentActivityState: "network_error",
            statusCapsuleText: "网络异常 · 可使用本机能力",
            statusCapsuleDetail: "联网工具暂不可用；已缓存的个人课表和正式版规则仍可继续使用。",
            statusCapsuleExpanded: false,
          });
        } else {
          Object.assign(connectionPatch, {
            agentActivityState: "idle",
            statusCapsuleText: "待命 · 校园工具可用",
            statusCapsuleDetail: status.statusMachine === "enhanced_degraded"
              ? "增强表达层暂不可用，课表与提醒仍由校园工具完成。"
              : "课表与提醒由本机课表、Release Pack 与校园工具核验。",
            statusCapsuleExpanded: false,
          });
        }
      }
      this.setData(Object.assign({
        connectionStatusText: status.connectionStatusText,
        connectionStatusClass: status.connectionStatusClass,
        statusMachine: status.statusMachine || "public_ready",
        runtimeMode: status.runtimeMode || this.data.runtimeMode || "public",
        runtimeModeLabel,
      }, headerPatch, connectionPatch));
    });
  },

  
  async prefetchReminderCapability() {
    try {
      const capability = await courseReminderClient.getCapability();
      if (capability && capability.success) {
        this.setData({ reminderCapability: capability });
      }
    } catch (error) {
      // ignore
    }
  },

  ensurePersonalContextFromSchedule() {
    try {
      if (aiAssistantService.isPersonalContextAllowed && aiAssistantService.isPersonalContextAllowed()) return;
      const context = aiAssistantService.buildClientContext({
        conversationId: this.data.activeConversationId,
        contextSlots: this.data.activeConversationContext,
        memoryMode: this.data.memoryMode,
      });
      const summary = context && context.currentScheduleSummary;
      if (summary && summary.enabled && Array.isArray(summary.courses) && summary.courses.length) {
        if (aiAssistantService.setPersonalContextAllowed) {
          aiAssistantService.setPersonalContextAllowed(true);
        }
        this.setData(Object.assign({}, buildPrivacyState(true, this.data.privacyExpanded, this.data.showPrivacyTip)));
      }
    } catch (error) {
      // ignore
    }
  },
  refreshProactiveWorkspace() {
    let workspace;
    let proactiveContext = null;
    try {
      proactiveContext = aiAssistantService.buildClientContext({
        conversationId: this.data.activeConversationId,
        contextSlots: this.data.activeConversationContext,
        memoryMode: this.data.memoryMode,
      });
      workspace = aiAssistantService.buildProactiveWorkspace(proactiveContext);
    } catch (error) {
      workspace = aiAssistantService.buildProactiveWorkspace({
        currentScheduleSummary: { enabled: false, courses: [] },
      });
    }
    // Prefer server proactiveSuggestion when available; fall back to local insight.
    const serverSuggestion = this.data.serverProactiveSuggestion;
    let insight = workspace && workspace.insight || null;
    if (serverSuggestion && serverSuggestion.title) {
      insight = {
        kind: serverSuggestion.type || "suggestion",
        eyebrow: "小佛建议",
        title: serverSuggestion.title,
        detail: serverSuggestion.body || "",
        actionLabel: serverSuggestion.actions && serverSuggestion.actions[0]
          ? serverSuggestion.actions[0].label
          : "知道了",
        server: true,
        raw: serverSuggestion,
      };
    }
    const contextualActions = Array.isArray(workspace && workspace.actions)
      ? workspace.actions.slice(0, 3)
      : [];
    this.setData({ proactiveInsight: insight, contextualActions });
    if (insight) xiaofuFloatService.setProactiveInsight(insight);
    this.evaluateServerProactive("assistant_open", proactiveContext);
    if (proactiveContext && proactiveContext.scheduleChangePending === true
      && proactiveContext.scheduleChangeBaseline && proactiveContext.currentScheduleSummary) {
      const baselineFingerprint = proactiveContext.scheduleChangeBaseline.fingerprint || "baseline";
      const currentFingerprint = proactiveContext.currentScheduleSummary.fingerprint
        || proactiveContext.scheduleChangeDetectedAt || "current";
      const reportKey = `schedule-change:${baselineFingerprint}:${currentFingerprint}`.slice(0, 120);
      if (this._reportedScheduleChangeKey !== reportKey) {
        this._reportedScheduleChangeKey = reportKey;
        courseReminderClient.reportScheduleChange({
          currentScheduleSummary: proactiveContext.currentScheduleSummary,
          baselineScheduleSummary: proactiveContext.scheduleChangeBaseline,
          todayDate: proactiveContext.todayDate,
          todayWeekday: proactiveContext.todayWeekday,
          currentTeachingWeek: proactiveContext.currentTeachingWeek,
          idempotencyKey: reportKey,
        }).then((result) => {
          if (!result || result.success !== true) this._reportedScheduleChangeKey = "";
        }).catch(() => {
          this._reportedScheduleChangeKey = "";
        });
      }
    }
  },

  refreshInAppReminders() {
    if (this._inAppReminderFetchPending) return;
    this._inAppReminderFetchPending = true;
    courseReminderClient.listInAppEvents(5).then((result) => {
      if (this._aiPageUnloaded || !result || result.success !== true) return;
      const source = Array.isArray(result.items) && result.items.length ? result.items[0] : null;
      if (!source) {
        this.setData({ inAppReminderBanner: null });
        return;
      }
      const occurrence = source.occurrence && typeof source.occurrence === "object" ? source.occurrence : {};
      const courseName = String(occurrence.courseName || "课程提醒").slice(0, 60);
      const detail = [
        occurrence.date,
        occurrence.startTime,
        occurrence.classroom,
        occurrence.teacherName,
        occurrence.campus,
      ].filter(Boolean).map((item) => String(item).replace(/[\r\n]+/g, " ").slice(0, 60)).join(" · ");
      this.setData({
        inAppReminderBanner: {
          id: String(source.id || "").slice(0, 80),
          kind: source.kind === "schedule_change" ? "schedule_change" : "course_start",
          eyebrow: source.kind === "schedule_change" ? "课表变化提醒" : "应用内课程提醒",
          title: source.kind === "schedule_change" ? `${courseName} 的安排有变化` : courseName,
          detail: detail || "打开今日课表查看详情",
          actionLabel: "查看今日课表",
        },
      });
    }).catch(() => {
      // 离线或 Session 不可用时保持当前页面可用，不伪造提醒已送达。
    }).finally(() => {
      this._inAppReminderFetchPending = false;
    });
  },

  async acknowledgeInAppReminder(navigateAfter) {
    const banner = this.data.inAppReminderBanner || {};
    if (!banner.id || this._inAppReminderAckRunning) return;
    this._inAppReminderAckRunning = true;
    this.setData({ inAppReminderAcknowledging: true });
    try {
      const result = await courseReminderClient.acknowledgeInAppEvent(banner.id);
      if (!result || result.success !== true) {
        wx.showToast({ title: result && result.error || "提醒状态更新失败", icon: "none" });
        return;
      }
      this.setData({ inAppReminderBanner: null });
      if (navigateAfter === true) this.navigateByUrl("/pages/today/today");
    } catch (error) {
      wx.showToast({ title: "提醒状态更新失败", icon: "none" });
    } finally {
      this._inAppReminderAckRunning = false;
      if (!this._aiPageUnloaded) this.setData({ inAppReminderAcknowledging: false });
    }
  },

  onOpenInAppReminder() {
    this.acknowledgeInAppReminder(true);
  },

  onAcknowledgeInAppReminder() {
    this.acknowledgeInAppReminder(false);
  },

  toggleStatusCapsule() {
    this.setData({ statusCapsuleExpanded: !this.data.statusCapsuleExpanded });
  },

  onProactiveInsightTap() {
    const insight = this.data.proactiveInsight || {};
    if (insight.actionUrl) {
      this.navigateByUrl(insight.actionUrl);
      return;
    }
    if (insight.actionMessage) this.queueTaskMessage(insight.actionMessage);
  },

  onContextualActionTap(event) {
    const index = Number(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index);
    const action = (this.data.contextualActions || [])[index];
    if (!action) return;
    if (action.url) {
      this.navigateByUrl(action.url);
      return;
    }
    if (action.actionType === "manageReminders" || action.type === "manageReminders") {
      this.setData({
        showReminderSheet: true,
        reminderSheetOpenCreate: Boolean(!action.payload || action.payload.openCreate !== false),
      });
      return;
    }
    if (action.message) this.queueTaskMessage(action.message);
  },

  scheduleStatusCapsuleReset() {
    if (this._statusCapsuleResetTimer) clearTimeout(this._statusCapsuleResetTimer);
    this._statusCapsuleResetTimer = setTimeout(() => {
      if (this._aiPageUnloaded || this.data.sending || this.data.agentActivityState === "waiting_confirmation") return;
      this.setData({
        agentActivityState: "idle",
        statusCapsuleText: "待命 · 校园工具可用",
        statusCapsuleDetail: "课表与提醒由本机课表、Release Pack 与校园工具核验。",
        statusCapsuleExpanded: false,
      });
    }, 1800);
  },

  async refreshConversationList() {
    const activeId = this.data.activeConversationId;
    const localList = conversationStore.getConversationList();
    let merged = agentMemoryClient.mergeLocalAndCloudConversations(localList, [], activeId);
    try {
      const cloud = await agentMemoryClient.listCloudConversations();
      if (cloud.success) {
        merged = agentMemoryClient.mergeLocalAndCloudConversations(localList, cloud.conversations, activeId);
      }
    } catch (error) {
      // offline / session missing: keep local
    }
    if (this._aiPageUnloaded) return;
    this.setData({
      conversations: buildConversationDisplayList(activeId, merged),
    });
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
    this.refreshConnectionStatus();
    this.ensurePersonalContextFromSchedule();
    this.refreshProactiveWorkspace();
    this.refreshInAppReminders();
  },

  onUnload() {
    this._aiPageUnloaded = true;
    this._activeAiRequestId = "";
    if (this._statusCapsuleResetTimer) clearTimeout(this._statusCapsuleResetTimer);
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
    this.refreshConversationList();
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
    this.refreshProactiveWorkspace();
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
      title: "重命名查询",
      editable: true,
      placeholderText: "输入查询标题",
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
      title: "清空当前查询",
      content: "只清空这条对话的内容和结果，不影响其他对话和课表数据。",
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
      title: "删除查询",
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
    // Product UX: no dedicated newline control; textarea supports natural line breaks.
  },

  openComposerPlus() {
    if (this.data.sending) return;
    this.setData({
      showComposerPlus: true,
      showHeaderMenu: false,
      showTaskPanel: false,
      showCapabilityGuide: false,
      showPrivacySheet: false,
      showConversationSheet: false,
      showMemorySheet: false,
      showReminderSheet: false,
    });
  },

  closeComposerPlus() {
    this.setData({ showComposerPlus: false });
  },

  openTaskPanelFromPlus() {
    this.setData({ showComposerPlus: false });
    this.openTaskPanel();
  },

  openPersonalSyncFromPlus() {
    this.setData({ showComposerPlus: false });
    this.navigateByUrl(PERSONAL_SYNC_URL, { toast: "已打开课表导入" });
  },

  createReminderFromPlus() {
    this.setData({
      showComposerPlus: false,
      showReminderSheet: true,
      reminderSheetOpenCreate: true,
    });
  },

  openRemindersFromPlus() {
    this.setData({ showComposerPlus: false, showReminderSheet: true });
  },

  viewNextCourseFromPlus() {
    this.setData({ showComposerPlus: false });
    this.queueTaskMessage("我下一节课在哪，什么时候该出发？");
  },

  findEmptyRoomFromPlus() {
    this.setData({ showComposerPlus: false });
    this.queueTaskMessage("现在帮我找附近空教室");
  },

  openCampusMapFromPlus() {
    this.setData({ showComposerPlus: false });
    this.navigateByUrl("/packageMaps/pages/campus-map/campus-map");
  },

  startVoiceFromPlus() {
    this.setData({ showComposerPlus: false });
    this.onVoiceTap();
  },

  createNewConversationFromPlus() {
    this.setData({ showComposerPlus: false });
    this.createNewConversation();
  },

  openConversationSheetFromMenu() {
    this.setData({ showHeaderMenu: false });
    this.openConversationSheet();
  },

  openPrivacyHelp() {
    this.setData({ showHeaderMenu: false, showMemorySheet: true });
  },

  onFloatSwitchChange(event) {
    const enabled = event && event.detail && event.detail.value === true;
    if (enabled) xiaofuFloatService.enableEverywhere();
    else xiaofuFloatService.setEnabled(false);
    this.setData(Object.assign({ showHeaderMenu: false }, buildXiaofuFloatState()));
    try { wx.vibrateShort({ type: "light" }); } catch (e) { /* ignore */ }
    wx.showToast({ title: enabled ? "已开启浮窗" : "已关闭浮窗", icon: "none" });
  },

  onFloatSwitchChangeFromSheet(event) {
    const enabled = event && event.detail && event.detail.value === true;
    this.onFloatSwitchChange({ detail: { value: enabled } });
  },

  onResultCardAction(event) {
    const detail = event.detail || {};
    this.onCardAction({
      currentTarget: {
        dataset: {
          messageIndex: detail.messageIndex,
          cardIndex: detail.cardIndex,
          actionIndex: detail.actionIndex,
        },
      },
    });
  },

  onResultCardOverflow(event) {
    const detail = event.detail || {};
    this.onCardOverflow({
      currentTarget: {
        dataset: { cardKey: detail.cardKey },
      },
    });
  },

  onMessageLongPress(event) {
    const messageId = event.currentTarget.dataset.messageId;
    const role = event.currentTarget.dataset.role || "assistant";
    if (!messageId) return;
    const message = (this.data.messages || []).find((item) => item.id === messageId);
    if (!message) return;
    const itemList = xiaofuMessageActions.actionSheetItemList(role);
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const label = itemList[res.tapIndex];
        const action = xiaofuMessageActions.actionByLabel(role, label);
        if (!action) return;
        this.handleMessageAction(action.id, message);
      },
    });
  },

  handleMessageAction(actionId, message) {
    const content = String(message && message.content || "");
    if (actionId === "copy") {
      wx.setClipboardData({
        data: content,
        success: () => {
          try { wx.vibrateShort({ type: "light" }); } catch (e) { /* ignore */ }
          wx.showToast({ title: "已复制", icon: "none" });
        },
      });
      return;
    }
    if (actionId === "resend" || actionId === "regenerate") {
      const userText = actionId === "regenerate"
        ? (() => {
          const list = this.data.messages || [];
          const idx = list.findIndex((m) => m.id === message.id);
          for (let i = idx - 1; i >= 0; i -= 1) {
            if (list[i].role === "user") return list[i].content;
          }
          return "";
        })()
        : content;
      if (userText) this.sendMessage(userText, { retryAssistantIndex: actionId === "regenerate" ? (this.data.messages || []).findIndex((m) => m.id === message.id) : undefined });
      return;
    }
    if (actionId === "edit") {
      this.setData({ inputValue: content, inputFocus: true });
      return;
    }
    if (actionId === "followup") {
      this.setData({ inputValue: "", inputFocus: true });
      wx.showToast({ title: "继续追问吧", icon: "none" });
      return;
    }
    if (actionId === "delete") {
      const next = (this.data.messages || []).filter((m) => m.id !== message.id);
      this.setMessages(next, {}, { save: true });
      return;
    }
    if (actionId === "share") {
      const share = xiaofuMessageActions.buildShareSummary(message);
      if (!share.ok) {
        wx.showToast({ title: share.reason || "无法分享", icon: "none" });
        return;
      }
      wx.showModal({
        title: share.title,
        content: share.summary,
        confirmText: "复制摘要",
        success: (res) => {
          if (!res.confirm) return;
          wx.setClipboardData({ data: `${share.title}\n${share.summary}` });
        },
      });
      return;
    }
    if (actionId === "feedback") {
      this.openFeedbackReasons(message.id);
    }
  },

  openFeedbackReasons(messageId) {
    const reasons = xiaofuMessageActions.feedbackReasons();
    wx.showActionSheet({
      itemList: reasons.map((r) => r.label),
      success: (res) => {
        const reason = reasons[res.tapIndex];
        if (!reason) return;
        this.submitMessageFeedback(messageId, reason.id);
      },
    });
  },

  submitMessageFeedback(messageId, feedback) {
    try {
      const key = "FOSU_AI_FEEDBACK_LOG";
      const existing = wx.getStorageSync(key) || [];
      const next = (Array.isArray(existing) ? existing : []).concat([{
        feedback: String(feedback || "").slice(0, 32),
        messageId: String(messageId || "").slice(0, 80),
        at: new Date().toISOString(),
      }]).slice(-50);
      wx.setStorageSync(key, next);
    } catch (error) {
      // ignore
    }
    wx.showToast({ title: "已记录反馈", icon: "none" });
  },

  onRetryUserMessage(event) {
    const messageId = event.currentTarget.dataset.messageId;
    const message = (this.data.messages || []).find((item) => item.id === messageId);
    if (message && message.content) this.sendMessage(message.content);
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
      wx.showToast({ title: action.missingText || "请补充必要信息后查询", icon: "none" });
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
    const actionId = event.currentTarget.dataset.actionId === "xls" ? "sync" : event.currentTarget.dataset.actionId;
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
    if (task.abilityId === "personalSync") {
      this.setData({
        showTaskPanel: false,
        showCapabilityGuide: false,
        showConversationSheet: false,
      });
      this.navigateByUrl(PERSONAL_SYNC_URL, { toast: "已打开个人课表同步" });
      return;
    }
    this.dispatchCapabilityAction(task, task.message || task.fallbackMessage || task.label, { closeTaskPanel: true });
  },

  onSuggestionTap(event) {
    const suggestion = event.currentTarget.dataset.suggestion;
    if (!suggestion) return;
    this._clickedSuggestions = (this._clickedSuggestions || []).concat([String(suggestion)]).slice(-20);
    this.setData({ clickedSuggestions: this._clickedSuggestions });
    this.queueTaskMessage(suggestion);
  },

  onSubmit() {
    // While a run is in flight, the same control becomes stop/cancel.
    if (this.data.sending) {
      this.onCancelRun();
      try { wx.vibrateShort({ type: "light" }); } catch (e) { /* ignore */ }
      return;
    }
    try { wx.vibrateShort({ type: "light" }); } catch (e) { /* ignore */ }
    this.sendMessage(this.data.inputValue);
  },

  setMessages(nextMessages, patch, options) {
    const trimmed = Array.isArray(nextMessages) && nextMessages.length > MAX_MESSAGE_COUNT;
    const sourceMessages = trimMessages(nextMessages);
    const messages = normalizeMessagesForDisplay(sourceMessages, this.data.expandedCards, {
      clickedSuggestions: this._clickedSuggestions || this.data.clickedSuggestions || [],
      previousSuggestionKey: this._previousSuggestionKey || this.data.previousSuggestionKey || "",
    });
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (lastAssistant && lastAssistant.suggestions && lastAssistant.suggestions.length) {
      this._previousSuggestionKey = xiaofuPresentation.suggestionKey(lastAssistant.suggestions);
    }
    const providerState = resolveProviderState(messages);
    const headerPatch = applyHeaderStatusPatch(Object.assign({}, this.data, patch || {}));
    const nextState = Object.assign({
      messages,
      scrollTop: Date.now(),
      scrollIntoView: "message-bottom-anchor",
      scrollWithAnimation: !(options && options.instantScroll),
      historyTrimNotice: this.data.historyTrimNotice || trimmed,
      previousSuggestionKey: this._previousSuggestionKey || "",
      showQuickTasks: false,
    }, providerState, headerPatch, patch || {});
    this.setData(nextState);
    if (options && options.save) {
      const savedConversation = conversationStore.saveConversationMessages(
        this.data.activeConversationId,
        sourceMessages,
        nextState.activeConversationContext || this.data.activeConversationContext
      );
      if (savedConversation) {
        let title = savedConversation.title;
        if (/^(你好|你好啊|哈喽|hi|hello)$/i.test(String(title || "").trim())) {
          title = xiaofuConversationViewModel.deriveConversationTitle(sourceMessages, "校园助手问候");
        } else if (!title || title === "新对话") {
          title = xiaofuConversationViewModel.deriveConversationTitle(sourceMessages, title || "新对话");
        }
        this.setData({
          activeConversationTitle: title,
          conversationTitle: title,
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
    this._cancelCurrentRun = false;
    this.setMessages(nextMessages, {
      inputValue: "",
      inputFocus: false,
      sending: true,
      slowRequest: false,
      sendingStatusText: "正在提交任务",
      agentActivityState: "understanding",
      statusCapsuleText: "正在提交校园任务",
      statusCapsuleDetail: "等待服务端建立真实任务运行记录。",
      statusCapsuleExpanded: true,
      liveRunVisible: true,
      liveRunEvents: [],
      liveRunExpanded: false,
      activeRunId: "",
      activePollToken: "",
    }, { save: !this.data.demoMode });

    if (this.data.demoMode) {
      setTimeout(() => {
        const response = demoData.getDemoResponse(this.data.demoMode, message);
        const assistantMessage = makeMessage("assistant", response.answer || "已整理演示结果。", {
          cards: Array.isArray(response.cards) ? response.cards : [],
          suggestions: Array.isArray(response.suggestions) ? response.suggestions : [],
          toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls : [],
          taskSteps: Array.isArray(response.taskSteps) ? response.taskSteps : [],
          steps: Array.isArray(response.steps) ? response.steps : (Array.isArray(response.taskSteps) ? response.taskSteps : []),
          evidence: response.evidence || null,
          safety: response.safety || null,
          metrics: response.metrics || null,
          fallback: false,
          status: "completed",
        });
        this.setMessages(nextMessages.concat(assistantMessage), {
          sending: false,
          slowRequest: false,
          agentActivityState: "complete",
          statusCapsuleText: "完成 · 演示结果已整理",
          statusCapsuleDetail: "当前为本机演示数据。",
          statusCapsuleExpanded: false,
        }, { save: false });
        this.scheduleStatusCapsuleReset();
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
        const type = String(status && status.type || "");
        const activityPatch = {};
        if (status && status.type === "provider.started") {
          Object.assign(activityPatch, {
            agentActivityState: "thinking",
            statusCapsuleText: text || "正在增强理解",
            statusCapsuleDetail: "外部表达层已实际开始；校园事实仍只取自确定性工具。",
          });
        } else if (type === "tool.started") {
          Object.assign(activityPatch, {
            agentActivityState: "querying",
            statusCapsuleText: text || "正在查询校园数据",
            statusCapsuleDetail: "正在调用受控校园工具并记录可验证结果。",
          });
        } else if (type === "tool.completed" || type === "result.verifying" || type === "response.composing") {
          Object.assign(activityPatch, {
            agentActivityState: "composing",
            statusCapsuleText: text || "正在组合工具结果",
            statusCapsuleDetail: "正在核验并整理课表、地点或天气结果。",
          });
        } else if (type === "planner.started" || type === "plan.created" || type === "plan.replan") {
          Object.assign(activityPatch, {
            agentActivityState: "understanding",
            statusCapsuleText: text || "正在理解任务",
            statusCapsuleDetail: "正在生成受约束计划；不会直接改写校园事实。",
          });
        } else if (type === "run.degraded" || type === "provider.failed" || type === "run.status_unavailable") {
          Object.assign(activityPatch, {
            agentActivityState: "network_error",
            statusCapsuleText: text || "增强能力异常 · 正在降级",
            statusCapsuleDetail: "会保留确定性工具结果，不把 Provider 失败当作课表失败。",
          });
        }
        if (text || Object.keys(activityPatch).length) {
          this.setData(Object.assign({
            sendingStatusText: text || this.data.sendingStatusText,
            statusCapsuleExpanded: true,
          }, activityPatch));
        }
      },
      onRunCreated: (info) => {
        if (!isRequestActive()) return;
        this.setData({
          activeRunId: info && info.runId || "",
          activePollToken: info && info.pollToken || "",
        });
      },
      onRunEvents: (events, allEvents) => {
        if (!isRequestActive()) return;
        this.setData({
          liveRunEvents: Array.isArray(allEvents) ? allEvents.slice(-12) : [],
          liveRunVisible: true,
        });
      },
      shouldCancel: () => this._cancelCurrentRun === true || !isRequestActive(),
      onDelta: (delta, fullText) => {
        if (!isRequestActive()) return;
        streamContent = fullText || `${streamContent}${delta || ""}`;
        flushStream(false);
      },
    };

    const clientContext = aiAssistantService.buildClientContext({
      conversationId: this.data.activeConversationId,
      contextSlots: this.data.activeConversationContext,
      memoryMode: this.data.memoryMode,
    });

    aiAssistantService.chat(message, clientContext, { callbacks })
      .then((response) => {
        if (!isRequestActive()) return;
        flushStream(true);
        if (response && response.status === "cancelled") {
          this.setMessages(this.data.messages || nextMessages, {
            sending: false,
            slowRequest: false,
            liveRunVisible: false,
            liveRunEvents: [],
            sendingStatusText: "已取消",
            agentActivityState: "idle",
            statusCapsuleText: "任务已取消",
            statusCapsuleDetail: "未继续执行后续工具或写操作。",
            statusCapsuleExpanded: false,
            activeRunId: "",
            activePollToken: "",
          }, { save: true });
          return;
        }
        const safety = response && response.safety || {};
        const memoryPreferencePatch = response && response.memoryPreferencePatch;
        if (memoryPreferencePatch && typeof memoryPreferencePatch === "object" && Object.keys(memoryPreferencePatch).length) {
          aiAssistantService.saveUserPreferences(Object.assign(
            {},
            aiAssistantService.getUserPreferences(),
            memoryPreferencePatch
          ));
          this.loadMemoryPreferences();
        }
        if (safety.pendingClarification) {
          aiAssistantService.setPendingClarification(safety.pendingClarification);
        } else if (safety.clearPendingClarification || response && response.metrics && response.metrics.intentName !== "clarify_missing_slot") {
          aiAssistantService.clearPendingClarification();
        }
        const resolvedIntentName = (typeof response.intent === "string" && response.intent)
          || (response.intent && response.intent.name)
          || response.intentName
          || (response.metrics && (response.metrics.intentName || response.metrics.canonicalIntent))
          || "";
        const presentationMode = response.presentationMode
          || (response.presentation && response.presentation.presentationMode)
          || "";
        const responseCards = Array.isArray(response.cards) ? response.cards : [];
        const waitingConfirmation = responseCards.some((card) => (Array.isArray(card && card.actions) ? card.actions : [])
          .some((action) => action && action.type === "confirmReminder"));
        const assistantMessage = makeMessage("assistant", response.answer || "已为你整理以下结果。", {
          cards: responseCards,
          suggestions: Array.isArray(response.suggestions) ? response.suggestions : [],
          toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls : [],
          taskSteps: Array.isArray(response.taskSteps) ? response.taskSteps : [],
          steps: Array.isArray(response.steps) ? response.steps : (Array.isArray(response.taskSteps) ? response.taskSteps : []),
          evidence: response.evidence || response.evidenceDisplay || null,
          safety,
          metrics: response.metrics || null,
          fallback: response.fallback === true,
          fallbackLayer: response.fallbackLayer || "",
          status: response.status || "completed",
          memory: response.memory || null,
          intent: response.intent || (response.metrics && response.metrics.canonicalIntent) || "",
          intentName: resolvedIntentName,
          userQuery: message,
          presentationMode,
          presentation: response.presentation || null,
          runSummary: response.runSummary || (response.presentation && response.presentation.runSummary) || null,
          taskTrajectory: response.taskTrajectory || (response.presentation && response.presentation.taskTrajectory) || null,
          plan: response.plan || null,
        });
        if (response.memory && response.memory.mode) {
          this.setData(Object.assign({
            memoryMode: response.memory.mode,
          }, applyHeaderStatusPatch(Object.assign({}, this.data, {
            memoryMode: response.memory.mode,
          }))));
        }
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
          sendingStatusText: "已完成",
          agentActivityState: waitingConfirmation ? "waiting_confirmation" : "complete",
          statusCapsuleText: waitingConfirmation ? "等待确认 · 尚未创建提醒" : "完成 · 结果已核验",
          statusCapsuleDetail: waitingConfirmation
            ? "写操作只有在你查看计划并点击确认后才会执行。"
            : "已完成本次任务，可继续追问或执行卡片操作。",
          statusCapsuleExpanded: waitingConfirmation,
          liveRunVisible: false,
          liveRunEvents: [],
          activeRunId: "",
          activePollToken: "",
        }, { save: true });
        if (resolvedIntentName === "detect_schedule_changes") {
          scheduleChangeTracker.acknowledge(clientContext.currentScheduleSummary);
        }
        this.refreshProactiveWorkspace();
        if (!waitingConfirmation) this.scheduleStatusCapsuleReset();
      })
      .catch((error) => {
        if (!isRequestActive()) return;
        flushStream(true);
        const isReminderQuery = /提醒|通知|默认提醒/.test(String(message || ""));
        const assistantMessage = makeMessage("assistant", "", {
          cards: [{
            type: "generic",
            variant: isReminderQuery ? "reminder" : "error",
            title: isReminderQuery ? "可用智能课程提醒继续" : "服务暂时不可用，已保留你的问题。",
            subtitle: isReminderQuery
              ? "已为你保留本机提醒配置入口；确认后会创建提醒并可申请微信服务通知。"
              : "可以重试，或先使用全校课表/空教室页面。",
            badges: [],
            items: [],
            actions: isReminderQuery
              ? [
                { label: "配置课程提醒", type: "manageReminders", url: "", payload: { sheet: "reminders", openCreate: true } },
                { label: "重试", type: "retry", url: "", payload: { message } },
                { label: "打开全校课表", type: "navigate", url: "/pages/school/school", payload: {} },
              ]
              : [
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
          sendingStatusText: "已生成卡片",
          agentActivityState: "network_error",
          statusCapsuleText: "服务异常 · 已提供降级入口",
          statusCapsuleDetail: "问题已保留，可以重试或使用现有校园工具页面。",
          statusCapsuleExpanded: true,
          liveRunVisible: false,
          liveRunEvents: [],
          activeRunId: "",
          activePollToken: "",
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
      showMemorySheet: false,
      privacyExpanded: false,
    });
  },

  closeHeaderMenu() {
    this.setData({ showHeaderMenu: false });
  },

  openMemorySheet() {
    this.setData({
      showMemorySheet: true,
      showHeaderMenu: false,
      showConversationSheet: false,
      showTaskPanel: false,
      showCapabilityGuide: false,
      showPrivacySheet: false,
    });
    this.loadMemoryPreferences();
  },

  async loadMemoryPreferences() {
    const localItems = aiAssistantService.getUserPreferenceItems();
    if (this.data.memoryMode !== "cloud_sync") {
      this.setData({
        memoryPreferences: normalizeMemoryPreferenceItems(localItems),
        memoryPreferencesLoading: false,
      });
      return;
    }
    this.setData({ memoryPreferencesLoading: true });
    const cloud = await agentMemoryClient.listCloudPreferences();
    const merged = {};
    localItems.forEach((item) => { merged[item.key] = item; });
    if (cloud.success) {
      (cloud.items || []).forEach((item) => { merged[item.key] = item; });
    }
    this.setData({
      memoryPreferences: normalizeMemoryPreferenceItems(Object.keys(merged).map((key) => merged[key])),
      memoryPreferencesLoading: false,
    });
  },

  closeMemorySheet() {
    this.setData({ showMemorySheet: false });
  },

  onToggleLiveRunExpand() {
    this.setData({ liveRunExpanded: !this.data.liveRunExpanded });
  },

  async onCancelRun() {
    if (!this.data.sending) return;
    this._cancelCurrentRun = true;
    const runId = this.data.activeRunId;
    const pollToken = this.data.activePollToken;
    if (runId) {
      try {
        await agentRunClient.cancelRun(runId, pollToken);
      } catch (error) {
        // ignore
      }
    }
    this.setData({
      sendingStatusText: "正在取消",
    });
  },

  onMemoryModeChange(event) {
    const mode = event.detail && event.detail.mode || "local_only";
    const previous = this.data.memoryMode || "local_only";
    if (mode === previous) {
      this.setData({ showMemorySheet: false });
      return;
    }
    if (mode === "cloud_sync") {
      wx.showModal({
        title: "开启同步脱敏对话",
        content: "将仅保存脱敏后的有限最近消息，不含学号密码、完整个人课表和隐藏推理。可随时关闭并清除。",
        confirmText: "开启",
        success: (res) => {
          if (!res.confirm) return;
          this.applyMemoryMode(mode, { previous });
        },
      });
      return;
    }
    if (mode === "local_only" && previous === "cloud_sync") {
      wx.showModal({
        title: "关闭云端同步",
        content: "是否同时删除云端已同步数据？选择取消仅关闭同步并保留云端数据。",
        confirmText: "删除云端",
        cancelText: "仅关闭",
        success: (res) => {
          this.applyMemoryMode(mode, { previous, deleteCloudData: res.confirm === true });
        },
      });
      return;
    }
    this.applyMemoryMode(mode, { previous });
  },

  async applyMemoryMode(mode, options = {}) {
    const previous = options.previous || this.data.memoryMode || "local_only";
    if (this.data.memorySwitching) return;
    this.setData({ memorySwitching: true });

    if (mode === "local_only") {
      // local_only can apply immediately; cloud delete is best-effort and must not claim success on failure
      if (options.deleteCloudData === true) {
        const cleared = await agentMemoryClient.clearCloudMemory();
        if (!cleared.success) {
          this.setData({ memorySwitching: false });
          wx.showToast({
            title: agentClientErrorMapper.userMessage(cleared, "云端清除失败，请稍后再试"),
            icon: "none",
          });
          return;
        }
      }
      try { wx.setStorageSync("FOSU_AI_MEMORY_MODE", mode); } catch (error) { /* ignore */ }
      this.setData(Object.assign({
        memoryMode: mode,
        showMemorySheet: false,
        memorySwitching: false,
      }, applyHeaderStatusPatch(Object.assign({}, this.data, { memoryMode: mode }))));
      this.refreshConnectionStatus();
      try { wx.vibrateShort({ type: "light" }); } catch (e) { /* ignore */ }
      wx.showToast({ title: mapMemoryModeText(mode), icon: "none" });
      return;
    }

    const result = await agentMemoryClient.updateMemoryPolicy({
      mode,
      conversationId: this.data.activeConversationId,
      title: this.data.activeConversationTitle || this.data.conversationTitle || "新对话",
      clearExisting: options.deleteCloudData === true,
    });
    if (!result.success) {
      // Server failed: keep previous mode and do not write local storage
      this.setData(Object.assign({
        memoryMode: previous,
        memorySwitching: false,
      }, applyHeaderStatusPatch(Object.assign({}, this.data, { memoryMode: previous }))));
      wx.showToast({
        title: agentClientErrorMapper.userMessage(result, "记忆模式更新失败，将继续保存在本机"),
        icon: "none",
      });
      return;
    }
    try { wx.setStorageSync("FOSU_AI_MEMORY_MODE", mode); } catch (error) { /* ignore */ }
    this.setData(Object.assign({
      memoryMode: mode,
      showMemorySheet: false,
      memorySwitching: false,
    }, applyHeaderStatusPatch(Object.assign({}, this.data, { memoryMode: mode }))));
    this.refreshConnectionStatus();
    try { wx.vibrateShort({ type: "light" }); } catch (e) { /* ignore */ }
    wx.showToast({ title: mapMemoryModeText(mode), icon: "none" });
  },

  onClearLocalMemory() {
    const conversationId = this.data.activeConversationId;
    if (conversationId) conversationStore.clearConversation(conversationId);
    aiAssistantService.clearUserPreferences();
    this.setData({
      messages: [],
      memoryPreferences: [],
      showMemorySheet: false,
    });
    wx.showToast({ title: "已清空本机消息", icon: "none" });
  },

  onDeleteMemoryPreference(event) {
    const key = event.detail && event.detail.key || "";
    if (!key) return;
    wx.showModal({
      title: "删除这项记忆",
      content: "删除后，小佛不会再把它作为长期偏好使用。",
      confirmText: "删除",
      success: async (res) => {
        if (!res.confirm) return;
        if (this.data.memoryMode === "cloud_sync") {
          const cloud = await agentMemoryClient.deleteCloudPreference(key);
          if (!cloud.success) {
            wx.showToast({ title: cloud.error || "云端删除失败", icon: "none" });
            return;
          }
        }
        aiAssistantService.deleteUserPreference(key);
        await this.loadMemoryPreferences();
        wx.showToast({ title: "已删除", icon: "none" });
      },
    });
  },

  onToggleAutoMemory(event) {
    const enabled = event.detail && event.detail.autoMemoryEnabled !== false;
    try {
      wx.setStorageSync("xiaofu_auto_memory_enabled", enabled ? "1" : "0");
    } catch (_) { /* ignore */ }
    this.setData({ autoMemoryEnabled: enabled });
    if (this.data.memoryMode === "cloud_sync") {
      agentMemoryClient.patchCloudPreference({ autoMemoryEnabled: enabled }).catch(() => {});
    }
    wx.showToast({
      title: enabled ? "已恢复自动记忆" : "已暂停自动记忆",
      icon: "none",
    });
  },

  onEditMemoryPreference(event) {
    const key = event.detail && event.detail.key || "";
    const current = event.detail && event.detail.value;
    if (!key) return;
    const titles = {
      preferredName: "修改称呼",
      campus: "修改常用校区（仙溪校区/江湾校区）",
      preferredBuilding: "修改常用楼栋",
      defaultReminderLeadMinutes: "修改默认提醒（分钟）",
      answerDetailLevel: "修改回答偏好（简洁/详细）",
    };
    wx.showModal({
      title: titles[key] || "修改记忆",
      editable: true,
      placeholderText: String(current == null ? "" : current).slice(0, 40),
      content: String(current == null ? "" : current),
      success: async (res) => {
        if (!res.confirm) return;
        const nextValue = res.content != null ? String(res.content).trim() : "";
        if (!nextValue) {
          wx.showToast({ title: "内容不能为空", icon: "none" });
          return;
        }
        let value = nextValue;
        if (key === "defaultReminderLeadMinutes") {
          const minutes = Number(nextValue.replace(/[^\d]/g, ""));
          if (!Number.isFinite(minutes) || minutes < 5 || minutes > 180) {
            wx.showToast({ title: "请输入 5–180 分钟", icon: "none" });
            return;
          }
          value = minutes;
        }
        if (key === "campus" && !/仙溪|江湾/.test(value)) {
          wx.showToast({ title: "请输入仙溪校区或江湾校区", icon: "none" });
          return;
        }
        if (key === "campus" && value.indexOf("校区") < 0) value = `${value}校区`;
        if (this.data.memoryMode === "cloud_sync") {
          const cloud = await agentMemoryClient.patchCloudPreference({ key, value });
          if (!cloud.success) {
            wx.showToast({ title: cloud.error || "保存失败", icon: "none" });
            return;
          }
        }
        try {
          aiAssistantService.setUserPreference && aiAssistantService.setUserPreference(key, value);
        } catch (_) { /* ignore */ }
        await this.loadMemoryPreferences();
        wx.showToast({ title: "已更新", icon: "none" });
      },
    });
  },

  async evaluateServerProactive(eventName, clientContext) {
    if (this._proactiveEvaluating) return;
    const event = String(eventName || "assistant_open");
    // Low-frequency: once per open per event type in this page lifetime.
    this._proactiveShownEvents = this._proactiveShownEvents || {};
    if (this._proactiveShownEvents[event]) return;
    this._proactiveEvaluating = true;
    try {
      const optOut = [];
      try {
        const raw = wx.getStorageSync("xiaofu_proactive_opt_out");
        if (Array.isArray(raw)) optOut.push(...raw);
      } catch (_) { /* ignore */ }
      const result = await agentMemoryClient.evaluateProactive({
        event,
        conversationId: this.data.activeConversationId,
        memoryMode: this.data.memoryMode,
        context: Object.assign({}, clientContext || {}, {
          proactiveOptOut: optOut,
          disabledProactiveTypes: optOut,
          reminderEnabled: clientContext && clientContext.courseReminderEnabled,
        }),
        facts: {
          reminderEnabled: clientContext && clientContext.courseReminderEnabled === false
            ? false
            : undefined,
          nextCourse: clientContext && clientContext.nextCourse,
          weather: clientContext && clientContext.weather,
        },
      });
      if (result && result.success && result.proactiveSuggestion) {
        this._proactiveShownEvents[event] = true;
        this.setData({ serverProactiveSuggestion: result.proactiveSuggestion });
        // Refresh UI strip with server suggestion
        const s = result.proactiveSuggestion;
        const insight = {
          kind: s.type || "suggestion",
          eyebrow: "小佛建议",
          title: s.title,
          detail: s.body || "",
          actionLabel: s.actions && s.actions[0] ? s.actions[0].label : "知道了",
          server: true,
          raw: s,
        };
        this.setData({ proactiveInsight: insight });
        xiaofuFloatService.setProactiveInsight(insight);
      }
    } catch (_) {
      // ignore network
    } finally {
      this._proactiveEvaluating = false;
    }
  },

  onClearCurrentMemory() {
    const conversationId = this.data.activeConversationId;
    wx.showModal({
      title: "清除服务端会话状态",
      content: "将删除当前对话在服务端的结构化状态，本机消息可另选清空。",
      confirmText: "清除",
      success: async (res) => {
        if (!res.confirm) return;
        if (conversationId) {
          const result = await agentMemoryClient.deleteCloudConversation(conversationId);
          if (!result.success) {
            wx.showToast({ title: result.error || "服务端清除失败", icon: "none" });
            return;
          }
        }
        this.setData({ showMemorySheet: false });
        wx.showToast({ title: "已清除服务端会话状态", icon: "none" });
        this.refreshConversationList();
      },
    });
  },

  onClearAllMemory() {
    wx.showModal({
      title: "清除全部云端记忆",
      content: "将请求删除你账号下的服务端会话状态。本机对话列表仍可单独管理。",
      confirmText: "清除",
      success: async (res) => {
        if (!res.confirm) return;
        const result = await agentMemoryClient.clearCloudMemory();
        if (!result.success) {
          wx.showToast({
            title: agentClientErrorMapper.userMessage(result, "清除失败，请稍后再试"),
            icon: "none",
          });
          return;
        }
        this.setData(Object.assign({
          memoryMode: "local_only",
          showMemorySheet: false,
          memoryPreferences: [],
        }, applyHeaderStatusPatch(Object.assign({}, this.data, { memoryMode: "local_only" }))));
        aiAssistantService.clearUserPreferences();
        try { wx.setStorageSync("FOSU_AI_MEMORY_MODE", "local_only"); } catch (error) { /* ignore */ }
        try { wx.vibrateShort({ type: "medium" }); } catch (e) { /* ignore */ }
        wx.showToast({ title: "已清除云端记忆", icon: "none" });
        this.refreshConversationList();
      },
    });
  },

  onConversationSheetSelect(event) {
    const conversationId = event.detail && event.detail.conversationId;
    if (conversationId) this.switchConversationById(conversationId);
  },

  onConversationSheetRename(event) {
    const conversationId = event.detail && event.detail.conversationId;
    if (!conversationId) return;
    this.renameConversation({ currentTarget: { dataset: { conversationId } } });
  },

  onConversationSheetClear(event) {
    const conversationId = event.detail && event.detail.conversationId;
    if (!conversationId) return;
    this.clearConversation({ currentTarget: { dataset: { conversationId } } });
  },

  onConversationSheetDelete(event) {
    const conversationId = event.detail && event.detail.conversationId;
    if (!conversationId) return;
    this.deleteConversation({ currentTarget: { dataset: { conversationId } } });
  },

  onConversationSheetPin(event) {
    const conversationId = event.detail && event.detail.conversationId;
    if (!conversationId) return;
    try {
      const key = "FOSU_AI_PINNED_CONVERSATIONS";
      const raw = wx.getStorageSync(key) || [];
      const set = new Set(Array.isArray(raw) ? raw : []);
      if (set.has(conversationId)) set.delete(conversationId);
      else set.add(conversationId);
      wx.setStorageSync(key, Array.from(set));
    } catch (error) {
      // ignore
    }
    this.refreshConversationList();
  },

  onToggleEvidence(event) {
    const messageId = event.currentTarget.dataset.messageId;
    if (!messageId) return;
    const messages = (this.data.messages || []).map((item) => {
      if (item.id !== messageId) return item;
      return Object.assign({}, item, { evidenceExpanded: !item.evidenceExpanded });
    });
    this.setData({ messages: normalizeMessagesForDisplay(messages, this.data.expandedCards || {}) });
  },

  onToggleRunDetails(event) {
    const messageId = event.currentTarget.dataset.messageId;
    if (!messageId) return;
    const messages = (this.data.messages || []).map((item) => {
      if (item.id !== messageId) return item;
      return Object.assign({}, item, { runExpanded: !item.runExpanded });
    });
    this.setData({ messages: normalizeMessagesForDisplay(messages, this.data.expandedCards || {}) });
  },

  onToggleQuickTasks() {
    this.setData({ showQuickTasks: !this.data.showQuickTasks });
  },

  onFeedbackMore(event) {
    const messageId = event.currentTarget.dataset.messageId;
    if (messageId) this.openFeedbackReasons(messageId);
  },

  onMessageFeedback(event) {
    const feedback = event.currentTarget.dataset.feedback;
    const messageId = event.currentTarget.dataset.messageId;
    if (feedback === "more") {
      this.onFeedbackMore(event);
      return;
    }
    this.submitMessageFeedback(messageId, feedback);
  },

  enableXiaofuFloat() {
    xiaofuFloatService.enableEverywhere();
    this.setData(Object.assign({
      showHeaderMenu: false,
      showTaskPanel: false,
      showCapabilityGuide: false,
    }, buildXiaofuFloatState()));
    wx.showToast({ title: "已开启小佛助手浮窗", icon: "none" });
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
    wx.showToast({ title: nextEnabled ? "已开启小佛助手浮窗" : "已关闭小佛助手浮窗", icon: "none" });
  },

  onCapabilityExampleTap(event) {
    const text = event.currentTarget.dataset.text;
    if (!text) return;
    this.dispatchCapabilityAction(findAbilityByText(text), text, { closeGuide: true });
  },

  openCampusMapFromGuide() {
    this.setData({ showCapabilityGuide: false });
    this.navigateByUrl("/packageMaps/pages/campus-map/campus-map");
  },

  closeSheets() {
    this.setData({
      showTaskPanel: false,
      showCapabilityGuide: false,
      showPrivacySheet: false,
      showHeaderMenu: false,
      showConversationSheet: false,
      showMemorySheet: false,
      showComposerPlus: false,
      showReminderSheet: false,
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
      title: "允许使用本机课表？",
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
      title: "清空当前查询",
      content: "仅清空当前对话的内容和结果，不影响其他对话和课表数据。",
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
    const payload = safeAction.payload && typeof safeAction.payload === "object" && !Array.isArray(safeAction.payload)
      ? safeAction.payload
      : {};
    // Create/authorize must stay inside the user-tap gesture for requestSubscribeMessage.
    // Extra wx.showModal here breaks the gesture chain and leaves users stuck on
    // "请先确认这次提醒操作" after they already accepted the WeChat sheet.
    const skipModalForReminderCreate = safeAction.type === "confirmReminder"
      && String(payload.operation || "create") === "create";
    if (safeAction.confirm && !skipModalForReminderCreate) {
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
      const message = firstActionText([payload.message, action.fallbackText, this.findLastUserMessage()]);
      if (!message) {
        this.showActionFallback("暂无可重试的问题");
        return;
      }
      this.sendMessage(message, {
        retryAssistantIndex: Number(context && context.messageIndex),
      });
      return;
    }
    if (type === "ask") {
      const nextMessage = firstActionText([payload.message, action.text, action.fallbackText, action.label]);
      if (!nextMessage) {
        this.showActionFallback("暂无可追问内容");
        return;
      }
      this.queueTaskMessage(nextMessage);
      return;
    }
    if (type === "navigate" || type === "switchTab") {
      const url = firstActionText([action.url, payload.url]);
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
    if (type === "manageReminders") {
      this.setData({
        showReminderSheet: true,
        reminderSheetOpenCreate: Boolean(payload && payload.openCreate),
      });
      return;
    }
    if (type === "confirmReminder") {
      this.performReminderConfirmation(payload, context || {});
      return;
    }
    this.showActionFallback(action.toast || "暂时无法执行该操作");
  },

  markReminderCardCreated(context, result) {
    const messageIndex = Number(context && context.messageIndex);
    const cardIndex = Number(context && context.cardIndex);
    const actionIndex = Number(context && context.actionIndex);
    if (!Number.isFinite(messageIndex) || !Number.isFinite(cardIndex) || !Number.isFinite(actionIndex)) return;
    const base = `messages[${messageIndex}].displayCards[${cardIndex}]`;
    const badges = ((context.card && context.card.badges) || []).filter((item) => item !== "未执行写入");
    if (badges.indexOf("已创建") < 0) badges.unshift("已创建");
    if (result && result.duplicate && badges.indexOf("已存在") < 0) badges.unshift("已存在");
    this.setData({
      [`${base}.badges`]: badges,
      [`${base}.actions[${actionIndex}]`]: {
        label: "管理提醒",
        type: "manageReminders",
        url: "",
        payload: { sheet: "reminders" },
      },
      [`${base}.primaryActions`]: [{
        label: "管理提醒",
        type: "manageReminders",
        url: "",
        payload: { sheet: "reminders" },
        originalIndex: actionIndex,
      }],
    });
  },

  async performReminderCreateFromConfig(source) {
    const leadMinutes = Math.max(5, Math.min(180, Number(source.leadMinutes || 20) || 20));
    const scope = safeText(source.scope, 32) || "all_courses";
    const clientContext = aiAssistantService.buildClientContext({
      conversationId: this.data.activeConversationId,
      contextSlots: this.data.activeConversationContext,
      memoryMode: this.data.memoryMode,
    });
    // Gesture-safe: only use already-prefetched capability so requestSubscribeMessage
    // stays in the user-tap stack. Never await network before the WeChat sheet.
    const cached = this.data.reminderCapability;
    const capability = cached && cached.configured && cached.templateId
      ? cached
      : { configured: false, templateId: "" };
    try {
      const prefs = aiAssistantService.getUserPreferences ? aiAssistantService.getUserPreferences() : {};
      if (aiAssistantService.saveUserPreferences) {
        aiAssistantService.saveUserPreferences(Object.assign({}, prefs, {
          defaultReminderLeadMinutes: leadMinutes,
        }));
      }
    } catch (_) { /* ignore preference write */ }
    return courseReminderClient.createReminderFromConfig({
      leadMinutes,
      scope,
      idempotencyKey: safeText(source.idempotencyKey, 160)
        || courseReminderClient.makeIdempotencyKey("create", scope),
      capability,
      currentScheduleSummary: clientContext && clientContext.currentScheduleSummary,
      todayDate: clientContext && clientContext.todayDate,
      todayWeekday: clientContext && clientContext.todayWeekday,
      currentTeachingWeek: clientContext && clientContext.currentTeachingWeek,
      clientTimestampMs: clientContext && clientContext.clientTimestampMs,
    });
  },

  async performReminderConfirmation(payload, context) {
    const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const operation = safeText(source.operation, 16) || "create";
    if (operation !== "create") {
      this.showActionFallback("请在提醒面板完成该操作");
      return;
    }
    if (this._reminderActionRunning) return;
    this._reminderActionRunning = true;
    wx.showLoading({ title: "正在创建提醒", mask: true });
    try {
      // One-shot configure path: the button tap is the confirmation.
      // Avoids fragile confirmationProof tokens that break after card storage / double dialogs.
      let result = await this.performReminderCreateFromConfig(source);
      if (!result.success
        && source.confirmationProof
        && source.idempotencyKey
        && result.code !== "SCHEDULE_REQUIRED"
        && result.code !== "NO_MATCHING_COURSE"
      ) {
        let capability = this.data.reminderCapability && this.data.reminderCapability.configured
          ? this.data.reminderCapability
          : { configured: false, templateId: "" };
        const subscription = await courseReminderClient.requestWechatSubscription(capability);
        const proofResult = await courseReminderClient.createReminder({
          confirmationProof: source.confirmationProof,
          idempotencyKey: source.idempotencyKey,
          subscriptionStatus: subscription.status,
        });
        if (proofResult && proofResult.success) result = proofResult;
      }

      try { wx.hideLoading(); } catch (_) { /* ignore */ }
      if (!result || !result.success) {
        const errText = (result && result.error) || "提醒创建失败";
        if (result && result.code === "SCHEDULE_REQUIRED") {
          wx.showModal({
            title: "需要个人课表",
            content: "导入个人课表后，才能按真实上课时间创建提醒。",
            confirmText: "去导入",
            success: (res) => {
              if (res.confirm) this.navigateByUrl(PERSONAL_SYNC_URL, { toast: "已打开课表导入" });
            },
          });
          return;
        }
        this.showActionFallback(errText);
        return;
      }
      const channelText = result.reminder && result.reminder.channel === "wechat_subscription"
        ? "已创建微信服务通知提醒"
        : "已创建应用内提醒";
      wx.showToast({ title: result.duplicate ? "提醒已经存在" : channelText, icon: "none", duration: 2400 });
      this.setData({
        agentActivityState: "complete",
        statusCapsuleText: result.duplicate ? "完成 · 提醒已经存在" : "完成 · 提醒已创建",
        statusCapsuleDetail: result.reminder && result.reminder.channel === "wechat_subscription"
          ? "已记录本次微信订阅授权；额度按平台一次性规则消耗。"
          : "当前使用应用内提醒；可在提醒面板补充微信服务通知授权。",
        statusCapsuleExpanded: false,
      });
      this.markReminderCardCreated(context || {}, result);
      this.scheduleStatusCapsuleReset();
    } catch (error) {
      try { wx.hideLoading(); } catch (_) { /* ignore */ }
      this.setData({
        agentActivityState: "network_error",
        statusCapsuleText: "提醒创建失败",
        statusCapsuleDetail: "没有执行不完整写入。可打开智能课程提醒面板一键重试。",
        statusCapsuleExpanded: true,
      });
      this.showActionFallback("提醒创建失败，请打开提醒面板重试");
    } finally {
      this._reminderActionRunning = false;
    }
  },

  closeReminderSheet() {
    this.setData({ showReminderSheet: false, reminderSheetOpenCreate: false });
  },

  onReminderCreate() {
    this.setData({
      showReminderSheet: true,
      reminderSheetOpenCreate: true,
    });
  },

  onReminderChange() {
    // The reminder sheet refreshes itself; no optimistic timetable mutation is needed.
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
    if (["reminder", "reminders", "course-reminders"].indexOf(sheet) >= 0) {
      this.setData({ showReminderSheet: true, reminderSheetOpenCreate: true });
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
    wx.showToast({ title: nextEnabled ? "已开启小佛助手浮窗" : "已关闭小佛助手浮窗", icon: "none" });
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
    if (/^https?:\/\//i.test(parsed.raw)) {
      wx.showToast({ title: "请前往对应官网查看", icon: "none" });
      return;
    }
    if (!parsed.path) return;
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
        wx.showToast({ title: "暂时无法打开该页面", icon: "none" });
      },
    });
  },
});

if (typeof module !== "undefined") {
  module.exports = {
    normalizeCard,
    normalizeCardItem,
    normalizeMessagesForDisplay,
    normalizeMessageForDisplay,
    makeMessage,
    resolveAssistantIntentName,
  };
}
