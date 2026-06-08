const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const appJson = JSON.parse(fs.readFileSync(path.join(root, "miniprogram/app.json"), "utf8"));
assert(appJson.pages.includes("pages/ai-assistant/ai-assistant"), "app.json must include ai-assistant page");

[
  "miniprogram/pages/ai-assistant/ai-assistant.js",
  "miniprogram/pages/ai-assistant/ai-assistant.wxml",
  "miniprogram/pages/ai-assistant/ai-assistant.wxss",
  "miniprogram/pages/ai-assistant/ai-assistant.json",
  "miniprogram/services/aiAssistantService.js",
].forEach((file) => {
  assert(fs.existsSync(path.join(root, file)), `${file} must exist`);
});

const entryFiles = [
  "miniprogram/pages/index/index.wxml",
  "miniprogram/pages/index/index.js",
  "miniprogram/pages/school/school.wxml",
  "miniprogram/pages/school/school.js",
  "miniprogram/pages/today/today.wxml",
  "miniprogram/pages/today/today.js",
];

const entryText = entryFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
assert(entryText.includes("/pages/ai-assistant/ai-assistant"), "index/school/today should reference ai-assistant route");
assert(fs.readFileSync(path.join(root, "miniprogram/pages/index/index.wxml"), "utf8").includes("AI校园管家") ||
  fs.readFileSync(path.join(root, "miniprogram/pages/index/index.wxml"), "utf8").includes("AI管家"), "home page should expose AI entry");
assert(fs.readFileSync(path.join(root, "miniprogram/pages/school/school.wxml"), "utf8").includes("问 AI 帮我查课/找教室"), "school page should expose AI entry");
assert(fs.readFileSync(path.join(root, "miniprogram/pages/today/today.wxml"), "utf8").includes("问 AI 分析今天安排"), "today page should expose AI entry");

console.log("test-miniprogram-ai-page-entry passed");
