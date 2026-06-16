const config = require("../config");

const VALID_MODES = new Set([
  "observe",
  "session",
  "ticket",
  "session-canary",
  "session-enforce",
  "ticket-canary",
  "ticket-enforce",
]);

const MODE_ALIASES = {
  session: "session-enforce",
  ticket: "ticket-enforce",
};

const MODE_DESCRIPTIONS = {
  observe: "观察模式：记录缺失或无效 Session，不拦截请求。",
  "session-canary": "Session 金丝雀：仅用于小流量验证准备，默认不全量拦截。",
  "session-enforce": "Session 强制：动态 API 全量要求有效 X-Fosu-Session。",
  "ticket-canary": "Ticket 金丝雀：动态 API 强制 Session，静态 Release 仅观察票据准备度。",
  "ticket-enforce": "Ticket 强制：动态 API 强制 Session，静态 Release 强制 Ticket。",
};

function boolEnv(name) {
  return String(process.env[name] || "").toLowerCase() === "true";
}

function normalizeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (!VALID_MODES.has(mode)) return "observe";
  return MODE_ALIASES[mode] || mode;
}

function hasValue(value) {
  return Boolean(String(value || "").trim());
}

function hasSessionSecret() {
  return hasValue(process.env.FOSU_SESSION_SECRET_CURRENT) ||
    hasValue(process.env.FOSU_SESSION_SECRET);
}

function hasStaticTicketSecret() {
  return hasValue(process.env.FOSU_STATIC_TICKET_SECRET_CURRENT) ||
    hasValue(process.env.FOSU_STATIC_TICKET_SECRET);
}

function getStaticAccessMode(mode) {
  const raw = String(process.env.FOSU_STATIC_ACCESS_MODE || "").trim().toLowerCase();
  if (raw === "ticket" || mode === "ticket-enforce") return "ticket";
  if (raw === "observe" || mode === "observe" || mode === "ticket-canary") return "observe";
  return "public";
}

function maskValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 4)}***${text.slice(-2)}`;
}

function getSecurityMode() {
  const mode = normalizeMode(process.env.FOSU_SECURITY_MODE || (boolEnv("FOSU_DYNAMIC_API_SESSION_REQUIRED") ? "session" : "observe"));
  const staticAccessMode = getStaticAccessMode(mode);
  const warnings = [];

  const requireDynamicSession = mode === "session-enforce" ||
    mode === "ticket-canary" ||
    mode === "ticket-enforce" ||
    boolEnv("FOSU_DYNAMIC_API_SESSION_REQUIRED");
  const requireStaticTicket = mode === "ticket-enforce" || staticAccessMode === "ticket";
  const canarySession = mode === "session-canary";
  const canaryTicket = mode === "ticket-canary";
  const observeOnly = mode === "observe";

  if (!process.env.FOSU_SECURITY_MODE) {
    warnings.push("FOSU_SECURITY_MODE is not set; using observe compatibility mode.");
  }
  if (config.ADMIN_API_TOKEN_LEGACY_DERIVED) {
    warnings.push("ADMIN_API_TOKEN is derived from ADMIN_PASSWORD for legacy compatibility; configure an explicit ADMIN_API_TOKEN for production publisher sync.");
  }
  if (config.NODE_ENV === "production" && requireDynamicSession && !hasSessionSecret()) {
    warnings.push("FOSU_SESSION_SECRET_CURRENT or FOSU_SESSION_SECRET is required before enforcing dynamic API sessions.");
  }
  if (config.NODE_ENV === "production" && requireStaticTicket && !hasStaticTicketSecret()) {
    warnings.push("FOSU_STATIC_TICKET_SECRET_CURRENT or FOSU_STATIC_TICKET_SECRET is required before enforcing static tickets.");
  }
  if (requireStaticTicket && String(process.env.FOSU_OPENRESTY_STATIC_SECURITY_MODE || "").toLowerCase() !== "ticket") {
    warnings.push("FOSU_OPENRESTY_STATIC_SECURITY_MODE=ticket is required before enforcing static ticket mode.");
  }
  if (config.NODE_ENV === "production" && !hasValue(process.env.WECHAT_APPID || process.env.WX_APPID)) {
    warnings.push("WECHAT_APPID is not configured; session bootstrap will fail in production.");
  }
  if (config.NODE_ENV === "production" && !hasValue(process.env.WECHAT_APPSECRET || process.env.WX_APPSECRET)) {
    warnings.push("WECHAT_APPSECRET is not configured; session bootstrap will fail in production.");
  }

  const blockingWarnings = warnings.filter((warning) => {
    if (mode === "observe") return false;
    return /required before enforcing|is required before enforcing|bootstrap will fail/.test(warning);
  });

  return {
    mode,
    rolloutStage: mode,
    legacyMode: mode.indexOf("ticket") === 0 ? "ticket" : (mode.indexOf("session") === 0 ? "session" : "observe"),
    modeDescription: MODE_DESCRIPTIONS[mode] || MODE_DESCRIPTIONS.observe,
    staticAccessMode,
    observeOnly,
    canarySession,
    canaryTicket,
    requireDynamicSession,
    requireStaticTicket,
    dynamicApiMode: requireDynamicSession ? "session" : (canarySession ? "session-canary" : "observe"),
    staticReleaseMode: requireStaticTicket ? "ticket" : (canaryTicket ? "ticket-canary" : staticAccessMode),
    configurationValid: blockingWarnings.length === 0,
    warnings,
  };
}

function getSecurityStatus() {
  const mode = getSecurityMode();
  return Object.assign({}, mode, {
    nodeEnv: config.NODE_ENV,
    wechatAppidConfigured: hasValue(process.env.WECHAT_APPID || process.env.WX_APPID),
    wechatAppidMasked: maskValue(process.env.WECHAT_APPID || process.env.WX_APPID),
    wechatSecretConfigured: hasValue(process.env.WECHAT_APPSECRET || process.env.WX_APPSECRET),
    sessionSecretConfigured: hasSessionSecret(),
    sessionPreviousSecretConfigured: hasValue(process.env.FOSU_SESSION_SECRET_PREVIOUS),
    sessionSecretKid: String(process.env.FOSU_SESSION_SECRET_KID || "current").trim() || "current",
    staticTicketSecretConfigured: hasStaticTicketSecret(),
    staticTicketPreviousSecretConfigured: hasValue(process.env.FOSU_STATIC_TICKET_SECRET_PREVIOUS),
    staticTicketSecretKid: String(process.env.FOSU_STATIC_TICKET_SECRET_KID || "current").trim() || "current",
    openRestySecurityMode: String(process.env.FOSU_OPENRESTY_STATIC_SECURITY_MODE || mode.staticAccessMode || "public").trim(),
  });
}

function assertSecurityConfiguration() {
  const status = getSecurityMode();
  if (!status.configurationValid && status.mode !== "observe") {
    const error = new Error(status.warnings.join("; "));
    error.code = "FOSU_SECURITY_CONFIG_INVALID";
    error.statusCode = 503;
    throw error;
  }
  return status;
}

module.exports = {
  assertSecurityConfiguration,
  getSecurityMode,
  getSecurityStatus,
  hasSessionSecret,
  hasStaticTicketSecret,
  maskValue,
};
