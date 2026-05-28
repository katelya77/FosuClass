const cloud = require("wx-server-sdk");
const { mockClasses, mockCourses } = require("../common/mockData");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event) => {
  const className = (event && event.className) || "25动物医学6";
  return {
    success: true,
    mock: true,
    source: "getSchoolSchedule",
    targetPath: "https://100.fosu.edu.cn/kbcx/kbxx_xzb",
    classes: mockClasses,
    courses: mockCourses.filter((course) => course.className === className),
    message: "当前返回 Mock 行政班级课表，真实接口需脱敏抓包后接入。",
  };
};
