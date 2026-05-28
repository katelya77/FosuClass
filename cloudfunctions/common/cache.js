const { mockClasses, mockCourses } = require("./mockData");

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

function classKey(params) {
  if (params && params.className) {
    return `class:${params.className}`;
  }
  return `class:${(params && params.semester) || "2025-2026-2"}:${(params && params.collegeCode) || ""}:${(params && params.grade) || ""}:${(params && params.majorCode) || ""}`;
}

function teacherKey(params) {
  return `teacher:${(params && (params.teacherName || params.teacherCode)) || ""}:${(params && params.semester) || "2025-2026-2"}`;
}

function genericKey(type, params) {
  return `${type}:${JSON.stringify(params || {})}`;
}

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
    semesters: [{ code: "2025-2026-2", name: "2025-2026学年第二学期" }],
    colleges,
    grades,
    majors,
    classes: classNames,
    updatedAt: nowIso(),
  };
}

function getSchoolOptions() {
  return STORE.schoolOptions || buildDefaultSchoolOptions();
}

function saveSchoolOptions(options) {
  STORE.schoolOptions = Object.assign({}, options || {}, {
    updatedAt: nowIso(),
  });
  return STORE.schoolOptions;
}

function saveClassSchedules(classes, params) {
  (classes || []).forEach((item) => {
    STORE.classSchedules[classKey({ className: item.className })] = Object.assign({}, item, {
      params: params || {},
      updatedAt: nowIso(),
    });
  });
  return classes || [];
}

function getClassSchedule(params) {
  const direct = STORE.classSchedules[classKey(params)];
  if (direct) {
    return direct;
  }
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
    STORE.teacherSchedules[teacherKey({ teacherName: item.teacherName, semester: params && params.semester })] = Object.assign({}, item, {
      params: params || {},
      updatedAt: nowIso(),
    });
  });
  return teachers || [];
}

function getTeacherSchedule(params) {
  return STORE.teacherSchedules[teacherKey(params)] || null;
}

function saveGenericSchedule(type, keyParams, payload) {
  STORE[`${type}Schedules`][genericKey(type, keyParams)] = Object.assign({}, payload || {}, {
    updatedAt: nowIso(),
  });
}

function getGenericSchedule(type, keyParams) {
  return STORE[`${type}Schedules`][genericKey(type, keyParams)] || null;
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
};
