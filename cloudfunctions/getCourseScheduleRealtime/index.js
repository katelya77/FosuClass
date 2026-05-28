const cloud = require("wx-server-sdk");
const { FosuQiangzhiAdapter } = require("../common/fosuQiangzhiAdapter");
const { parseCourseScheduleIfrHtml } = require("../common/parser");
const { getCachedSchedule, saveGenericSchedule } = require("../common/cache");
const { groupCoursesBy } = require("../common/scheduleNormalizer");
const { safeLog } = require("../common/safeLogger");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event) => {
  const {
    semester,
    collegeCode = "03", // 默认
    openCollegeCode = "",
    courseAttr = "",
    courseName = "", // 课程名称
    weekStart = "",
    weekEnd = "",
  } = event;

  const queryParams = {
    semester: semester || "2025-2026-2",
    collegeCode,
    openCollegeCode,
    courseAttr,
    courseName,
    weekStart,
    weekEnd,
    sectionStart: "",
    sectionEnd: "",
  };

  const cacheKey = {
    type: "course",
    semester: queryParams.semester,
    collegeCode,
    courseName,
  };

  const cached = getCachedSchedule(cacheKey);
  if (cached && cached.success) {
    safeLog("course-schedule-hit-cache", { courseName });
    return cached;
  }

  try {
    safeLog("course-schedule-fetch-realtime", { courseName });
    const adapter = new FosuQiangzhiAdapter();
    
    const res = await adapter.fetchCourseSchedule(null, queryParams);
    if (res.statusCode !== 200) {
      throw new Error(`教务课程课表接口请求失败，HTTP 状态码: ${res.statusCode}`);
    }

    const parsed = parseCourseScheduleIfrHtml(res.text, {
      semester: queryParams.semester,
    });

    const courses = parsed.courses || [];
    const warnings = parsed.warnings || [];

    // 按课程名称分组 (Group By)
    const grouped = groupCoursesBy(courses, "courseName", "未知课程");

    let coursesList = Object.keys(grouped).map((cName) => ({
      courseName: cName,
      courses: grouped[cName].map(c => Object.assign(c, { audienceType: "course" })),
    }));

    if (courseName) {
      const cleanKeyword = String(courseName).trim().toLowerCase();
      coursesList = coursesList.filter((c) => 
        c.courseName.toLowerCase().includes(cleanKeyword)
      );
    }

    const resultPayload = {
      success: true,
      dataSource: "fosu-realtime",
      updatedAt: new Date().toISOString(),
      coursesList,
      warnings,
    };

    saveGenericSchedule("course", cacheKey, resultPayload);

    return resultPayload;
  } catch (error) {
    safeLog("course-schedule-fetch-failed", { error: error.message });
    return {
      success: false,
      message: `获取课程课表失败: ${error.message}`,
      errorType: "FOSU_REQUEST_FAILED",
      coursesList: [],
    };
  }
};
