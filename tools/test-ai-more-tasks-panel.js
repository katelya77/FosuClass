const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function run() {
  const js = read("miniprogram/pages/ai-assistant/ai-assistant.js");
  const wxml = read("miniprogram/pages/ai-assistant/ai-assistant.wxml");
  const wxss = read("miniprogram/pages/ai-assistant/ai-assistant.wxss");
  const knowledge = read("miniprogram/data/fosuKnowledgeBase.js");
  const helpCopy = read("miniprogram/services/aiAssistantService.js");
  const scheduleCopy = read("miniprogram/services/scheduleAssistantService.js");

  assert(js.includes("showTaskPanel"), "AI assistant should define showTaskPanel state");
  assert(js.includes("TASK_PANEL_GROUPS"), "AI assistant should define grouped task panel items");
  assert(wxml.includes("task-sheet") && wxml.includes("bottom-sheet"), "task panel should render as a bottom sheet");
  assert(wxss.includes(".bottom-sheet") && wxss.includes(".task-section-scroll"), "task panel should have sheet/scroll WXSS");

  const taskMatches = js.match(/label:\s*"[^"]+"/g) || [];
  assert(taskMatches.length >= 10, `expected at least 10 task items, got ${taskMatches.length}`);

  const quickHandler = js.match(/onQuickAction\(event\)\s*\{([\s\S]*?)\n  \},/);
  assert(quickHandler, "onQuickAction handler should exist");
  const body = quickHandler[1];
  assert(js.includes("AI_CAPABILITY_REGISTRY"), "quick/task entries should be backed by the capability registry");
  assert(body.includes("dispatchCapabilityAction"), "quick actions should use the shared capability dispatcher");
  assert(js.includes("CAPABILITY_KINDS.SUPPLEMENT_PARAMS"), "missing-slot capabilities should be classified");
  assert(js.includes("queueTaskMessage"), "quick and task actions should answer in the current chat flow");
  assert(wxml.includes('quick-more-button') && wxml.includes('bindtap="openTaskPanel"'), "任务 should open the task panel sheet");
  assert(js.includes("onTaskPanelItemTap"), "task panel items should have a tap handler");
  assert(!wxml.includes('class="quick-task-row"'), "mode switch should not share the horizontal quick-action row");
  assert(
    wxml.includes('class="ai-mode-row"') || wxml.includes("ai-mode-row"),
    "mode switch should live in its own centered row"
  );

  [js, wxml, knowledge, helpCopy, scheduleCopy].forEach((source, index) => {
    assert(!source.includes("25动物医学6班"), `formal AI copy should not include personal class example in source ${index}`);
    assert(!source.includes("25动医6"), `formal AI copy should not include personal class alias in source ${index}`);
  });

  ["查班级本周课表", "查教师课表", "查教室明天是否有课", "查课程安排", "今天有什么课", "当前是第几教学周", "课表数据更新到什么时候", "教务系统在哪里", "佛大有哪些校区", "如何导入个人课表", "可以查询什么"].forEach((phrase) => {
    assert(js.includes(phrase) || helpCopy.includes(phrase) || scheduleCopy.includes(phrase) || knowledge.includes(phrase), `built-in phrase should be present and testable: ${phrase}`);
  });

  console.log("test-ai-more-tasks-panel passed");
}

run();
