const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { normalizeImportSurface, hasPrimarySyncBody } = require("../miniprogram/services/personalSyncSurface");

const page = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.js"), "utf8");
const wxml = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.wxml"), "utf8");

assert.ok(page.includes("returnToAccountForm"));
assert.ok(page.includes("resyncStudentImport()"));
assert.ok(wxml.includes("activeImportMethod == 'method'"));
assert.ok(wxml.includes("同步最新课表"));
assert.ok(!/activeImportMethod:\s*"student"[\s\S]{0,80}studentImportStage:\s*"form"/.test(page));

const blank = normalizeImportSurface("student", "form");
assert.strictEqual(blank.activeImportMethod, "method");
assert.strictEqual(blank.studentImportStage, "form");
assert.strictEqual(hasPrimarySyncBody({ activeImportMethod: "student", studentImportStage: "form" }), false);
assert.strictEqual(hasPrimarySyncBody(blank), true);
assert.strictEqual(normalizeImportSurface("student", "identity-confirm").activeImportMethod, "student");
assert.strictEqual(normalizeImportSurface("student", "loading").studentImportStage, "loading");
console.log("personal sync resync state ok");
