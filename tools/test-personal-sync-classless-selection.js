const assert = require("assert");
const { buildScheduleImportPreview } = require("../server/src/services/scheduleImportNormalizer");

function row(className, courseName) {
  return {
    courseName,
    weekText: "1-16",
    weekdayText: "星期一",
    sectionText: "1-2",
    roomName: "C3-101",
    className,
  };
}

const preview = buildScheduleImportPreview([
  row("25动物医学6班", "动物解剖学"),
  row("25动物科学3班", "农业生态学"),
], {
  semester: "2026-2027-1",
  scheduleOwnership: "personal",
  reliableClassScope: false,
});

assert.strictEqual(preview.profile.className, "");
assert.strictEqual(preview.uiHints.classNameWarningText, "");
const decisions = preview.allArrangements.map((item) => item.importDecision);
assert.ok(!decisions.includes("suspected_not_mine"));
assert.ok(decisions.includes("auto_include"));
console.log("personal sync classless selection ok");
