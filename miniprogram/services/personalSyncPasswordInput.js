const PASSWORD_PLACEHOLDER = "学校账号密码";

function createPasswordEntry() {
  return {
    pendingPassword: "",
    cursor: 0,
    eyeHold: false,
  };
}

function inputBindings(data) {
  return {
    alive: data.passwordFieldAlive !== false,
    password: !data.passwordVisible,
    placeholder: PASSWORD_PLACEHOLDER,
    node: "password-input",
  };
}

function onPasswordFocus(data) {
  const patch = {};
  if (!data.passwordManualEdit) patch.passwordManualEdit = true;
  if (!data.passwordInputFocus) patch.passwordInputFocus = true;
  if (data.syncErrorTitle || data.syncErrorContent) {
    patch.syncErrorTitle = "";
    patch.syncErrorContent = "";
  }
  return patch;
}

function onPasswordInput(entry, detail) {
  const value = detail && detail.value != null ? String(detail.value) : "";
  entry.pendingPassword = value;
  const cursor = Number(detail && detail.cursor);
  entry.cursor = Number.isFinite(cursor) ? cursor : value.length;
  return {
    setData: null,
    pendingPassword: entry.pendingPassword,
  };
}

function onPasswordBlur(entry) {
  if (entry.eyeHold) return null;
  return { passwordInputFocus: false };
}

function onEyeToggle(entry, data) {
  entry.eyeHold = true;
  return {
    passwordVisible: !data.passwordVisible,
    passwordInputFocus: true,
  };
}

function releaseEyeHold(entry) {
  entry.eyeHold = false;
}

function resetPasswordEntry(entry) {
  entry.pendingPassword = "";
  entry.cursor = 0;
  entry.eyeHold = false;
  return {
    passwordManualEdit: false,
    passwordVisible: false,
    passwordInputFocus: false,
    passwordFieldAlive: false,
    "studentForm.password": "",
  };
}

module.exports = {
  PASSWORD_PLACEHOLDER,
  createPasswordEntry,
  inputBindings,
  onPasswordFocus,
  onPasswordInput,
  onPasswordBlur,
  onEyeToggle,
  releaseEyeHold,
  resetPasswordEntry,
};
