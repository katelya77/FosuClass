const assert = require("assert");

process.env.AI_MAX_CONTEXT_COURSES = "80";

const safetyGuard = require("../server/src/services/ai/safetyGuard");

function makeCourses(count) {
  return Array.from({ length: count }, (_, index) => ({
    courseName: `课程${index}`,
    teacherName: `教师${index}`,
    classroom: `C${index}`,
    weekday: (index % 7) + 1,
    startSection: 1,
    endSection: 2,
    studentName: "测试姓名",
    studentId: "202612345678",
    password: "secret-value",
  }));
}

function run() {
  process.env.AI_ALLOW_PERSONAL_CONTEXT = "false";
  let context = safetyGuard.sanitizeAgentContext({
    currentScheduleSummary: {
      enabled: true,
      targetType: "personal-xls",
      targetName: "张三的课表",
      courses: makeCourses(3),
    },
  });
  assert.strictEqual(context.currentScheduleSummary.enabled, false);
  assert.strictEqual(context.currentScheduleSummary.targetType, "personal-redacted");
  assert.strictEqual(context.currentScheduleSummary.targetName, "个人课表");
  assert.deepStrictEqual(context.currentScheduleSummary.courses, []);

  process.env.AI_ALLOW_PERSONAL_CONTEXT = "true";
  context = safetyGuard.sanitizeAgentContext({
    currentScheduleSummary: {
      enabled: true,
      targetType: "personal",
      targetName: "李四",
      courses: makeCourses(100),
      studentName: "李四",
      studentId: "202612345678",
      password: "secret-value",
    },
  });
  assert.strictEqual(context.currentScheduleSummary.enabled, true);
  assert.strictEqual(context.currentScheduleSummary.targetName, "个人课表");
  assert.strictEqual(context.currentScheduleSummary.courses.length, 80);
  const serialized = JSON.stringify(context);
  assert(!serialized.includes("202612345678"), "studentId must be redacted");
  assert(!serialized.includes("secret-value"), "password must be redacted");
  assert(!serialized.includes("李四的课表"), "student target name must not be exposed");

  console.log("test-ai-personal-context-gate passed");
}

run();
