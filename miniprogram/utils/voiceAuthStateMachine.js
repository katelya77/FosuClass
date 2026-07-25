/**
 * Voice / record authorization state machine for 小佛助手.
 * States: unknown → privacy_authorization → record_authorization → ready
 *       → recording → transcribing → success | error
 * Pure transitions + injectable wx-like host for tests.
 */

const STATES = Object.freeze({
  UNKNOWN: "unknown",
  PRIVACY_AUTHORIZATION: "privacy_authorization",
  RECORD_AUTHORIZATION: "record_authorization",
  READY: "ready",
  RECORDING: "recording",
  TRANSCRIBING: "transcribing",
  SUCCESS: "success",
  ERROR: "error",
});

function createInitialState() {
  return {
    phase: STATES.UNKNOWN,
    privacyAuthorized: null,
    recordAuthorized: null,
    lastError: "",
    resumeAfterSetting: false,
  };
}

function getWx(host) {
  if (host && host.wx) return host.wx;
  return typeof wx !== "undefined" ? wx : null;
}

function canUse(wxLike, method) {
  return Boolean(wxLike && typeof wxLike[method] === "function");
}

function getPrivacySetting(wxLike) {
  return new Promise((resolve) => {
    if (!canUse(wxLike, "getPrivacySetting")) {
      resolve({ needAuthorization: false, privacyContractName: "" });
      return;
    }
    wxLike.getPrivacySetting({
      success: (res) => resolve(res || { needAuthorization: false }),
      fail: () => resolve({ needAuthorization: false }),
    });
  });
}

function requirePrivacyAuthorize(wxLike) {
  return new Promise((resolve) => {
    if (!canUse(wxLike, "requirePrivacyAuthorize")) {
      resolve(true);
      return;
    }
    wxLike.requirePrivacyAuthorize({
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });
}

function getRecordAuthSetting(wxLike) {
  return new Promise((resolve) => {
    if (!canUse(wxLike, "getSetting")) {
      resolve({ decided: false, authorized: false });
      return;
    }
    wxLike.getSetting({
      success: (res) => {
        const auth = res && res.authSetting ? res.authSetting : {};
        if (!Object.prototype.hasOwnProperty.call(auth, "scope.record")) {
          resolve({ decided: false, authorized: false });
          return;
        }
        resolve({ decided: true, authorized: auth["scope.record"] === true });
      },
      fail: () => resolve({ decided: false, authorized: false }),
    });
  });
}

function authorizeRecord(wxLike) {
  return new Promise((resolve) => {
    if (!canUse(wxLike, "authorize")) {
      resolve(false);
      return;
    }
    wxLike.authorize({
      scope: "scope.record",
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });
}

function openRecordSetting(wxLike) {
  return new Promise((resolve) => {
    if (!canUse(wxLike, "openSetting")) {
      resolve(false);
      return;
    }
    wxLike.openSetting({
      success: (res) => {
        const auth = res && res.authSetting ? res.authSetting : {};
        resolve(auth["scope.record"] === true);
      },
      fail: () => resolve(false),
    });
  });
}

/**
 * Ensure privacy + record permission before recording.
 * Does NOT open settings on first deny of undecided authorize — only after real rejection.
 *
 * @returns {Promise<{ok:boolean, state:object, openSettingSuggested:boolean, shouldResume:boolean}>}
 */
async function ensureVoiceReady(state = createInitialState(), host = {}) {
  const wxLike = getWx(host);
  const next = Object.assign({}, createInitialState(), state || {});
  next.lastError = "";
  next.phase = STATES.PRIVACY_AUTHORIZATION;

  const privacy = await getPrivacySetting(wxLike);
  if (privacy && privacy.needAuthorization) {
    const ok = await requirePrivacyAuthorize(wxLike);
    next.privacyAuthorized = ok;
    if (!ok) {
      next.phase = STATES.ERROR;
      next.lastError = "需要先同意隐私保护指引才能使用语音输入";
      return { ok: false, state: next, openSettingSuggested: false, shouldResume: false };
    }
  } else {
    next.privacyAuthorized = true;
  }

  next.phase = STATES.RECORD_AUTHORIZATION;
  let setting = await getRecordAuthSetting(wxLike);

  if (setting.authorized) {
    next.recordAuthorized = true;
    next.phase = STATES.READY;
    return { ok: true, state: next, openSettingSuggested: false, shouldResume: Boolean(next.resumeAfterSetting) };
  }

  if (!setting.decided) {
    // First-time: call authorize — do NOT openSetting on failure yet.
    const granted = await authorizeRecord(wxLike);
    if (granted) {
      next.recordAuthorized = true;
      next.phase = STATES.READY;
      return { ok: true, state: next, openSettingSuggested: false, shouldResume: false };
    }
    // Re-query: if still undecided, treat as soft fail without forcing settings.
    setting = await getRecordAuthSetting(wxLike);
    if (setting.authorized) {
      next.recordAuthorized = true;
      next.phase = STATES.READY;
      return { ok: true, state: next, openSettingSuggested: false, shouldResume: false };
    }
    if (!setting.decided) {
      next.recordAuthorized = false;
      next.phase = STATES.ERROR;
      next.lastError = "未获得麦克风权限";
      return { ok: false, state: next, openSettingSuggested: false, shouldResume: false };
    }
  }

  // Decided and denied → only then suggest openSetting
  next.recordAuthorized = false;
  next.phase = STATES.ERROR;
  next.lastError = "麦克风权限已被拒绝，可在设置中开启";
  return { ok: false, state: next, openSettingSuggested: true, shouldResume: false };
}

/**
 * After user confirms openSetting and returns.
 */
async function resumeAfterOpenSetting(state = createInitialState(), host = {}) {
  const wxLike = getWx(host);
  const next = Object.assign({}, createInitialState(), state || {}, { resumeAfterSetting: true });
  const setting = await getRecordAuthSetting(wxLike);
  if (setting.authorized) {
    next.recordAuthorized = true;
    next.privacyAuthorized = true;
    next.phase = STATES.READY;
    next.resumeAfterSetting = true;
    return { ok: true, state: next, openSettingSuggested: false, shouldResume: true };
  }
  next.recordAuthorized = false;
  next.phase = STATES.ERROR;
  next.lastError = "仍未开启麦克风权限";
  return { ok: false, state: next, openSettingSuggested: true, shouldResume: false };
}

function markRecording(state) {
  return Object.assign({}, state, { phase: STATES.RECORDING, lastError: "" });
}

function markTranscribing(state) {
  return Object.assign({}, state, { phase: STATES.TRANSCRIBING, lastError: "" });
}

function markSuccess(state) {
  return Object.assign({}, state, { phase: STATES.SUCCESS, lastError: "" });
}

function markError(state, message) {
  return Object.assign({}, state, { phase: STATES.ERROR, lastError: String(message || "语音失败") });
}

function openSettingAndResume(host = {}) {
  return openRecordSetting(getWx(host));
}

module.exports = {
  STATES,
  createInitialState,
  ensureVoiceReady,
  resumeAfterOpenSetting,
  markRecording,
  markTranscribing,
  markSuccess,
  markError,
  openSettingAndResume,
  getPrivacySetting,
  getRecordAuthSetting,
  authorizeRecord,
};
