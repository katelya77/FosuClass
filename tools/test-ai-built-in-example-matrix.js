const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

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

global.wx.mockRequest = (options) => {
  const url = String(options && options.url || "");
  if (url.indexOf("/api/ai/weather") >= 0) {
    options.success({
      statusCode: 200,
      data: {
        success: true,
        weather: {
          success: true,
          campus: "仙溪校区",
          provider: "open-meteo",
          sourceId: "open-meteo:xianxi",
          updatedAt: "2026-07-07T09:00:00+08:00",
          weatherText: "多云",
          temperatureC: 31,
          apparentTemperatureC: 33,
          highC: 35,
          lowC: 27,
          humidity: 72,
          windSpeedKmh: 11,
          precipitationMm: 0.2,
          rainProbabilityMax24h: 68,
          advice: "短时降雨概率较高，建议带伞并预留通行时间。",
          next6Hours: [
            { time: "09时", temperatureC: 31, rainProbability: 30 },
            { time: "10时", temperatureC: 32, rainProbability: 42 },
          ],
        },
      },
    });
    return;
  }
  options.success({ statusCode: 200, data: { success: true } });
};

const aiAssistantService = require("../miniprogram/services/aiAssistantService");
const contextManager = require("../miniprogram/services/xiaofuContextManager");
const ragRetriever = require("../miniprogram/services/ragRetriever");
const aiPage = require("../miniprogram/pages/ai-assistant/ai-assistant.js");

function baseContext() {
  const contextSlots = contextManager.createEmptyContextSlots();
  return {
    term: "test-term",
    selectedTerm: "test-term",
    activeTerm: "test-term",
    releaseVersion: "test-release",
    currentTeachingWeek: 16,
    todayWeekday: 2,
    contextSlots,
    conversation: {
      conversationId: "built-in-example-matrix",
      contextSlots,
    },
  };
}

const MATRIX = [
  {
    text: "查班级本周课表",
    intentName: "school_schedule_query",
    cardType: "clarification",
    answer: /班级/,
  },
  {
    text: "查教师课表",
    intentName: "school_schedule_query",
    cardType: "clarification",
    answer: /教师|老师/,
  },
  {
    text: "查教室明天是否有课",
    intentName: "school_schedule_query",
    cardType: "clarification",
    answer: /教室/,
  },
  {
    text: "查课程安排",
    intentName: "school_schedule_query",
    cardType: "clarification",
    answer: /课程/,
  },
  {
    text: "今天有什么课",
    intentName: "personal_schedule",
    cardType: "personal_schedule",
    answer: /个人课表|指定/,
  },
  {
    text: "明天有什么课",
    intentName: "personal_schedule",
    cardType: "personal_schedule",
    answer: /个人课表|指定/,
  },
  {
    text: "下一节课",
    intentName: "personal_schedule",
    cardType: "personal_schedule",
    answer: /个人课表|指定/,
  },
  {
    text: "本周课表",
    intentName: "personal_schedule",
    cardType: "personal_schedule",
    answer: /个人课表|指定/,
  },
  {
    text: "当前是第几教学周",
    intentName: "schedule_status",
    cardType: "schedule_status",
    answer: /当前教学周/,
  },
  {
    text: "课表数据更新到什么时候",
    intentName: "schedule_status",
    cardType: "schedule_status",
    answer: /更新时间|未记录精确更新时间/,
  },
  {
    text: "仙溪校区什么天气",
    intentName: "weather",
    tool: "get_campus_weather",
    cardType: "weather_card",
    answer: /仙溪校区天气|降雨概率|带伞/,
  },
  {
    text: "仙溪校区今天会下雨吗",
    intentName: "weather",
    tool: "get_campus_weather",
    cardType: "weather_card",
    answer: /仙溪校区天气|降雨概率|带伞/,
    actions: ["重新获取天气", "继续问带伞"],
  },
  {
    text: "今天要不要带伞",
    intentName: "weather",
    tool: "get_campus_weather",
    cardType: "weather_card",
    answer: /天气|降雨概率|带伞/,
    actions: ["重新获取天气", "继续问带伞", "明天适合跑步吗"],
  },
  {
    text: "下一节课要带伞吗",
    intentName: "weather",
    tool: "get_course_weather_advice",
    cardType: "weather_card",
    answer: /导入个人课表|天气|带伞/,
  },
  {
    text: "课表数据是否最新",
    intentName: "schedule_status",
    cardType: "schedule_status",
    answer: /课表数据状态|更新时间|最新/,
    actions: ["查看全校课表"],
  },
  {
    text: "教务系统在哪里",
    intentName: "navigation",
    cardType: "navigation",
    answer: /教务/,
    actions: ["打开教务部官网", "继续追问"],
  },
  {
    text: "图书馆入口在哪里",
    intentName: "navigation",
    cardType: "navigation",
    answer: /图书馆/,
    actions: ["打开图书馆官网", "继续追问"],
  },
  {
    text: "佛大有哪些校区",
    intentName: "school_knowledge",
    cardType: "school_knowledge",
    answer: /仙溪|江湾|河滨/,
    actions: ["打开校园地图", "继续追问"],
  },
  {
    text: "如何导入个人课表",
    intentName: "help",
    cardType: "import_guide",
    answer: /个人课表导入|导入个人课表/,
    actions: ["打开个人课表同步", "查看 XLS 文件导入", "继续问今天课程"],
  },
  {
    text: "可以查询什么",
    intentName: "help",
    cardType: "help",
    answer: /可以查询什么|校园事项/,
  },
  {
    text: "如何使用校园查询？",
    intentName: "help",
    cardType: "help",
    answer: /可以查询什么|校园事项/,
  },
  {
    text: "如何问得更准确",
    intentName: "help",
    cardType: "help",
    answer: /可以查询什么|校园事项/,
  },
  {
    text: "佛大有哪些学院和部门",
    intentName: "school_knowledge",
    cardType: "school_knowledge",
    answer: /学院|部门|官网/,
    actions: ["打开学校官网", "继续追问"],
  },
  {
    text: "佛大有哪些学院和部门？",
    intentName: "school_knowledge",
    cardType: "school_knowledge",
    answer: /学院|部门|官网/,
  },
  {
    text: "图书馆服务",
    intentName: "navigation",
    cardType: "navigation",
    answer: /图书馆/,
    actions: ["打开图书馆官网", "继续追问"],
  },
  {
    text: "佛大校医院电话是多少",
    intentName: "school_knowledge",
    cardType: "school_knowledge",
    answer: /知识库暂未收录可靠信息|不会.*编造电话/,
    noReliableActions: true,
  },
  {
    text: "校医院开放时间",
    intentName: "school_knowledge",
    cardType: "school_knowledge",
    answer: /知识库暂未收录可靠信息|不会.*开放时间/,
    noReliableActions: true,
  },
  {
    text: "常用系统入口",
    intentName: "navigation",
    cardType: "navigation",
    answer: /常用系统|入口|系统/,
  },
  {
    text: "数据来源说明",
    intentName: "help",
    cardType: "help",
    answer: /可以查询什么|校园事项|数据/,
  },
  {
    text: "随便问一句普通话",
    intentName: "smalltalk",
    cardType: "",
    answer: /普通话/,
    noCards: true,
  },
];

function visibleDisplayText(response) {
  const messages = aiPage.normalizeMessagesForDisplay([
    {
      id: "assistant-visible-test",
      role: "assistant",
      content: response.answer || "",
      cards: response.cards || [],
      suggestions: response.suggestions || [],
      toolCalls: response.toolCalls || [],
      evidence: response.evidence || null,
      safety: response.safety || null,
      metrics: response.metrics || null,
    },
  ], {});
  const message = messages[0] || {};
  return JSON.stringify({
    content: message.content,
    evidenceText: message.evidenceText,
    safetyText: message.displaySafety && message.displaySafety.text || "",
    toolLabels: (message.displayToolCalls || []).map((tool) => tool.displayText),
    cards: (message.displayCards || []).map((card) => ({
      title: card.title,
      subtitle: card.subtitle,
      typeLabel: card.typeLabel,
      badges: card.badges,
      items: card.visibleItems,
      actions: (card.actions || []).map((action) => action.label),
      disclaimer: card.disclaimer,
    })),
    suggestions: message.suggestions,
  });
}

function assertNoVisibleTechnicalLeak(response, text) {
  const visibleText = visibleDisplayText(response);
  assert(
    !/(intentname|ragmatchedreason|matchedreason|handler|cardtype|\[object object\])/i.test(visibleText),
    `${text} should not expose internal routing or RAG debug fields: ${visibleText}`
  );
}

async function run() {
  const page = mockEnv.createPageInstance();
  const covered = new Set(MATRIX.map((item) => item.text));
  const visibleExamples = []
    .concat(page.data.welcomeExamples || [])
    .concat((page.data.capabilityGuideGroups || []).flatMap((group) => group.items || []));
  visibleExamples.forEach((example) => {
    assert(covered.has(example), `visible built-in example should be covered by the matrix: ${example}`);
  });

  for (const item of MATRIX) {
    const response = await aiAssistantService.chat(item.text, baseContext());
    assert(response, `expected response for ${item.text}`);
    assertNoVisibleTechnicalLeak(response, item.text);
    assert.strictEqual(response.metrics && response.metrics.intentName, item.intentName, `unexpected intent for ${item.text}`);
    assert.match(response.answer || "", item.answer, `unexpected answer for ${item.text}`);
    if (item.noCards) {
      assert.strictEqual(Array.isArray(response.cards) ? response.cards.length : 0, 0, `expected no cards for ${item.text}`);
    } else {
      assert(response.cards && response.cards[0], `expected card for ${item.text}`);
      assert.strictEqual(response.cards[0].type, item.cardType, `unexpected card type for ${item.text}`);
      if (item.actions) {
        const labels = (response.cards[0].actions || []).map((action) => action.label);
        item.actions.forEach((label) => {
          assert(labels.includes(label), `${item.text} should expose action ${label}; got ${labels.join(", ")}`);
        });
      }
      (response.cards[0].actions || []).forEach((action) => {
        assert.notStrictEqual(action.type, "copy", `${item.text} should not expose copy action type`);
        assert(!/^复制/.test(action.label || ""), `${item.text} should not expose copy action label: ${action.label}`);
      });
      if (item.noReliableActions) {
        assert.strictEqual((response.cards[0].actions || []).length, 0, `${item.text} should not expose actions for unreliable knowledge`);
      }
    }
    const names = (response.toolCalls || []).map((tool) => tool.name);
    if (item.tool) {
      assert(names.includes(item.tool), `${item.text} should use ${item.tool}`);
    }
    if (["schedule_status", "help", "personal_schedule", "school_knowledge", "navigation", "smalltalk"].includes(item.intentName)) {
      assert(!names.includes("search_school_schedule_local"), `${item.text} should not use schedule object search`);
    }
  }

  const retrieval = ragRetriever.searchKnowledge("图书馆入口在哪里");
  assert(retrieval.top && retrieval.top.matchedReason, "RAG search should keep matchedReason for internal diagnostics");

  console.log("test-ai-built-in-example-matrix passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
