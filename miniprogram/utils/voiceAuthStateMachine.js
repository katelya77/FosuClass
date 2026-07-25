/**
 * Voice / record authorization state machine for 小佛助手.
 * Outputs explicit reasonCode for every failure path.
 *
 * reasonCodes:
 *   PRIVACY_NOT_ACCEPTED
 *   WECHAT_RECORD_UNDECIDED
 *   WECHAT_RECORD_DENIED
 *   SYSTEM_MIC_DENIED
 *   API_UNAVAILABLE
 *   RECORDER_START_FAILED
 *   ASR_NOT_ENABLED
 *   ASR_FAILED
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

const REASON = Object.freeze({
  PRIVACY_NOT_ACCEPTED: "PRIVACY_NOT_ACCEPTED",
  WECHAT_RECORD_UNDECIDED: "WECHAT_RECORD_UNDECIDED",
  WECHAT_RECORD_DENIED: "WECHAT_RECORD_DENIED",
  SYSTEM_MIC_DENIED: "SYSTEM_MIC_DENIED",
  API_UNAVAILABLE: "API_UNAVAILABLE",
  RECORDER_START_FAILED: "RECORDER_START_FAILED",
  ASR_NOT_ENABLED: "ASR_NOT_ENABLED",
  ASR_FAILED: "ASR_FAILED",
});

const USER_MESSAGES = Object.freeze({
  PRIVACY_NOT_ACCEPTED: "需要先同意隐私保护指引才能使用语音输入",
  WECHAT_RECORD_UNDECIDED: "尚未授予麦克风权限，请再次点击授权",
  WECHAT_RECORD_DENIED: "麦克风权限已被拒绝，可在设置中开启",
  SYSTEM_MIC_DENIED: "系统麦克风不可用或已被禁止",
  API_UNAVAILABLE: "当前环境不支持录音",
  RECORDER_START_FAILED: "无法启动录音，请重试",
  ASR_NOT_ENABLED: "语音识别未开通",
  ASR_FAILED: "识别失败，可继续文字输入",
});

function createInitialState() {
  return {
    phase: STATES.UNKNOWN,
    privacyAuthorized: null,
    recordAuthorized: null,
    lastError: "",
    reasonCode: "",
    resumeAfterSetting: false,
    canRetryAuthorize: false,
    openSettingSuggested: false,
  };
}

function getWx(host) {
  if (host && host.wx) return host.wx;
  return typeof wx !== "undefined" ? wx : null;
}

function canUse(wxLike, method) {
  return Boolean(wxLike && typeof wxLike[method] === "function");
}

function failResult(next, reasonCode, extra = {}) {
  next.phase = STATES.ERROR;
  next.reasonCode = reasonCode;
  next.lastError = USER_MESSAGES[reasonCode] || reasonCode;
  next.canRetryAuthorize = reasonCode === REASON.WECHAT_RECORD_UNDECIDED;
  next.openSettingSuggested = reasonCode === REASON.WECHAT_RECORD_DENIED
    || reasonCode === REASON.SYSTEM_MIC_DENIED;
  return Object.assign({
    ok: false,
    state: next,
    reasonCode,
    openSettingSuggested: next.openSettingSuggested,
    canRetryAuthorize: next.canRetryAuthorize,
    shouldResume: false,
    userMessage: next.lastError,
  }, extra);
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
      resolve({ decided: false, authorized: false, apiUnavailable: true });
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
      fail: () => resolve({ decided: false, authorized: false, apiUnavailable: true }),
    });
  });
}

function authorizeRecord(wxLike) {
  return new Promise((resolve) => {
    if (!canUse(wxLike, "authorize")) {
      resolve({ ok: false, apiUnavailable: true });
      return;
    }
    wxLike.authorize({
      scope: "scope.record",
      success: () => resolve({ ok: true }),
      fail: (err) => {
        const msg = String((err && (err.errMsg || err.message)) || "").toLowerCase();
        // System-level deny sometimes surfaces in authorize fail after user decided.
        const systemDenied = /system|authorize:fail|auth deny|permission/.test(msg)
          && /system|denied permanently|no permission/.test(msg);
        resolve({ ok: false, systemDenied, errMsg: err && err.errMsg });
      },
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
 * First undecided authorize fail → WECHAT_RECORD_UNDECIDED (can retry authorize, no openSetting).
 * Explicit deny → WECHAT_RECORD_DENIED (suggest openSetting).
 *
 * @returns {Promise<{ok:boolean, state:object, reasonCode?:string, openSettingSuggested:boolean, canRetryAuthorize:boolean, shouldResume:boolean, userMessage?:string}>}
 */
async function ensureVoiceReady(state = createInitialState(), host = {}) {
  const wxLike = getWx(host);
  const next = Object.assign({}, createInitialState(), state || {});
  next.lastError = "";
  next.reasonCode = "";
  next.canRetryAuthorize = false;
  next.openSettingSuggested = false;
  next.phase = STATES.PRIVACY_AUTHORIZATION;

  if (!wxLike) {
    return failResult(next, REASON.API_UNAVAILABLE);
  }
  if (!canUse(wxLike, "getRecorderManager") && host.requireRecorder !== false) {
    // Host may inject getRecorderManager later; only fail if explicitly required and missing.
    if (host.requireRecorder === true) {
      return failResult(next, REASON.API_UNAVAILABLE);
    }
  }

  const privacy = await getPrivacySetting(wxLike);
  if (privacy && privacy.needAuthorization) {
    const ok = await requirePrivacyAuthorize(wxLike);
    next.privacyAuthorized = ok;
    if (!ok) {
      return failResult(next, REASON.PRIVACY_NOT_ACCEPTED);
    }
  } else {
    next.privacyAuthorized = true;
  }

  next.phase = STATES.RECORD_AUTHORIZATION;
  let setting = await getRecordAuthSetting(wxLike);

  if (setting.apiUnavailable && !canUse(wxLike, "authorize")) {
    return failResult(next, REASON.API_UNAVAILABLE);
  }

  if (setting.authorized) {
    next.recordAuthorized = true;
    next.phase = STATES.READY;
    return {
      ok: true,
      state: next,
      openSettingSuggested: false,
      canRetryAuthorize: false,
      shouldResume: Boolean(next.resumeAfterSetting),
    };
  }

  if (!setting.decided) {
    // First-time / undecided: call authorize — do NOT openSetting on failure yet.
    const authResult = await authorizeRecord(wxLike);
    if (authResult.ok) {
      next.recordAuthorized = true;
      next.phase = STATES.READY;
      return {
        ok: true,
        state: next,
        openSettingSuggested: false,
        canRetryAuthorize: false,
        shouldResume: false,
      };
    }
    // Re-query after authorize fail
    setting = await getRecordAuthSetting(wxLike);
    if (setting.authorized) {
      next.recordAuthorized = true;
      next.phase = STATES.READY;
      return {
        ok: true,
        state: next,
        openSettingSuggested: false,
        canRetryAuthorize: false,
        shouldResume: false,
      };
    }
    if (!setting.decided) {
      // Soft fail: user can retry authorize via UI button
      next.recordAuthorized = false;
      return failResult(next, REASON.WECHAT_RECORD_UNDECIDED);
    }
  }

  // Decided and denied → only then suggest openSetting
  next.recordAuthorized = false;
  if (setting.apiUnavailable) {
    return failResult(next, REASON.API_UNAVAILABLE);
  }
  return failResult(next, REASON.WECHAT_RECORD_DENIED);
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
    next.reasonCode = "";
    next.lastError = "";
    return {
      ok: true,
      state: next,
      openSettingSuggested: false,
      canRetryAuthorize: false,
      shouldResume: true,
    };
  }
  next.recordAuthorized = false;
  return failResult(next, REASON.WECHAT_RECORD_DENIED, { shouldResume: false });
}

function markRecording(state) {
  return Object.assign({}, state, {
    phase: STATES.RECORDING,
    lastError: "",
    reasonCode: "",
  });
}

function markTranscribing(state) {
  return Object.assign({}, state, {
    phase: STATES.TRANSCRIBING,
    lastError: "",
    reasonCode: "",
  });
}

function markSuccess(state) {
  return Object.assign({}, state, {
    phase: STATES.SUCCESS,
    lastError: "",
    reasonCode: "",
  });
}

function markError(state, message, reasonCode) {
  const code = reasonCode || REASON.RECORDER_START_FAILED;
  return Object.assign({}, state, {
    phase: STATES.ERROR,
    lastError: String(message || USER_MESSAGES[code] || "语音失败"),
    reasonCode: code,
    canRetryAuthorize: code === REASON.WECHAT_RECORD_UNDECIDED,
    openSettingSuggested: code === REASON.WECHAT_RECORD_DENIED || code === REASON.SYSTEM_MIC_DENIED,
  });
}

function markAsrError(state, reasonCode = REASON.ASR_FAILED, message) {
  const code = reasonCode === REASON.ASR_NOT_ENABLED ? REASON.ASR_NOT_ENABLED : REASON.ASR_FAILED;
  return markError(state, message || USER_MESSAGES[code], code);
}

function markRecorderStartFailed(state, errMsg) {
  const msg = String(errMsg || "").toLowerCase();
  if (/system|denied|no permission|auth/.test(msg)) {
    return markError(state, USER_MESSAGES.SYSTEM_MIC_DENIED, REASON.SYSTEM_MIC_DENIED);
  }
  return markError(state, USER_MESSAGES.RECORDER_START_FAILED, REASON.RECORDER_START_FAILED);
}

function openSettingAndResume(host = {}) {
  return openRecordSetting(getWx(host));
}

module.exports = {
  STATES,
  REASON,
  USER_MESSAGES,
  createInitialState,
  ensureVoiceReady,
  resumeAfterOpenSetting,
  markRecording,
  markTranscribing,
  markSuccess,
  markError,
  markAsrError,
  markRecorderStartFailed,
  openSettingAndResume,
  getPrivacySetting,
  getRecordAuthSetting,
  authorizeRecord,
};
