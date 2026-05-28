const cloud = require("wx-server-sdk");
const { mockCalendar } = require("../common/mockData");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async () => ({
  success: true,
  demo: true,
  source: "getCalendar",
  targetPath: "教学日历查看",
  weeks: mockCalendar,
  message: "当前返回本地缓存教学周历，真实页面需脱敏接口样本后接入。",
});
