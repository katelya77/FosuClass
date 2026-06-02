// tools/test-school-request-timeout.js
const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

// 1. Mock 网络请求超时
global.wx.mockRequest = (options) => {
  setTimeout(() => {
    options.fail({ errMsg: "request:fail timeout" });
  }, 10);
};

// 2. 加载小程序的 modules
const request = require("../miniprogram/utils/request");
require("../miniprogram/pages/school/school.js");

const page = mockEnv.createPageInstance();

// 3. 执行初始化页面数据
page.onLoad();

// 4. 等待超时处理完成
setTimeout(() => {
  console.log("[test] dataLoadState after timeout:", page.data.dataLoadState);
  assert.strictEqual(page.data.dataLoadState, "timeout", "全局 bootstrap/app-config 超时，页面 dataLoadState 应该是 timeout");

  // 5. 重新 mock 网络请求超时用于测试 executeSearch 的超时
  page.setData({ catalogVersion: "2026-06-01T23-44-37" });
  page.executeSearch("class", {}, (data) => {}, (err) => {});

  setTimeout(() => {
    console.log("[test] loadingState after executeSearch timeout:", page.data.loadingState);
    assert.strictEqual(page.data.loadingState, "timeout", "局部 search-index 请求超时，loadingState 应该为 timeout");
    console.log("✅ test-school-request-timeout passed.");
    process.exit(0);
  }, 50);
}, 100);
