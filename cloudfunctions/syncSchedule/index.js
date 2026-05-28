const cloud = require("wx-server-sdk");
const { mockCourses } = require("../common/mockData");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event) => {
  const className = (event && event.className) || "25动物医学6";
  return {
    success: true,
    demo: true,
    source: "syncSchedule",
    targetPath: "https://100.fosu.edu.cn/xskb/xskb_list.do",
    courses: mockCourses.filter((course) => course.className === className),
    message: "当前返回本地缓存个人课表，尚未接入真实登录流程。",
  };
};
