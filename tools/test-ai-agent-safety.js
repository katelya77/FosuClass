const assert = require("assert");
const safetyGuard = require("../server/src/services/ai/safetyGuard");

const raw = [
  "password=abc123",
  "学号2024012345",
  "Authorization: Bearer abcdefghijklmnop",
  "token=secret-token-value",
  `data:text/plain;base64,${"a".repeat(180)}`,
].join(" ");

const redacted = safetyGuard.redactSensitiveText(raw);
assert(!redacted.includes("abc123"), "password value must be redacted");
assert(!redacted.includes("2024012345"), "student id must be redacted");
assert(!redacted.includes("abcdefghijklmnop"), "authorization token must be redacted");
assert(!redacted.includes("secret-token-value"), "token value must be redacted");
assert(!redacted.includes("a".repeat(80)), "base64 payload must be redacted");
assert.strictEqual(safetyGuard.hasSensitiveCredential(raw), true, "raw sensitive input must be detected");
assert.strictEqual(safetyGuard.hasSensitiveCredential(redacted), false, "redacted text should not be treated as credential-bearing");

const context = safetyGuard.sanitizeAgentContext({
  term: "2025-2026-2",
  releaseVersion: "release-1",
  password: "abc123",
  currentScheduleSummary: {
    enabled: true,
    targetType: "personal-xls",
    targetName: "张三 2024012345",
    courses: [{
      courseName: "数据结构",
      teacherName: "李老师",
      classroom: "C7-305",
      weekday: 2,
      startSection: 3,
      endSection: 4,
      studentId: "2024012345",
      password: "abc123",
      fileContent: "raw",
    }],
  },
});
const contextText = JSON.stringify(context);
assert(!contextText.includes("abc123"), "sanitized context must remove password");
assert(!contextText.includes("2024012345"), "sanitized context must remove student id");
assert(!contextText.includes("fileContent"), "sanitized context must not include raw file content");
assert(contextText.includes("数据结构"), "sanitized context should preserve course name");
assert(contextText.includes("C7-305"), "sanitized context should preserve classroom");

const logPayload = safetyGuard.buildSafeLogPayload({
  message: raw,
  context,
  provider: "mock",
  toolCalls: [{ name: "search_empty_rooms", status: "success", summary: raw }],
});
const logText = JSON.stringify(logPayload);
assert(!logText.includes("abc123"), "safe log payload must redact password value");
assert(!logText.includes("2024012345"), "safe log payload must redact student id");
assert(!logText.includes("abcdefghijklmnop"), "safe log payload must redact authorization value");
assert(!logText.includes("secret-token-value"), "safe log payload must redact token value");
assert(!logText.includes("password=abc123"), "safe log payload must not include raw prompt");

console.log("test-ai-agent-safety passed");
