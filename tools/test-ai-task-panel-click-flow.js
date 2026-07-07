const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
global.getCurrentPages = () => [];

require("../miniprogram/pages/ai-assistant/ai-assistant.js");
const xiaofuFloatService = require("../miniprogram/services/xiaofuFloatService");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const page = mockEnv.createPageInstance();
  const sent = [];
  const navigated = [];
  page.sendMessage = (message) => sent.push(message);
  page.navigateByUrl = (url) => navigated.push(url);

  assert.strictEqual(xiaofuFloatService.isEnabled(), true, "float should be enabled by default");
  page.toggleXiaofuFloat();
  assert.strictEqual(xiaofuFloatService.isEnabled(), false, "more menu toggle should disable the float");
  assert.strictEqual(page.data.xiaofuFloatToggleText, "开启小佛AI浮窗", "disabled state should show the enable action");
  page.toggleXiaofuFloat();
  assert.strictEqual(xiaofuFloatService.isEnabled(), true, "more menu toggle should re-enable the float");
  assert.strictEqual(page.data.xiaofuFloatToggleText, "关闭小佛AI浮窗", "enabled state should show the close action");

  page.openTaskPanelNow();
  await wait(50);

  assert.strictEqual(page.data.showTaskPanel, true, "task panel should open");
  assert.strictEqual(page.data.taskPanelReady, true, "task panel groups should be ready");
  assert(page.data.taskPanelGroups.length >= 4, "task panel should have grouped sections");

  let total = 0;
  page.data.taskPanelGroups.forEach((group, groupIndex) => {
    group.items.forEach((task, taskIndex) => {
      total += 1;
      page.setData({ showTaskPanel: true });
      page.onTaskPanelItemTap({
        currentTarget: {
          dataset: { groupIndex, taskIndex },
        },
      });
      assert.strictEqual(page.data.showTaskPanel, false, `${task.label} should close the task panel`);
    });
  });

  assert.strictEqual(sent.length, total, "every task panel item should send a chat message");
  assert.strictEqual(navigated.length, 0, "task panel items should not jump away before answering in chat");
  ["查班级本周课表", "查教师课表", "查教室明天是否有课", "查课程安排", "如何导入个人课表", "教务系统在哪里进？", "佛大有哪些校区？", "图书馆服务", "常用系统入口", "这个小程序怎么用？"].forEach((message) => {
    assert(sent.includes(message), `task panel should send ${message}`);
  });

  console.log("test-ai-task-panel-click-flow passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
