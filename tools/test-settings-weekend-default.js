"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const storage = require("../miniprogram/utils/storage");

assert.strictEqual(
  storage.getSettings().showWeekend,
  true,
  "new users should see weekend columns by default"
);
assert.strictEqual(
  storage.getSettings().hideInactiveCourses,
  true,
  "new users should only see courses that run in the current week"
);
assert.strictEqual(
  storage.getSettings().weekendShowMode,
  "overview",
  "new users should see all seven days in one overview"
);
assert.strictEqual(
  storage.getSettings().manualWeekOverride,
  false,
  "new users should follow the teaching calendar"
);

storage.saveSettings({
  showWeekend: false,
  hideInactiveCourses: false,
  weekendShowMode: "detail",
});
assert.strictEqual(
  storage.getSettings().showWeekend,
  false,
  "an explicit user choice to hide weekends must be preserved"
);
assert.strictEqual(storage.getSettings().hideInactiveCourses, false);
assert.strictEqual(storage.getSettings().weekendShowMode, "detail");

storage.resetSettings();
assert.strictEqual(
  storage.getSettings().showWeekend,
  true,
  "resetting settings should restore the weekend-visible default"
);
assert.strictEqual(storage.getSettings().hideInactiveCourses, true);
assert.strictEqual(storage.getSettings().weekendShowMode, "overview");
assert.strictEqual(storage.getSettings().manualWeekOverride, false);

storage.saveSettings({ showWeekend: false });
storage.clearAppCache();
assert.strictEqual(
  storage.getSettings().showWeekend,
  true,
  "clearing app settings should restore the weekend-visible default"
);

wx.setStorageSync(storage.STORAGE_KEY, {
  showWeekend: false,
  hideInactiveCourses: false,
  weekendShowMode: "detail",
  showHistoricalGrades: true,
});
const migrated = storage.getSettings();
assert.strictEqual(migrated.showWeekend, false, "legacy users keep an explicit weekend choice");
assert.strictEqual(migrated.hideInactiveCourses, false, "legacy users keep an explicit inactive-course choice");
assert.strictEqual(migrated.weekendShowMode, "detail", "legacy users keep an explicit display mode");
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(migrated, "showHistoricalGrades"),
  false,
  "retired historical-grade setting must not reach business code"
);
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(wx.getStorageSync(storage.STORAGE_KEY), "showHistoricalGrades"),
  false,
  "reading legacy settings should migrate the retired key out of storage"
);
storage.saveSettings({ showHistoricalGrades: true });
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(wx.getStorageSync(storage.STORAGE_KEY), "showHistoricalGrades"),
  false,
  "saving settings must not reintroduce the retired key"
);

const settingsWxml = fs.readFileSync(
  path.join(__dirname, "../miniprogram/pages/settings/settings.wxml"),
  "utf8"
);
assert(settingsWxml.includes("隐藏非本周课程"));
assert(settingsWxml.includes("只显示本周实际上课的课程"));
assert(settingsWxml.includes("显示完整一周"));
assert(settingsWxml.includes("显示周一至周日"));
assert(!settingsWxml.includes("显示历史年级"));
assert(!settingsWxml.includes("数据与公告"));

console.log("test-settings-weekend-default passed");
