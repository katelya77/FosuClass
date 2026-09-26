const assert = require("assert");
const fs = require("fs");
const path = require("path");
const input = require("../miniprogram/services/personalSyncPasswordInput");

const page = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/personal-sync/personal-sync.js"), "utf8");
const clear = page.slice(page.indexOf("confirmClearSavedCredential("), page.indexOf("togglePageRemarks("));
assert.ok(clear.includes("personalSyncCredentialStore.remove()"));
assert.ok(!clear.includes("setCurrentScheduleTarget"));
assert.ok(!clear.includes("recentStudentImportService.remove"));
assert.ok(clear.includes("已导入的个人课表不会被删除") || page.includes("已导入的个人课表不会被删除"));

const data = {
  hasSavedPassword: true,
  passwordVisible: false,
  passwordManualEdit: false,
  passwordInputFocus: false,
  passwordFieldAlive: true,
  syncErrorTitle: "",
  syncErrorContent: "",
};
const entry = input.createPasswordEntry();
const focus = input.onPasswordFocus(data);
assert.strictEqual(focus.passwordManualEdit, true);
assert.ok(!Object.prototype.hasOwnProperty.call(focus, "hasSavedPassword"));
const typed = input.onPasswordInput(entry, { value: "new-secret", cursor: 10 });
assert.strictEqual(typed.setData, null);
assert.strictEqual(entry.pendingPassword, "new-secret");
assert.strictEqual(input.inputBindings(Object.assign({}, data, focus)).alive, true);
const backspace = input.onPasswordInput(entry, { value: "new-secre", cursor: 9 });
assert.strictEqual(backspace.setData, null);
assert.strictEqual(entry.pendingPassword, "new-secre");
const pasted = input.onPasswordInput(entry, { value: "pasted-value-123", cursor: 16 });
assert.strictEqual(pasted.setData, null);
assert.strictEqual(entry.pendingPassword, "pasted-value-123");

console.log("personal-sync-saved-credential-edit PASS");
