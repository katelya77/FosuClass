const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const miniprogramRoot = path.join(root, "miniprogram");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function walkFiles(dir, predicate, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      walkFiles(fullPath, predicate, output);
    } else if (!predicate || predicate(fullPath)) {
      output.push(fullPath);
    }
  }
  return output;
}

function collectUsedComponentTags() {
  const tags = new Set();
  const files = walkFiles(miniprogramRoot, (filePath) => filePath.endsWith(".wxml"));
  files.forEach((filePath) => {
    const content = fs.readFileSync(filePath, "utf8");
    const matches = content.matchAll(/<([a-z][a-z0-9-]*)\b/gi);
    for (const match of matches) tags.add(match[1]);
  });
  return tags;
}

function run() {
  const usedTags = collectUsedComponentTags();
  const jsonFiles = walkFiles(miniprogramRoot, (filePath) => filePath.endsWith(".json"));
  jsonFiles.forEach((filePath) => {
    const json = readJson(filePath);
    const components = json.usingComponents || {};
    Object.keys(components).forEach((tag) => {
      assert(usedTags.has(tag), `${path.relative(root, filePath)} declares unused component ${tag}`);
      const ref = String(components[tag] || "");
      if (ref.startsWith("/")) {
        const componentJson = path.join(miniprogramRoot, `${ref}.json`);
        assert(fs.existsSync(componentJson), `${tag} component file should exist: ${componentJson}`);
      }
    });
  });
  assert(!fs.existsSync(path.join(miniprogramRoot, "components", "search-filter", "index.json")), "unused search-filter component should be removed");

  const pngFiles = walkFiles(path.join(miniprogramRoot, "assets", "icons"), (filePath) => /\.png$/i.test(filePath));
  pngFiles.forEach((filePath) => {
    const size = fs.statSync(filePath).size;
    assert(size <= 200 * 1024, `${path.relative(root, filePath)} exceeds 200KB`);
  });

  const aiWxml = fs.readFileSync(path.join(miniprogramRoot, "pages", "ai-assistant", "ai-assistant.wxml"), "utf8");
  const nodeCount = (aiWxml.match(/<view\b|<button\b|<scroll-view\b|<textarea\b|<image\b|<switch\b/g) || []).length;
  assert(nodeCount <= 130, `AI page WXML is too complex: ${nodeCount}`);

  const aiWxss = fs.readFileSync(path.join(miniprogramRoot, "pages", "ai-assistant", "ai-assistant.wxss"), "utf8");
  assert(/\.assistant-hero\s*\{[\s\S]*?padding:\s*10rpx 12rpx;/.test(aiWxss), "AI hero should stay compact");
  assert(/\.privacy-compact\s*\{[\s\S]*?min-height:\s*50rpx;/.test(aiWxss), "privacy compact bar should remain within 56rpx");
  assert(/\.quick-chip\s*\{[\s\S]*?height:\s*44rpx;/.test(aiWxss), "quick chips should remain compact");

  console.log("test-miniprogram-package-hygiene passed");
}

run();
