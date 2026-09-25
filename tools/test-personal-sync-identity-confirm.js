const assert = require("assert");
const fs = require("fs");
const path = require("path");

const page = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.js"), "utf8");
const wxml = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.wxml"), "utf8");

assert.ok(page.includes("studentImportStage: \"identity-confirm\""));
assert.ok(page.includes("presentIdentityConfirm"));
assert.ok(page.includes("confirmStudentIdentity"));
assert.ok(page.includes("reenterStudentIdentity"));
assert.ok(wxml.includes("确认，是我的课表"));
assert.ok(wxml.includes("重新输入"));
assert.ok(wxml.includes("确认后将继续整理并展示本学期课表。"));
assert.ok(wxml.includes("未读取到"));
assert.ok(wxml.includes("学校页面暂未提供可识别的姓名，请确认学号无误后继续。"));
assert.ok(!wxml.includes("我们还没有读取课表"));
assert.ok(page.includes("PROFILE_NAME_MISSING") || fs.readFileSync(path.join(__dirname, "../server/src/services/fosuDirectPreviewService.js"), "utf8").includes("PROFILE_NAME_MISSING"));
assert.ok(page.includes("\"studentForm.password\": \"\"") || page.includes("password: \"\""));
console.log("personal sync identity confirm ok");
