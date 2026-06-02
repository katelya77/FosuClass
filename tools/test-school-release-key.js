// tools/test-school-release-key.js
const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

// 1. 设置本地存储的 releaseKey 为旧版本
const oldTerm = "2025-2026-1";
const oldVersion = "2026-01-01T00-00-00";
const oldKey = `${oldTerm}:${oldVersion}:some-epoch`;
mockEnv.storage.set("FOSU_LOCAL_RELEASE_KEY", oldKey);

// 写入旧版本下的缓存
const oldIndexKey = `school:index:${oldTerm}:${oldVersion}:class`;
mockEnv.storage.set(oldIndexKey, { savedAt: Date.now(), data: { items: [1, 2, 3] } });

// 2. Mock 网络请求 app-config 返回最新的 releaseVersion (版本改变了)
const newTerm = "2025-2026-2";
const newVersion = "2026-06-01T23-44-37";
global.wx.mockRequest = (options) => {
  if (options.url.includes("app-config")) {
    options.success({
      statusCode: 200,
      data: {
        success: true,
        currentSemester: newTerm,
        dataVersion: {
          releaseVersion: newVersion,
          classScheduleUpdatedAt: "2026-06-02T13:43:00Z"
        }
      }
    });
  } else if (options.url.includes("bootstrap")) {
    options.success({
      statusCode: 200,
      data: {
        success: true,
        catalog: {
          colleges: [{ code: "01", name: "生命科学学院" }]
        }
      }
    });
  }
};

require("../miniprogram/pages/school/school.js");
const page = mockEnv.createPageInstance();

// 3. 执行页面初始化
page.onLoad();

setTimeout(() => {
  // 4. 校验新版本 key 是否已更新
  const savedKey = mockEnv.storage.get("FOSU_LOCAL_RELEASE_KEY");
  console.log("[test] 缓存中的新 releaseKey:", savedKey);
  assert(savedKey.includes(newVersion), "FOSU_LOCAL_RELEASE_KEY 必须更新为新版本");

  // 5. 校验旧版本的缓存是否被清空
  const oldCached = mockEnv.storage.get(oldIndexKey);
  assert.strictEqual(oldCached, undefined, "旧版本的 class index 缓存必须被自动清理以防旧缓存污染");
  console.log("✅ test-school-release-key passed.");
  process.exit(0);
}, 100);
