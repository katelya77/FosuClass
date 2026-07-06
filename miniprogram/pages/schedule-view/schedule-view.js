const BRAND = require("../../config/brand");
const { courseTimes } = require("../../data/courseTimes");
const { buildScheduleColumns, normalizeCourse } = require("../../utils/course");
const { getSettings, getCurrentScheduleTarget, setCurrentScheduleTarget } = require("../../utils/storage");
const customCourseService = require("../../services/customCourseService");
const releasePackService = require("../../services/releasePackService");
const teachingCalendarService = require("../../services/teachingCalendarService");
const {
  TOTAL_WEEKS,
  addLocalDays,
  clampWeek,
  formatDateLabel,
  formatWeekRange,
  getCurrentTeachingWeek,
  getTodayTeachingInfo,
  getVisibleWeekdays,
  getWeekRangeByWeekNo,
} = require("../../utils/week");

const SECTION_HEIGHT = 90;
const WEEKEND_DAY_WIDTH = 142;
const TIME_AXIS_WIDTH = 76;

function getContentWidthRpx() {
  return 750 - 32; // padding 左右各 16
}

function calendarChanged(left, right) {
  if (!left || !right) return Boolean(left || right);
  return left.term !== right.term ||
    left.releaseVersion !== right.releaseVersion ||
    JSON.stringify(left.termConfig || {}) !== JSON.stringify(right.termConfig || {}) ||
    JSON.stringify((left.weeks || []).map((week) => [week.weekNo, week.startDate, week.endDate])) !==
      JSON.stringify((right.weeks || []).map((week) => [week.weekNo, week.startDate, week.endDate]));
}

function getTypeText(type) {
  switch (type) {
    case "class": return "班级课表";
    case "teacher": return "教师课表";
    case "classroom": return "教室课表";
    case "course": return "课程安排";
    default: return "课表";
  }
}

function safeDecodeURIComponent(value) {
  const text = String(value || "");
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

function isTruthyParam(value) {
  return value === true || value === "1" || value === "true";
}

function parsePositiveIntParam(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function getScheduleKindText(type, displayType, isAggregated) {
  if (type !== "class") {
    return getTypeText(type);
  }
  if (isAggregated || displayType === "major-schedule" || displayType === "major-shared-schedule") {
    return "专业聚合课表 · 暂未拆分行政班";
  }
  return "行政班级课表";
}

function getWeekdayText(weekday) {
  const map = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return map[Number(weekday)] || "";
}

function getCourseOverview(courses) {
  return (courses || []).map(normalizeCourse).map((course, index) => Object.assign({}, course, {
    overviewKey: `${course.id || course.courseName || "course"}-${index}`,
    weekdayText: getWeekdayText(course.weekday),
    sectionText: `第${course.startSection}-${course.endSection}节`,
  }));
}

Page({
  data: {
    brand: BRAND,
    type: "class",
    typeText: "班级课表",
    name: "",
    title: "",
    semester: "",
    displayType: "",
    isAggregated: false,
    scheduleKindText: "行政班级课表",
    isCurrentTarget: false,
    allCourses: [],
    overviewCourses: [],
    overviewExpanded: true,
    hasCurrentWeekCourses: false,
    hasVisibleWeekCourses: false,
    visibleWeekCourseCount: 0,
    currentWeekCourseCount: 0,
    scheduleMeta: null,
    
    currentWeek: 12,
    totalWeeks: TOTAL_WEEKS,
    weekRangeText: "",
    weekScopeText: "周一至周五",
    weekSwitcherLabel: "",
    sections: courseTimes,
    sectionHeight: SECTION_HEIGHT,
    scheduleHeight: courseTimes.length * SECTION_HEIGHT,
    gridWidth: 718,
    dayTrackWidth: 642,
    dayColumnWidth: 128,
    weekdays: [],
    dayColumns: [],
    showWeekend: false,
    detailVisible: false,
    selectedCourse: null,
    isFromShare: false,
  },

  onLoad(options) {
    const { type = "class", name = "", id = "", semester = "", term = "", releaseVersion = "", displayType = "", isAggregated = "", shareScheduleId = "", week = "", weekday = "" } = options;
    const decodedName = safeDecodeURIComponent(name);
    const decodedId = safeDecodeURIComponent(id);
    const immediateCalendar = teachingCalendarService.getImmediateActiveCalendar();
    const runtimeTerm = immediateCalendar.termConfig && immediateCalendar.termConfig.term || immediateCalendar.term || "";
    const decodedSemester = safeDecodeURIComponent(term || semester || runtimeTerm);
    const localActiveRelease = releasePackService.getLocalActiveRelease(decodedSemester);
    const decodedReleaseVersion = safeDecodeURIComponent(releaseVersion) ||
      (localActiveRelease && localActiveRelease.releaseVersion) ||
      "";
    const decodedDisplayType = safeDecodeURIComponent(displayType);
    const aggregated = isTruthyParam(isAggregated) || decodedDisplayType === "major-schedule" || decodedDisplayType === "major-shared-schedule";
    const title = decodedName || decodedId;
    const isFromShare = !!shareScheduleId;
    this._initialWeek = parsePositiveIntParam(week);
    this._initialWeekday = parsePositiveIntParam(weekday);
    
    this.setData({
      type,
      typeText: getTypeText(type),
      name: decodedName || decodedId,
      title,
      semester: decodedSemester,
      displayType: decodedDisplayType,
      isAggregated: aggregated,
      scheduleKindText: getScheduleKindText(type, decodedDisplayType, aggregated),
      isFromShare,
    });

    if (title) {
      wx.setNavigationBarTitle({
        title,
      });
    }

    // 检查是否已经是当前的绑定目标
    this.checkCurrentTargetStatus();

    // 通过 EventChannel 获取上一页传过来的课程数据
    let hasLoadedData = false;
    const eventChannel = this.getOpenerEventChannel();
    if (eventChannel && typeof eventChannel.on === "function") {
      eventChannel.on("acceptDataFromOpenerPage", (data) => {
        if (data && Array.isArray(data.courses)) {
          hasLoadedData = true;
          const schedule = data.schedule || {};
          const nextDisplayType = schedule.displayType || this.data.displayType;
          const nextAggregated = Boolean(schedule.isAggregated || this.data.isAggregated || nextDisplayType === "major-schedule" || nextDisplayType === "major-shared-schedule");
          this.setData({
            allCourses: data.courses,
            displayType: nextDisplayType,
            isAggregated: nextAggregated,
            scheduleKindText: getScheduleKindText(this.data.type, nextDisplayType, nextAggregated),
            scheduleMeta: schedule,
          }, () => {
            this.initScheduleLayout();
          });
        }
      });
    }

    // 降级与分享异步拉取处理
    setTimeout(() => {
      if (!hasLoadedData && (decodedName || decodedId)) {
        wx.showLoading({ title: "正在拉取课表..." });
        const loadByIndexedId = Boolean(decodedId);

        if (loadByIndexedId) {
          if (!type || !decodedId || !decodedReleaseVersion) {
            wx.hideLoading();
            this.showScheduleOpenError();
            this.initScheduleLayout();
            return;
          }
          releasePackService.loadDetail(type, decodedId, {
            term: decodedSemester,
            releaseVersion: decodedReleaseVersion,
          }, {
            forceNetwork: true,
            timeout: 15000,
            retries: 1,
          })
            .then((res) => {
              wx.hideLoading();
              const schedule = res.schedule || res.detail || {};
              const courses = Array.isArray(schedule.courses) ? schedule.courses : [];
              if (!res || res.success === false || !courses.length) {
                this.showScheduleOpenError({ type });
                this.initScheduleLayout();
                return;
              }
              this.setData({
                name: decodedName || schedule.className || schedule.teacherName || schedule.roomName || schedule.courseName || decodedId,
                title: decodedName || schedule.className || schedule.teacherName || schedule.roomName || schedule.courseName || decodedId,
                allCourses: courses,
                scheduleMeta: Object.assign({}, schedule, {
                  scheduleVersion: res.releaseVersion || res.version || decodedReleaseVersion,
                }),
              }, () => {
                this.initScheduleLayout();
              });
            })
            .catch((err) => {
              wx.hideLoading();
              console.error("按索引拉取课表失败", err);
              if (type === "classroom" && decodedName) {
                this.openResolvedClassroomSchedule(decodedName, decodedSemester, decodedReleaseVersion, err);
                return;
              }
              this.showScheduleOpenError({ type });
              this.initScheduleLayout();
            });
          return;
        }

        const request = require("../../utils/request");
        let apiUrl = "/api/fosu/class-schedule";
        let requestParams = {
          semester: decodedSemester,
        };

        if (type === "teacher") {
          apiUrl = "/api/fosu/teacher-schedule";
          requestParams.keyword = decodedName;
        } else if (type === "classroom") {
          apiUrl = "/api/fosu/classroom-schedule";
          requestParams.classroomName = decodedName;
        } else if (type === "course") {
          apiUrl = "/api/fosu/course-schedule";
          requestParams.courseName = decodedName;
        } else {
          apiUrl = "/api/fosu/class-schedule";
          requestParams.className = decodedName;
        }

        request.post(apiUrl, requestParams, { showLoading: false, silentError: true })
          .then((res) => {
            wx.hideLoading();
            let courses = [];
            let scheduleMeta = null;
            if (res && res.success) {
              if (type === "class" && Array.isArray(res.classes) && res.classes.length > 0) {
                courses = res.classes[0].courses || [];
                scheduleMeta = res.classes[0];
              } else if (type === "teacher" && Array.isArray(res.teachers) && res.teachers.length > 0) {
                courses = res.teachers[0].courses || [];
              } else if (type === "classroom" && Array.isArray(res.classrooms) && res.classrooms.length > 0) {
                courses = res.classrooms[0].courses || [];
              } else if (type === "course" && Array.isArray(res.coursesList) && res.coursesList.length > 0) {
                courses = res.coursesList[0].courses || [];
              }
            }

            this.setData({
              allCourses: courses,
              scheduleMeta: scheduleMeta || this.data.scheduleMeta,
            }, () => {
              this.initScheduleLayout();
            });
          })
          .catch((err) => {
            wx.hideLoading();
            console.error("异步拉取课表失败", err);
            this.initScheduleLayout();
          });
      } else if (!hasLoadedData) {
        this.initScheduleLayout();
      }
    }, 300);
  },

  checkCurrentTargetStatus() {
    const currentTarget = getCurrentScheduleTarget();
    const meta = this.data.scheduleMeta || {};
    const currentId = currentTarget && (currentTarget.detailId || currentTarget.id || currentTarget.classId || "");
    const detailId = meta.detailId || meta.id || meta.scheduleId || meta.classId || "";
    const isCurrent = currentTarget &&
                      currentTarget.type === this.data.type &&
                      (currentId && detailId ? currentId === detailId : currentTarget.name === this.data.name) &&
                      (currentTarget.term || currentTarget.semester) === this.data.semester;
    this.setData({
      isCurrentTarget: Boolean(isCurrent),
    });
  },

  openResolvedClassroomSchedule(roomName, term, releaseVersion, originalError) {
    wx.showLoading({ title: "正在重新定位教室..." });
    releasePackService.resolveClassroomDetail(roomName, {
      term,
      releaseVersion,
    }, {
      timeout: 15000,
      retries: 1,
    })
      .then((res) => {
        wx.hideLoading();
        const schedule = res.schedule || res.detail || {};
        const courses = Array.isArray(schedule.courses) ? schedule.courses : [];
        if (!courses.length) {
          this.showScheduleOpenError({ type: "classroom" });
          this.initScheduleLayout();
          return;
        }
        this.setData({
          name: schedule.roomName || schedule.classroomName || roomName,
          title: schedule.roomName || schedule.classroomName || roomName,
          allCourses: courses,
          scheduleMeta: Object.assign({}, schedule, {
            id: res.detailId || res.resolvedId || schedule.id || "",
            detailId: res.detailId || res.resolvedId || schedule.id || "",
            scheduleVersion: res.releaseVersion || res.version || releaseVersion,
          }),
        }, () => {
          this.initScheduleLayout();
        });
      })
      .catch((error) => {
        wx.hideLoading();
        console.error("按教室名解析课表失败", error, originalError);
        this.showScheduleOpenError({ type: "classroom" });
        this.initScheduleLayout();
      });
  },

  showScheduleOpenError(options = {}) {
    const isClassroom = options.type === "classroom" || this.data.type === "classroom";
    wx.showModal({
      title: "未找到课表",
      content: isClassroom
        ? "该教室暂无课表详情，但空闲结果仍可参考。"
        : "该链接对应的课表不存在或已被新版本替换，可返回全校搜索重新查找。",
      confirmText: "去全校",
      cancelText: "留在此页",
      success: (res) => {
        if (res.confirm) {
          wx.switchTab({
            url: "/pages/school/school",
          });
        }
      },
    });
  },

  initScheduleLayout() {
    const settings = getSettings();
    const calendar = teachingCalendarService.getImmediateActiveCalendar({ term: this.data.semester });
    const termConfig = calendar.termConfig || {};
    const now = new Date();
    const currentWeek = this._initialWeek
      ? clampWeek(this._initialWeek, termConfig)
      : settings.manualWeekOverride
      ? clampWeek(settings.currentWeek, termConfig)
      : getCurrentTeachingWeek(now, calendar.weeks || [], termConfig);
    const showWeekend = this._initialWeekday >= 6 ? true : (settings.showWeekend || false);
    this.activeTeachingCalendar = calendar;
      
    this.setData({
      currentWeek,
      totalWeeks: termConfig.totalWeeks || TOTAL_WEEKS,
      showWeekend,
      weekendShowMode: settings.weekendShowMode || "overview",
    }, () => {
      this.renderSchedule();
    });
    teachingCalendarService.loadActiveTeachingCalendar({ term: this.data.semester })
      .then((latest) => {
        if (!calendarChanged(this.activeTeachingCalendar, latest)) return;
        this.activeTeachingCalendar = latest;
        const latestConfig = latest.termConfig || {};
        const nextWeek = this._initialWeek
          ? clampWeek(this._initialWeek, latestConfig)
          : getSettings().manualWeekOverride
          ? clampWeek(getSettings().currentWeek, latestConfig)
          : getCurrentTeachingWeek(new Date(), latest.weeks || [], latestConfig);
        this.setData({
          currentWeek: nextWeek,
          totalWeeks: latestConfig.totalWeeks || TOTAL_WEEKS,
        }, () => this.renderSchedule());
      })
      .catch(() => {});
  },

  renderSchedule() {
    const settings = getSettings();
    const calendar = this.activeTeachingCalendar || teachingCalendarService.getImmediateActiveCalendar({ term: this.data.semester });
    const termConfig = calendar.termConfig || {};
    const now = new Date();
    const todayInfo = getTodayTeachingInfo(now, calendar.weeks || [], termConfig);
    const currentWeek = this.data.currentWeek;
    const weekInfo = getWeekRangeByWeekNo(currentWeek, calendar.weeks || [], termConfig);
    
    const showWeekend = this.data.showWeekend;
    const weekendShowMode = this.data.weekendShowMode || "overview";
    const baseWeekdays = getVisibleWeekdays(showWeekend, now);
    
    const weekdays = baseWeekdays.map((day, index) => {
      const date = addLocalDays(weekInfo.startDate, index);
      return Object.assign({}, day, {
        dateLabel: formatDateLabel(date),
        isToday: currentWeek === todayInfo.weekNo && day.weekday === todayInfo.weekday,
      });
    });

    const courses = this.data.allCourses.map(normalizeCourse);
    const meta = this.data.scheduleMeta || {};
    const dayColumns = buildScheduleColumns(courses, weekdays, currentWeek, {
      sectionHeight: SECTION_HEIGHT,
      hideInactiveCourses: settings.hideInactiveCourses,
      targetType: this.data.type,
      targetId: meta.detailId || meta.id || meta.classId || this.data.name || "",
      targetName: this.data.name,
      semester: this.data.semester,
      releaseVersion: meta.scheduleVersion || meta.releaseVersion || "",
    });
    const currentWeekCourseCount = dayColumns.reduce((total, day) => total + (day.activeCourseCount || 0), 0);
    const visibleWeekCourseCount = dayColumns.reduce((total, day) => total + (day.visibleCourseCount || 0), 0);

    const contentWidth = getContentWidthRpx();
    let dayColumnWidth = 128;
    let scrollX = false;

    if (showWeekend) {
      if (weekendShowMode === "detail") {
        dayColumnWidth = WEEKEND_DAY_WIDTH; // 142
        scrollX = true;
      } else {
        // 七天概览模式，一屏显示周一至周日，无横滚
        dayColumnWidth = Math.floor((contentWidth - TIME_AXIS_WIDTH) / 7); // (750 - 32 - 76) / 7 = 91
        scrollX = false;
      }
    } else {
      // 五天详细，一屏无横滚
      dayColumnWidth = Math.floor((contentWidth - TIME_AXIS_WIDTH) / 5); // 128
      scrollX = false;
    }

    const dayTrackWidth = dayColumnWidth * weekdays.length;
    const gridWidth = TIME_AXIS_WIDTH + dayTrackWidth;
    const weekRangeText = formatWeekRange(weekInfo.startDate, weekInfo.endDate);
    const weekSwitcherLabel = weekRangeText ? `${weekRangeText} · 第${currentWeek}周` : `日期待同步 · 第${currentWeek}周`;

    this.setData({
      weekRangeText,
      weekScopeText: showWeekend ? "周一至周日" : "周一至周五",
      weekSwitcherLabel,
      gridWidth,
      dayTrackWidth,
      dayColumnWidth,
      weekdays,
      dayColumns,
      scrollX,
      weekendShowMode,
      overviewCourses: getCourseOverview(this.data.allCourses),
      hasCurrentWeekCourses: currentWeekCourseCount > 0,
      hasVisibleWeekCourses: visibleWeekCourseCount > 0,
      currentWeekCourseCount,
      visibleWeekCourseCount,
    });
  },

  onWeekChange(event) {
    const type = event.detail.type;
    const calendar = this.activeTeachingCalendar || teachingCalendarService.getImmediateActiveCalendar({ term: this.data.semester });
    const termConfig = calendar.termConfig || {};
    const nextWeek = type === "current"
      ? getCurrentTeachingWeek(new Date(), calendar.weeks || [], termConfig)
      : clampWeek(event.detail.week, termConfig);
    
    this.setData({
      currentWeek: nextWeek,
    }, () => {
      this.renderSchedule();
    });
  },

  toggleBindTarget() {
    if (this.data.isCurrentTarget) {
      wx.showToast({
        title: "已是当前首页课表",
        icon: "none",
      });
      return;
    }

    const nowStr = new Date().toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
    const meta = this.data.scheduleMeta || {};
    const releaseVersion = meta.scheduleVersion || meta.releaseVersion || meta.version || "";
    const detailId = meta.detailId || meta.id || meta.scheduleId || meta.classId || this.data.name || "";
    const target = {
      type: this.data.type,
      id: meta.id || detailId,
      detailId,
      name: this.data.name,
      term: this.data.semester,
      semester: this.data.semester,
      courses: this.data.allCourses,
      updateTime: nowStr,
      classId: meta.classId || "",
      className: meta.className || this.data.name || "",
      displayType: meta.displayType || this.data.displayType || "",
      isAggregated: this.data.isAggregated,
      releaseVersion,
      source: "schedule-view",
    };

    setCurrentScheduleTarget(target);

    this.setData({
      isCurrentTarget: true,
    });

    wx.showToast({
      title: "绑定首页成功",
      icon: "success",
      duration: 1200,
    });

    setTimeout(() => {
      wx.switchTab({
        url: "/pages/index/index",
      });
    }, 1000);
  },

  onCourseTap(event) {
    this.setData({
      selectedCourse: event.detail.course,
      detailVisible: true,
    });
  },

  toggleOverview() {
    this.setData({
      overviewExpanded: !this.data.overviewExpanded,
    });
  },

  onOverviewCourseTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    const course = this.data.overviewCourses[index];
    if (!course) return;
    this.setData({
      selectedCourse: course,
      detailVisible: true,
    });
  },

  closeCourseDetail() {
    this.setData({
      selectedCourse: null,
      detailVisible: false,
    });
  },

  onCopyCourseToCustom(event) {
    try {
      customCourseService.saveCustomCourseDraft(event.detail.course || this.data.selectedCourse);
      this.closeCourseDetail();
      wx.navigateTo({
        url: "/pages/custom-courses/custom-courses",
      });
    } catch (error) {
      wx.showToast({
        title: "课程信息不完整",
        icon: "none",
      });
    }
  },

  onShareAppMessage() {
    const meta = this.data.scheduleMeta || {};
    const detailId = meta.detailId || meta.id || meta.classId || this.data.name || "";
    const releaseVersion = meta.scheduleVersion || meta.releaseVersion || "";
    return {
      title: `${this.data.name}的课程安排 · ${BRAND.appName}`,
      path: `/pages/schedule-view/schedule-view?shareScheduleId=${encodeURIComponent(meta.classId || this.data.name)}&id=${encodeURIComponent(detailId)}&name=${encodeURIComponent(this.data.name)}&type=${this.data.type}&semester=${encodeURIComponent(this.data.semester)}&term=${encodeURIComponent(this.data.semester)}&releaseVersion=${encodeURIComponent(releaseVersion)}&displayType=${encodeURIComponent(this.data.displayType || "")}&isAggregated=${this.data.isAggregated ? "1" : "0"}&preview=1`
    };
  }
});
