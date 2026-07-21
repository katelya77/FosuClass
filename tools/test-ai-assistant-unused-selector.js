const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const pageDir = path.join(ROOT, "miniprogram/packageXiaofu/pages/ai-assistant");
const componentsDir = path.join(ROOT, "miniprogram/packageXiaofu/components");
const wxml = fs.readFileSync(path.join(pageDir, "ai-assistant.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(pageDir, "ai-assistant.wxss"), "utf8");
const pageJson = JSON.parse(fs.readFileSync(path.join(pageDir, "ai-assistant.json"), "utf8"));

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

function loadComponentWxmlClasses() {
  const classes = new Set();
  const using = (pageJson && pageJson.usingComponents) || {};
  Object.values(using).forEach((ref) => {
    const abs = path.join(ROOT, "miniprogram", String(ref).replace(/^\//, "") + ".wxml");
    if (fs.existsSync(abs)) {
      collectWxmlClasses(fs.readFileSync(abs, "utf8")).forEach((c) => classes.add(c));
    }
  });
  // also include shared package components commonly styled by page-level sheets
  if (fs.existsSync(componentsDir)) {
    fs.readdirSync(componentsDir).forEach((name) => {
      const file = path.join(componentsDir, name, "index.wxml");
      if (fs.existsSync(file)) {
        collectWxmlClasses(fs.readFileSync(file, "utf8")).forEach((c) => classes.add(c));
      }
    });
  }
  return classes;
}

function run() {
  const wxmlClasses = collectWxmlClasses(wxml);
  const componentClasses = loadComponentWxmlClasses();
  componentClasses.forEach((c) => wxmlClasses.add(c));
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
    "card-weather-cloud",
    "card-weather-rain",
    "card-weather-sun",
    // product experience leftovers kept for sheets/cards during progressive split
    "ai-mode-row",
    "ai-mode-row-slim",
    "quick-action-scroll",
    "quick-action-list",
    "quick-action-pill",
    "quick-action-icon",
    "quick-action-label",
    "quick-nav-segment",
    "quick-nav-option",
    "classroom",
    "sync",
    "tool-strip",
    "tool-chip",
    "message-bubble",
    "empty-desc",
    "task-card-grid",
    "task-entry-card",
    "task-entry-title",
    "task-entry-desc",
    "xiaofu-chip",
    "xiaofu-chip-row",
    "status-online",
    "status-offline",
    "status-warn",
    "header-menu-list",
    "header-menu-sheet",
    "header-menu-sheet-full",
    "header-menu-row",
    "header-menu-row-title",
    "header-menu-row-meta",
    "header-menu-row-arrow",
    "sheet-close",
    "settings-row",
    "settings-row-body",
    "settings-row-desc",
    "settings-row-icon",
    "settings-row-switch",
    "settings-section",
    "settings-section-danger",
    "settings-section-label",
    "settings-sheet-scroll",
    "settings-switch",
    "xiaofu-settings-sheet",
    "ai-result-card",
    "card",
    "card-header-row",
    "card-title-block",
    "card-title",
    "card-subtitle",
    "card-type",
    "card-items",
    "card-item",
    "card-overflow",
    "card-actions",
    "card-action-primary",
    "card-action-secondary",
    "card-disclaimer",
    "secondary-action-row",
    "badge",
    "badge-row",
    "item-main",
    "item-title",
    "item-subtitle",
    "item-value",
    "filtered-hint",
    "weather-card",
    "weather-card-head",
    "weather-campus",
    "weather-status",
    "weather-updated",
    "weather-main",
    "weather-temp",
    "weather-facts",
    "weather-icon",
    "weather-icon-css",
    "weather-metrics",
    "weather-metric",
    "weather-timeline",
    "weather-hour",
    "weather-advice",
    "weather-source",
    "card-type-guide",
    "card-type-navigation",
    "card-type-schedule-candidate",
    "card-type-schedule-status",
    "card-type-school-knowledge",
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
    if (className.startsWith("card-weather-")) continue;
    assert(wxmlClasses.has(className), `possible unused selector .${className}`);
  }

  console.log("test-ai-assistant-unused-selector passed");
}

run();
