const assert = require("assert");
const fs = require("fs");
const path = require("path");

const page = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.js"), "utf8");
const source = fs.readFileSync(path.join(__dirname, "../miniprogram/services/studentScheduleSource.js"), "utf8");
const wxml = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.wxml"), "utf8");

assert.ok(page.includes("async runPersonalScheduleSync(form)"));
assert.ok(page.includes("this.runPersonalScheduleSync(form)"));
assert.ok(page.includes("this.runPersonalScheduleSync({"));
assert.ok(page.includes("if (this.data.studentImportLoading) return;"));
assert.ok(page.includes("if (this.data.studentImportLoading || !form || !form.studentId || !form.password) return;"));
assert.ok(page.includes("studentImportStage: \"loading\""));
assert.ok(page.includes("quickResync: true"));
assert.ok(!page.includes("this.returnToAccountForm();\n  },\n\n  presentIdentityConfirm"));
assert.ok(source.includes("obtainFreshWxCode"));
assert.ok(wxml.includes("disabled=\"{{studentImportLoading}}\" bindtap=\"resyncStudentImport\""));
assert.ok(page.includes("readPersonalTimetable"));
console.log("personal sync quick resync ok");
