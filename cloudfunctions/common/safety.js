const SECRET_KEY_PATTERN = /(password|passwd|pwd|cookie|token|session|jsessionid|authorization)/i;

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
  return value;
}

function safeLog(label, payload) {
  console.log(label, JSON.stringify(redactSecrets(payload || {})));
}

function assertNotConnected() {
  throw new Error("真实教务接口尚未接入，请先提供脱敏抓包信息。");
}

module.exports = {
  assertNotConnected,
  maskStudentId,
  redactSecrets,
  safeLog,
};
