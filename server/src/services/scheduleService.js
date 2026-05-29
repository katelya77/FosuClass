/**
 * 课表查询服务：负责从缓存（cache-first 静态文件模式）或教务系统（realtime 调试模式）中
 * 读取并过滤班级、教师、教室、课程课表。
 */

const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const { FosuQiangzhiAdapter } = require("./fosuQiangzhiAdapter");
const parser = require("../utils/parser");
const normalizer = require("../utils/scheduleNormalizer");
const cache = require("../utils/cache");
const { safeLog } = require("../utils/safeLogger");
const config = require("../config");
const { getSnapshot } = require("./schoolCatalogService");

const STORAGE_DIR = path.join(__dirname, "../../storage");
const FILE_MAP = {
  "class-schedules": path.join(STORAGE_DIR, "class-schedules.json"),
  "teacher-schedules": path.join(STORAGE_DIR, "teacher-schedules.json"),
  "classroom-schedules": path.join(STORAGE_DIR, "classroom-schedules.json"),
  "course-schedules": path.join(STORAGE_DIR, "course-schedules.json"),
  "sync-meta": path.join(STORAGE_DIR, "sync-meta.json"),
};

/**
 * 安全读取 JSON 文件
 */
function readJsonFile(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      safeLog("read-json-file-error", { filePath, error: error.message });
      return null;
    }
  }
  return null;
}

/**
 * 获取元数据
 */
function getMeta(key) {
  const metaPath = FILE_MAP["sync-meta"];
  const meta = readJsonFile(metaPath);
  return meta && meta[key] ? meta[key] : {};
}

function normalizeFilterValue(value) {
  return String(value || "").trim();
}

function matchesFilter(actual, expected) {
  const normalizedExpected = normalizeFilterValue(expected);
  if (!normalizedExpected) {
    return true;
  }
  return normalizeFilterValue(actual) === normalizedExpected;
}

function safeDecode(str) {
  try {
    return decodeURIComponent(str);
  } catch (e) {
    return str;
  }
}

function filterClassSchedules(schedules, queryParams) {
  const baseFiltered = (schedules || []).filter(
    (item) =>
      matchesFilter(item.semester, queryParams.semester) &&
      matchesFilter(item.collegeCode, queryParams.collegeCode) &&
      matchesFilter(item.grade, queryParams.grade) &&
      matchesFilter(item.majorCode, queryParams.majorCode)
  );

  if (!queryParams.className) {
    return {
      baseFiltered,
      filtered: baseFiltered,
    };
  }

  const cleanQueryName = safeDecode(queryParams.className);
  return {
    baseFiltered,
    filtered: baseFiltered.filter((item) => {
      return safeDecode(item.className) === cleanQueryName || item.classId === queryParams.className;
    }),
  };
}

function buildNoClassScheduleResponse(queryParams, reasonCode) {
  const messageMap = {
    INVALID_FILTER: "请选择学院、年级和专业后再查询课表。",
    NO_MATCHED_CLASS: "已同步该专业课表，但没有匹配到指定班级。",
    NO_SCHEDULE_SYNCED: "暂未同步该专业课表，可稍后再试或联系维护者补充同步。",
  };

  return {
    success: false,
    dataSource: "cache",
    reasonCode,
    message: messageMap[reasonCode] || messageMap.NO_SCHEDULE_SYNCED,
    semester: queryParams.semester,
    classes: [],
  };
}

/**
 * 辅助检查域名是否能解析
 */
async function checkDns(hostname) {
  try {
    await dns.lookup(hostname);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 获取开发环境下的班级课表 Demo 数据
 */
function getDemoClassSchedule(params) {
  return {
    success: true,
    dataSource: "demo",
    updatedAt: new Date().toISOString(),
    semester: params.semester || "2025-2026-2",
    classes: [
      {
        className: "动物科学2023级1班 (Demo)",
        collegeCode: params.collegeCode,
        grade: params.grade,
        majorCode: params.majorCode,
        majorName: params.majorName || "动物科学",
        courses: [
          {
            courseName: "动物解剖学",
            teacherName: "张教授 (Demo)",
            weeks: [1, 2, 3, 4, 5, 6, 7, 8],
            dayOfWeek: 1, // 周一
            sections: [1, 2], // 1-2节
            classroom: "C7-302",
          },
          {
            courseName: "动物生理学",
            teacherName: "李副教授 (Demo)",
            weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            dayOfWeek: 3, // 周三
            sections: [3, 4], // 3-4节
            classroom: "C7-405",
          }
        ]
      }
    ]
  };
}

/**
 * 获取开发环境下的教师课表 Demo 数据
 */
function getDemoTeacherSchedule(params) {
  return {
    success: true,
    dataSource: "demo",
    updatedAt: new Date().toISOString(),
    teachers: [
      {
        teacherName: params.keyword || "汪军 (Demo)",
        college: params.collegeName || "物理与光电工程学院",
        title: "教授",
        courses: [
          {
            courseName: "大学物理实验",
            className: "光电2024级1班",
            weeks: [1, 2, 3, 4, 5, 6, 7, 8],
            dayOfWeek: 2,
            sections: [5, 6, 7],
            classroom: "B5-202",
          }
        ]
      }
    ]
  };
}

/**
 * 获取开发环境下的教室课表 Demo 数据
 */
function getDemoClassroomSchedule(params) {
  return {
    success: true,
    dataSource: "demo",
    updatedAt: new Date().toISOString(),
    classrooms: [
      {
        roomName: params.classroomName || "C7-503 (Demo)",
        courses: [
          {
            courseName: "动物生物化学",
            teacherName: "赵老师",
            className: "动医2023级2班",
            weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            dayOfWeek: 4,
            sections: [1, 2],
          }
        ]
      }
    ]
  };
}

/**
 * 获取开发环境下的课程课表 Demo 数据
 */
function getDemoCourseSchedule(params) {
  return {
    success: true,
    dataSource: "demo",
    updatedAt: new Date().toISOString(),
    coursesList: [
      {
        courseName: params.courseName || "有机化学 (Demo)",
        courses: [
          {
            teacherName: "钱老师",
            className: "化工2024级1班",
            weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
            dayOfWeek: 5,
            sections: [1, 2],
            classroom: "D3-102",
          }
        ]
      }
    ]
  };
}

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
    className,
  } = params;

  // 允许通过 className 或 classId 精准查找行政班课表
  if (!collegeCode || !grade || !majorCode) {
    if (className) {
      const semesterParam = semester || "2025-2026-2";
      let allSchedules = [];
      const snapshot = getSnapshot();
      if (snapshot && Array.isArray(snapshot.classSchedules)) {
        allSchedules = snapshot.classSchedules;
      } else {
        allSchedules = readJsonFile(FILE_MAP["class-schedules"]) || [];
      }

      const cleanQueryName = safeDecode(className);
      const found = allSchedules.find(item =>
        String(item.semester || "") === String(semesterParam) &&
        (safeDecode(item.className) === cleanQueryName || item.classId === className)
      );

      if (found) {
        const meta = getMeta("class-schedules");
        return {
          success: true,
          dataSource: snapshot ? "snapshot" : "cache",
          updatedAt: snapshot ? snapshot.updatedAt : (meta.updatedAt || new Date().toISOString()),
          semester: semesterParam,
          classes: [found],
        };
      }
    }

    return buildNoClassScheduleResponse({
      semester: semester || "2025-2026-2",
      collegeCode,
      grade,
      majorCode,
      className,
    }, "INVALID_FILTER");
  }

  const queryParams = {
    semester: semester || "2025-2026-2",
    collegeCode,
    grade,
    majorCode,
    majorName,
    className,
  };

  const mode = config.DATA_SOURCE_MODE;

  // 1. disabled 模式
  if (mode === "disabled") {
    return {
      success: false,
      message: "教务课表查询服务暂时关闭维护中。",
    };
  }

  // 2. realtime 模式
  if (mode === "realtime") {
    const host = new URL(config.FOSU_BASE_URL).hostname;
    const canResolve = await checkDns(host);
    if (!canResolve) {
      return {
        success: false,
        reasonCode: "FOSU_INTRANET_ONLY",
        message: "100.fosu.edu.cn 仅校园网或 EasyConnect VPN 可访问，当前服务器无法直连。",
      };
    }

    try {
      safeLog("class-schedule-fetch-realtime", { majorCode });
      const adapter = new FosuQiangzhiAdapter();
      const res = await adapter.fetchClassSchedule(queryParams);
      if (res.statusCode !== 200) {
        throw new Error(`教务课表接口请求失败，HTTP 状态码: ${res.statusCode}`);
      }

      const parsed = parser.parseClassScheduleIfrHtml(res.text, {
        semester: queryParams.semester,
      });

      const courses = normalizer.normalizeCourseList(parsed.courses || [], {
        semester: queryParams.semester,
        sourceType: "class",
        audienceType: "student",
      });
      
      const warnings = parsed.warnings || [];
      const builtClasses = normalizer.buildClassScheduleEntries(courses, {
        semester: queryParams.semester,
        collegeCode,
        grade,
        majorCode,
        majorName: majorName || "",
      });
      const { baseFiltered, filtered } = filterClassSchedules(builtClasses, queryParams);

      if (!baseFiltered.length) {
        return buildNoClassScheduleResponse(queryParams, "NO_SCHEDULE_SYNCED");
      }

      if (queryParams.className && !filtered.length) {
        return buildNoClassScheduleResponse(queryParams, "NO_MATCHED_CLASS");
      }

      return {
        success: true,
        dataSource: "fosu-realtime",
        updatedAt: new Date().toISOString(),
        semester: queryParams.semester,
        classes: filtered,
        warnings,
      };
    } catch (error) {
      safeLog("class-schedule-realtime-failed", { error: error.message });
      return {
        success: false,
        reasonCode: "FOSU_INTRANET_ONLY",
        message: `无法实时连接教务系统获取课表: ${error.message}`,
      };
    }
  }

  // 3. cache-first 模式
  let allClassSchedules = null;
  const snapshot = getSnapshot();
  if (snapshot && Array.isArray(snapshot.classSchedules)) {
    allClassSchedules = snapshot.classSchedules;
  } else {
    allClassSchedules = readJsonFile(FILE_MAP["class-schedules"]);
  }

  if (Array.isArray(allClassSchedules) && allClassSchedules.length > 0) {
    const { baseFiltered, filtered } = filterClassSchedules(allClassSchedules, queryParams);

    if (!baseFiltered.length) {
      return buildNoClassScheduleResponse(queryParams, "NO_SCHEDULE_SYNCED");
    }

    if (queryParams.className && !filtered.length) {
      return buildNoClassScheduleResponse(queryParams, "NO_MATCHED_CLASS");
    }

    const meta = getMeta("class-schedules");
    return {
      success: true,
      dataSource: snapshot ? "snapshot" : "cache",
      updatedAt: snapshot ? snapshot.updatedAt : (meta.updatedAt || new Date().toISOString()),
      syncSource: snapshot ? snapshot.source : (meta.syncSource || "local-sync-client"),
      semester: queryParams.semester,
      classes: filtered,
    };
  }

  // 开发环境 Demo 降级
  if (config.NODE_ENV !== "production") {
    return getDemoClassSchedule(queryParams);
  }

  return {
    success: false,
    dataSource: "empty",
    reasonCode: "NO_SCHEDULE_SYNCED",
    message: "暂未同步该专业课表，可稍后再试或联系维护者补充同步。",
    classes: [],
  };
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
  } = params;

  const queryParams = {
    semester: semester || "2025-2026-2",
    collegeCode,
    collegeName,
    teacherTitleCode: titleCode,
    keyword,
  };

  const mode = config.DATA_SOURCE_MODE;

  // 1. disabled
  if (mode === "disabled") {
    return {
      success: false,
      message: "教务课表查询服务暂时关闭维护中。",
    };
  }

  // 2. realtime
  if (mode === "realtime") {
    const host = new URL(config.FOSU_BASE_URL).hostname;
    const canResolve = await checkDns(host);
    if (!canResolve) {
      return {
        success: false,
        reasonCode: "FOSU_INTRANET_ONLY",
        message: "100.fosu.edu.cn 仅校园网或 EasyConnect VPN 可访问，当前服务器无法直连。",
      };
    }

    try {
      safeLog("teacher-schedule-fetch-realtime", { keyword });
      const adapter = new FosuQiangzhiAdapter();
      const res = await adapter.fetchTeacherSchedule({
        semester: queryParams.semester,
        collegeCode: queryParams.collegeCode || "02",
        teacherTitleCode: queryParams.teacherTitleCode,
      });

      if (res.statusCode !== 200) {
        throw new Error(`教务教师课表接口请求失败，HTTP 状态码: ${res.statusCode}`);
      }

      const parsed = parser.parseTeacherScheduleIfrHtml(res.text, {
        semester: queryParams.semester,
      });

      const courses = normalizer.normalizeCourseList(parsed.courses || [], {
        semester: queryParams.semester,
        sourceType: "teacher",
        audienceType: "teacher",
      });
      
      const warnings = parsed.warnings || [];
      const grouped = normalizer.groupCoursesBy(courses, "teacherName", "未知教师");

      let teachers = Object.keys(grouped).map((tName) => ({
        teacherName: tName,
        college: collegeName || "已知院系",
        title: "",
        courses: grouped[tName],
      }));

      if (keyword) {
        const cleanKeyword = String(keyword).trim().toLowerCase();
        teachers = teachers.filter((t) => 
          t.teacherName.toLowerCase().includes(cleanKeyword)
        );
      }

      return {
        success: true,
        dataSource: "fosu-realtime",
        updatedAt: new Date().toISOString(),
        teachers,
        warnings,
      };
    } catch (error) {
      safeLog("teacher-schedule-realtime-failed", { error: error.message });
      return {
        success: false,
        reasonCode: "FOSU_INTRANET_ONLY",
        message: `无法实时连接教务系统获取教师课表: ${error.message}`,
      };
    }
  }

  // 3. cache-first
  const snapshot = getSnapshot();
  const allTeacherSchedules = snapshot && snapshot.resources && Array.isArray(snapshot.resources.teacherSchedules)
    ? snapshot.resources.teacherSchedules
    : readJsonFile(FILE_MAP["teacher-schedules"]);
  if (Array.isArray(allTeacherSchedules) && allTeacherSchedules.length > 0) {
    let filtered = allTeacherSchedules;
    if (keyword) {
      const cleanKeyword = String(keyword).trim().toLowerCase();
      filtered = filtered.filter((t) =>
        t.teacherName.toLowerCase().includes(cleanKeyword)
      );
    }

    const meta = getMeta("teacher-schedules");
    return {
      success: true,
      dataSource: snapshot ? "snapshot" : "cache",
      updatedAt: snapshot ? snapshot.updatedAt : (meta.updatedAt || new Date().toISOString()),
      syncSource: snapshot ? snapshot.source : (meta.syncSource || "local-sync-client"),
      teachers: filtered,
    };
  }

  // 开发环境 Demo 降级
  if (config.NODE_ENV !== "production") {
    return getDemoTeacherSchedule(queryParams);
  }

  return {
    success: false,
    dataSource: "empty",
    reasonCode: "NO_SYNC_DATA",
    message: "暂未同步该范围的课表数据。",
  };
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
  } = params;

  const queryParams = {
    semester: semester || "2025-2026-2",
    collegeCode,
    campusId,
    buildingId,
    classroomName,
  };

  const mode = config.DATA_SOURCE_MODE;

  // 1. disabled
  if (mode === "disabled") {
    return {
      success: false,
      message: "教务课表查询服务暂时关闭维护中。",
    };
  }

  // 2. realtime
  if (mode === "realtime") {
    const host = new URL(config.FOSU_BASE_URL).hostname;
    const canResolve = await checkDns(host);
    if (!canResolve) {
      return {
        success: false,
        reasonCode: "FOSU_INTRANET_ONLY",
        message: "100.fosu.edu.cn 仅校园网或 EasyConnect VPN 可访问，当前服务器无法直连。",
      };
    }

    try {
      safeLog("classroom-schedule-fetch-realtime", { classroomName });
      const adapter = new FosuQiangzhiAdapter();
      const res = await adapter.fetchClassroomSchedule({
        semester: queryParams.semester,
        collegeCode: queryParams.collegeCode,
        campusId: queryParams.campusId,
        buildingId: queryParams.buildingId,
      });

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

      return {
        success: true,
        dataSource: "fosu-realtime",
        updatedAt: new Date().toISOString(),
        classrooms,
        warnings,
      };
    } catch (error) {
      safeLog("classroom-schedule-realtime-failed", { error: error.message });
      return {
        success: false,
        reasonCode: "FOSU_INTRANET_ONLY",
        message: `无法实时连接教务系统获取教室课表: ${error.message}`,
      };
    }
  }

  // 3. cache-first
  const snapshot = getSnapshot();
  const allClassroomSchedules = snapshot && snapshot.resources && Array.isArray(snapshot.resources.classroomSchedules)
    ? snapshot.resources.classroomSchedules
    : readJsonFile(FILE_MAP["classroom-schedules"]);
  if (Array.isArray(allClassroomSchedules) && allClassroomSchedules.length > 0) {
    let filtered = allClassroomSchedules;
    if (classroomName) {
      const cleanKeyword = String(classroomName).trim().toLowerCase();
      filtered = filtered.filter((r) =>
        r.roomName.toLowerCase().includes(cleanKeyword)
      );
    }

    const meta = getMeta("classroom-schedules");
    return {
      success: true,
      dataSource: snapshot ? "snapshot" : "cache",
      updatedAt: snapshot ? snapshot.updatedAt : (meta.updatedAt || new Date().toISOString()),
      syncSource: snapshot ? snapshot.source : (meta.syncSource || "local-sync-client"),
      classrooms: filtered,
    };
  }

  // 开发环境 Demo 降级
  if (config.NODE_ENV !== "production") {
    return getDemoClassroomSchedule(queryParams);
  }

  return {
    success: false,
    dataSource: "empty",
    reasonCode: "NO_SYNC_DATA",
    message: "暂未同步该范围的课表数据。",
  };
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
  } = params;

  const queryParams = {
    semester: semester || "2025-2026-2",
    collegeCode,
    openCollegeCode,
    courseAttr,
    courseName,
  };

  const mode = config.DATA_SOURCE_MODE;

  // 1. disabled
  if (mode === "disabled") {
    return {
      success: false,
      message: "教务课表查询服务暂时关闭维护中。",
    };
  }

  // 2. realtime
  if (mode === "realtime") {
    const host = new URL(config.FOSU_BASE_URL).hostname;
    const canResolve = await checkDns(host);
    if (!canResolve) {
      return {
        success: false,
        reasonCode: "FOSU_INTRANET_ONLY",
        message: "100.fosu.edu.cn 仅校园网或 EasyConnect VPN 可访问，当前服务器无法直连。",
      };
    }

    try {
      safeLog("course-schedule-fetch-realtime", { courseName });
      const adapter = new FosuQiangzhiAdapter();
      const res = await adapter.fetchCourseSchedule({
        semester: queryParams.semester,
        collegeCode: queryParams.collegeCode,
        openCollegeCode: queryParams.openCollegeCode,
        courseAttr: queryParams.courseAttr,
        courseName: queryParams.courseName,
      });

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

      return {
        success: true,
        dataSource: "fosu-realtime",
        updatedAt: new Date().toISOString(),
        coursesList,
        warnings,
      };
    } catch (error) {
      safeLog("course-schedule-realtime-failed", { error: error.message });
      return {
        success: false,
        reasonCode: "FOSU_INTRANET_ONLY",
        message: `无法实时连接教务系统获取课程课表: ${error.message}`,
      };
    }
  }

  // 3. cache-first
  const snapshot = getSnapshot();
  const allCourseSchedules = snapshot && snapshot.resources && Array.isArray(snapshot.resources.courseSchedules)
    ? snapshot.resources.courseSchedules
    : readJsonFile(FILE_MAP["course-schedules"]);
  if (Array.isArray(allCourseSchedules) && allCourseSchedules.length > 0) {
    let filtered = allCourseSchedules;
    if (courseName) {
      const cleanKeyword = String(courseName).trim().toLowerCase();
      filtered = filtered.filter((c) =>
        c.courseName.toLowerCase().includes(cleanKeyword)
      );
    }

    const meta = getMeta("course-schedules");
    return {
      success: true,
      dataSource: snapshot ? "snapshot" : "cache",
      updatedAt: snapshot ? snapshot.updatedAt : (meta.updatedAt || new Date().toISOString()),
      syncSource: snapshot ? snapshot.source : (meta.syncSource || "local-sync-client"),
      coursesList: filtered,
    };
  }

  // 开发环境 Demo 降级
  if (config.NODE_ENV !== "production") {
    return getDemoCourseSchedule(queryParams);
  }

  return {
    success: false,
    dataSource: "empty",
    reasonCode: "NO_SYNC_DATA",
    message: "暂未同步该范围的课表数据。",
  };
}

module.exports = {
  getClassSchedule,
  getTeacherSchedule,
  getClassroomSchedule,
  getCourseSchedule,
};
