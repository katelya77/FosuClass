const { mockClasses, mockCourses } = require("./mockData");
const { termCachePart } = require("./term");

// 内存级缓存容器
const CACHE_STORE = {};

// 旧版内存存储，用作备用和容灾
const STORE = {
  schoolOptions: null,
  classSchedules: {},
  teacherSchedules: {},
  classroomSchedules: {},
  courseSchedules: {},
};

function nowIso() {
  return new Date().toISOString();
}

/**
 * 缓存读写助手
 */
function setCache(key, data, ttlMinutes) {
  CACHE_STORE[key] = {
    data: JSON.parse(JSON.stringify(data)), // 深拷贝
    expiresAt: Date.now() + ttlMinutes * 60 * 1000,
    updatedAt: nowIso(),
  };
}

function getCache(key) {
  const item = CACHE_STORE[key];
  if (!item) {
    return null;
  }
  if (Date.now() > item.expiresAt) {
    delete CACHE_STORE[key];
    return null;
  }
  return item.data;
}

/**
 * 统一的缓存 Key 生成器
 */
function getCatalogKey(semester) {
  return `catalog:${termCachePart(semester)}`;
}

function getMajorsKey(collegeCode, grade, semester) {
  return `majors:${termCachePart(semester)}:${collegeCode || ""}:${grade || ""}`;
}

function classKey(params) {
  if (params && params.className) {
    return `class:${termCachePart(params.semester)}:${params.className}`;
  }
  return `class:${termCachePart(params && params.semester)}:${(params && params.collegeCode) || ""}:${(params && params.grade) || ""}:${(params && params.majorCode) || ""}`;
}

function teacherKey(params) {
  return `teacher:${termCachePart(params && params.semester)}:${(params && (params.teacherName || params.teacherCode)) || ""}`;
}

function genericKey(type, params) {
  return `${type}:${JSON.stringify(params || {})}`;
}

/**
 * 备用的硬编码选项，当教务网不可达时回退使用
 */
function buildDefaultSchoolOptions() {
  const colleges = [];
  const grades = [];
  const majors = [];
  const classNames = [];
  const seen = {};

  mockClasses.forEach((item) => {
    if (!seen[`college:${item.college}`]) {
      seen[`college:${item.college}`] = true;
      colleges.push({ code: item.collegeCode || "", name: item.college });
    }
    if (!seen[`grade:${item.grade}`]) {
      seen[`grade:${item.grade}`] = true;
      grades.push(item.grade);
    }
    if (!seen[`major:${item.major}:${item.grade}`]) {
      seen[`major:${item.major}:${item.grade}`] = true;
      majors.push({
        code: item.majorCode || "",
        name: item.major,
        collegeCode: item.collegeCode || "",
        grade: item.grade,
      });
    }
    classNames.push({
      className: item.className,
      college: item.college,
      grade: item.grade,
      major: item.major,
      cached: Boolean(item.scheduleReady),
    });
  });

  return {
    semesters: [],
    colleges,
    grades,
    majors,
    classes: classNames,
    updatedAt: nowIso(),
  };
}

// ================== Catalog 缓存读写 ==================

function getSchoolOptions(semester) {
  const cacheKey = getCatalogKey(semester);
  const cached = getCache(cacheKey);
  if (cached) {
    return cached;
  }
  // 读旧版或默认值
  return STORE.schoolOptions || buildDefaultSchoolOptions();
}

function saveSchoolOptions(options, semester) {
  const cacheKey = getCatalogKey(semester);
  const enriched = Object.assign({}, options || {}, {
    updatedAt: nowIso(),
  });
  // 缓存 10 分钟
  setCache(cacheKey, enriched, 10);
  STORE.schoolOptions = enriched;
  return enriched;
}

// ================== Majors 缓存读写 ==================

function getMajorsByCollegeCache(collegeCode, grade, semester) {
  const key = getMajorsKey(collegeCode, grade, semester);
  return getCache(key);
}

function saveMajorsByCollegeCache(collegeCode, grade, majors, semester) {
  const key = getMajorsKey(collegeCode, grade, semester);
  // 缓存 30 分钟
  setCache(key, majors, 30);
}

// ================== 课表缓存读写 ==================

function saveClassSchedules(classes, params) {
  (classes || []).forEach((item) => {
    const key = classKey({ className: item.className, semester: params && params.semester });
    const payload = Object.assign({}, item, {
      params: params || {},
      updatedAt: nowIso(),
    });
    // 班级课表缓存 10 分钟
    setCache(key, payload, 10);
    STORE.classSchedules[key] = payload;
  });
  return classes || [];
}

function getClassSchedule(params) {
  const key = classKey(params);
  const cached = getCache(key);
  if (cached) {
    return cached;
  }
  const direct = STORE.classSchedules[key];
  if (direct) {
    return direct;
  }
  // 回退：演示班级数据
  const className = params && params.className;
  if (!className) {
    return null;
  }
  const courses = mockCourses.filter((course) => course.className === className);
  if (!courses.length) {
    return null;
  }
  return {
    className,
    courses,
    updatedAt: nowIso(),
  };
}

function saveTeacherSchedules(teachers, params) {
  (teachers || []).forEach((item) => {
    const key = teacherKey({ teacherName: item.teacherName, semester: params && params.semester });
    const payload = Object.assign({}, item, {
      params: params || {},
      updatedAt: nowIso(),
    });
    // 教师课表缓存 10 分钟
    setCache(key, payload, 10);
    STORE.teacherSchedules[key] = payload;
  });
  return teachers || [];
}

function getTeacherSchedule(params) {
  const key = teacherKey(params);
  const cached = getCache(key);
  if (cached) {
    return cached;
  }
  return STORE.teacherSchedules[key] || null;
}

function saveGenericSchedule(type, keyParams, payload) {
  const key = genericKey(type, keyParams);
  const data = Object.assign({}, payload || {}, {
    updatedAt: nowIso(),
  });
  // 教室/课程课表缓存 10 分钟
  setCache(key, data, 10);
  STORE[`${type}Schedules`][key] = data;
}

function getGenericSchedule(type, keyParams) {
  const key = genericKey(type, keyParams);
  const cached = getCache(key);
  if (cached) {
    return cached;
  }
  return STORE[`${type}Schedules`][key] || null;
}

function getCachedSchedule(params) {
  const type = (params && params.type) || "class";
  if (type === "teacher") {
    return getTeacherSchedule(params);
  }
  if (type === "classroom") {
    return getGenericSchedule("classroom", params);
  }
  if (type === "course") {
    return getGenericSchedule("course", params);
  }
  return getClassSchedule(params);
}

module.exports = {
  getCachedSchedule,
  getClassSchedule,
  getGenericSchedule,
  getSchoolOptions,
  getTeacherSchedule,
  saveClassSchedules,
  saveGenericSchedule,
  saveSchoolOptions,
  saveTeacherSchedules,
  getMajorsByCollegeCache,
  saveMajorsByCollegeCache,
};
