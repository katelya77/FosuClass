const cloud = require("wx-server-sdk");
const { maskStudentId } = require("../common/safety");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event) => {
  const studentId = String((event && event.studentId) || "").trim();
  return {
    success: true,
    mock: true,
    studentId: maskStudentId(studentId),
    message: "Mock 登录成功。真实教务接口尚未接入，请先提供脱敏抓包信息。",
  };
};
