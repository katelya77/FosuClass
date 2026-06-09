const cloud = require("wx-server-sdk");
const { FosuQiangzhiAdapter } = require("../common/fosuQiangzhiAdapter");
const { getTeacherSchedule, saveTeacherSchedules } = require("../common/cache");
const { parseTeacherScheduleIfrHtml } = require("../common/parser");
const { groupCoursesBy, normalizeCourseList } = require("../common/scheduleNormalizer");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

function buildTeachersFromCourses(courses, event) {
  const grouped = groupCoursesBy(courses, "teacherName", event.teacherName || "待识别教师");
  return Object.keys(grouped).map((teacherName) => ({
    teacherName,
    college: event.college || event.collegeName || "",
    semester: event.semester || "",
    courses: grouped[teacherName],
  }));
}

exports.main = async (event) => {
  const payload = event || {};
  const adapter = new FosuQiangzhiAdapter({
    enableNetwork: payload.enableNetwork === true,
  });

  if (!payload.enableNetwork) {
    const cached = getTeacherSchedule(payload);
    if (!cached) {
      return {
        success: false,
        needSync: true,
        message: "该教师课表尚未同步，请稍后或由管理员同步",
      };
    }
    return {
      success: true,
      source: "local-cache",
      teachers: [cached],
      updatedAt: cached.updatedAt,
    };
  }

  const response = await adapter.fetchTeacherSchedule(payload.session, payload);
  const parsed = parseTeacherScheduleIfrHtml(response.text, {
    semester: payload.semester,
    teacherName: payload.teacherName,
    extra: {
      teacherName: payload.teacherName,
    },
  });
  const courses = normalizeCourseList(parsed.courses, {
    semester: payload.semester,
    teacherName: payload.teacherName,
    sourceType: "teacher",
    audienceType: "teacher",
  });
  const teachers = buildTeachersFromCourses(courses, payload);
  saveTeacherSchedules(teachers, payload);

  return {
    success: true,
    source: "fosu-qz",
    teachers,
    warnings: parsed.warnings,
    meta: parsed.meta,
    updatedAt: new Date().toISOString(),
  };
};
