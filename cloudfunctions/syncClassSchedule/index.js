const cloud = require("wx-server-sdk");
const { FosuQiangzhiAdapter } = require("../common/fosuQiangzhiAdapter");
const { getClassSchedule, saveClassSchedules } = require("../common/cache");
const { parseClassScheduleIfrHtml } = require("../common/parser");
const { groupCoursesBy, normalizeCourseList } = require("../common/scheduleNormalizer");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

function buildClassesFromCourses(courses, event) {
  const grouped = groupCoursesBy(courses, "className", event.className || "待识别班级");
  return Object.keys(grouped).map((className) => ({
    className,
    college: event.college || event.collegeName || "",
    grade: event.grade || "",
    major: event.major || event.majorName || "",
    courses: grouped[className],
  }));
}

exports.main = async (event) => {
  const payload = event || {};
  const adapter = new FosuQiangzhiAdapter({
    enableNetwork: payload.enableNetwork === true,
  });

  if (!payload.enableNetwork) {
    const cached = getClassSchedule(payload);
    if (!cached) {
      return {
        success: false,
        needSync: true,
        message: "该课表尚未同步，请稍后或由管理员同步",
      };
    }
    return {
      success: true,
      source: "local-cache",
      classes: [cached],
      updatedAt: cached.updatedAt,
    };
  }

  const response = await adapter.fetchClassSchedule(payload.session, payload);
  const parsed = parseClassScheduleIfrHtml(response.text, {
    semester: payload.semester,
    className: payload.className,
  });
  const courses = normalizeCourseList(parsed.courses, {
    semester: payload.semester,
    sourceType: "class",
    audienceType: "student",
  });
  const classes = buildClassesFromCourses(courses, payload);
  saveClassSchedules(classes, payload);

  return {
    success: true,
    source: "fosu-qz",
    classes,
    warnings: parsed.warnings,
    meta: parsed.meta,
    updatedAt: new Date().toISOString(),
  };
};
