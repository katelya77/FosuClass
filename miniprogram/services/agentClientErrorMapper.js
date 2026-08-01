/**
 * Maps internal Agent / memory error codes to natural Chinese user messages.
 * Never show raw error.message or English codes in toasts.
 */

const CODE_MESSAGES = Object.freeze({
  NETWORK_OFFLINE: "当前设备没有可用网络，请恢复连接后重试",
  DNS_FAILED: "域名解析失败，请稍后重试或打开连接诊断",
  TLS_FAILED: "安全连接建立失败，请打开连接诊断",
  WECHAT_DOMAIN_NOT_ALLOWED: "当前 API 域名未通过微信合法域名校验，请联系管理员配置",
  WECHAT_NETWORK_REQUEST_FAILED: "微信网络层请求失败，请打开连接诊断并复制脱敏报告",
  CONNECT_TIMEOUT: "连接服务器超时，请稍后重试",
  REQUEST_TIMEOUT: "请求处理超时，请稍后重试",
  HTTP_4XX: "请求未被服务器接受，请刷新会话后重试",
  HTTP_5XX: "服务器处理失败，请稍后重试",
  FOSU_SESSION_INVALID: "当前会话已失效，请重新连接后重试",
  FOSU_SESSION_EXPIRED: "当前会话已过期，请重新连接后重试",
  SESSION_REQUIRED: "需要有效会话才能执行此操作",
  SESSION_INVALID: "当前会话无效，请重新连接后重试",
  RUNTIME_NOT_AUTHORIZED: "当前体验环境未获增强能力授权，将继续使用公开能力",
  RUN_CREATE_FAILED: "任务创建失败，可运行连接诊断后重试",
  RUN_POLL_FAILED: "任务状态读取中断，网络恢复后可继续",
  RUN_EXECUTOR_LOST: "服务重启导致任务中断，请重新执行",
  PROVIDER_NOT_CONFIGURED: "增强理解服务尚未配置，确定性校园工具仍可使用",
  PROVIDER_KEY_MISSING: "增强理解服务尚未配置，确定性校园工具仍可使用",
  PROVIDER_UNVERIFIED: "增强理解服务已配置但尚未真实验证",
  TOOL_FAILED: "校园工具执行失败，请查看诊断详情后重试",
  MEMORY_STORE_UNAVAILABLE: "云端记忆暂不可用，本机记忆仍可查看",
  FOSU_SESSION_REQUIRED: "需要先登录会话后才能使用云端记忆",
  CONVERSATION_NOT_FOUND: "会话尚未同步，请重试一次",
  CONVERSATION_REVISION_CONFLICT: "会话状态有更新，请刷新后再试",
  CONVERSATION_ID_INVALID: "当前对话标识无效，请新建对话后再试",
  MEMORY_POLICY_FAILED: "记忆设置更新失败，请稍后再试",
  POLICY_FAILED: "记忆设置更新失败，请稍后再试",
  PATCH_FAILED: "会话更新失败，请稍后再试",
  SERVER_UNREACHABLE: "暂时连不上服务器，请检查网络后重试",
  RUN_EXPIRED: "这次任务已超时结束，请重新提问",
  RUN_CANCELLED: "已取消本次任务",
  PROVIDER_TIMEOUT: "增强理解响应超时，已为你保留本地结果",
  provider_timeout: "增强理解响应超时，已为你保留本地结果",
  PROVIDER_UNAUTHORIZED: "增强服务暂时不可用，已切换本地能力",
  PROVIDER_RATE_LIMITED: "当前请求较多，请稍后再试",
  REMINDER_PLAN_FAILED: "暂时无法生成提醒计划",
  REMINDER_CREATE_FAILED: "提醒创建失败，请稍后重试",
  REMINDER_CONFIRMATION_REQUIRED: "请再点一次完成创建（无需额外确认卡）",
  REMINDER_CONFIRMATION_INVALID: "操作凭证已失效，请再点一次一键创建",
  REMINDER_CONFIRMATION_MISMATCH: "提醒内容已变化，请再点一次一键创建",
  REMINDER_CONFIRMATION_FAILED: "提醒确认未完成，请再点一次",
  SCHEDULE_REQUIRED: "需要先导入个人课表",
  NO_MATCHING_COURSE: "暂时找不到可提醒的下一节课",
  PRINCIPAL_REQUIRED: "需要先登录会话后才能管理提醒",
  LIST_FAILED: "暂时无法加载对话列表",
  GET_FAILED: "暂时无法打开该对话",
  DELETE_FAILED: "删除失败，请稍后再试",
  CLEAR_FAILED: "清除失败，请稍后再试",
  CONVERSATION_ID_REQUIRED: "请先选择或新建一个对话",
  NETWORK_ERROR: "网络异常，请检查连接后重试",
  TIMEOUT: "请求超时，请稍后再试",
  UNKNOWN: "操作未完成，请稍后再试",
});

const MESSAGE_PATTERNS = [
  { test: /conversation not found/i, code: "CONVERSATION_NOT_FOUND" },
  { test: /revision conflict/i, code: "CONVERSATION_REVISION_CONFLICT" },
  { test: /session required|未登录|需要登录/i, code: "FOSU_SESSION_REQUIRED" },
  { test: /timeout|超时|ECONNABORTED|ETIMEDOUT/i, code: "TIMEOUT" },
  { test: /network|fail to|request:fail|unreachable/i, code: "SERVER_UNREACHABLE" },
  { test: /rate limit|429/i, code: "PROVIDER_RATE_LIMITED" },
  { test: /unauthorized|401|403/i, code: "PROVIDER_UNAUTHORIZED" },
  { test: /cancelled|已取消/i, code: "RUN_CANCELLED" },
];

function normalizeCode(value) {
  return String(value || "").trim();
}

function mapAgentError(errorOrCode, fallbackMessage) {
  let code = "";
  let rawMessage = "";

  if (typeof errorOrCode === "string") {
    code = normalizeCode(errorOrCode);
    rawMessage = errorOrCode;
  } else if (errorOrCode && typeof errorOrCode === "object") {
    code = normalizeCode(errorOrCode.code || errorOrCode.errCode || errorOrCode.errorCode);
    rawMessage = String(errorOrCode.message || errorOrCode.error || errorOrCode.errMsg || "");
  } else if (errorOrCode != null) {
    rawMessage = String(errorOrCode);
  }

  if (!code && /^request:fail(?:\s|$)/i.test(rawMessage)) {
    code = "WECHAT_NETWORK_REQUEST_FAILED";
  }

  if (CODE_MESSAGES[code]) {
    return {
      code: code || "UNKNOWN",
      userMessage: CODE_MESSAGES[code],
      internalMessage: rawMessage,
    };
  }

  for (let i = 0; i < MESSAGE_PATTERNS.length; i += 1) {
    const item = MESSAGE_PATTERNS[i];
    if (item.test.test(rawMessage) || item.test.test(code)) {
      return {
        code: item.code,
        userMessage: CODE_MESSAGES[item.code] || CODE_MESSAGES.UNKNOWN,
        internalMessage: rawMessage,
      };
    }
  }

  // If message is already Chinese and short, keep it; otherwise use fallback.
  const looksChinese = /[\u4e00-\u9fff]/.test(rawMessage) && !/[A-Z_]{4,}/.test(rawMessage);
  if (looksChinese && rawMessage.length <= 40) {
    return {
      code: code || "UNKNOWN",
      userMessage: rawMessage,
      internalMessage: rawMessage,
    };
  }

  return {
    code: code || "UNKNOWN",
    userMessage: fallbackMessage || CODE_MESSAGES.UNKNOWN,
    internalMessage: rawMessage,
  };
}

function userMessage(errorOrCode, fallbackMessage) {
  return mapAgentError(errorOrCode, fallbackMessage).userMessage;
}

module.exports = {
  CODE_MESSAGES,
  mapAgentError,
  userMessage,
};
