const axios = require("axios");
const { defaultWechatRecipientVault } = require("./wechatRecipientVault");

const DEFAULT_FIELD_MAP = Object.freeze({
  courseName: "thing8",
  startTime: "time15",
  duration: "thing2",
  teacherName: "thing14",
  classroom: "thing4",
});

function mapWechatSendError(payload = {}) {
  const code = Number(payload.errcode || 0);
  if (code === 0) return { success: true, code: "OK", retryable: false };
  if (code === 43101) return { success: false, code: "WECHAT_SUBSCRIPTION_NOT_AUTHORIZED", retryable: false };
  if (code === 40037) return { success: false, code: "WECHAT_TEMPLATE_INVALID", retryable: false };
  if (code === 40003) return { success: false, code: "WECHAT_RECIPIENT_INVALID", retryable: false };
  if (code === 45009) return { success: false, code: "WECHAT_RATE_LIMITED", retryable: true };
  if (code === -1) return { success: false, code: "WECHAT_SYSTEM_BUSY", retryable: true };
  return { success: false, code: "WECHAT_SEND_REJECTED", retryable: false };
}

function loadFieldMap(value) {
  let source = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch (_) {
      source = {};
    }
  }
  source = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const output = {};
  Object.keys(DEFAULT_FIELD_MAP).forEach((key) => {
    const field = String(source[key] || DEFAULT_FIELD_MAP[key]);
    if (/^[A-Za-z]+\d+$/.test(field)) output[key] = field;
  });
  return output;
}

function truncateValue(value, max) {
  return String(value == null ? "" : value).replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function fieldMax(field) {
  if (/^thing/i.test(field)) return 20;
  if (/^name/i.test(field)) return 10;
  if (/^time/i.test(field)) return 32;
  return 20;
}

function buildTemplateData(occurrence, fieldMap) {
  const source = occurrence && typeof occurrence === "object" ? occurrence : {};
  const location = [source.campus, source.classroom]
    .map((item) => String(item || "").trim())
    .filter((item, index, items) => item && items.indexOf(item) === index)
    .join(" ");
  const durationMinutes = Math.max(0, Number(source.durationMinutes || 0) || 0);
  const durationFallback = durationMinutes
    ? [Math.floor(durationMinutes / 60) ? `${Math.floor(durationMinutes / 60)}小时` : "", durationMinutes % 60 ? `${durationMinutes % 60}分钟` : ""].filter(Boolean).join("")
    : "";
  const logical = {
    courseName: source.courseName || "课程提醒",
    startTime: [source.date, source.startTime].filter(Boolean).join(" "),
    duration: source.durationText || durationFallback || "以课表为准",
    teacherName: source.teacherName || "教师待定",
    classroom: location || "地点待定",
  };
  const output = {};
  Object.keys(fieldMap).forEach((key) => {
    const field = fieldMap[key];
    output[field] = { value: truncateValue(logical[key], fieldMax(field)) };
  });
  return output;
}

class WechatSubscriptionService {
  constructor(options = {}) {
    this.appid = String(options.appid || process.env.WECHAT_APPID || process.env.WX_APPID || "");
    this.appSecret = String(options.appSecret || process.env.WECHAT_APPSECRET || process.env.WX_APPSECRET || "");
    this.templateId = String(options.templateId || process.env.WECHAT_COURSE_REMINDER_TEMPLATE_ID || "");
    this.fieldMap = loadFieldMap(options.fieldMap || process.env.WECHAT_COURSE_REMINDER_DATA_FIELDS_JSON || {});
    this.recipientVault = options.recipientVault || defaultWechatRecipientVault;
    this.request = typeof options.request === "function"
      ? options.request
      : (url, body, config) => axios.post(url, body, config);
    this.accessTokenProvider = typeof options.accessTokenProvider === "function"
      ? options.accessTokenProvider
      : () => this.fetchAccessToken();
    this.accessToken = "";
    this.accessTokenExpiresAt = 0;
  }

  getCapability() {
    const configured = Boolean(
      this.templateId
      && this.appid
      && this.appSecret
      && this.recipientVault
      && this.recipientVault.isConfigured()
    );
    return {
      configured,
      templateId: configured ? this.templateId : "",
      deliveryMode: configured ? "wechat_subscription_or_app_only" : "app_only",
      requestMode: "one_time",
      permanentSubscription: false,
      requiresUserTap: true,
      fallback: "app_only",
      reasonCode: configured ? "READY" : "SUBSCRIPTION_TEMPLATE_OR_VAULT_NOT_CONFIGURED",
    };
  }

  async fetchAccessToken() {
    if (this.accessToken && this.accessTokenExpiresAt > Date.now() + 60000) return this.accessToken;
    if (!this.appid || !this.appSecret) {
      const error = new Error("WeChat credentials unavailable");
      error.code = "WECHAT_CREDENTIALS_UNAVAILABLE";
      error.retryable = false;
      throw error;
    }
    const response = await axios.get("https://api.weixin.qq.com/cgi-bin/token", {
      params: { grant_type: "client_credential", appid: this.appid, secret: this.appSecret },
      timeout: Number(process.env.WECHAT_REMINDER_TIMEOUT_MS || 5000) || 5000,
    });
    const data = response && response.data || {};
    if (!data.access_token) {
      const mapped = mapWechatSendError(data);
      const error = new Error("WeChat access token failed");
      error.code = mapped.code;
      error.retryable = mapped.retryable;
      throw error;
    }
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = Date.now() + Math.max(300, Number(data.expires_in || 7200) - 120) * 1000;
    return this.accessToken;
  }

  async sendCourseReminder(input = {}) {
    const capability = this.getCapability();
    if (!capability.configured) {
      return { success: false, code: "WECHAT_SUBSCRIPTION_NOT_CONFIGURED", retryable: false };
    }
    const recipient = this.recipientVault.get({ principalKey: input.principalKey });
    if (!recipient || !recipient.openid) {
      return { success: false, code: "WECHAT_RECIPIENT_UNAVAILABLE", retryable: false };
    }
    const reminder = input.reminder && typeof input.reminder === "object" ? input.reminder : {};
    const occurrence = reminder.nextOccurrence && typeof reminder.nextOccurrence === "object"
      ? reminder.nextOccurrence
      : {};
    try {
      const accessToken = await this.accessTokenProvider();
      const body = {
        touser: recipient.openid,
        template_id: this.templateId,
        page: "pages/today/today",
        miniprogram_state: String(process.env.WECHAT_REMINDER_MINIPROGRAM_STATE || "formal"),
        lang: "zh_CN",
        data: buildTemplateData(occurrence, this.fieldMap),
      };
      const response = await this.request(
        `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(accessToken)}`,
        body,
        { timeout: Number(process.env.WECHAT_REMINDER_TIMEOUT_MS || 5000) || 5000 }
      );
      return mapWechatSendError(response && response.data || {});
    } catch (error) {
      if (error && error.code && /^WECHAT_/.test(error.code)) {
        return { success: false, code: error.code, retryable: error.retryable !== false };
      }
      const timeout = error && (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT");
      return { success: false, code: timeout ? "WECHAT_TIMEOUT" : "WECHAT_NETWORK_ERROR", retryable: true };
    }
  }
}

const defaultWechatSubscriptionService = new WechatSubscriptionService();

module.exports = {
  DEFAULT_FIELD_MAP,
  WechatSubscriptionService,
  buildTemplateData,
  defaultWechatSubscriptionService,
  loadFieldMap,
  mapWechatSendError,
};
