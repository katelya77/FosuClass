const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const wxml = fs.readFileSync(path.join(ROOT, "miniprogram/pages/ai-assistant/ai-assistant.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(ROOT, "miniprogram/pages/ai-assistant/ai-assistant.wxss"), "utf8");

function collectWxmlClasses(text) {
  const classes = new Set();
  const matches = text.matchAll(/class="([^"]+)"/g);
  for (const match of matches) {
    match[1].split(/\s+/).forEach((name) => {
      const clean = name.replace(/\{\{[\s\S]*?\}\}/g, "").trim();
      if (clean && /^[a-zA-Z0-9_-]+$/.test(clean)) classes.add(clean);
    });
  }
  return classes;
}

function collectCssSelectors(text) {
  const selectors = new Set();
  const matches = text.matchAll(/(^|[,{]\s*)\.([a-zA-Z0-9_-]+)(?=[\s.{:#>,])/gm);
  for (const match of matches) selectors.add(match[2]);
  return selectors;
}

function run() {
  const wxmlClasses = collectWxmlClasses(wxml);
  const cssClasses = collectCssSelectors(wxss);
  const allowedUtility = new Set([
    "today",
    "room",
    "teacher",
    "xls",
    "success",
    "failed",
    "skipped",
    "running",
    "expanded",
    "disabled",
    "secondary",
    "one-action",
    "two-actions",
    "card-error",
    "card-type-empty-room",
    "card-type-schedule",
  ]);

  [".assistant-hero", ".hero-top", ".hero-logo-wrap", ".hero-logo", ".hero-mark", ".hero-copy", ".hero-title", ".hero-desc", ".hero-clear-mini", ".hero-meta-row", ".hero-status-chip"].forEach((selector) => {
    assert(!wxss.includes(selector), `${selector} should be removed from ai-assistant.wxss`);
  });

  for (const className of cssClasses) {
    if (className.startsWith("hero-")) {
      assert.fail(`unused legacy hero selector remains: .${className}`);
    }
    if (allowedUtility.has(className)) continue;
    if (className.startsWith("card-type-")) continue;
    assert(wxmlClasses.has(className), `possible unused selector .${className}`);
  }

  console.log("test-ai-assistant-unused-selector passed");
}

run();
