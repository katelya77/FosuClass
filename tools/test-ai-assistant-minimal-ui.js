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

const quickCount = (arrayBody("QUICK_QUESTIONS").match(/"[^"]*"/g) || []).length;
assert(quickCount <= 3, `quick questions should be <= 3, got ${quickCount}`);

const heroMatch = /function\s+buildHeroChips[\s\S]*?return\s+\[([\s\S]*?)\];/.exec(js);
const heroCount = heroMatch ? (heroMatch[1].match(/id:/g) || []).length : 0;
assert(heroCount <= 2, `hero chips should be <= 2, got ${heroCount}`);

assert(!wxml.includes("privacy-tip-full"), "privacy-tip-full must not be a first-viewport card");
assert(wxml.includes("bottom-sheet") || wxml.includes("sheet-mask"), "bottom sheet / overlay should exist");
assert(/class="composer"/.test(wxml), "composer should exist");
assert(/\.composer\s*\{[\s\S]*?position\s*:\s*fixed/.test(wxss), "composer should stay fixed");
assert(wxml.includes("top-status-bar") && !wxml.includes("assistant-hero card"), "top should be compact status bar, not hero card");

console.log("test-ai-assistant-minimal-ui passed");
