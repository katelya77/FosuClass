#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pageRoot = path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant");
const wxml = fs.readFileSync(path.join(pageRoot, "ai-assistant.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(pageRoot, "ai-assistant.wxss"), "utf8");
const iconRoot = path.join(root, "miniprogram/assets/icons/ai-actions");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "m").exec(wxss);
  return match ? match[1] : "";
}

assert(wxml.includes('class="plus-action-grid"'), "quick actions should use a primary grid");
assert((wxml.match(/class="plus-action-card"/g) || []).length >= 4, "at least four high-value actions should be primary cards");
assert((wxml.match(/class="plus-action-icon"/g) || []).length >= 8, "every quick action should have a local icon");
assert(wxml.includes("下一节课") && wxml.includes("创建提醒") && wxml.includes("找空教室") && wxml.includes("导入课表"));
assert(wxml.includes("管理提醒") && wxml.includes("校园工具") && wxml.includes("新建对话"));

const grid = rule(".plus-action-grid");
assert(/grid-template-columns\s*:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(grid), "primary actions should fill two equal columns");
const list = rule(".plus-action-list");
assert(/width\s*:\s*100%/.test(list) && /box-sizing\s*:\s*border-box/.test(list), "sheet content should fill the available width");
assert(!/max-width/.test(list), "quick action content must not be constrained by a centered max width");
const row = rule(".plus-action-row");
assert(/width\s*:\s*100%/.test(row), "secondary actions should be full-width rows");

const svgPaths = Array.from(wxml.matchAll(/src="(\/assets\/icons\/ai-actions\/[^"]+\.svg)"/g), (match) => match[1]);
assert(svgPaths.length >= 8, "quick actions should use a coherent local SVG icon family");
svgPaths.forEach((publicPath) => {
  const filePath = path.join(root, "miniprogram", publicPath.replace(/^\//, ""));
  assert(fs.existsSync(filePath), `missing quick action icon: ${publicPath}`);
  const source = fs.readFileSync(filePath, "utf8");
  assert(source.includes("<svg") && !/<script|onload=|javascript:/i.test(source), `unsafe SVG: ${publicPath}`);
});

console.log("test-xiaofu-quick-actions-ui passed");
