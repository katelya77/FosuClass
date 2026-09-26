const assert = require("assert");
const { buildScheduleImportPreview } = require("../server/src/services/scheduleImportNormalizer");

function row(patch) {
  return Object.assign({
    courseName: "动物生物化学",
    weekText: "1-16",
    weekdayText: "星期一",
    sectionText: "1-2",
    roomName: "C3-101",
    className: "",
  }, patch);
}

const preview = buildScheduleImportPreview([
  row({ courseName: "动物生物化学" }),
  row({ courseName: "动物机能学实验技术", weekdayText: "星期二", sectionText: "3-5" }),
  row({ courseName: "形势与政策3", weekdayText: "星期四", sectionText: "11-12", weekText: "10,14", roomName: "C7-120报告厅" }),
  row({ courseName: "大学体育3", weekdayText: "星期五", sectionText: "6-7" }),
  row({ courseName: "劳动教育", weekdayText: "星期三", sectionText: "8-10", weekText: "1-8" }),
  row({ courseName: "在线课程示例", weekdayText: "星期一", sectionText: "1-2", specialNote: "在线课程" }),
  row({ courseName: "另行通知课程", weekText: "", weekdayText: "", sectionText: "", roomName: "" }),
], {
  semester: "2026-2027-1",
  scheduleOwnership: "personal",
  reliableClassScope: false,
});

const byName = new Map(preview.allArrangements.map((item) => [item.courseName, item]));
["动物生物化学", "动物机能学实验技术", "形势与政策3", "大学体育3", "劳动教育", "在线课程示例"].forEach((name) => {
  const item = byName.get(name);
  assert.ok(item, name);
  assert.strictEqual(item.importDecision, "auto_include", name);
  assert.strictEqual(item.selectedByDefault, true, name);
});
assert.notStrictEqual(byName.get("形势与政策3").importDecision, "needs_confirm");
const pending = byName.get("另行通知课程");
assert.strictEqual(pending.importDecision, "unscheduled");
assert.notStrictEqual(pending.importDecision, "needs_confirm");
assert.notStrictEqual(pending.importDecision, "suspected_not_mine");

const classPreview = buildScheduleImportPreview([
  row({ courseName: "形势与政策3", className: "25动物科学3班" }),
], {
  semester: "2026-2027-1",
  existingSelectedClassName: "25动物医学6班",
});
assert.notStrictEqual(classPreview.allArrangements[0].importDecision, "auto_include");
console.log("trusted personal schedule ok");
