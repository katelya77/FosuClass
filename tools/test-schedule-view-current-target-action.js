const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
global.getApp = () => ({
  globalData: {
    activeRelease: {
      term: "2026-2027-1",
      releaseVersion: "release-2026-fall",
    },
  },
});

const storage = require("../miniprogram/utils/storage");
require("../miniprogram/pages/schedule-view/schedule-view.js");

function makePage(name, detailId) {
  const page = mockEnv.createPageInstance();
  page.setData({
    isCurrentTarget: false,
    type: "class",
    name,
    semester: "2026-2027-1",
    allCourses: [{
      id: `${detailId}-course`,
      courseName: "动物生物化学",
      weekday: 5,
      startSection: 3,
      endSection: 5,
      weeks: [1],
    }],
    scheduleMeta: {
      id: detailId,
      detailId,
      classId: detailId,
      className: name,
      releaseVersion: "release-2026-fall",
    },
  });
  return page;
}

function run() {
  const originalSetStorageSync = wx.setStorageSync;
  const originalSetTimeout = global.setTimeout;
  let toast = null;
  let modal = null;
  let switchedTo = "";
  wx.onToast = (options) => { toast = options; };
  wx.onModal = (options) => { modal = options; };
  wx.switchTab = (options) => { switchedTo = options && options.url || ""; };
  global.setTimeout = (handler) => {
    handler();
    return 1;
  };

  try {
    wx.setStorageSync("school:v8:index:disposable", { items: new Array(100).fill({ id: "cached" }) });
    let injectedQuotaFailure = false;
    wx.setStorageSync = (key, value) => {
      if (key === storage.CURRENT_SCHEDULE_TARGET_KEY && !injectedQuotaFailure) {
        injectedQuotaFailure = true;
        const error = new Error("setStorage:fail exceed storage limit");
        error.errMsg = "setStorage:fail exceed storage limit";
        throw error;
      }
      return originalSetStorageSync(key, value);
    };

    const page = makePage("25动物医学6班", "class-25-vet-6");
    page.toggleBindTarget();
    assert.strictEqual(page.data.isCurrentTarget, true, "button should become active after recovered write");
    assert.strictEqual(storage.getCurrentScheduleTarget().detailId, "class-25-vet-6");
    assert(toast && toast.icon === "success", "real-device action must provide success feedback");
    assert.strictEqual(switchedTo, "/pages/index/index");

    wx.setStorageSync = originalSetStorageSync;
    storage.clearCurrentScheduleTarget();
    toast = null;
    modal = null;
    switchedTo = "";
    wx.setStorageSync = (key, value) => {
      if (key === storage.CURRENT_SCHEDULE_TARGET_KEY) {
        throw new Error("setStorage:fail internal error");
      }
      return originalSetStorageSync(key, value);
    };

    const failedPage = makePage("25动物医学7班", "class-25-vet-7");
    failedPage.toggleBindTarget();
    assert.strictEqual(failedPage.data.isCurrentTarget, false);
    assert(modal && modal.title === "设置失败", "unrecoverable write must never fail silently");
    assert.strictEqual(switchedTo, "");
  } finally {
    wx.setStorageSync = originalSetStorageSync;
    global.setTimeout = originalSetTimeout;
    wx.onToast = null;
    wx.onModal = null;
    storage.clearCurrentScheduleTarget();
  }

  console.log("test-schedule-view-current-target-action passed");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
