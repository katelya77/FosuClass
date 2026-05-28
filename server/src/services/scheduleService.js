/**
 * 课表查询服务：负责从教务系统抓取班级、教师、教室、课程课表并结合 parser 解析、正常化、缓存及容灾。
 */

const { FosuQiangzhiAdapter } = require("./fosuQiangzhiAdapter");
const parser = require("../utils/parser");
const normalizer = require("../utils/scheduleNormalizer");
const cache = require("../utils/cache");
const { safeLog } = require("../utils/safeLogger");

/**
 * 1. 获取行政班级课表
 */
async function getClassSchedule(params) {
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
  } = params;

  if (!collegeCode || !grade || !majorCode) {
    throw new Error("collegeCode, grade and majorCode are required parameters.");
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

  const cacheKey = cache.keys.getClassScheduleKey(
    queryParams.semester,
    collegeCode,
    grade,
    majorCode
  );

  // 1. 尝试从短期内存缓存中获取选项
  const cached = cache.get(cacheKey);
  if (cached && cached.dataSource === "fosu-realtime") {
    safeLog("class-schedule-hit-cache", { majorCode });
    return cached;
  }

  try {
    safeLog("class-schedule-fetch-realtime", { majorCode });
    const adapter = new FosuQiangzhiAdapter();
    
    // 2. 发送 POST 请求获取课表 HTML
    const res = await adapter.fetchClassSchedule(queryParams);
    if (res.statusCode !== 200) {
      throw new Error(`教务课表接口请求失败，HTTP 状态码: ${res.statusCode}`);
    }

    // 3. 解析课表 HTML
    const parsed = parser.parseClassScheduleIfrHtml(res.text, {
      semester: queryParams.semester,
    });

    const courses = normalizer.normalizeCourseList(parsed.courses || [], {
      semester: queryParams.semester,
      sourceType: "class",
      audienceType: "student",
    });
    
    const warnings = parsed.warnings || [];

    // 4. 按班级名称分组 (Group By)
    const grouped = normalizer.groupCoursesBy(courses, "className", "未命名班级");
    
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

    // 5. 将专业的整体查询结果存入短期缓存
    cache.set(cacheKey, resultPayload, cache.TTL.SCHEDULE);

    // 同时也缓存一份班级独立课表（便于可能存在的单个班级检索，这里做内存辅助缓存）
    classes.forEach((cls) => {
      const singleClassKey = `schedule:single-class:${queryParams.semester}:${cls.className}`;
      cache.set(singleClassKey, cls, cache.TTL.SCHEDULE);
    });

    return resultPayload;
  } catch (error) {
    safeLog("class-schedule-fetch-failed", { error: error.message });
    
    // 容灾处理：尝试读取没有过期的或旧的本地缓存
    const fallback = cache.get(cacheKey);
    if (fallback) {
      fallback.warning = `无法实时连接教务系统，已使用历史数据。原因：${error.message}`;
      return fallback;
    }

    throw error;
  }
}

/**
 * 2. 获取教师课表
 */
async function getTeacherSchedule(params) {
  const {
    semester,
    collegeCode,
    collegeName = "",
    titleCode = "",
    keyword = "",
    weekStart = "",
    weekEnd = "",
  } = params;

  const queryParams = {
    semester: semester || "2025-2026-2",
    collegeCode: collegeCode || "02", // 默认测试物理与光电工程学院，或由前台传入
    teacherTitleCode: titleCode,
    weekStart,
    weekEnd,
    sectionStart: "",
    sectionEnd: "",
  };

  const cacheKey = cache.keys.getTeacherScheduleKey(
    queryParams.semester,
    queryParams.collegeCode,
    keyword
  );

  // 1. 尝试从缓存中获取
  const cached = cache.get(cacheKey);
  if (cached && cached.dataSource === "fosu-realtime") {
    safeLog("teacher-schedule-hit-cache", { keyword });
    return cached;
  }

  try {
    safeLog("teacher-schedule-fetch-realtime", { keyword });
    const adapter = new FosuQiangzhiAdapter();
    
    // 2. 发送 POST 请求获取课表 HTML
    const res = await adapter.fetchTeacherSchedule(queryParams);
    if (res.statusCode !== 200) {
      throw new Error(`教务教师课表接口请求失败，HTTP 状态码: ${res.statusCode}`);
    }

    // 3. 解析教师课表 HTML
    const parsed = parser.parseTeacherScheduleIfrHtml(res.text, {
      semester: queryParams.semester,
    });

    const courses = normalizer.normalizeCourseList(parsed.courses || [], {
      semester: queryParams.semester,
      sourceType: "teacher",
      audienceType: "teacher",
    });
    
    const warnings = parsed.warnings || [];

    // 4. 按教师姓名分组 (Group By)
    const grouped = normalizer.groupCoursesBy(courses, "teacherName", "未知教师");

    // 5. 组装教师列表并进行姓名关键字过滤
    let teachers = Object.keys(grouped).map((tName) => ({
      teacherName: tName,
      college: collegeName || "已知院系", // 供前端展示
      title: "", // 职称
      courses: grouped[tName],
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

    // 6. 保存本次查询的整体结果到缓存
    cache.set(cacheKey, resultPayload, cache.TTL.SCHEDULE);

    return resultPayload;
  } catch (error) {
    safeLog("teacher-schedule-fetch-failed", { error: error.message });
    
    // 容灾读取旧缓存
    const fallback = cache.get(cacheKey);
    if (fallback) {
      fallback.warning = `无法实时连接教务系统，已使用历史数据。原因：${error.message}`;
      return fallback;
    }

    throw error;
  }
}

/**
 * 3. 获取教室课表
 */
async function getClassroomSchedule(params) {
  const {
    semester,
    collegeCode = "02",
    campusId = "",
    buildingId = "",
    classroomName = "",
    weekStart = "",
    weekEnd = "",
  } = params;

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

  const cacheKey = cache.keys.getClassroomScheduleKey(
    queryParams.semester,
    campusId,
    classroomName
  );

  // 1. 尝试从缓存中获取
  const cached = cache.get(cacheKey);
  if (cached && cached.dataSource === "fosu-realtime") {
    safeLog("classroom-schedule-hit-cache", { classroomName });
    return cached;
  }

  try {
    safeLog("classroom-schedule-fetch-realtime", { classroomName });
    const adapter = new FosuQiangzhiAdapter();
    
    const res = await adapter.fetchClassroomSchedule(queryParams);
    if (res.statusCode !== 200) {
      throw new Error(`教务教室课表接口请求失败，HTTP 状态码: ${res.statusCode}`);
    }

    const parsed = parser.parseClassroomScheduleIfrHtml(res.text, {
      semester: queryParams.semester,
    });

    const courses = normalizer.normalizeCourseList(parsed.courses || [], {
      semester: queryParams.semester,
      sourceType: "classroom",
      audienceType: "classroom",
    });
    
    const warnings = parsed.warnings || [];

    // 按教室名称分组 (Group By)
    const grouped = normalizer.groupCoursesBy(courses, "classroom", "未知教室");

    let classrooms = Object.keys(grouped).map((rName) => ({
      roomName: rName,
      courses: grouped[rName],
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

    // 保存本次查询的整体结果到缓存
    cache.set(cacheKey, resultPayload, cache.TTL.SCHEDULE);

    return resultPayload;
  } catch (error) {
    safeLog("classroom-schedule-fetch-failed", { error: error.message });
    
    const fallback = cache.get(cacheKey);
    if (fallback) {
      fallback.warning = `无法实时连接教务系统，已使用历史数据。原因：${error.message}`;
      return fallback;
    }

    throw error;
  }
}

/**
 * 4. 获取课程课表
 */
async function getCourseSchedule(params) {
  const {
    semester,
    collegeCode = "03",
    openCollegeCode = "",
    courseAttr = "",
    courseName = "",
    weekStart = "",
    weekEnd = "",
  } = params;

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

  const cacheKey = cache.keys.getCourseScheduleKey(
    queryParams.semester,
    courseName
  );

  // 1. 尝试从缓存中获取
  const cached = cache.get(cacheKey);
  if (cached && cached.dataSource === "fosu-realtime") {
    safeLog("course-schedule-hit-cache", { courseName });
    return cached;
  }

  try {
    safeLog("course-schedule-fetch-realtime", { courseName });
    const adapter = new FosuQiangzhiAdapter();
    
    const res = await adapter.fetchCourseSchedule(queryParams);
    if (res.statusCode !== 200) {
      throw new Error(`教务课程课表接口请求失败，HTTP 状态码: ${res.statusCode}`);
    }

    const parsed = parser.parseCourseScheduleIfrHtml(res.text, {
      semester: queryParams.semester,
    });

    const courses = normalizer.normalizeCourseList(parsed.courses || [], {
      semester: queryParams.semester,
      sourceType: "course",
      audienceType: "course",
    });
    
    const warnings = parsed.warnings || [];

    // 按课程名称分组 (Group By)
    const grouped = normalizer.groupCoursesBy(courses, "courseName", "未知课程");

    let coursesList = Object.keys(grouped).map((cName) => ({
      courseName: cName,
      courses: grouped[cName],
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

    // 保存本次查询的整体结果到缓存
    cache.set(cacheKey, resultPayload, cache.TTL.SCHEDULE);

    return resultPayload;
  } catch (error) {
    safeLog("course-schedule-fetch-failed", { error: error.message });
    
    const fallback = cache.get(cacheKey);
    if (fallback) {
      fallback.warning = `无法实时连接教务系统，已使用历史数据。原因：${error.message}`;
      return fallback;
    }

    throw error;
  }
}

module.exports = {
  getClassSchedule,
  getTeacherSchedule,
  getClassroomSchedule,
  getCourseSchedule,
};
