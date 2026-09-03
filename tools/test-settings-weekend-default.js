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

storage.saveSettings({ showWeekend: false });
assert.strictEqual(
  storage.getSettings().showWeekend,
  false,
  "an explicit user choice to hide weekends must be preserved"
);

storage.resetSettings();
assert.strictEqual(
  storage.getSettings().showWeekend,
  true,
  "resetting settings should restore the weekend-visible default"
);

storage.saveSettings({ showWeekend: false });
storage.clearAppCache();
assert.strictEqual(
  storage.getSettings().showWeekend,
  true,
  "clearing app settings should restore the weekend-visible default"
);

const settingsWxml = fs.readFileSync(
  path.join(__dirname, "../miniprogram/pages/settings/settings.wxml"),
  "utf8"
);
assert(
  settingsWxml.includes("默认开启，避免漏看周六、周日课程；确认无课可关闭"),
  "settings should explain why weekend display is enabled by default"
);

console.log("test-settings-weekend-default passed");
