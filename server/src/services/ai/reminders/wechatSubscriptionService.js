const axios = require("axios");
const { defaultWechatRecipientVault } = require("./wechatRecipientVault");

const DEFAULT_FIELD_MAP = Object.freeze({
  courseName: "thing12",
  teacherName: "thing17",
  classroom: "thing3",
  startTime: "time19",
  endTime: "time20",
});

const REFRESHABLE_ACCESS_TOKEN_CODES = new Set([40014, 42001]);

function mapWechatSendError(payload = {}) {
  const code = Number(payload.errcode || 0);
  if (code === 0) return { success: true, code: "OK", retryable: false };
  if (code === 43101) return { success: false, code: "WECHAT_SUBSCRIPTION_NOT_AUTHORIZED", retryable: false };
  if (code === 40037) return { success: false, code: "WECHAT_TEMPLATE_INVALID", retryable: false };
  if (code === 40003) return { success: false, code: "WECHAT_RECIPIENT_INVALID", retryable: false };
  if (code === 41030) return { success: false, code: "WECHAT_PAGE_INVALID", retryable: false };
  if (code === 47003) return { success: false, code: "WECHAT_TEMPLATE_DATA_INVALID", retryable: false };
  if (REFRESHABLE_ACCESS_TOKEN_CODES.has(code)) {
    return { success: false, code: "WECHAT_ACCESS_TOKEN_EXPIRED", retryable: true };
  }
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

function formatTemplateDateTime(dateValue, timeValue) {
  const rawDate = String(dateValue || "").trim();
  const rawTime = String(timeValue || "").trim();
  const match = rawDate.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const date = match
    ? `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`
    : rawDate;
  return [date, rawTime].filter(Boolean).join(" ");
}

function buildTemplateData(occurrence, fieldMap) {
  const source = occurrence && typeof occurrence === "object" ? occurrence : {};
  const location = [source.campus, source.classroom]
    .map((item) => String(item || "").trim())
    .filter((item, index, items) => item && items.indexOf(item) === index)
    .join(" ");
  const logical = {
    courseName: source.courseName || "课程提醒",
    teacherName: source.teacherName || "教师待定",
    classroom: location || "地点待定",
    startTime: formatTemplateDateTime(source.date, source.startTime),
    endTime: formatTemplateDateTime(source.date, source.endTime || source.startTime),
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
      const body = {
        touser: recipient.openid,
        template_id: this.templateId,
        page: "pages/today/today",
        miniprogram_state: String(process.env.WECHAT_REMINDER_MINIPROGRAM_STATE || "formal"),
        lang: "zh_CN",
        data: buildTemplateData(occurrence, this.fieldMap),
      };
      const send = async (forceRefresh) => {
        if (forceRefresh) {
          this.accessToken = "";
          this.accessTokenExpiresAt = 0;
        }
        const accessToken = await this.accessTokenProvider({ forceRefresh: forceRefresh === true });
        return this.request(
          `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(accessToken)}`,
          body,
          { timeout: Number(process.env.WECHAT_REMINDER_TIMEOUT_MS || 5000) || 5000 }
        );
      };
      let response = await send(false);
      let mapped = mapWechatSendError(response && response.data || {});
      const responseCode = Number(response && response.data && response.data.errcode || 0);
      if (REFRESHABLE_ACCESS_TOKEN_CODES.has(responseCode)) {
        response = await send(true);
        mapped = mapWechatSendError(response && response.data || {});
      }
      return mapped;
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
  REFRESHABLE_ACCESS_TOKEN_CODES,
  WechatSubscriptionService,
  buildTemplateData,
  defaultWechatSubscriptionService,
  formatTemplateDateTime,
  loadFieldMap,
  mapWechatSendError,
};
