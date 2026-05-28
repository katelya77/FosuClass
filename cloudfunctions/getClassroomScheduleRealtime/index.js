const cloud = require("wx-server-sdk");
const { FosuQiangzhiAdapter } = require("../common/fosuQiangzhiAdapter");
const { parseClassroomScheduleIfrHtml } = require("../common/parser");
const { getCachedSchedule, saveGenericSchedule } = require("../common/cache");
const { groupCoursesBy } = require("../common/scheduleNormalizer");
const { safeLog } = require("../common/safeLogger");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event) => {
  const {
    semester,
    collegeCode = "02", // 默认
    campusId = "",      // 校区 id
    buildingId = "",    // 教学楼 id
    classroomName = "", // 教室名称，用于过滤
    weekStart = "",
    weekEnd = "",
  } = event;

  const queryParams = {
    semester: semester || "2025-2026-2",
    collegeCode,
    campusId,
    buildingId,
    weekStart,
    weekEnd,
    sectionStart: "",
    sectionEnd: "",
  };

  const cacheKey = {
    type: "classroom",
    semester: queryParams.semester,
    campusId,
    buildingId,
    classroomName,
  };

  const cached = getCachedSchedule(cacheKey);
  if (cached && cached.success) {
    safeLog("classroom-schedule-hit-cache", { classroomName });
    return cached;
  }

  try {
    safeLog("classroom-schedule-fetch-realtime", { classroomName });
    const adapter = new FosuQiangzhiAdapter();
    
    const res = await adapter.fetchClassroomSchedule(null, queryParams);
    if (res.statusCode !== 200) {
      throw new Error(`教务教室课表接口请求失败，HTTP 状态码: ${res.statusCode}`);
    }

    const parsed = parseClassroomScheduleIfrHtml(res.text, {
      semester: queryParams.semester,
    });

    const courses = parsed.courses || [];
    const warnings = parsed.warnings || [];

    // 按教室名称分组 (Group By)
    const grouped = groupCoursesBy(courses, "classroom", "未知教室");

    let classrooms = Object.keys(grouped).map((rName) => ({
      roomName: rName,
      courses: grouped[rName].map(c => Object.assign(c, { audienceType: "classroom" })),
    }));

    if (classroomName) {
      const cleanKeyword = String(classroomName).trim().toLowerCase();
      classrooms = classrooms.filter((r) => 
        r.roomName.toLowerCase().includes(cleanKeyword)
      );
    }

    const resultPayload = {
      success: true,
      dataSource: "fosu-realtime",
      updatedAt: new Date().toISOString(),
      classrooms,
      warnings,
    };

    saveGenericSchedule("classroom", cacheKey, resultPayload);

    return resultPayload;
  } catch (error) {
    safeLog("classroom-schedule-fetch-failed", { error: error.message });
    return {
      success: false,
      message: `获取教室课表失败: ${error.message}`,
      errorType: "FOSU_REQUEST_FAILED",
      classrooms: [],
    };
  }
};
