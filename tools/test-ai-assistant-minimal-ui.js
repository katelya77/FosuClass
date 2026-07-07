const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const wxml = fs.readFileSync(path.join(ROOT, "miniprogram/pages/ai-assistant/ai-assistant.wxml"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "miniprogram/pages/ai-assistant/ai-assistant.js"), "utf8");
const wxss = fs.readFileSync(path.join(ROOT, "miniprogram/pages/ai-assistant/ai-assistant.wxss"), "utf8");

function arrayBody(name) {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`).exec(js);
  return match ? match[1] : "";
}

const quickActionCount = (js.match(/buildQuickAction\(/g) || []).length - 1;
assert.strictEqual(quickActionCount, 5, `quick actions should be 5, got ${quickActionCount}`);

assert(!wxml.includes("privacy-tip-full"), "privacy-tip-full must not be a first-viewport card");
assert(wxml.includes("bottom-sheet") || wxml.includes("sheet-mask"), "bottom sheet / overlay should exist");
assert(/class="composer"/.test(wxml), "composer should exist");
assert(/\.composer\s*\{[\s\S]*?position\s*:\s*fixed/.test(wxss), "composer should stay fixed");
assert(wxml.includes("xiaofu-header") && !wxml.includes("assistant-hero card"), "top should be the Xiaofu light header, not a hero card");
assert(wxml.includes("xiaofu-title-line") && wxml.includes("xiaofu-status"), "header should include stable title/status line");

console.log("test-ai-assistant-minimal-ui passed");
