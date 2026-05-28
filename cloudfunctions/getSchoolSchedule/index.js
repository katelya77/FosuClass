const cloud = require("wx-server-sdk");
const { mockClasses, mockCourses } = require("../common/mockData");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event) => {
  const className = (event && event.className) || "25动物医学6";
  return {
    success: true,
    demo: true,
    source: "getSchoolSchedule",
    targetPath: "https://100.fosu.edu.cn/kbcx/kbxx_xzb",
    classes: mockClasses,
    courses: mockCourses.filter((course) => course.className === className),
    message: "当前返回本地缓存行政班级课表，真实同步请使用 syncClassSchedule。",
  };
};
