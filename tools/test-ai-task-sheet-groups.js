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

  ["课表查询", "个人课表", "校园知识", "使用帮助"].forEach((title) => {
    assert(js.includes(`title: "${title}"`), `task group should include ${title}`);
  });
  ["查班级课表", "查教师课表", "查教室占用", "查课程安排", "导入个人课表", "教务系统入口", "校区与地图", "图书馆服务", "常用系统入口", "小佛能做什么", "数据来源说明"].forEach((label) => {
    assert(js.includes(`taskLabel: "${label}"`) || js.includes(`label: "${label}"`), `task item should include ${label}`);
  });

  assert(wxml.includes('wx:for="{{taskPanelGroups}}"'), "task sheet should render grouped sections");
  assert(wxml.includes("task-section-title"), "task sheet should render section titles");
  assert(wxml.includes("task-icon") && wxml.includes("task-copy"), "task items should include icon and copy areas");

  const sheetRule = /\.bottom-sheet\s*\{[\s\S]*?\}/.exec(wxss);
  assert(sheetRule && /max-height\s*:\s*72vh/.test(sheetRule[0]), "bottom sheet should stay within 72vh");
  assert(wxss.includes(".task-section-scroll"), "task section list should be scrollable");

  console.log("test-ai-task-sheet-groups passed");
}

run();
