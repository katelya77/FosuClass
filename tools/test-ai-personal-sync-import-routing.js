const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
global.getCurrentPages = () => [];
global.getApp = () => ({ globalData: {} });

const aiAssistantService = require("../miniprogram/services/aiAssistantService");
const aiPageModule = require("../miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");

function baseContext() {
  return {
    term: "test-term",
    selectedTerm: "test-term",
    activeTerm: "test-term",
    currentTeachingWeek: 16,
    todayWeekday: 2,
    contextSlots: {},
    conversation: { conversationId: "import-routing", contextSlots: {} },
  };
}

function makePageFromResponse(response) {
  const displayMessages = aiPageModule.normalizeMessagesForDisplay([
    {
      id: "assistant-import-routing",
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
  const page = mockEnv.createPageInstance();
  const navigated = [];
  page.setData({ messages: displayMessages });
  page.navigateByUrl = (url) => navigated.push(url);
  return { page, navigated };
}

function tapAction(page, actionIndex) {
  page.onCardAction({
    currentTarget: {
      dataset: { messageIndex: 0, cardIndex: 0, actionIndex },
    },
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const importResponse = await aiAssistantService.chat("如何导入个人课表", baseContext());
  assert.strictEqual(importResponse.cards[0].type, "guide");
  const actions = importResponse.cards[0].actions || [];
  const syncAction = actions.find((item) => item.label === "打开个人课表同步");
  const xlsAction = actions.find((item) => item.label === "查看 XLS 文件导入");
  assert(syncAction, "import guide should expose the personal sync main entry");
  assert(xlsAction, "import guide should expose the explicit XLS entry");
  assert.strictEqual(syncAction.url, "/pages/personal-sync/personal-sync");
  assert.strictEqual(xlsAction.url, "/pages/personal-sync/personal-sync?tab=xls");

  const clickContext = makePageFromResponse(importResponse);
  tapAction(clickContext.page, 0);
  tapAction(clickContext.page, 1);
  assert.deepStrictEqual(clickContext.navigated.slice(0, 2), [
    "/pages/personal-sync/personal-sync",
    "/pages/personal-sync/personal-sync?tab=xls",
  ], "card buttons should route main sync before explicit XLS");

  const openImportResponse = await aiAssistantService.chat("打开导入入口", baseContext());
  assert.strictEqual(openImportResponse.cards[0].type, "guide");
  assert.strictEqual(openImportResponse.cards[0].actions[0].url, "/pages/personal-sync/personal-sync");

  const openXlsResponse = await aiAssistantService.chat("打开 XLS导入", baseContext());
  assert.strictEqual(openXlsResponse.cards[0].type, "guide");
  assert.strictEqual(openXlsResponse.cards[0].actions[0].url, "/pages/personal-sync/personal-sync?tab=xls");

  const explicitXlsHelpResponse = await aiAssistantService.chat("XLS文件导入怎么用？", baseContext());
  assert.strictEqual(explicitXlsHelpResponse.cards[0].type, "guide", "explicit XLS help should not fall back to smalltalk");
  assert(/导入个人课表/.test(explicitXlsHelpResponse.answer), "explicit XLS help should answer the import guide");

  const page = mockEnv.createPageInstance();
  page.sendMessage = (message) => {
    page.sent = page.sent || [];
    page.sent.push(message);
  };
  page.navigateByUrl = (url) => {
    page.navigated = page.navigated || [];
    page.navigated.push(url);
  };
  page.openTaskPanelNow();
  await wait(50);
  let personalTask = null;
  let personalTaskLocation = null;
  page.data.taskPanelGroups.forEach((group, groupIndex) => {
    (group.items || []).forEach((item, taskIndex) => {
      if (item.abilityId === "personalSync" && !personalTask) {
        personalTask = item;
        personalTaskLocation = { groupIndex, taskIndex };
      }
    });
  });
  assert(personalTask, "task panel should use personalSync for personal import");
  assert.strictEqual(personalTask.url, "/pages/personal-sync/personal-sync");
  page.onTaskPanelItemTap({
    currentTarget: {
      dataset: personalTaskLocation,
    },
  });
  assert.deepStrictEqual(page.navigated, ["/pages/personal-sync/personal-sync"], "task personal import should open the sync page directly");
  assert.deepStrictEqual(page.sent || [], [], "task personal import should not send the stale XLS help question");

  console.log("test-ai-personal-sync-import-routing passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
