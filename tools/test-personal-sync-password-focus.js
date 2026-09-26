const assert = require("assert");
const input = require("../miniprogram/services/personalSyncPasswordInput");

const data = {
  hasSavedPassword: true,
  passwordVisible: false,
  passwordManualEdit: false,
  passwordInputFocus: false,
  passwordFieldAlive: true,
  syncErrorTitle: "学号或密码错误",
  syncErrorContent: "请重试",
};
const patch = input.onPasswordFocus(data);
assert.strictEqual(patch.passwordManualEdit, true);
assert.strictEqual(patch.passwordInputFocus, true);
assert.strictEqual(patch.syncErrorTitle, "");
assert.strictEqual(patch.syncErrorContent, "");
assert.strictEqual(patch.passwordFieldAlive, undefined);
assert.ok(!Object.prototype.hasOwnProperty.call(patch, "password"));

const entry = input.createPasswordEntry();
input.onPasswordInput(entry, { value: "abcde", cursor: 5 });
const again = input.onPasswordFocus(Object.assign({}, data, patch));
assert.deepStrictEqual(again, {});
assert.strictEqual(input.onPasswordInput(entry, { value: "abcdef", cursor: 6 }).setData, null);
assert.strictEqual(entry.pendingPassword, "abcdef");

const blank = input.onPasswordBlur(entry);
assert.deepStrictEqual(blank, { passwordInputFocus: false });
entry.eyeHold = true;
assert.strictEqual(input.onPasswordBlur(entry), null);

console.log("personal-sync-password-focus PASS");
