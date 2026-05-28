const cloud = require("wx-server-sdk");
const { FosuQiangzhiAdapter } = require("../common/fosuQiangzhiAdapter");
const { parseClassScheduleIfrHtml } = require("../common/parser");
const { getCachedSchedule, saveClassSchedules } = require("../common/cache");
const { groupCoursesBy } = require("../common/scheduleNormalizer");
const { safeLog } = require("../common/safeLogger");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event) => {
  const {
    semester,
    collegeCode,
    grade,
    majorCode,
    majorName,
    weekStart = "",
    weekEnd = "",
    sectionStart = "",
    sectionEnd = "",
  } = event;

  if (!collegeCode || !grade || !majorCode) {
    return {
      success: false,
      message: "collegeCode, grade and majorCode are required parameters.",
    };
  }

  const queryParams = {
    semester: semester || "2025-2026-2",
    collegeCode,
    grade,
    majorCode,
    weekStart,
    weekEnd,
    sectionStart,
    sectionEnd,
  };

  // 1. 尝试从短期缓存中读取该专业的班级课表
  // 我们使用 classKey 来查询或使用通用的短期缓存。由于在 cache.js 中已经实现了
  // 基于 classKey(params) 的缓存，其中 params 会被序列化作为 key
  const cacheKey = {
    type: "class",
    semester: queryParams.semester,
    collegeCode,
    grade,
    majorCode,
  };
  
  const cached = getCachedSchedule(cacheKey);
  if (cached && cached.dataSource === "fosu-realtime") {
    safeLog("class-schedule-hit-cache", { majorCode });
    return cached;
  }

  try {
    safeLog("class-schedule-fetch-realtime", { majorCode });
    const adapter = new FosuQiangzhiAdapter();
    
    // 2. 发送 POST 请求获取课表 HTML
    const res = await adapter.fetchClassSchedule(null, queryParams);
    
    if (res.statusCode !== 200) {
      throw new Error(`教务课表接口请求失败，HTTP 状态码: ${res.statusCode}`);
    }

    // 3. 解析课表 HTML
    const parsed = parseClassScheduleIfrHtml(res.text, {
      semester: queryParams.semester,
    });

    const courses = parsed.courses || [];
    const warnings = parsed.warnings || [];

    // 4. 按班级名称分组 (Group By)
    const grouped = groupCoursesBy(courses, "className", "未命名班级");
    
    const classes = Object.keys(grouped).map((clsName) => ({
      className: clsName,
      collegeCode,
      grade,
      majorCode,
      majorName: majorName || "",
      courses: grouped[clsName],
    }));

    const resultPayload = {
      success: true,
      dataSource: "fosu-realtime",
      updatedAt: new Date().toISOString(),
      semester: queryParams.semester,
      classes,
      warnings,
    };

    // 5. 将这些班级课表存入缓存
    // 同时以每个独立班级的名字存储班级课表
    saveClassSchedules(
      classes.map((cls) => ({
        className: cls.className,
        courses: cls.courses,
        semester: queryParams.semester,
        dataSource: "fosu-realtime",
      })),
      queryParams
    );

    // 同时也把针对这个专业的整体查询结果存入短期缓存
    const { saveGenericSchedule } = require("../common/cache");
    saveGenericSchedule("class", cacheKey, resultPayload);

    return resultPayload;
  } catch (error) {
    safeLog("class-schedule-fetch-failed", { error: error.message });
    
    // 容灾处理：尝试读取没有过期的或旧的本地缓存
    const fallback = getCachedSchedule(cacheKey);
    if (fallback) {
      return Object.assign({}, fallback, {
        success: true,
        dataSource: "fallback-mock",
        updatedAt: new Date().toISOString(),
        warning: `无法实时连接教务系统，已使用离线缓存。原因：${error.message}`,
      });
    }

    return {
      success: false,
      message: `获取班级课表失败: ${error.message}`,
      errorType: "FOSU_REQUEST_FAILED",
    };
  }
};
