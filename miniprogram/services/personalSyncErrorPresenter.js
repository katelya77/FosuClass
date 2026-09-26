const CODE_ALIASES = {
  LOGIN_REJECTED: "INVALID_CREDENTIALS",
  DIRECT_NETWORK_ERROR: "SCHOOL_UNAVAILABLE",
  DIRECT_CLIENT_INTERNAL_ERROR: "DIRECT_CLIENT_INTERNAL_ERROR",
  DIRECT_MODE_UNSUPPORTED: "DIRECT_MODE_UNSUPPORTED",
  INTERACTIVE_CHALLENGE_REQUIRED: "INTERACTIVE_CHALLENGE_REQUIRED",
  CAPTCHA_REQUIRED: "INTERACTIVE_CHALLENGE_REQUIRED",
  RISK_CONTROL_REQUIRED: "INTERACTIVE_CHALLENGE_REQUIRED",
  UNTRUSTED_REDIRECT: "UNTRUSTED_REDIRECT",
  REDIRECT_LOCATION_MISSING: "UNTRUSTED_REDIRECT",
  SCHEDULE_EMPTY: "EMPTY_PERSONAL_SCHEDULE",
  SCHEDULE_ROWS_EMPTY: "EMPTY_PERSONAL_SCHEDULE",
  AUTH_PAGE_CHANGED: "STRUCTURE_CHANGED",
  LOGIN_PAGE_CHANGED: "STRUCTURE_CHANGED",
  SCHEDULE_PAGE_UNREACHABLE: "SCHOOL_UNAVAILABLE",
  REQUEST_TIMEOUT: "TIMEOUT",
  SCHOOL_SYSTEM_TIMEOUT: "TIMEOUT",
  NETWORK_TIMEOUT: "TIMEOUT",
  UPSTREAM_TIMEOUT: "TIMEOUT",
  CAMPUS_AGENT_NOT_AVAILABLE: "AGENT_OFFLINE",
  JOB_ALREADY_ACTIVE: "CAMPUS_SYNC_CONCURRENT_LIMIT",
  FOSU_SESSION_REQUIRED: "SESSION_EXPIRED",
  FOSU_SESSION_EXPIRED: "SESSION_EXPIRED",
  SESSION_INVALID: "SESSION_EXPIRED",
  CAS_SESSION_NOT_ESTABLISHED: "SESSION_EXPIRED",
};

function detailsFrom(error) {
  const payload = error && error.payload && typeof error.payload === "object" ? error.payload : {};
  const quota = payload.quota && typeof payload.quota === "object" ? payload.quota : {};
  return Object.assign({}, quota, payload, error || {});
}

function resolveCode(error) {
  const payload = error && error.payload && typeof error.payload === "object" ? error.payload : {};
  const raw = String(
    (error && (error.code || error.reasonCode))
    || payload.code
    || payload.errorCode
    || payload.reasonCode
    || "UNKNOWN_SYNC_ERROR"
  );
  const generic = raw === "HTTP_4XX" || raw === "HTTP_5XX" || raw === "NETWORK" || raw === "INVALID_PAYLOAD";
  const code = generic ? String(payload.code || payload.errorCode || "UNKNOWN_SYNC_ERROR") : raw;
  return CODE_ALIASES[code] || code || "UNKNOWN_SYNC_ERROR";
}

function formatBeijing(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  const parts = {};
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).forEach((part) => {
    parts[part.type] = part.value;
  });
  return parts.year + "-" + parts.month + "-" + parts.day + " " + parts.hour + ":" + parts.minute;
}

function humanWait(seconds) {
  const value = Math.round(Number(seconds));
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 60) return value + " 秒后";
  return Math.ceil(value / 60) + " 分钟后";
}

function problemId(error) {
  const raw = String(error && (error.requestId || (error.payload && error.payload.requestId)) || "");
  if (/^[a-f0-9]{4,16}$/i.test(raw)) return raw.slice(0, 8).toUpperCase();
  return Math.random().toString(16).slice(2, 6).toUpperCase();
}

function present(code, error) {
  const details = detailsFrom(error);
  if (code === "INVALID_CREDENTIALS") {
    return {
      title: "学号或密码错误",
      content: "学校账号验证未通过，请检查学号和密码后重新尝试。",
      confirmText: "重新输入",
      cancelText: "",
      action: "reenter-password",
    };
  }
  if (code === "CAMPUS_SYNC_DAILY_LIMIT") {
    const limit = Number(details.dailyLimit);
    const reset = formatBeijing(details.resetAt);
    const limitText = Number.isInteger(limit) && limit > 0 ? String(limit) : "";
    const quotaSentence = limitText
      ? "为保护学校系统，个人课表每天最多同步 " + limitText + " 次。"
      : "为保护学校系统，个人课表今天的同步次数已用完。";
    const resetSentence = reset ? "下次可在 " + reset + "（北京时间）后再次同步。" : "明天 00:00 后可再次同步。";
    return {
      title: "今日同步次数已用完",
      content: quotaSentence + resetSentence,
      confirmText: "我知道了",
      cancelText: "",
      action: "acknowledge",
    };
  }
  if (code === "CAMPUS_SYNC_RATE_LIMITED" || code === "IMPORT_RATE_LIMITED") {
    const wait = humanWait(details.retryAfterSeconds || details.retryAfter);
    return {
      title: "操作有些频繁",
      content: wait ? "同步请求过于频繁，请在 " + wait + "再试。" : "同步请求过于频繁，请稍后再试。",
      confirmText: "我知道了",
      cancelText: "",
      action: "acknowledge",
    };
  }
  if (code === "CAMPUS_SYNC_CONCURRENT_LIMIT") {
    return {
      title: "正在同步课表",
      content: "当前已有一次个人课表同步正在进行，请等待本次同步完成。",
      confirmText: "我知道了",
      cancelText: "",
      action: "acknowledge",
    };
  }
  if (code === "CAMPUS_SYNC_BUSY") {
    return {
      title: "当前同步人数较多",
      content: "当前同步任务较多，请稍后再试。",
      confirmText: "我知道了",
      cancelText: "",
      action: "acknowledge",
    };
  }
  if (code === "CAMPUS_SYNC_MAINTENANCE") {
    return {
      title: "同步服务维护中",
      content: "个人课表同步服务正在维护，请稍后再试。已保存的课表仍可正常使用。",
      confirmText: "我知道了",
      cancelText: "",
      action: "acknowledge",
    };
  }
  if (code === "AGENT_OFFLINE") {
    return {
      title: "校内同步节点暂不可用",
      content: "暂时无法连接学校系统，请稍后再试。",
      confirmText: "我知道了",
      cancelText: "",
      action: "acknowledge",
    };
  }
  if (code === "TIMEOUT" || code === "SCHOOL_UNAVAILABLE") {
    return {
      title: "学校系统响应较慢",
      content: "学校系统暂时没有正常响应，请稍后重新同步。",
      confirmText: "我知道了",
      cancelText: "",
      action: "acknowledge",
    };
  }
  if (code === "PROFILE_ID_MISMATCH") {
    return {
      title: "账号身份校验未通过",
      content: "读取到的学校账号身份与当前输入不一致。为保护你的课表数据，本次同步已停止，请重新输入账号。",
      confirmText: "重新输入",
      cancelText: "",
      action: "reenter-password",
    };
  }
  if (code === "STRUCTURE_CHANGED") {
    return {
      title: "暂时无法识别课表",
      content: "学校课表页面可能发生了调整，本次没有修改你的现有课表。请稍后再试。",
      confirmText: "我知道了",
      cancelText: "",
      action: "acknowledge",
    };
  }
  if (code === "EMPTY_PERSONAL_SCHEDULE") {
    return {
      title: "暂未读取到课程",
      content: "学校系统中当前学期暂未读取到可导入的课程。你的现有课表不会被修改。",
      confirmText: "我知道了",
      cancelText: "重新同步",
      action: "empty-schedule",
    };
  }
  if (code === "UNTRUSTED_REDIRECT" || code === "REDIRECT_LOCATION_MISSING") {
    return {
      title: "学校登录流程发生变化",
      content: "暂时无法继续完成身份验证，请稍后重试。",
      confirmText: "我知道了",
      cancelText: "",
      action: "acknowledge",
    };
  }
  if (code === "DIRECT_CLIENT_INTERNAL_ERROR") {
    return {
      title: "同步暂时失败",
      content: "暂时无法读取学校课表，请稍后重试。",
      confirmText: "我知道了",
      cancelText: "",
      action: "acknowledge",
    };
  }
  if (code === "DIRECT_MODE_UNSUPPORTED") {
    return {
      title: "暂时无法直接同步",
      content: "当前微信版本暂不支持直接同步，请更新微信或使用其他导入方式。",
      confirmText: "我知道了",
      cancelText: "",
      action: "acknowledge",
    };
  }
  if (code === "INTERACTIVE_CHALLENGE_REQUIRED" || code === "CAPTCHA_REQUIRED" || code === "RISK_CONTROL_REQUIRED") {
    return {
      title: "暂时无法自动同步",
      content: "学校系统要求额外安全验证，暂时无法自动同步。",
      confirmText: "我知道了",
      cancelText: "",
      action: "acknowledge",
    };
  }
  if (code === "SESSION_EXPIRED") {
    return {
      title: "需要重新进入",
      content: "当前登录状态已失效，请重新进入小程序后再同步。",
      confirmText: "我知道了",
      cancelText: "",
      action: "acknowledge",
    };
  }
  return {
    title: "同步没有完成",
    content: "本次个人课表同步没有完成，请稍后再试。\n问题编号：" + problemId(error),
    confirmText: "我知道了",
    cancelText: "",
    action: "acknowledge",
  };
}

function presentPersonalSyncError(error) {
  const code = resolveCode(error);
  const view = present(code, error);
  return Object.assign({ code: code }, view);
}

module.exports = {
  formatBeijing,
  humanWait,
  presentPersonalSyncError,
  resolveCode,
};
