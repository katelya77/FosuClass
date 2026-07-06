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

const aiAssistantService = require("../miniprogram/services/aiAssistantService");
const contextManager = require("../miniprogram/services/xiaofuContextManager");
require("../miniprogram/pages/ai-assistant/ai-assistant.js");

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
    text: "课表数据是否最新",
    intentName: "schedule_status",
    cardType: "schedule_status",
    answer: /课表数据状态|更新时间|最新/,
  },
  {
    text: "教务系统在哪里",
    intentName: "navigation",
    cardType: "navigation",
    answer: /教务/,
  },
  {
    text: "佛大有哪些校区",
    intentName: "school_knowledge",
    cardType: "school_knowledge",
    answer: /仙溪|江湾|河滨/,
  },
  {
    text: "如何导入个人课表",
    intentName: "help",
    cardType: "help",
    answer: /导入个人课表/,
  },
  {
    text: "小佛能做什么",
    intentName: "help",
    cardType: "help",
    answer: /小佛能做什么|校园事项/,
  },
  {
    text: "这个小程序怎么用？",
    intentName: "help",
    cardType: "help",
    answer: /小佛能做什么|校园事项/,
  },
  {
    text: "如何问得更准确",
    intentName: "help",
    cardType: "help",
    answer: /小佛能做什么|校园事项/,
  },
  {
    text: "佛大有哪些学院和部门",
    intentName: "school_knowledge",
    cardType: "school_knowledge",
    answer: /学院|部门|官网/,
  },
  {
    text: "图书馆服务",
    intentName: "navigation",
    cardType: "navigation",
    answer: /图书馆/,
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
    answer: /小佛能做什么|校园事项|数据/,
  },
  {
    text: "随便问一句普通话",
    intentName: "smalltalk",
    cardType: "",
    answer: /普通话/,
    noCards: true,
  },
];

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
    assert.strictEqual(response.metrics && response.metrics.intentName, item.intentName, `unexpected intent for ${item.text}`);
    assert.match(response.answer || "", item.answer, `unexpected answer for ${item.text}`);
    if (item.noCards) {
      assert.strictEqual(Array.isArray(response.cards) ? response.cards.length : 0, 0, `expected no cards for ${item.text}`);
    } else {
      assert(response.cards && response.cards[0], `expected card for ${item.text}`);
      assert.strictEqual(response.cards[0].type, item.cardType, `unexpected card type for ${item.text}`);
    }
    const names = (response.toolCalls || []).map((tool) => tool.name);
    if (["schedule_status", "help", "personal_schedule", "school_knowledge", "navigation", "smalltalk"].includes(item.intentName)) {
      assert(!names.includes("search_school_schedule_local"), `${item.text} should not use schedule object search`);
    }
  }

  console.log("test-ai-built-in-example-matrix passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
