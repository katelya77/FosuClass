const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const appJson = JSON.parse(fs.readFileSync(path.join(root, "miniprogram/app.json"), "utf8"));

// WeChat: main package pages vs subpackage pages
assert(Array.isArray(appJson.pages), "app.json.pages must exist");
assert(!appJson.pages.includes("pages/ai-assistant/ai-assistant"), "ai-assistant must not stay in main package pages");
assert(!appJson.pages.includes("pages/campus-map/campus-map"), "campus-map must not stay in main package pages");

const subPackages = appJson.subPackages || appJson.subpackages || [];
const xiaofu = subPackages.find((item) => item && item.root === "packageXiaofu");
const maps = subPackages.find((item) => item && item.root === "packageMaps");
assert(xiaofu, "packageXiaofu subpackage must be registered");
assert(maps, "packageMaps subpackage must be registered");
assert(
  Array.isArray(xiaofu.pages) && xiaofu.pages.includes("pages/ai-assistant/ai-assistant"),
  "packageXiaofu must register ai-assistant page"
);
assert(
  Array.isArray(maps.pages) && maps.pages.includes("pages/campus-map/campus-map"),
  "packageMaps must register campus-map page"
);

[
  "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js",
  "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml",
  "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss",
  "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.json",
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
  "miniprogram/components/xiaofu-float/index.js",
];

const entryText = entryFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
assert(entryText.includes("/packageXiaofu/pages/ai-assistant/ai-assistant"), "index/school/today/float should reference subpackage ai-assistant route");
assert(fs.readFileSync(path.join(root, "miniprogram/pages/index/index.wxml"), "utf8").includes("校园服务管家") ||
  fs.readFileSync(path.join(root, "miniprogram/pages/index/index.wxml"), "utf8").includes("校园管家"), "home page should expose campus assistant entry");
assert(fs.readFileSync(path.join(root, "miniprogram/pages/school/school.wxml"), "utf8").includes("校园助手查课/找教室"), "school page should expose campus assistant entry");
assert(fs.readFileSync(path.join(root, "miniprogram/pages/today/today.wxml"), "utf8").includes("查询今日安排"), "today page should expose campus assistant entry");

// Server navigation allowlist must accept subpackage routes
const payloadContract = require("../server/src/services/ai/generatedPayloadContract");
assert.strictEqual(
  payloadContract.isAllowedNavigationUrl("/packageXiaofu/pages/ai-assistant/ai-assistant"),
  true,
  "server must allow AI subpackage navigate url"
);
assert.strictEqual(
  payloadContract.isAllowedNavigationUrl("/packageMaps/pages/campus-map/campus-map?map=xianxiSouth"),
  true,
  "server must allow campus-map subpackage navigate url"
);

console.log("test-miniprogram-ai-page-entry passed");
