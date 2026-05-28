const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async () => ({
  success: true,
  mock: true,
  source: "queryCourseSchedule",
  targetPath: "https://100.fosu.edu.cn/kbcx/kbxx_kc",
  courses: [],
  message: "课程课表查询入口已预留，真实接口尚未接入。",
});
