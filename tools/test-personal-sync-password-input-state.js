const assert = require("assert");
const fs = require("fs");
const path = require("path");
const input = require("../miniprogram/services/personalSyncPasswordInput");

const page = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.js"), "utf8");
const wxml = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.wxml"), "utf8");
const field = wxml.slice(wxml.indexOf('class="password-field"'), wxml.indexOf('class="saved-account"'));
assert.strictEqual((field.match(/<input\b/g) || []).length, 1);
assert.ok(!field.includes("wx:else"));
assert.ok(!field.includes("passwordFieldEpoch"));
assert.ok(field.includes('placeholder="{{passwordPlaceholder}}"'));
assert.ok(field.includes('hold-keyboard="{{true}}"'));
assert.ok(!wxml.includes("passwordTyped"));

const handler = page.slice(page.indexOf("onStudentPasswordInput(event)"), page.indexOf("onStudentPasswordBlur("));
assert.ok(handler.includes("pendingPassword"));
assert.ok(!handler.includes("setData"));
assert.ok(!page.includes("this.data.studentForm.password ="));
assert.ok(!page.includes('password: event.detail.value'));

function savedHidden() {
  return {
    hasSavedPassword: true,
    passwordVisible: false,
    passwordManualEdit: false,
    passwordInputFocus: false,
    passwordFieldAlive: true,
    syncErrorTitle: "",
    syncErrorContent: "",
    studentForm: { studentId: "202500000303", password: "", privacyConfirmed: false },
  };
}

const entry = input.createPasswordEntry();
const before = input.inputBindings(savedHidden());
const focus = input.onPasswordFocus(savedHidden());
assert.strictEqual(focus.passwordManualEdit, true);
assert.strictEqual(focus.passwordInputFocus, true);
assert.ok(!Object.prototype.hasOwnProperty.call(focus, "password"));
const focused = Object.assign(savedHidden(), focus);
const typed = input.onPasswordInput(entry, { value: "a", cursor: 1 });
assert.strictEqual(typed.setData, null);
assert.strictEqual(typed.pendingPassword, "a");
assert.deepStrictEqual(input.inputBindings(focused), before);
for (let index = 0; index < 9; index += 1) {
  const next = input.onPasswordInput(entry, { value: "a".repeat(index + 2), cursor: index + 2 });
  assert.strictEqual(next.setData, null);
}
assert.strictEqual(entry.pendingPassword.length, 10);
assert.deepStrictEqual(input.inputBindings(focused), before);
assert.ok(!JSON.stringify(focused).includes(entry.pendingPassword));

const fresh = input.createPasswordEntry();
const blank = {
  hasSavedPassword: false,
  passwordVisible: false,
  passwordManualEdit: false,
  passwordInputFocus: false,
  passwordFieldAlive: true,
  syncErrorTitle: "",
  syncErrorContent: "",
};
const blankBefore = input.inputBindings(blank);
input.onPasswordInput(fresh, { value: "first-char", cursor: 10 });
assert.deepStrictEqual(input.inputBindings(blank), blankBefore);

console.log("personal-sync-password-input-state PASS");
