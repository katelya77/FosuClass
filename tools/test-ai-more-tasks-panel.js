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
  assert(wxml.includes("task-panel") && wxss.includes(".task-panel"), "task panel should have WXML and WXSS");

  const taskMatches = js.match(/label:\s*"[^"]+"/g) || [];
  assert(taskMatches.length >= 8, `expected at least 8 task items, got ${taskMatches.length}`);

  const quickHandler = js.match(/onQuickQuestion\(event\)\s*\{([\s\S]*?)\n  \},/);
  assert(quickHandler, "onQuickQuestion handler should exist");
  const body = quickHandler[1];
  assert(body.includes('question === "更多任务"'), "更多任务 should have a dedicated branch");
  const beforeDedicatedBranch = body.split('question === "更多任务"')[0];
  assert(!beforeDedicatedBranch.includes("sendMessage(question)"), "更多任务 must not be sent before the panel branch");
  assert(js.includes("onTaskPanelItemTap"), "task panel items should have a tap handler");

  console.log("test-ai-more-tasks-panel passed");
}

run();
