// tools/test-fosu-search-index-performance.js
const assert = require("assert");
const releaseService = require("../server/src/services/releaseService");

const fs = require("fs");
const path = require("path");

const ACTIVE_RELEASE_PATH = path.join(__dirname, "../server/storage/releases/active.json");
let isTempActive = false;

// 若不存在 active.json，则写入临时文件使其指向 26.05.29.22 现成索引
if (!fs.existsSync(ACTIVE_RELEASE_PATH)) {
  console.log("[test] 写入临时 active.json 以连接 26.05.29.22 索引数据...");
  const tempActive = {
    version: "26.05.29.22",
    activatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    semester: "2025-2026-2",
    counts: { classScheduleCount: 100 }
  };
  fs.mkdirSync(path.dirname(ACTIVE_RELEASE_PATH), { recursive: true });
  fs.writeFileSync(ACTIVE_RELEASE_PATH, JSON.stringify(tempActive, null, 2), "utf-8");
  isTempActive = true;
}

const activeInfo = releaseService.getActiveReleaseInfo();
if (!activeInfo || !activeInfo.version) {
  console.warn("⚠️ 没有检测到 active release，测试跳过。");
  if (isTempActive && fs.existsSync(ACTIVE_RELEASE_PATH)) fs.unlinkSync(ACTIVE_RELEASE_PATH);
  process.exit(0);
}

const term = activeInfo.term || "2025-2026-2";
const version = activeInfo.version;

// 第一次加载，触发索引解析与 derivedCache 初始化
const start1 = Date.now();
const res1 = releaseService.searchActiveIndex("class", "", { semester: term, releaseVersion: version });
const duration1 = Date.now() - start1;
console.log(`[test] 第一次查询耗时: ${duration1}ms`);

// 第二次查询，应该命中 derivedCache 缓存，接近 0ms
const start2 = Date.now();
const res2 = releaseService.searchActiveIndex("class", "", { semester: term, releaseVersion: version });
const duration2 = Date.now() - start2;
console.log(`[test] 第二次(缓存命中)查询耗时: ${duration2}ms`);

assert(duration2 < 100, "缓存命中时耗时必须极短 (< 100ms)");
// 第一次即使要从 classes-index.json 读取重建，也不应该超过 2s
assert(duration1 < 2000, "第一次加载耗时必须 < 2s，确保不重新解析 185MB 的完整原始 JSON");

if (isTempActive && fs.existsSync(ACTIVE_RELEASE_PATH)) {
  fs.unlinkSync(ACTIVE_RELEASE_PATH);
}
console.log("✅ test-fosu-search-index-performance passed.");
process.exit(0);
