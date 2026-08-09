// Generated from server/config/agent-capability-manifest.json. Do not edit by hand.
// 小佛助手能力注册表：图标、文案、任务面板与快捷动作全部由 manifest.miniprogram 驱动。
const CAPABILITY_KINDS = Object.freeze({
  "DIRECT_TOOL": "direct_tool",
  "SUPPLEMENT_PARAMS": "supplement_params",
  "NAVIGATE": "navigate",
  "GENERATIVE_QA": "generative_qa",
  "LOCAL_ACTION": "local_action"
});

const AI_CAPABILITY_REGISTRY = Object.freeze([
  {
    "id": "today",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/today.svg",
    "label": "今日课表",
    "quickLabel": "今日课表",
    "className": "today",
    "taskGroup": "个人课表",
    "taskLabel": "今日安排",
    "taskDesc": "需要个人课表或指定对象",
    "guideGroup": "个人课表",
    "guideExamples": [
      "今天有什么课"
    ],
    "welcomeExample": "今天有什么课",
    "message": "今天有什么课"
  },
  {
    "id": "tomorrow",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/today.svg",
    "label": "明日课表",
    "guideGroup": "个人课表",
    "guideExamples": [
      "明天有什么课"
    ],
    "message": "明天有什么课？"
  },
  {
    "id": "nextCourse",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/today.svg",
    "label": "下一节课",
    "guideGroup": "个人课表",
    "guideExamples": [
      "下一节课"
    ],
    "message": "下一节课"
  },
  {
    "id": "weekSchedule",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/today.svg",
    "label": "本周课表",
    "guideGroup": "个人课表",
    "guideExamples": [
      "本周课表"
    ],
    "message": "本周课表"
  },
  {
    "id": "gapBetweenCourses",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/study.svg",
    "label": "课间间隔",
    "message": "两节课之间有多久？"
  },
  {
    "id": "emptyRoomNow",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/room.svg",
    "label": "空教室",
    "quickLabel": "空教室",
    "className": "room",
    "taskGroup": "课表查询",
    "taskLabel": "查教室占用",
    "taskDesc": "先说明时间或教室",
    "message": "现在有空教室吗？"
  },
  {
    "id": "continuousEmptyRoom",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/room.svg",
    "label": "连续空教室",
    "message": "找连续两节空教室"
  },
  {
    "id": "meetingTime",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/study.svg",
    "label": "共同空闲",
    "taskGroup": "个人课表",
    "taskLabel": "自习时间推荐",
    "taskDesc": "需要开启课表摘要",
    "message": "帮我推荐连续 2 节自习时间"
  },
  {
    "id": "teacherSchedule",
    "kind": "supplement_params",
    "iconPath": "/assets/icons/ai-tasks/teacher.svg",
    "label": "查老师",
    "quickLabel": "查老师",
    "className": "teacher",
    "taskGroup": "课表查询",
    "taskLabel": "查教师课表",
    "taskDesc": "输入教师姓名更准确",
    "guideGroup": "课表查询",
    "guideExamples": [
      "查教师课表"
    ],
    "message": "查教师课表",
    "draft": "查教师课表",
    "missingText": "请补充教师姓名后查询"
  },
  {
    "id": "classSchedule",
    "kind": "supplement_params",
    "iconPath": "/assets/icons/ai-tasks/classroom.svg",
    "label": "查班级课表",
    "quickLabel": "查班级",
    "className": "classroom",
    "taskGroup": "课表查询",
    "taskLabel": "查班级课表",
    "taskDesc": "输入完整班级更准确",
    "guideGroup": "课表查询",
    "guideExamples": [
      "查班级本周课表"
    ],
    "message": "查班级本周课表",
    "draft": "查班级本周课表",
    "missingText": "请补充班级名称后查询"
  },
  {
    "id": "classroomOccupancy",
    "kind": "supplement_params",
    "iconPath": "/assets/icons/ai-tasks/classroom.svg",
    "label": "查教室占用",
    "quickLabel": "查教室",
    "className": "room",
    "taskGroup": "课表查询",
    "taskLabel": "查教室占用",
    "taskDesc": "输入教室和时间",
    "guideGroup": "课表查询",
    "guideExamples": [
      "查教室明天是否有课"
    ],
    "message": "查教室明天是否有课",
    "draft": "查教室明天是否有课",
    "missingText": "请补充教室或楼栋后查询"
  },
  {
    "id": "courseSchedule",
    "kind": "supplement_params",
    "iconPath": "/assets/icons/ai-tasks/course.svg",
    "label": "查课程安排",
    "taskGroup": "课表查询",
    "taskLabel": "查课程安排",
    "taskDesc": "输入课程名称更准确",
    "guideGroup": "课表查询",
    "guideExamples": [
      "查课程安排"
    ],
    "message": "查课程安排",
    "draft": "查课程安排",
    "missingText": "请补充课程名称后查询"
  },
  {
    "id": "placeC7",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/app.svg",
    "label": "教学楼位置",
    "message": "某教学楼在哪里？"
  },
  {
    "id": "xianxiSouthMap",
    "kind": "navigate",
    "iconPath": "/assets/icons/ai-tasks/app.svg",
    "label": "仙溪南区地图",
    "url": "/packageMaps/pages/campus-map/campus-map?map=xianxiSouth"
  },
  {
    "id": "jiangwanPlaces",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/app.svg",
    "label": "江湾地点",
    "message": "江湾校区主要地点"
  },
  {
    "id": "nextCourseLocation",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/app.svg",
    "label": "下一节课位置",
    "message": "下一节课在哪里？"
  },
  {
    "id": "campusWeather",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/term.svg",
    "label": "校区天气",
    "taskGroup": "校园服务",
    "taskLabel": "校区天气",
    "taskDesc": "下雨、温度、带伞和出行建议",
    "guideGroup": "校园服务",
    "guideExamples": [
      "仙溪校区今天会下雨吗"
    ],
    "welcomeExample": "仙溪校区今天会下雨吗",
    "message": "仙溪校区今天会下雨吗？"
  },
  {
    "id": "umbrellaAdvice",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/term.svg",
    "label": "带伞建议",
    "taskGroup": "校园服务",
    "taskLabel": "今天要不要带伞",
    "taskDesc": "优先查询天气，不走学校官网概况",
    "guideGroup": "校园服务",
    "guideExamples": [
      "今天要不要带伞",
      "下一节课要带伞吗"
    ],
    "welcomeExample": "今天要不要带伞",
    "message": "今天要不要带伞"
  },
  {
    "id": "teachingWeek",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/term.svg",
    "label": "教学周",
    "taskGroup": "个人课表",
    "taskLabel": "当前教学周",
    "taskDesc": "查看当前是第几周",
    "guideGroup": "个人课表",
    "guideExamples": [
      "当前是第几教学周"
    ],
    "message": "当前是第几教学周？"
  },
  {
    "id": "dataStatus",
    "kind": "direct_tool",
    "iconPath": "/assets/icons/ai-tasks/diagnosis.svg",
    "label": "数据状态",
    "taskGroup": "个人课表",
    "taskLabel": "课表数据状态",
    "taskDesc": "查看学期、版本和更新时间",
    "guideGroup": "个人课表",
    "guideExamples": [
      "课表数据更新到什么时候",
      "当前是第几教学周"
    ],
    "message": "课表数据是否最新？"
  },
  {
    "id": "personalSync",
    "kind": "navigate",
    "iconPath": "/assets/icons/ai-tasks/xls.svg",
    "label": "个人课表同步",
    "quickLabel": "导入课表",
    "className": "sync",
    "taskGroup": "个人课表",
    "taskLabel": "导入个人课表",
    "taskDesc": "打开同步主入口",
    "guideGroup": "个人课表",
    "guideExamples": [
      "如何导入个人课表"
    ],
    "url": "/pages/personal-sync/personal-sync",
    "message": "如何导入个人课表",
    "fallbackMessage": "如何导入个人课表"
  },
  {
    "id": "xlsImport",
    "kind": "navigate",
    "iconPath": "/assets/icons/ai-tasks/xls.svg",
    "label": "XLS 文件导入",
    "quickLabel": "XLS导入",
    "className": "xls",
    "taskGroup": "个人课表",
    "taskLabel": "XLS 文件导入",
    "taskDesc": "表格/文件导入入口",
    "url": "/pages/personal-sync/personal-sync?tab=xls",
    "message": "XLS文件导入怎么用？",
    "fallbackMessage": "如何导入个人课表"
  },
  {
    "id": "appHelp",
    "kind": "generative_qa",
    "iconPath": "/assets/icons/ai-tasks/app.svg",
    "label": "怎么使用",
    "taskGroup": "使用帮助",
    "taskLabel": "可以查询什么",
    "taskDesc": "查看范围和关键词",
    "guideGroup": "使用帮助",
    "guideExamples": [
      "可以查询什么",
      "如何问得更准确"
    ],
    "welcomeExample": "如何使用校园查询",
    "message": "如何使用校园查询"
  },
  {
    "id": "enableFloat",
    "kind": "local_action",
    "iconPath": "/assets/icons/ai-tasks/app.svg",
    "label": "开启浮窗",
    "taskGroup": "使用帮助",
    "taskLabel": "开启小序浮窗",
    "taskDesc": "恢复右下角可拖拽小序入口",
    "message": "开启小序浮窗"
  },
  {
    "id": "termSync",
    "kind": "generative_qa",
    "iconPath": "/assets/icons/ai-tasks/term.svg",
    "label": "数据来源",
    "taskGroup": "使用帮助",
    "taskLabel": "数据来源说明",
    "taskDesc": "了解课表与知识来源",
    "guideGroup": "使用帮助",
    "guideExamples": [
      "数据来源说明"
    ],
    "message": "数据来源说明"
  },
  {
    "id": "jwcEntry",
    "kind": "generative_qa",
    "iconPath": "/assets/icons/ai-tasks/app.svg",
    "label": "教务入口",
    "taskGroup": "校园服务",
    "taskLabel": "教务系统入口",
    "taskDesc": "查看教务相关入口",
    "guideGroup": "校园服务",
    "guideExamples": [
      "教务系统在哪里"
    ],
    "message": "教务系统在哪里进？"
  },
  {
    "id": "campusLocations",
    "kind": "generative_qa",
    "iconPath": "/assets/icons/ai-tasks/app.svg",
    "label": "校区与地图",
    "taskGroup": "校园服务",
    "taskLabel": "校区与地图",
    "taskDesc": "了解校区和位置",
    "guideGroup": "校园服务",
    "guideExamples": [
      "佛大有哪些校区"
    ],
    "message": "佛大有哪些校区？"
  },
  {
    "id": "collegeDepartments",
    "kind": "generative_qa",
    "iconPath": "/assets/icons/ai-tasks/study.svg",
    "label": "学院部门",
    "taskGroup": "校园服务",
    "taskLabel": "学院与部门",
    "taskDesc": "查看学院部门入口",
    "guideGroup": "校园服务",
    "guideExamples": [
      "佛大有哪些学院和部门"
    ],
    "message": "佛大有哪些学院和部门？"
  },
  {
    "id": "libraryService",
    "kind": "generative_qa",
    "iconPath": "/assets/icons/ai-tasks/term.svg",
    "label": "图书馆服务",
    "taskGroup": "校园服务",
    "taskLabel": "图书馆服务",
    "taskDesc": "查图书馆入口与服务边界",
    "guideGroup": "校园服务",
    "guideExamples": [
      "图书馆服务"
    ],
    "message": "图书馆服务"
  },
  {
    "id": "commonSystems",
    "kind": "generative_qa",
    "iconPath": "/assets/icons/ai-tasks/app.svg",
    "label": "常用系统",
    "taskGroup": "校园服务",
    "taskLabel": "常用系统入口",
    "taskDesc": "查教务、门户等公开入口",
    "guideGroup": "校园服务",
    "guideExamples": [
      "常用系统入口"
    ],
    "message": "常用系统入口"
  },
  {
    "id": "serviceGuide",
    "kind": "generative_qa",
    "iconPath": "/assets/icons/ai-tasks/term.svg",
    "label": "办事指南",
    "message": "常用办事指南在哪里？"
  },
  {
    "id": "askBetter",
    "kind": "generative_qa",
    "iconPath": "/assets/icons/ai-tasks/study.svg",
    "label": "问法建议",
    "taskGroup": "使用帮助",
    "taskLabel": "如何问得更准确",
    "taskDesc": "获得更稳的回答",
    "guideGroup": "使用帮助",
    "guideExamples": [
      "如何问得更准确"
    ],
    "message": "如何问得更准确？"
  }
]);

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

const QUICK_ACTIONS = Object.freeze([
  buildQuickAction("today"),
  buildQuickAction("classSchedule", "class"),
  buildQuickAction("classroomOccupancy", "room"),
  buildQuickAction("campusWeather", "weather"),
  buildQuickAction("personalSync", "sync"),
]);

module.exports = {
  AI_CAPABILITY_BY_ID,
  AI_CAPABILITY_REGISTRY,
  CAPABILITY_KINDS,
  QUICK_ACTIONS,
  buildQuickAction,
};
