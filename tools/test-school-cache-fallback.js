// tools/test-school-cache-fallback.js
const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

const term = "2025-2026-2";
const releaseVersion = "2026-06-01T23-44-37";
const type = "class";

// 1. 写入同版本的 catalog 缓存
const catalogKey = `school:catalog:${term}:${releaseVersion}`;
const catalogData = {
  semester: term,
  version: releaseVersion,
  colleges: [{ code: "01", name: "生命科学学院" }],
  success: true
};
mockEnv.storage.set(catalogKey, catalogData);

// 2. 写入同版本的 search-index 缓存
const { getSchoolIndexCacheKey } = require("../miniprogram/utils/storage");
const indexKey = getSchoolIndexCacheKey(term, releaseVersion, type, { term, releaseVersion, type });
const indexData = {
  savedAt: Date.now(),
  data: {
    success: true,
    items: [{ id: "class-1", className: "25动物医学3班", collegeCode: "01" }]
  }
};
mockEnv.storage.set(indexKey, indexData);

// 3. Mock 网络请求连接失败，用于触发静默更新时的失败流
global.wx.mockRequest = (options) => {
  setTimeout(() => {
    options.fail({ errMsg: "request:fail disconnected" });
  }, 10);
};

require("../miniprogram/pages/school/school.js");
const page = mockEnv.createPageInstance();

// 设置必要的状态变量
page.setData({
  catalogVersion: releaseVersion,
  semesters: [{ label: term, value: term }],
  selectedSemesterIndex: 0
});

// 4. 执行 executeSearch，确保能用缓存成功渲染数据
let renderCount = 0;
let lastRenderedData = null;

page.executeSearch(type, { term, releaseVersion }, (data, isFromCache) => {
  renderCount++;
  lastRenderedData = data;
  if (isFromCache) {
    console.log("[test] 成功从缓存渲染:", data.items[0].className);
  }
}, (err) => {
  console.log("[test] 网络请求失败回调触发");
});

setTimeout(() => {
  assert(renderCount > 0, "即使网络请求失败，若有同版本缓存也必须触发渲染");
  assert.strictEqual(lastRenderedData.items[0].className, "25动物医学3班", "成功渲染出缓存中的班级");
  
  // 即使网络刷新失败，由于已有缓存且渲染了，loadingState 不应变成错误，而是 none
  assert.strictEqual(page.data.loadingState, "none", "同版本缓存存在且渲染，网络刷新失败时 loadingState 应该为 none");
  console.log("✅ test-school-cache-fallback passed.");
  process.exit(0);
}, 100);
