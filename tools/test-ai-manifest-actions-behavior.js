// 第四章行为验证：12 个新收编领域动作的 stableActionCommands 过滤行为
process.env.AI_AGENT_ENABLED = process.env.AI_AGENT_ENABLED || "false";
const assert = require("assert");
const contract = require("../server/src/services/ai/actionCommandContract");
const manifest = require("../server/config/agent-capability-manifest.json");

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log("PASS " + name);
  } catch (e) {
    fail++;
    console.log("FAIL " + name + " :: " + e.message);
  }
}

const confirmReq = { title: "确认操作", summary: "确认执行该操作？", confirmText: "确认", cancelText: "取消" };

const SAMPLES = {
  importStudentSchedule: { term: "2025-2026-2" },
  resyncStudentSchedule: { term: "2025-2026-2" },
  saveCustomCourse: { name: "羽毛球", weekday: 3, startSection: 7, endSection: 8, weeks: [1, 2, 3, 4, 5, 6, 7, 8], room: "体育馆", enabled: true },
  deleteCustomCourse: { courseId: "cc_123" },
  saveStudentArrangement: { arrangementKey: "arr_1", weekday: 2, startSection: 3, endSection: 4, room: "C7-301" },
  clearLocalCache: { scope: "schedule_cache" },
  resetToNewUser: { keepLogin: true },
  submitFeedback: { type: "suggestion", content: "希望支持桌面小组件" },
  refreshBootstrapData: { include: "all" },
  createCourseReminder: { courseName: "动物解剖学", weekday: 1, startSection: 1, leadMinutes: 30, scope: "all" },
  deleteReminder: { reminderId: "rmd_123" },
  clearAgentMemory: { scope: "local" },
};

check("manifest 含 21 个 actions，13 个领域动作契约字段完整", () => {
  assert.strictEqual(Object.keys(manifest.actions).length, 21);
  for (const key of Object.keys(SAMPLES)) {
    const a = manifest.actions[key];
    assert.ok(a, key + " 存在");
    for (const f of ["operation", "safetyLevel", "confirmation", "idempotent", "inputSchema", "clientHandler", "resultSchema", "receiptRequired", "testCases"]) {
      assert.ok(a[f] !== undefined, key + " 缺 " + f);
    }
    assert.ok(Array.isArray(a.testCases) && a.testCases.length >= 2, key + " testCases>=2");
  }
});

for (const [command, input] of Object.entries(SAMPLES)) {
  check(command + " 合法 action 放行", () => {
    const a = manifest.actions[command];
    const action = { command, label: a.displayName, input };
    if (a.confirmation !== "none") action.confirmationRequest = confirmReq;
    const out = contract.stableActionCommands([action], "public");
    assert.strictEqual(out.length, 1, "应放行");
    assert.strictEqual(out[0].command, command);
  });
}

check("confirmation=required 但缺 confirmationRequest 一律过滤", () => {
  for (const [command, input] of Object.entries(SAMPLES)) {
    const a = manifest.actions[command];
    if (a.confirmation === "none") continue;
    const out = contract.stableActionCommands([{ command, label: a.displayName, input }], "public");
    assert.strictEqual(out.length, 0, command + " 应被过滤");
  }
});

check("importStudentSchedule 载荷含凭据字段被拒（凭据不进 Action）", () => {
  const out = contract.stableActionCommands([{
    command: "importStudentSchedule",
    label: "导入",
    input: { term: "2025-2026-2", studentId: "2024001", password: "secret" },
    confirmationRequest: confirmReq,
  }], "public");
  assert.strictEqual(out.length, 0);
});

check("high 级动作（resetToNewUser/clearAgentMemory/importStudentSchedule）confirmation 均为 required", () => {
  for (const k of ["resetToNewUser", "clearAgentMemory", "importStudentSchedule"]) {
    assert.strictEqual(manifest.actions[k].confirmation, "required", k);
    assert.strictEqual(manifest.actions[k].safetyLevel, "high", k);
  }
});

check("refreshBootstrapData 无需确认即可放行", () => {
  const out = contract.stableActionCommands([{ command: "refreshBootstrapData", label: "刷新", input: {} }], "public");
  assert.strictEqual(out.length, 1);
});

check("枚举值非法被拒（clearLocalCache scope=disk）", () => {
  const out = contract.stableActionCommands([{
    command: "clearLocalCache",
    label: "清理",
    input: { scope: "disk" },
    confirmationRequest: confirmReq,
  }], "public");
  assert.strictEqual(out.length, 0);
});

console.log("---");
console.log("pass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
