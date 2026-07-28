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

function getSubpackageRoots(appJson) {
  const packages = appJson.subPackages || appJson.subpackages || [];
  return packages
    .map((item) => String(item && item.root || "").replace(/\\/g, "/").replace(/\/+$/, ""))
    .filter(Boolean)
    .map((rel) => path.resolve(miniprogramRoot, rel));
}

function isUnderDir(filePath, dirPath) {
  const rel = path.relative(dirPath, filePath);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function run() {
  const appJsonPath = path.join(miniprogramRoot, "app.json");
  assert(fs.existsSync(appJsonPath), "miniprogram/app.json must exist");
  const appJson = readJson(appJsonPath);
  const subpackageRoots = getSubpackageRoots(appJson);
  assert(subpackageRoots.length >= 1, "AI/map heavy pages should live in subpackages");

  // WeChat upload compiler rejects BOM-prefixed sources (inner upload errcode -80056).
  const bomFiles = walkFiles(miniprogramRoot, (filePath) => /\.(wxss|wxml|js|json|wxs)$/.test(filePath))
    .filter((filePath) => {
      const head = fs.readFileSync(filePath);
      return head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
    });
  assert.strictEqual(bomFiles.length, 0, `source files must not carry UTF-8 BOM: ${bomFiles.join(", ")}`);

  const usedTags = collectUsedComponentTags();
  const packageFiles = walkFiles(miniprogramRoot);
  const totalBytes = packageFiles.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0);

  // WeChat main-package gate: files NOT under any subpackage root.
  const mainFiles = packageFiles.filter((filePath) => !subpackageRoots.some((rootDir) => isUnderDir(filePath, rootDir)));
  const mainBytes = mainFiles.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0);
  assert(
    mainBytes <= 2 * 1024 * 1024,
    `miniprogram main package exceeds 2MB: ${mainBytes} bytes (total project ${totalBytes} bytes; subpackages=${subpackageRoots.length})`
  );

  // Keep total project sanity (WeChat total limit is higher; soft guard for runaway assets).
  assert(totalBytes <= 20 * 1024 * 1024, `miniprogram total package exceeds 20MB: ${totalBytes} bytes`);

  // Main package must not still host AI assistant page or map JPG assets.
  assert(
    !mainFiles.some((filePath) => /[\\/]pages[\\/]ai-assistant[\\/]/.test(filePath)),
    "ai-assistant page must not stay in main package"
  );
  assert(
    !mainFiles.some((filePath) => /[\\/]assets[\\/]maps[\\/].*\.jpe?g$/i.test(filePath)),
    "campus map JPGs must not stay in main package"
  );

  const jsonFiles = walkFiles(miniprogramRoot, (filePath) => filePath.endsWith(".json"));
  jsonFiles.forEach((filePath) => {
    const json = readJson(filePath);
    const components = json.usingComponents || {};
    Object.keys(components).forEach((tag) => {
      assert(usedTags.has(tag), `${path.relative(root, filePath)} declares unused component ${tag}`);
      const ref = String(components[tag] || "");
      if (ref.startsWith("/")) {
        const componentJson = path.join(miniprogramRoot, `${ref}.json`.replace(/^\//, ""));
        // component path is absolute from miniprogram root
        const resolved = path.join(miniprogramRoot, ref.replace(/^\//, "") + ".json");
        assert(
          fs.existsSync(resolved) || fs.existsSync(componentJson),
          `${tag} component file should exist: ${resolved}`
        );
      }
    });
  });
  assert(!fs.existsSync(path.join(miniprogramRoot, "components", "search-filter", "index.json")), "unused search-filter component should be removed");

  const pngFiles = walkFiles(path.join(miniprogramRoot, "assets", "icons"), (filePath) => /\.png$/i.test(filePath));
  pngFiles.forEach((filePath) => {
    const size = fs.statSync(filePath).size;
    assert(size <= 200 * 1024, `${path.relative(root, filePath)} exceeds 200KB`);
  });

  const aiWxmlPath = path.join(miniprogramRoot, "packageXiaofu", "pages", "ai-assistant", "ai-assistant.wxml");
  assert(fs.existsSync(aiWxmlPath), "AI assistant page should live in packageXiaofu subpackage");
  const aiWxml = fs.readFileSync(aiWxmlPath, "utf8");
  const nodeCount = (aiWxml.match(/<view\b|<button\b|<scroll-view\b|<textarea\b|<image\b|<switch\b/g) || []).length;
  assert(nodeCount <= 190, `AI page WXML is too complex: ${nodeCount}`);

  const aiWxss = fs.readFileSync(
    path.join(miniprogramRoot, "packageXiaofu", "pages", "ai-assistant", "ai-assistant.wxss"),
    "utf8"
  );
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

  console.log(
    `test-miniprogram-package-hygiene passed (main=${mainBytes} bytes, total=${totalBytes} bytes, subpackages=${subpackageRoots.length})`
  );
}

run();
