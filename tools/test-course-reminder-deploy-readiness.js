#!/usr/bin/env node
const assert = require("assert");
const {
  EXPECTED_FIELD_MAP,
  verifyCourseReminder,
} = require("../server/scripts/verify-course-reminder");

function makeService(fieldMap = EXPECTED_FIELD_MAP) {
  return {
    fieldMap,
    getCapability() {
      return {
        configured: true,
        requestMode: "one_time",
        permanentSubscription: false,
      };
    },
    async fetchAccessToken() {
      return "not-logged";
    },
  };
}

async function run() {
  const ready = await verifyCourseReminder({
    service: makeService(),
    env: {
      FOSU_COURSE_REMINDER_DISPATCH_ENABLED: "true",
      WECHAT_REMINDER_MINIPROGRAM_STATE: "formal",
    },
    requireReady: true,
    probeToken: true,
  });
  assert.strictEqual(ready.success, true);
  assert.strictEqual(ready.fieldMapValid, true);
  assert.strictEqual(ready.sampleDataValid, true);
  assert.strictEqual(ready.accessTokenReachable, true);

  const staleMapping = await verifyCourseReminder({
    service: makeService({
      courseName: "thing8",
      teacherName: "thing14",
      classroom: "thing4",
      startTime: "time15",
      endTime: "time20",
    }),
    env: {
      FOSU_COURSE_REMINDER_DISPATCH_ENABLED: "true",
      WECHAT_REMINDER_MINIPROGRAM_STATE: "formal",
    },
  });
  assert.strictEqual(staleMapping.success, false);
  assert.strictEqual(staleMapping.fieldMapValid, false);

  console.log("test-course-reminder-deploy-readiness: PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
