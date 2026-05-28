const { maskStudentId, redactSecrets, safeLog } = require("./safeLogger");

function assertNotConnected() {
  throw new Error("真实教务接口尚未接入，请先提供脱敏抓包信息。");
}

module.exports = {
  assertNotConnected,
  maskStudentId,
  redactSecrets,
  safeLog,
};
