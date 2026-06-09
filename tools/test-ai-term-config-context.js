const assert = require("assert");

const storage = {};
global.wx = {
  getStorageSync(key) {
    return storage[key] === undefined ? "" : storage[key];
  },
  setStorageSync(key, value) {
    storage[key] = value;
  },
  removeStorageSync(key) {
    delete storage[key];
  },
};
global.getCurrentPages = () => [{ route: "pages/ai-assistant/ai-assistant" }];
global.getApp = () => ({
  globalData: {
    activeRelease: {
      term: "2026-2027-1",
      releaseVersion: "runtime-term-test",
      manifest: {
        releaseVersion: "runtime-term-test",
        termConfig: {
          term: "2026-2027-1",
          semesterText: "2026-2027学年第一学期",
          termStartDate: "2026-09-07",
          totalWeeks: 18,
          source: "release-test",
        },
      },
    },
    appConfig: {},
  },
});

const { CURRENT_SCHEDULE_TARGET_KEY } = require("../miniprogram/utils/storage");
const week = require("../miniprogram/utils/week");
const termConfigService = require("../miniprogram/services/termConfigService");
const aiAssistantService = require("../miniprogram/services/aiAssistantService");

function run() {
  termConfigService.applyRuntimeTermConfigFromApp(global.getApp());
  storage[CURRENT_SCHEDULE_TARGET_KEY] = {
    type: "personal-xls",
    name: "个人课表",
    semester: "2026-2027-1",
    courses: [{
      courseName: "运行时学期测试",
      weekday: 1,
      startSection: 1,
      endSection: 2,
      weeks: [1, 2],
      weekText: "1-2周",
    }],
  };
  storage[aiAssistantService.ALLOW_PERSONAL_CONTEXT_KEY] = true;

  const context = aiAssistantService.buildClientContext();
  assert.strictEqual(context.term, "2026-2027-1");
  assert.strictEqual(context.semesterText, "2026-2027学年第一学期");
  assert.strictEqual(context.termStartDate, "2026-09-07");
  assert.strictEqual(context.totalWeeks, 18);
  assert(Number(context.currentTeachingWeek) >= 1, "currentTeachingWeek should be present");

  week.resetRuntimeTermConfig();
  assert.strictEqual(week.getRuntimeTermConfig().termStartDate, "");
  console.log("test-ai-term-config-context passed");
}

run();
