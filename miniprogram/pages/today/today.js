const {
  getCourseDataSource,
  getCourseStatus,
  getCourseTimeRange,
  getCoursesByClass,
  getTodayCourses,
  groupElectiveLikeCourses,
  normalizeCourse,
} = require("../../utils/course");
const { mockCalendar } = require("../../data/mockCalendar");
const { getSettings } = require("../../utils/storage");
const { clampWeek, getCurrentTeachingWeek, getTodayTeachingInfo, getTodayWeekday } = require("../../utils/week");


function getStatusText(status, isNext) {
  if (status === "ongoing") {
    return "正在上课";
  }
  if (isNext) {
    return "下一节";
  }
  if (status === "finished") {
    return "已结束";
  }
  return "未开始";
}

function decorateTodayCourses(courses, now) {
  const decorated = courses.map((course) => {
    const status = getCourseStatus(course, now);
    return Object.assign({}, course, {
      active: status !== "finished",
      sectionText: `第${course.startSection}-${course.endSection}节`,
      status,
      timeText: getCourseTimeRange(course),
    });
  });
  const nextIndex = decorated.findIndex((course) => course.status === "upcoming");
  return decorated.map((course, index) => {
    const isNext = index === nextIndex;
    return Object.assign({}, course, {
      isNext,
      statusText: getStatusText(course.status, isNext),
    });
  });
}

function normalizeCourseName(courseName) {
  if (!courseName) return "";
  return courseName.replace(/[\(\（].*?[\)\）]/g, "").trim();
}

function getCurrentBoundSchedule() {
  const settings = getSettings();
  const target = wx.getStorageSync("FOSU_CURRENT_SCHEDULE_TARGET");
  const currentSchedule = wx.getStorageSync("CURRENT_SCHEDULE") || wx.getStorageSync("SELECTED_SCHEDULE");
  
  let classId = settings.classId || target?.classId || currentSchedule?.classId || "";
  let className = settings.className || target?.name || target?.className || currentSchedule?.className || currentSchedule?.name || "";
  
  let semester = target?.semester || currentSchedule?.semester || settings.semester || "2025-2026-2";
  let schedule = null;
  let source = "";

  if (target && Array.isArray(target.courses) && target.courses.length > 0) {
    schedule = target;
    source = "FOSU_CURRENT_SCHEDULE_TARGET";
  } else if (currentSchedule && Array.isArray(currentSchedule.courses) && currentSchedule.courses.length > 0) {
    schedule = currentSchedule;
    source = "CURRENT_SCHEDULE_OR_SELECTED_SCHEDULE";
  }

  const { getCoursesByClass } = require("../../utils/course");
  if (!schedule && className) {
    const courses = getCoursesByClass(className);
    if (courses && courses.length) {
      schedule = {
        classId,
        className,
        semester,
        courses,
      };
      source = "fallback_by_classname";
    }
  }

  return {
    classId: classId || "",
    className: className || "",
    semester,
    schedule,
    source
  };
}

function isCourseActiveInCurrentWeek(course, currentWeek) {
  if (!course) return false;
  
  const current = Number(currentWeek);
  
  if (Array.isArray(course.weeks) && course.weeks.length > 0) {
    return course.weeks.map(Number).includes(current);
  }

  const possibleFields = [
    course.weekText,
    course.rawWeek,
    course.weekRange,
    typeof course.weeks === 'string' ? course.weeks : ''
  ];

  const weekStr = possibleFields.find(f => f && typeof f === 'string' && f.trim() !== '');

  if (!weekStr) {
    if (typeof course.startWeek === 'number' && typeof course.endWeek === 'number') {
      const start = course.startWeek;
      const end = course.endWeek;
      if (current >= start && current <= end) {
        if (course.weekType === 'odd' && current % 2 === 0) return false;
        if (course.weekType === 'even' && current % 2 !== 0) return false;
        return true;
      }
      return false;
    }
    course.isUncertainWeek = true;
    console.warn("[周次过滤] 课程无有效周次字段，标记为 uncertain:", course.courseName, course);
    return false;
  }

  try {
    const normalizedStr = weekStr.replace(/\s+/g, "");
    
    let isOddOnly = normalizedStr.includes("单");
    let isEvenOnly = normalizedStr.includes("双");
    
    const cleanStr = normalizedStr.replace(/[周单双]/g, "");
    const parts = cleanStr.split(/[,，]/);
    let matched = false;

    for (const part of parts) {
      if (!part) continue;
      if (part.includes("-")) {
        const range = part.split("-").map(Number);
        if (range.length === 2 && !isNaN(range[0]) && !isNaN(range[1])) {
          const start = range[0];
          const end = range[1];
          if (current >= start && current <= end) {
            matched = true;
            break;
          }
        }
      } else {
        const single = Number(part);
        if (!isNaN(single) && single === current) {
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      if (isOddOnly && current % 2 === 0) return false;
      if (isEvenOnly && current % 2 !== 0) return false;
      return true;
    }
    
    return false;
  } catch (error) {
    course.isUncertainWeek = true;
    console.error("[周次过滤] 周次解析错误，标记为 uncertain:", weekStr, course.courseName, error);
    return false;
  }
}

Page({
  data: {
    dateText: "",
    weekdayText: "",
    className: "25动物医学6",
    currentWeek: 12,
    dataSourceText: "教务课表 · 本地缓存",
    courseCountText: "今日共 0 门课",
    courses: [],
    selectedCourse: null,
    detailVisible: false,
    emptyTitle: "今天没有课程，好好休息",
    emptyDesc: "这里会根据当前班级、教学周和星期自动筛选课程。"
  },

  onShow() {
    this.loadToday();
  },

  loadToday() {
    const settings = getSettings();
    const now = new Date();
    const todayInfo = getTodayTeachingInfo(now, mockCalendar);
    const weekday = getTodayWeekday(now);
    const currentWeek = settings.manualWeekOverride
      ? clampWeek(settings.currentWeek)
      : getCurrentTeachingWeek(now, mockCalendar);

    const boundInfo = getCurrentBoundSchedule();
    const { classId, className, semester, schedule, source } = boundInfo;

    if (!schedule || !Array.isArray(schedule.courses) || schedule.courses.length === 0) {
      this.setData({
        dateText: todayInfo.fullDateLabel,
        weekdayText: todayInfo.weekdayLabel,
        className: className || "未选择当前课表",
        currentWeek,
        dataSourceText: "未绑定课表",
        courseCountText: "今日共 0 门课",
        courses: [],
        emptyTitle: "未绑定当前课表",
        emptyDesc: "请先前往「全校」页面查找班级，并在课表详情页点击「设为当前」进行绑定。"
      });

      const envVersion = wx.getSystemInfoSync().platform === 'devtools' || (wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram.envVersion === 'develop');
      if (envVersion) {
        console.log("========== [开发环境今日页面调试日志] ==========");
        console.log("- 未找到绑定课表，请前往绑定");
        console.log("===============================================");
      }
      return;
    }

    const sourceCourses = schedule.courses.map(normalizeCourse);
    const rawTodayCount = sourceCourses.length;

    let filteredOutCount = 0;
    const todayRawCourses = sourceCourses.filter(course => {
      const inWeek = isCourseActiveInCurrentWeek(course, currentWeek);
      const isToday = Number(course.weekday) === Number(weekday);
      const matchesSemester = !course.semester || course.semester === semester;
      
      let classMatches = true;
      if (className && course.className) {
        if (course.className !== className) {
          classMatches = false;
        }
      }

      const startSectionValid = typeof course.startSection === 'number' && !isNaN(course.startSection);
      const endSectionValid = typeof course.endSection === 'number' && !isNaN(course.endSection);
      const sectionValid = startSectionValid && endSectionValid && course.startSection <= course.endSection;

      const keep = inWeek && isToday && matchesSemester && classMatches && sectionValid;
      if (!keep) {
        filteredOutCount++;
      }
      return keep;
    });

    const seenStrictKeys = new Set();
    const strictUniqueCourses = [];
    todayRawCourses.forEach((c) => {
      const sem = c.semester || semester || "2025-2026-2";
      const clsName = c.className || className || "未知班级";
      const teacher = c.teacherName || "";
      const room = c.classroom || "";
      
      const strictKey = [
        sem,
        clsName,
        currentWeek,
        weekday,
        c.startSection,
        c.endSection,
        c.courseName,
        room,
        teacher
      ].join("_");
      
      if (!seenStrictKeys.has(strictKey)) {
        seenStrictKeys.add(strictKey);
        strictUniqueCourses.push(c);
      }
    });

    const resolvedClass = classId || className || "未知班级";
    const groups = {};
    const groupKeys = [];

    strictUniqueCourses.forEach((c) => {
      const sem = c.semester || semester || "2025-2026-2";
      const normName = normalizeCourseName(c.courseName);
      
      const displayGroupKey = [
        sem,
        resolvedClass,
        currentWeek,
        weekday,
        c.startSection,
        c.endSection,
        normName
      ].join("_");

      if (!groups[displayGroupKey]) {
        groups[displayGroupKey] = [];
        groupKeys.push(displayGroupKey);
      }
      groups[displayGroupKey].push(c);
    });

    const displayCourses = [];
    const mergedGroups = [];

    groupKeys.forEach((key) => {
      const group = groups[key];
      if (group.length === 1) {
        const single = Object.assign({}, group[0]);
        displayCourses.push(single);
      } else {
        const base = Object.assign({}, group[0]);
        const normName = normalizeCourseName(base.courseName);

        const classrooms = [...new Set(group.map(c => c.classroom).filter(Boolean))];
        const teachers = [...new Set(group.map(c => c.teacherName).filter(Boolean))];

        let resolvedClassroom = base.classroom;
        if (classrooms.length > 1) {
          resolvedClassroom = "多个地点";
        } else if (classrooms.length === 0) {
          resolvedClassroom = "多地点/见教师通知";
        }

        let resolvedTeacher = base.teacherName;
        if (teachers.length > 1) {
          resolvedTeacher = "多个教师";
        } else if (teachers.length === 0) {
          resolvedTeacher = "见教师通知";
        }

        const isPhysicalEducation = normName.includes("体育") || normName.includes("大学体育") || group.some(c => (c.courseName || "").includes("体育"));

        if (isPhysicalEducation) {
          resolvedClassroom = "多个地点";
          resolvedTeacher = "多个教师";
          base.remark = "体育课地点以教师/实际选课通知为准";
        } else {
          base.remark = group.map((c, i) => `[地点${i+1}] 教师: ${c.teacherName || "未知"}, 教室: ${c.classroom || "未知"}`).join("\n");
        }

        base.id = key;
        base.courseName = normName;
        base.classroom = resolvedClassroom;
        base.teacherName = resolvedTeacher;
        base.isMerged = true;
        base.mergedCount = group.length;

        displayCourses.push(base);

        mergedGroups.push({
          key,
          courseName: normName,
          count: group.length,
          items: group.map(c => ({ classroom: c.classroom, teacherName: c.teacherName }))
        });
      }
    });

    displayCourses.sort((a, b) => {
      if (a.startSection !== b.startSection) {
        return a.startSection - b.startSection;
      }
      if (a.endSection !== b.endSection) {
        return a.endSection - b.endSection;
      }
      return (a.courseName || "").localeCompare(b.courseName || "", "zh");
    });

    const courses = decorateTodayCourses(displayCourses, now);
    const dataSource = getCourseDataSource();

    let displayClassName = className;
    const target = wx.getStorageSync("FOSU_CURRENT_SCHEDULE_TARGET");
    if (target) {
      displayClassName = target.type === "teacher"
        ? `${target.name} 老师`
        : (target.type === "classroom" ? `${target.name} 教室` : target.name);
    }

    this.setData({
      dateText: todayInfo.fullDateLabel,
      weekdayText: todayInfo.weekdayLabel,
      className: displayClassName,
      currentWeek,
      dataSourceText: dataSource.text,
      courseCountText: `今日共 ${courses.length} 门课`,
      courses,
      emptyTitle: "今天没有课程，好好休息",
      emptyDesc: "这里会根据当前班级、教学周和星期自动筛选课程。"
    });

    const envVersion = wx.getSystemInfoSync().platform === 'devtools' || (wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram.envVersion === 'develop');
    if (envVersion) {
      console.log("========== [开发环境今日页面调试日志] ==========");
      console.log("- 当前绑定课表 (className/classId): " + className + " / " + (classId || "无"));
      console.log("- 原始今日课程数量 (rawTodayCount):", rawTodayCount);
      console.log("- 过滤后进入去重的今日课程数量:", todayRawCourses.length);
      console.log("- 被过滤课程数量 (filteredOutCount):", filteredOutCount);
      console.log("- 合并后展示课程数量 (displayTodayCount):", courses.length);
      console.log("- 被合并课程组 (mergedGroups):", JSON.stringify(mergedGroups, null, 2));
      console.log("===============================================");
    }
  },


  onCourseTap(event) {
    this.setData({
      selectedCourse: event.detail.course,
      detailVisible: true,
    });
  },

  closeCourseDetail() {
    this.setData({
      selectedCourse: null,
      detailVisible: false,
    });
  },
});
