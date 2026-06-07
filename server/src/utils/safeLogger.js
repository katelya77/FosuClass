/**
 * 安全日志工具：提供敏感信息脱敏功能，防止在控制台或日志文件中泄露学号、密码、Cookie 或 Ticket 等信息。
 */

// 敏感词正则，匹配包含密码、Cookie、Token、JSESSIONID、Session、Ticket、Execution、Captcha等字段
const SECRET_KEY_PATTERN = /(password|passwd|pwd|cookie|token|session|jsessionid|authorization|ticket|execution|captcha)/i;

/**
 * 脱敏学号
 * @param {string} studentId 学号
 * @returns {string} 脱敏后的学号
 */
function maskStudentId(studentId) {
  const value = String(studentId || "").trim();
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    if (value.length <= 4) {
      return "****";
    }
    return `${value.slice(0, 2)}****${value.slice(-2)}`;
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/**
 * 递归对象进行敏感字脱敏
 * @param {any} value 需要脱敏的数据
 * @returns {any} 脱敏后的数据
 */
function redactSecrets(value) {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value && typeof value === "object") {
    const output = {};
    Object.keys(value).forEach((key) => {
      const safeMetadataKey = /(Prefix|Masked|Configured|Kid|Mode|Status)$/i.test(key);
      output[key] = SECRET_KEY_PATTERN.test(key) && !safeMetadataKey ? "[REDACTED]" : redactSecrets(value[key]);
    });
    return output;
  }
  if (typeof value === "string") {
    // 过滤 URL 中携带的 JSESSIONID 和 ticket，以及 POST 传参中的 password/token 等
    return value
      .replace(/(JSESSIONID=)[^;\s]+/gi, "$1[REDACTED]")
      .replace(/(ticket=)[^&\s]+/gi, "$1[REDACTED]")
      .replace(/(password|passwd|pwd|token|authorization|execution|captcha)=([^&\s]+)/gi, "$1=[REDACTED]");
  }
  return value;
}

/**
 * 安全打印日志
 * @param {string} label 日志标签
 * @param {Object} payload 日志内容对象
 */
function safeLog(label, payload) {
  console.log(`[${new Date().toISOString()}] [${label}]`, JSON.stringify(redactSecrets(payload || {})));
}

module.exports = {
  maskStudentId,
  redactSecrets,
  safeLog,
};
