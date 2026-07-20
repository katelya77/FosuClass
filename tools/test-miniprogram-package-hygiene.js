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
  const packageFiles = walkFiles(miniprogramRoot);
  const sourceBytes = packageFiles.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0);
  assert(sourceBytes <= 2 * 1024 * 1024, `miniprogram source package exceeds 2MB: ${sourceBytes} bytes`);

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
  assert(nodeCount <= 190, `AI page WXML is too complex: ${nodeCount}`);

  const aiWxss = fs.readFileSync(path.join(miniprogramRoot, "pages", "ai-assistant", "ai-assistant.wxss"), "utf8");
  assert(
    /\.xiaofu-header\s*\{[\s\S]*?(height:\s*84rpx;|min-height:\s*9[0-9]rpx;)/.test(aiWxss),
    "Xiaofu header should stay compact"
  );
  assert(/\.quick-action-pill\s*\{[\s\S]*?height:\s*5[0-8]rpx;/.test(aiWxss), "quick action pills should remain compact");
  assert(!aiWxss.includes(".assistant-hero"), "legacy AI hero styles should be removed");

  const personalSyncJs = fs.readFileSync(path.join(miniprogramRoot, "pages", "personal-sync", "personal-sync.js"), "utf8");
  const personalSyncWxml = fs.readFileSync(path.join(miniprogramRoot, "pages", "personal-sync", "personal-sync.wxml"), "utf8");
  [
    "selectAllStudentActiveBucket",
    "clearStudentActiveBucketSelection",
    "resetStudentRecommendedSelection",
  ].forEach((handler) => {
    assert(personalSyncJs.includes(`${handler}()`), `personal sync should define ${handler}`);
    assert(personalSyncWxml.includes(`bindtap="${handler}"`), `personal sync WXML should bind ${handler}`);
  });
  assert(personalSyncWxml.includes("selection-dot"), "advanced course rows should expose a tap-friendly multi-select dot");

  console.log("test-miniprogram-package-hygiene passed");
}

run();
