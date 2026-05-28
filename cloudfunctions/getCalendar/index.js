const cloud = require("wx-server-sdk");
const { mockCalendar } = require("../common/mockData");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async () => ({
  success: true,
  mock: true,
  source: "getCalendar",
  targetPath: "教学日历查看",
  weeks: mockCalendar,
  message: "当前返回 Mock 教学周历，真实页面需脱敏抓包后接入。",
});
