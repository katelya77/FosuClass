// tools/test-fosu-search-index.js
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

console.log(`[test] 当前 active release: term=${term}, version=${version}`);

const result = releaseService.searchActiveIndex("class", "", { semester: term, releaseVersion: version });
assert.strictEqual(result.success, true, "查询主索引应该成功");
assert(Array.isArray(result.items), "返回的 items 应该是数组");
console.log(`[test] class items count: ${result.items.length}`);

// 测试带有筛选条件
if (result.items.length > 0) {
  const item = result.items[0];
  const query = {
    semester: term,
    releaseVersion: version,
    collegeCode: item.collegeCode,
    grade: item.grade,
    majorCode: item.majorCode
  };
  const filtered = releaseService.searchActiveIndex("class", "", query);
  assert.strictEqual(filtered.success, true, "带筛选的查询应该成功");
  assert(filtered.items.length > 0, "带筛选的查询返回 items 应该大于 0");
  assert(filtered.items.every(x => x.collegeCode === item.collegeCode && x.grade === item.grade), "筛选数据正确");
  console.log(`[test] 带筛选的查询通过，匹配项数: ${filtered.items.length}`);
}

if (isTempActive && fs.existsSync(ACTIVE_RELEASE_PATH)) {
  fs.unlinkSync(ACTIVE_RELEASE_PATH);
}
console.log("✅ test-fosu-search-index passed.");
process.exit(0);
