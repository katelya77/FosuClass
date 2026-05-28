const cloud = require("wx-server-sdk");
const { maskStudentId } = require("../common/safety");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event) => {
  const studentId = String((event && event.studentId) || "").trim();
  return {
    success: true,
    demo: true,
    studentId: maskStudentId(studentId),
    message: "登录演示成功。真实登录流程尚未接入。",
  };
};
