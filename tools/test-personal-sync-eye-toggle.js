const assert = require("assert");
const input = require("../miniprogram/services/personalSyncPasswordInput");

const entry = input.createPasswordEntry();
input.onPasswordInput(entry, { value: "hidden-secret", cursor: 13 });
const hidden = {
  passwordVisible: false,
  passwordFieldAlive: true,
  passwordManualEdit: true,
};
const show = input.onEyeToggle(entry, hidden);
assert.strictEqual(show.passwordVisible, true);
assert.strictEqual(show.passwordInputFocus, true);
assert.strictEqual(entry.pendingPassword, "hidden-secret");
assert.strictEqual(input.inputBindings(Object.assign({}, hidden, show)).alive, true);
assert.strictEqual(input.inputBindings(Object.assign({}, hidden, show)).node, "password-input");
assert.strictEqual(input.onPasswordBlur(entry), null);
input.releaseEyeHold(entry);
const hide = input.onEyeToggle(entry, Object.assign({}, hidden, show));
assert.strictEqual(hide.passwordVisible, false);
assert.strictEqual(hide.passwordInputFocus, true);
assert.strictEqual(entry.pendingPassword, "hidden-secret");
const more = input.onPasswordInput(entry, { value: "hidden-secretX", cursor: 14 });
assert.strictEqual(more.setData, null);
assert.strictEqual(entry.pendingPassword, "hidden-secretX");

console.log("personal-sync-eye-toggle PASS");
