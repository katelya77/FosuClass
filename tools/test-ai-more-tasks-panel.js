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
  assert(js.includes("navigateByUrl"), "XLS quick action should navigate through the shared dispatcher");
  assert(wxml.includes('class="quick-more-button"') && wxml.includes('bindtap="openTaskPanel"'), "更多 should open the task panel sheet");
  assert(js.includes("onTaskPanelItemTap"), "task panel items should have a tap handler");

  console.log("test-ai-more-tasks-panel passed");
}

run();
