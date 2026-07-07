const DEMO_RESPONSES = {
  "empty-room": {
    answer: "演示数据：已按当前节次筛出附近可用教室，优先展示连续空闲和距离较近的结果。",
    toolCalls: [
      { name: "search_empty_rooms", status: "success" },
    ],
    safety: { provider: "mock", mode: "tool-grounded" },
    suggestions: ["找连续 2 节空教室", "看今天课程"],
    cards: [{
      type: "empty_room",
      title: "演示数据 · 附近空教室",
      subtitle: "第 5-6 节可用，结果按连续空闲优先排序。",
      badges: ["演示数据", "连续空闲", "教务缓存"],
      items: [
        { title: "C7-305", subtitle: "本部 · 教学楼 C7 · 连续 2 节", value: "5-6 节" },
        { title: "C6-202", subtitle: "本部 · 教学楼 C6 · 设备齐全", value: "5-8 节" },
        { title: "A2-104", subtitle: "本部 · 教学楼 A2 · 小班讨论", value: "5-6 节" },
        { title: "B1-501", subtitle: "本部 · 教学楼 B1 · 空调开放", value: "7-8 节" },
        { title: "C3-218", subtitle: "本部 · 教学楼 C3 · 靠近图书馆", value: "5-6 节" },
        { title: "D2-406", subtitle: "本部 · 教学楼 D2 · 备选教室", value: "5-8 节" },
      ],
      actions: [
        { label: "打开空教室", type: "navigate", url: "/pages/empty-room/empty-room", payload: {} },
        { label: "再查连续时段", type: "retry", url: "", payload: { message: "找连续 2 节空教室" } },
      ],
    }],
  },
  today: {
    answer: "演示数据：今天还有 2 段课程，中间有一段较短空档，建议提前确认下一节课教室。",
    toolCalls: [
      { name: "get_today_courses", status: "success" },
    ],
    safety: { provider: "deepseek", mode: "tool-grounded" },
    suggestions: ["帮我规划课间空档", "找下一节附近空教室"],
    cards: [{
      type: "schedule",
      title: "演示数据 · 今日安排",
      subtitle: "根据本机课表摘要整理，不含个人身份字段。",
      badges: ["演示数据", "今日课程", "仅供参考"],
      items: [
        { title: "高等数学", subtitle: "第 3-4 节 · C7-305", value: "09:40-11:05" },
        { title: "大学英语", subtitle: "第 7-8 节 · B1-204", value: "14:15-15:50" },
      ],
      actions: [
        { label: "打开今日页", type: "navigate", url: "/pages/today/today", payload: {} },
      ],
    }],
  },
  diagnosis: {
    answer: "演示数据：当前索引、课表详情和空教室缓存状态正常；如出现空结果，可先刷新全校数据再重试。",
    toolCalls: [
      { name: "diagnose_data_status", status: "success" },
    ],
    safety: { provider: "mock", mode: "tool-grounded" },
    suggestions: ["为什么数据加载失败？", "重新查空教室"],
    cards: [{
      type: "diagnosis",
      title: "演示数据 · 数据诊断",
      subtitle: "检查课表索引、详情缓存、空教室索引和客户端缓存状态。",
      badges: ["演示数据", "状态正常", "可刷新"],
      items: [
        { title: "全校索引", subtitle: "可搜索班级、教师、教室、课程", value: "正常" },
        { title: "课表详情", subtitle: "详情缓存可读取", value: "正常" },
        { title: "空教室索引", subtitle: "支持当前节次筛选", value: "正常" },
        { title: "客户端缓存", subtitle: "可使用最近一次可用数据", value: "可用" },
      ],
      actions: [
        { label: "打开全校查询", type: "navigate", url: "/pages/school/school", payload: {} },
      ],
    }],
  },
  teacher: {
    answer: "演示数据：已通过全校索引命中教师课表，并读取到详情缓存。结果只来自 Release Pack，不额外补写。",
    toolCalls: [
      { name: "search_school_index", status: "success" },
      { name: "get_schedule_detail", status: "success" },
    ],
    safety: { provider: "mock", mode: "tool-grounded" },
    metrics: { latencyMs: 128, intentName: "search_school_index", toolCallCount: 2, externalProviderUsed: false, fallback: true, itemCount: 4, usedPersonalContext: false },
    suggestions: ["查教室占用", "查课程安排"],
    cards: [{
      type: "teacher",
      title: "演示数据 · 教师课表",
      subtitle: "关键词：陈老师 · 已读取课表详情",
      badges: ["演示数据", "全校索引", "课表详情"],
      items: [
        { title: "数据结构", subtitle: "星期一 · 第 1-2 节 · C7-203", value: "08:00-09:25" },
        { title: "程序设计基础", subtitle: "星期二 · 第 5-6 节 · B8-102", value: "11:10-14:10" },
        { title: "实验课", subtitle: "星期四 · 第 7-8 节 · C6-301", value: "14:15-15:50" },
      ],
      actions: [
        { label: "查看课表详情", type: "navigate", url: "/pages/schedule-view/schedule-view?type=teacher&id=demo-teacher", payload: {} },
        { label: "打开全校查询", type: "navigate", url: "/pages/school/school?type=teacher&q=%E9%99%88%E8%80%81%E5%B8%88", payload: {} },
      ],
    }],
  },
  meeting: {
    answer: "演示数据：已基于课表摘要计算共同空闲时段，并联动空教室工具给出可核对入口。",
    toolCalls: [
      { name: "recommend_meeting_time", status: "success" },
      { name: "search_empty_rooms", status: "success" },
    ],
    safety: { provider: "deepseek", mode: "tool-grounded" },
    metrics: { latencyMs: 236, intentName: "recommend_meeting_time", toolCallCount: 2, externalProviderUsed: true, fallback: false, itemCount: 5, usedPersonalContext: true },
    suggestions: ["找连续 2 节空教室", "看今天课程"],
    cards: [{
      type: "reminder",
      title: "演示数据 · 组会/自习时间",
      subtitle: "忙闲矩阵只使用课程名、星期和节次摘要。",
      badges: ["演示数据", "忙闲矩阵", "空教室联动"],
      items: [
        { title: "星期三", subtitle: "第 9-10 节共同空闲 · 可优先看 C7-305", value: "15:55-17:20" },
        { title: "星期五", subtitle: "第 5-6 节共同空闲 · 可选 B8-204", value: "11:10-14:10" },
      ],
      actions: [
        { label: "查看空教室", type: "navigate", url: "/pages/empty-room/empty-room?weekday=3&sections=9-10&building=C7", payload: {} },
      ],
    }],
  },
  guide: {
    answer: "演示数据：个人课表同步用于把自己的课程带入首页、今日课程和课表摘要。需要表格文件时，再选择 XLS 文件导入。",
    toolCalls: [
      { name: "explain_personal_import", status: "success" },
    ],
    safety: { provider: "deepseek", mode: "tool-grounded" },
    suggestions: ["怎么导入个人课表？", "看今天课程"],
    cards: [{
      type: "guide",
      title: "演示数据 · 个人课表同步",
      subtitle: "先进入同步主入口，再按自己的数据来源选择导入方式。",
      badges: ["演示数据", "导入指引", "本机处理"],
      items: [
        { title: "进入同步入口", subtitle: "打开个人课表同步页面", value: "第 1 步" },
        { title: "选择导入方式", subtitle: "按页面提示选择适合自己的来源", value: "第 2 步" },
        { title: "检查课程字段", subtitle: "确认课程名、教师、教室、节次和教学周", value: "第 3 步" },
        { title: "启用摘要", subtitle: "需要结合本机课程查询时再开启", value: "可选" },
      ],
      actions: [
        { label: "打开个人课表同步", type: "navigate", url: "/pages/personal-sync/personal-sync", payload: {} },
        { label: "查看 XLS 文件导入", type: "navigate", url: "/pages/personal-sync/personal-sync?tab=xls", payload: {} },
      ],
    }],
  },
};

const DEMO_ALIASES = {
  "empty_room": "empty-room",
  "empty-room": "empty-room",
  empty: "empty-room",
  today: "today",
  diagnosis: "diagnosis",
  teacher: "teacher",
  meeting: "meeting",
  guide: "guide",
};

function normalizeDemoMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return DEMO_ALIASES[mode] || "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildDemoTaskSteps(response) {
  const names = (Array.isArray(response.toolCalls) ? response.toolCalls : []).map((item) => String(item && item.name || ""));
  const steps = [{ key: "understand", label: "已理解演示需求", status: "done" }];
  if (names.some((name) => /today|schedule|meeting|recommend/.test(name))) {
    steps.push({ key: "schedule", label: "已读取演示课表", status: "done" });
  }
  if (names.some((name) => /empty|room/.test(name))) {
    steps.push({ key: "empty-room", label: "已核验演示空教室", status: "done" });
  }
  if (names.some((name) => /school|detail|search/.test(name))) {
    steps.push({ key: "search", label: "已查询演示索引", status: "done" });
  }
  if (names.some((name) => /diagnose|status/.test(name))) {
    steps.push({ key: "diagnose", label: "已检查演示数据", status: "done" });
  }
  steps.push({ key: "complete", label: "已完成", status: "done" });
  return steps.slice(0, 6);
}

function enrichDemoResponse(response) {
  const next = response || {};
  next.taskSteps = Array.isArray(next.taskSteps) ? next.taskSteps : buildDemoTaskSteps(next);
  next.evidence = next.evidence || {
    term: "demo",
    releaseVersion: "demo-data",
    currentWeek: "demo",
    sources: ["demo-data"],
    toolCount: Array.isArray(next.toolCalls) ? next.toolCalls.length : 0,
  };
  next.safety = Object.assign({ provider: "mock", mode: "tool-grounded", demoData: true }, next.safety || {});
  return next;
}

function getDemoResponse(mode) {
  const normalized = normalizeDemoMode(mode) || "empty-room";
  return enrichDemoResponse(clone(DEMO_RESPONSES[normalized] || DEMO_RESPONSES["empty-room"]));
}

function getDemoMessages(mode) {
  const response = getDemoResponse(mode);
  return [{
    id: `demo-${normalizeDemoMode(mode) || "empty-room"}`,
    role: "assistant",
    content: response.answer,
    cards: response.cards,
    suggestions: response.suggestions,
    toolCalls: response.toolCalls,
    taskSteps: response.taskSteps,
    evidence: response.evidence,
    safety: response.safety,
    metrics: response.metrics || null,
    timeText: "演示",
  }];
}

module.exports = {
  getDemoMessages,
  getDemoResponse,
  normalizeDemoMode,
};
