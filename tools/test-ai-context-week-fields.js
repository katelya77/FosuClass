const assert = require("assert");

const storage = {};
global.wx = {
  getStorageSync(key) {
    return storage[key] === undefined ? "" : storage[key];
  },
  setStorageSync(key, value) {
    storage[key] = value;
  },
};
global.getCurrentPages = () => [{ route: "packageXiaofu/pages/ai-assistant/ai-assistant" }];
global.getApp = () => ({
  globalData: {
    activeRelease: {
      term: "2025-2026-2",
      releaseVersion: "fixture-release",
      manifest: {
        releaseVersion: "fixture-release",
        termConfig: {
          term: "2025-2026-2",
          semesterText: "2025-2026学年第二学期",
          termStartDate: "2026-03-09",
          totalWeeks: 19,
          source: "test",
        },
      },
    },
    appConfig: {},
  },
});

const { CURRENT_SCHEDULE_TARGET_KEY } = require("../miniprogram/utils/storage");
const week = require("../miniprogram/utils/week");
const aiAssistantService = require("../miniprogram/services/aiAssistantService");

function run() {
  week.setRuntimeTermConfig({
    term: "2025-2026-2",
    semesterText: "2025-2026学年第二学期",
    termStartDate: "2026-03-09",
    totalWeeks: 19,
    source: "test",
  });

  const sanitized = aiAssistantService.sanitizeCourse({
    courseName: "测试课",
    teacherName: "测试老师",
    classroom: "C7-101",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    weeks: [1, 14],
    weekText: "1-16周(双)",
    rawWeek: "第1-16周(双)",
    startWeek: 1,
    endWeek: 16,
    weekType: "even",
    rawWeeks: "raw-weeks-fixture",
    weeksText: "weeks-text-fixture",
    weekRange: { startWeek: 1, endWeek: 16, oddEven: "even" },
    weekParity: "even",
    parity: "even",
    studentId: "2024012345",
    password: "secret",
    fileBase64: "data:application/vnd.ms-excel;base64," + "A".repeat(120),
  });
  assert.deepStrictEqual(sanitized.weeks, [1, 14]);
  assert.strictEqual(sanitized.weekText, "1-16周(双)");
  assert.strictEqual(sanitized.rawWeek, "第1-16周(双)");
  assert.strictEqual(sanitized.startWeek, 1);
  assert.strictEqual(sanitized.endWeek, 16);
  assert.strictEqual(sanitized.weekType, "even");
  assert.strictEqual(sanitized.rawWeeks, "raw-weeks-fixture");
  assert.strictEqual(sanitized.weeksText, "weeks-text-fixture");
  assert.deepStrictEqual(sanitized.weekRange, { startWeek: 1, endWeek: 16, oddEven: "even" });
  assert.strictEqual(sanitized.weekParity, "even");
  assert.strictEqual(sanitized.parity, "even");
  assert(!Object.prototype.hasOwnProperty.call(sanitized, "studentId"), "studentId must not be preserved");
  assert(!Object.prototype.hasOwnProperty.call(sanitized, "password"), "password must not be preserved");

  storage[CURRENT_SCHEDULE_TARGET_KEY] = {
    name: "fixture",
    type: "personal-xls",
    semester: "2025-2026-2",
    courses: [sanitized],
  };
  storage[aiAssistantService.ALLOW_PERSONAL_CONTEXT_KEY] = true;
  const context = aiAssistantService.buildClientContext();
  assert(Number(context.currentTeachingWeek) >= 1, "currentTeachingWeek should exist");
  assert(Number(context.todayWeekday) >= 1, "todayWeekday should exist");
  assert.strictEqual(context.termStartDate, "2026-03-09");
  assert.strictEqual(context.totalWeeks, 19);

  const text = JSON.stringify(context);
  assert(!/studentId|password|fileBase64|base64,A{20}/i.test(text), "context must not contain sensitive fields or raw file content");
  assert(/weeks|weekText|weeksText|rawWeeks|weekRange|weekParity|startWeek|endWeek|weekType/.test(text), "context should retain week fields");

  console.log("test-ai-context-week-fields passed");
}

run();
