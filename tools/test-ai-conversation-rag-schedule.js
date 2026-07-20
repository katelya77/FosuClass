const assert = require("assert");

const storage = {};

global.wx = {
  getStorageSync(key) {
    return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : "";
  },
  setStorageSync(key, value) {
    storage[key] = value;
  },
  removeStorageSync(key) {
    delete storage[key];
  },
  getSystemInfoSync() {
    return { platform: "devtools" };
  },
};

global.getCurrentPages = () => [];
global.getApp = () => ({
  globalData: {
    activeRelease: {
      term: "test-term",
      releaseVersion: "test-release",
      manifest: {
        term: "test-term",
        releaseVersion: "test-release",
      },
    },
    appConfig: {
      currentSemester: "test-term",
      availableTerms: [
        { term: "test-term", dataAvailable: true, releaseVersion: "test-release" },
      ],
    },
  },
});

const conversationStore = require("../miniprogram/services/conversationStore");
const contextManager = require("../miniprogram/services/xiaofuContextManager");
const releasePackService = require("../miniprogram/services/releasePackService");
const aiAssistantService = require("../miniprogram/services/aiAssistantService");
const ragAnswerBuilder = require("../miniprogram/services/ragAnswerBuilder");
const scheduleAssistantService = require("../miniprogram/services/scheduleAssistantService");
const xiaofuAgentRouter = require("../miniprogram/services/xiaofuAgentRouter");

const TERM = "test-term";
const RELEASE = "test-release";

function seedIndex(type, items) {
  wx.setStorageSync(releasePackService.getIndexCacheKey(TERM, RELEASE, type), {
    savedAt: Date.now(),
    data: {
      success: true,
      type,
      term: TERM,
      semester: TERM,
      releaseVersion: RELEASE,
      version: RELEASE,
      total: items.length,
      items,
    },
  });
}

function seedDetail(type, id, detail) {
  wx.setStorageSync(releasePackService.getDetailCacheKey(TERM, RELEASE, type, id), {
    savedAt: Date.now(),
    data: {
      success: true,
      type,
      id,
      term: TERM,
      semester: TERM,
      releaseVersion: RELEASE,
      version: RELEASE,
      detail,
    },
  });
}

function seedReleasePack() {
  const courses = [
    {
      id: "math-w16-wed",
      courseName: "高等数学",
      teacherName: "张三",
      classroom: "A1-101",
      className: "25动物医学6班",
      weekday: 3,
      startSection: 1,
      endSection: 2,
      weeks: [16],
      weekText: "第16周",
    },
    {
      id: "chem-w15-mon",
      courseName: "大学化学",
      teacherName: "李四",
      classroom: "A1-101",
      className: "25动物医学6班",
      weekday: 1,
      startSection: 3,
      endSection: 4,
      weeks: [15],
      weekText: "第15周",
    },
  ];

  seedIndex("class", [
    { id: "class-25-dy6", detailId: "class-25-dy6", className: "25动物医学6班", majorName: "动物医学", courseCount: 2 },
  ]);
  seedIndex("teacher", [
    { id: "teacher-zhangsan", detailId: "teacher-zhangsan", teacherName: "张三", courseCount: 1 },
  ]);
  seedIndex("classroom", [
    { id: "room-a1-101", detailId: "room-a1-101", roomName: "A1-101", campus: "仙溪校区", courseCount: 2 },
  ]);
  seedIndex("course", [
    { id: "course-gaoshu", detailId: "course-gaoshu", courseName: "高等数学", courseCount: 1 },
  ]);

  seedDetail("class", "class-25-dy6", { className: "25动物医学6班", courses });
  seedDetail("teacher", "teacher-zhangsan", { teacherName: "张三", courses: [courses[0]] });
  seedDetail("classroom", "room-a1-101", { roomName: "A1-101", courses });
  seedDetail("course", "course-gaoshu", { courseName: "高等数学", courses: [courses[0]] });
}

function baseContext(contextSlots) {
  return {
    term: TERM,
    selectedTerm: TERM,
    activeTerm: TERM,
    releaseVersion: RELEASE,
    currentTeachingWeek: 16,
    todayWeekday: 2,
    contextSlots: contextManager.normalizeContextSlots(contextSlots),
    conversation: {
      conversationId: "test-conversation",
      contextSlots: contextManager.normalizeContextSlots(contextSlots),
    },
  };
}

async function assertScheduleQuery(text, expected) {
  const response = await scheduleAssistantService.tryHandleScheduleQuery(text, baseContext(expected.contextSlots));
  assert(response, `expected schedule response for ${text}`);
  assert.match(response.answer, expected.answerPattern, `unexpected answer for ${text}`);
  assert(response.cards && response.cards.length, `expected card for ${text}`);
  if (expected.cardTitle) assert.strictEqual(response.cards[0].title, expected.cardTitle);
  if (expected.itemText) {
    const flatItems = JSON.stringify(response.cards[0].items);
    assert(flatItems.includes(expected.itemText), `expected card item to include ${expected.itemText}`);
  }
  return response;
}

async function assertChat(text, contextSlots, expected) {
  const response = await aiAssistantService.chat(text, baseContext(contextSlots));
  assert(response, `expected chat response for ${text}`);
  if (expected.intentName) {
    assert.strictEqual(response.metrics && response.metrics.intentName, expected.intentName, `unexpected intent for ${text}`);
  }
  if (expected.answerPattern) {
    assert.match(response.answer || "", expected.answerPattern, `unexpected answer for ${text}`);
  }
  if (expected.cardType) {
    assert(response.cards && response.cards[0], `expected card for ${text}`);
    const canonicalCardTypes = {
      personal_schedule: "schedule",
      schedule_result: "schedule",
      schedule_status: "diagnosis",
      weather_card: "weather",
      import_guide: "guide",
      help: "guide",
      school_knowledge: "guide",
      navigation: "generic",
      clarification: "generic",
    };
    const expectedCardType = expected.cardType === "schedule_status" && /教学周|第几周|周次/.test(text)
      ? "generic"
      : (canonicalCardTypes[expected.cardType] || expected.cardType);
    assert.strictEqual(response.cards[0].type, expectedCardType, `unexpected card type for ${text}`);
  }
  if (expected.noCards) {
    assert.strictEqual(Array.isArray(response.cards) ? response.cards.length : 0, 0, `expected no cards for ${text}`);
  }
  if (expected.noScheduleTool) {
    const names = (response.toolCalls || []).map((item) => item.name);
    assert(!names.includes("search_school_schedule_local"), `${text} should not call schedule search`);
  }
  return response;
}

async function main() {
  conversationStore.resetForTest();
  seedReleasePack();

  const statusRoute = xiaofuAgentRouter.routeMessage("课表数据是否最新？", baseContext());
  assert.strictEqual(statusRoute.intent, "schedule_status");
  assert.strictEqual(statusRoute.shouldUseScheduleTool, false);

  const status = await assertChat("课表数据是否最新？", null, {
    intentName: "schedule_status",
    cardType: "schedule_status",
    answerPattern: /课表数据状态查询/,
    noScheduleTool: true,
  });
  assert(!JSON.stringify(status.cards).includes("未找到课表对象"), "status should not render not-found schedule card");

  await assertChat("你能做什么", null, {
    intentName: "help",
    cardType: "help",
    answerPattern: /可以查询|校园事项|课表|空教室|教学周|小佛/,
    noScheduleTool: true,
  });

  await assertChat("如何使用校园查询？", null, {
    intentName: "help",
    cardType: "help",
    answerPattern: /可以查询|校园事项|课表|空教室|教学周|小佛/,
    noScheduleTool: true,
  });

  await assertChat("今天还有课吗", null, {
    intentName: "personal_schedule",
    cardType: "personal_schedule",
    answerPattern: /个人课表|指定/,
  });

  await assertChat("随便问一句普通话", null, {
    intentName: "smalltalk",
    answerPattern: /普通话/,
    noCards: true,
    noScheduleTool: true,
  });

  const first = conversationStore.createConversation({ title: "班级查询" });
  conversationStore.saveConversationMessages(first.conversationId, [
    { role: "user", content: "查看25动物医学6班课表" },
  ], {
    lastIntent: "schedule_query",
    lastTargetType: "class",
    lastTargetName: "25动物医学6班",
    lastWeek: 16,
    lastWeekday: null,
  });
  const second = conversationStore.createConversation({ title: "新查询" });
  assert.strictEqual(second.messages.length, 0);
  assert.strictEqual(second.contextSlots.lastTargetName, "");
  const restored = conversationStore.setActiveConversation(first.conversationId);
  assert.strictEqual(restored.contextSlots.lastTargetName, "25动物医学6班");

  const classResponse = await assertScheduleQuery("查看25动物医学6班课表", {
    answerPattern: /25动物医学6班/,
    cardTitle: "25动物医学6班课表",
    itemText: "高等数学",
  });

  const classChat = await assertChat("查看25动物医学6班课表", null, {
    intentName: "school_schedule_query",
    cardType: "schedule_result",
    answerPattern: /25动物医学6班/,
  });
  assert.strictEqual(classChat.contextSlots.lastTargetName, "25动物医学6班");

  const followup = await assertScheduleQuery("那第16周周三呢", {
    contextSlots: classResponse.contextSlots,
    answerPattern: /25动物医学6班 第16周 周三课表/,
    cardTitle: "25动物医学6班课表",
    itemText: "高等数学",
  });
  assert.strictEqual(followup.contextSlots.lastTargetName, "25动物医学6班");
  assert.strictEqual(followup.contextSlots.lastWeek, 16);
  assert.strictEqual(followup.contextSlots.lastWeekday, 3);

  const navigation = ragAnswerBuilder.tryBuildContextNavigationAnswer("这个在哪里", baseContext(followup.contextSlots));
  assert(navigation, "expected context navigation response");
  assert.match(navigation.answer, /A1-101/);
  assert.strictEqual(navigation.cards[0].actions[0].url, "/pages/campus-map/campus-map");

  await assertScheduleQuery("换成25动医6", {
    contextSlots: followup.contextSlots,
    answerPattern: /25动物医学6班 第16周 周三课表/,
    cardTitle: "25动物医学6班课表",
    itemText: "高等数学",
  });

  await assertScheduleQuery("查张三老师本周课表", {
    answerPattern: /张三 本周课表/,
    cardTitle: "张三教师课表",
    itemText: "高等数学",
  });

  await assertScheduleQuery("看A1-101明天有没有课", {
    answerPattern: /A1-101 本周 周三课表/,
    cardTitle: "A1-101教室课表",
    itemText: "高等数学",
  });

  await assertScheduleQuery("查高等数学课程课表", {
    answerPattern: /高等数学 全周课表/,
    cardTitle: "高等数学课程课表",
    itemText: "高等数学",
  });

  const rag = ragAnswerBuilder.tryBuildKnowledgeAnswer("佛大有哪些校区", baseContext());
  assert(rag, "expected RAG response");
  assert.match(rag.answer, /仙溪/);
  assert.match(rag.answer, /江湾/);
  assert.match(rag.answer, /河滨/);
  assert.strictEqual(rag.cards[0].type, "school_knowledge");

  const ragChat = await assertChat("佛大有哪些校区", null, {
    intentName: "school_knowledge",
    cardType: "school_knowledge",
    answerPattern: /仙溪/,
    noScheduleTool: true,
  });
  assert.match(ragChat.answer, /校园信息/);

  const jwc = ragAnswerBuilder.tryBuildKnowledgeAnswer("教务系统在哪里进", baseContext());
  assert(jwc, "expected JWC RAG response");
  assert.match(jwc.answer, /教务/);
  assert(jwc.answer.includes("https://www.fosu.edu.cn/jwc/"));

  await assertChat("教务系统在哪里进", null, {
    intentName: "navigation",
    cardType: "navigation",
    answerPattern: /教务/,
    noScheduleTool: true,
  });

  await assertChat("当前是第几教学周？", null, {
    intentName: "schedule_status",
    cardType: "schedule_status",
    answerPattern: /当前教学周/,
    noScheduleTool: true,
  });

  const unknownAlias = await scheduleAssistantService.tryHandleScheduleQuery("查看25兽医6课表", baseContext());
  assert(unknownAlias, "expected unknown alias response");
  assert.strictEqual(unknownAlias.answer, scheduleAssistantService.UNKNOWN_CLASS_ALIAS_MESSAGE);

  console.log("ai conversation/rag/schedule checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
