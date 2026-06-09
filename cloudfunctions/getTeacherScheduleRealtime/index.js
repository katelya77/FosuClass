const cloud = require("wx-server-sdk");
const { FosuQiangzhiAdapter } = require("../common/fosuQiangzhiAdapter");
const { parseTeacherScheduleIfrHtml } = require("../common/parser");
const { getCachedSchedule, saveTeacherSchedules } = require("../common/cache");
const { groupCoursesBy } = require("../common/scheduleNormalizer");
const { safeLog } = require("../common/safeLogger");
const { normalizeTerm } = require("../common/term");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event) => {
  const {
    semester,
    collegeCode,
    titleCode = "",
    keyword = "",
    weekStart = "",
    weekEnd = "",
  } = event;

  const selectedSemester = normalizeTerm(semester);
  if (!selectedSemester) {
    return {
      success: false,
      code: "TERM_REQUIRED",
      message: "semester is required.",
    };
  }

  const queryParams = {
    semester: selectedSemester,
    collegeCode: collegeCode || "02", // 默认测试物理与光电工程学院，或由前台传入
    teacherTitleCode: titleCode,
    weekStart,
    weekEnd,
    sectionStart: "",
    sectionEnd: "",
  };

  const cacheKey = {
    type: "teacher",
    semester: queryParams.semester,
    collegeCode: queryParams.collegeCode,
    titleCode,
    keyword,
  };

  // 1. 尝试从缓存获取
  const cached = getCachedSchedule(cacheKey);
  if (cached && cached.success) {
    safeLog("teacher-schedule-hit-cache", { keyword });
    return cached;
  }

  try {
    safeLog("teacher-schedule-fetch-realtime", { keyword });
    const adapter = new FosuQiangzhiAdapter();
    
    // 2. 发起请求
    const res = await adapter.fetchTeacherSchedule(null, queryParams);
    if (res.statusCode !== 200) {
      throw new Error(`教务教师课表接口请求失败，HTTP 状态码: ${res.statusCode}`);
    }

    // 3. 解析教师课表 HTML
    const parsed = parseTeacherScheduleIfrHtml(res.text, {
      semester: queryParams.semester,
    });

    const courses = parsed.courses || [];
    const warnings = parsed.warnings || [];

    // 4. 按教师姓名分组 (Group By)
    const grouped = groupCoursesBy(courses, "teacherName", "未知教师");

    // 5. 组装教师列表并进行姓名关键字过滤
    let teachers = Object.keys(grouped).map((tName) => ({
      teacherName: tName,
      college: event.collegeName || "已知院系", // 供前端展示
      title: "", // 职称
      courses: grouped[tName].map(c => Object.assign(c, { audienceType: "teacher" })),
    }));

    if (keyword) {
      const cleanKeyword = String(keyword).trim().toLowerCase();
      teachers = teachers.filter((t) => 
        t.teacherName.toLowerCase().includes(cleanKeyword)
      );
    }

    const resultPayload = {
      success: true,
      dataSource: "fosu-realtime",
      updatedAt: new Date().toISOString(),
      teachers,
      warnings,
    };

    // 6. 保存教师独立课表到短期缓存
    saveTeacherSchedules(
      teachers.map((t) => ({
        teacherName: t.teacherName,
        courses: t.courses,
        semester: queryParams.semester,
        dataSource: "fosu-realtime",
      })),
      queryParams
    );

    // 保存本次查询的整体结果到缓存
    const { saveGenericSchedule } = require("../common/cache");
    saveGenericSchedule("teacher", cacheKey, resultPayload);

    return resultPayload;
  } catch (error) {
    safeLog("teacher-schedule-fetch-failed", { error: error.message });
    
    const fallback = getCachedSchedule(cacheKey);
    if (fallback) {
      return Object.assign({}, fallback, {
        success: true,
        dataSource: "fallback-mock",
        updatedAt: new Date().toISOString(),
        warning: `无法实时连接教务系统，已使用离线数据。原因：${error.message}`,
      });
    }

    return {
      success: false,
      message: `获取教师课表失败: ${error.message}`,
      errorType: "FOSU_REQUEST_FAILED",
      teachers: [],
    };
  }
};
