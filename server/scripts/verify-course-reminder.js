#!/usr/bin/env node
const assert = require("assert");
const {
  DEFAULT_FIELD_MAP,
  buildTemplateData,
  defaultWechatSubscriptionService,
} = require("../src/services/ai/reminders/wechatSubscriptionService");

const EXPECTED_FIELD_MAP = Object.freeze({
  courseName: "thing12",
  teacherName: "thing17",
  classroom: "thing3",
  startTime: "time19",
  endTime: "time20",
});

function mapsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function verifyCourseReminder(options = {}) {
  const service = options.service || defaultWechatSubscriptionService;
  const env = options.env || process.env;
  const capability = service.getCapability();
  const sampleData = buildTemplateData({
    courseName: "课程提醒验收",
    teacherName: "测试教师",
    campus: "仙溪校区",
    classroom: "C7-307",
    date: "2026-09-07",
    startTime: "13:30",
    endTime: "14:45",
  }, service.fieldMap);
  const expectedSampleFields = Object.values(EXPECTED_FIELD_MAP);
  const sampleFields = Object.keys(sampleData);
  const expectedSampleData = {
    thing12: { value: "课程提醒验收" },
    thing17: { value: "测试教师" },
    thing3: { value: "仙溪校区 C7-307" },
    time19: { value: "2026年9月7日 13:30" },
    time20: { value: "2026年9月7日 14:45" },
  };
  const status = {
    success: false,
    configured: capability.configured === true,
    requestMode: capability.requestMode,
    permanentSubscription: capability.permanentSubscription === true,
    dispatchEnabled: String(env.FOSU_COURSE_REMINDER_DISPATCH_ENABLED || "false").toLowerCase() === "true",
    miniprogramState: String(env.WECHAT_REMINDER_MINIPROGRAM_STATE || "formal"),
    fieldMapValid: mapsEqual(service.fieldMap, EXPECTED_FIELD_MAP)
      && mapsEqual(DEFAULT_FIELD_MAP, EXPECTED_FIELD_MAP),
    sampleDataValid: mapsEqual(sampleFields, expectedSampleFields)
      && mapsEqual(sampleData, expectedSampleData),
    accessTokenReachable: null,
  };

  if (options.probeToken) {
    await service.fetchAccessToken();
    status.accessTokenReachable = true;
  }

  status.success = status.configured
    && status.requestMode === "one_time"
    && status.permanentSubscription === false
    && status.dispatchEnabled
    && status.miniprogramState === "formal"
    && status.fieldMapValid
    && status.sampleDataValid
    && (!options.probeToken || status.accessTokenReachable === true);

  if (options.requireReady) {
    assert.strictEqual(status.success, true, `course reminder is not production-ready: ${JSON.stringify(status)}`);
  }
  return status;
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  verifyCourseReminder({
    requireReady: args.has("--require-ready"),
    probeToken: args.has("--probe-token"),
  }).then((status) => {
    console.log(JSON.stringify(status));
  }).catch((error) => {
    console.error(JSON.stringify({
      success: false,
      code: String(error && error.code || "COURSE_REMINDER_VERIFY_FAILED").slice(0, 80),
    }));
    process.exit(1);
  });
}

module.exports = { EXPECTED_FIELD_MAP, verifyCourseReminder };
