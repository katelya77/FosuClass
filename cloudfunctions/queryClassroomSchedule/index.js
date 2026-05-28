const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async () => ({
  success: true,
  mock: true,
  source: "queryClassroomSchedule",
  targetPath: "https://100.fosu.edu.cn/kbcx/kbxx_classroom",
  courses: [],
  message: "教室课表查询入口已预留，真实接口尚未接入。",
});
