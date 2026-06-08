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
  assert(js.includes("TASK_PANEL_ITEMS"), "AI assistant should define task panel items");
  assert(wxml.includes("task-sheet") && wxml.includes("bottom-sheet"), "task panel should render as a bottom sheet");
  assert(wxss.includes(".bottom-sheet") && wxss.includes(".task-grid"), "task panel should have sheet/grid WXSS");

  const taskMatches = js.match(/label:\s*"[^"]+"/g) || [];
  assert(taskMatches.length >= 8, `expected at least 8 task items, got ${taskMatches.length}`);

  const quickHandler = js.match(/onQuickQuestion\(event\)\s*\{([\s\S]*?)\n  \},/);
  assert(quickHandler, "onQuickQuestion handler should exist");
  const body = quickHandler[1];
  assert(body.includes('question === "更多"'), "更多 should have a dedicated branch");
  const beforeDedicatedBranch = body.split('question === "更多"')[0];
  assert(!beforeDedicatedBranch.includes("sendMessage(question)"), "更多 must not be sent before the panel branch");
  assert(body.includes("openTaskPanel"), "更多 should open the task panel sheet");
  assert(js.includes("onTaskPanelItemTap"), "task panel items should have a tap handler");

  console.log("test-ai-more-tasks-panel passed");
}

run();
