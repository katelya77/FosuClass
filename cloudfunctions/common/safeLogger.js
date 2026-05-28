const SECRET_KEY_PATTERN = /(password|passwd|pwd|cookie|token|session|jsessionid|authorization|ticket)/i;

function maskStudentId(studentId) {
  const value = String(studentId || "");
  if (value.length <= 4) {
    return value ? "****" : "";
  }
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

function redactSecrets(value) {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value && typeof value === "object") {
    const output = {};
    Object.keys(value).forEach((key) => {
      output[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSecrets(value[key]);
    });
    return output;
  }
  if (typeof value === "string") {
    return value
      .replace(/(JSESSIONID=)[^;\s]+/gi, "$1[REDACTED]")
      .replace(/(ticket=)[^&\s]+/gi, "$1[REDACTED]")
      .replace(/(password|passwd|pwd|token|authorization)=([^&\s]+)/gi, "$1=[REDACTED]");
  }
  return value;
}

function safeLog(label, payload) {
  console.log(label, JSON.stringify(redactSecrets(payload || {})));
}

module.exports = {
  maskStudentId,
  redactSecrets,
  safeLog,
};
