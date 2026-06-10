const {
  formatWeekRange,
  getRuntimeTermConfig,
  getTodayTeachingInfo,
} = require("../../utils/week");
const teachingCalendarService = require("../../services/teachingCalendarService");
const { getBuiltinTeachingCalendar } = require("../../data/builtinTeachingCalendar");

Page({
  data: {
    title: "教学周历",
    loading: true,
    phaseText: "",
    currentWeek: 0,
    currentWeekText: "",
    weeks: [],
  },

  onShow() {
    this._calendarSeq = (this._calendarSeq || 0) + 1;
    const seq = this._calendarSeq;
    const termConfig = getRuntimeTermConfig();
    const builtinSource = getBuiltinTeachingCalendar();
    const builtin = teachingCalendarService.normalizeCalendar(builtinSource, {
      termConfig: builtinSource.termConfig,
    });
    this.setData({
      loading: false,
      title: `${termConfig.semesterText || builtin.semesterText || termConfig.term || builtin.term || "当前学期"}教学周历`,
      currentWeekText: "正在获取当前学期",
      weeks: this.decorateWeeks(builtin, termConfig),
    });

    teachingCalendarService.loadActiveTeachingCalendar({ pointerTimeout: 1800, calendarTimeout: 2200 })
      .then((calendar) => {
        if (seq !== this._calendarSeq) return;
        const decorated = this.decorateWeeks(calendar, termConfig);
        const todayInfo = getTodayTeachingInfo(new Date(), decorated, calendar.termConfig || termConfig);
        const phaseText = this.getPhaseText(todayInfo.termPhase);
        this.setData({
          loading: false,
          title: `${calendar.semesterText || termConfig.semesterText || calendar.term || "当前学期"}教学周历`,
          currentWeek: todayInfo.isInTerm ? todayInfo.weekNo : 0,
          currentWeekText: todayInfo.isInTerm
            ? `${todayInfo.dateLabel} ${todayInfo.weekdayLabel} 第${todayInfo.weekNo}周`
            : phaseText,
          phaseText,
          weeks: decorated,
        });
      })
      .catch(() => {
        if (seq !== this._calendarSeq) return;
        const fallback = teachingCalendarService.getBuiltinCalendar("page-network-failed");
        const decorated = this.decorateWeeks(fallback, termConfig);
        const todayInfo = getTodayTeachingInfo(new Date(), decorated, fallback.termConfig || termConfig);
        const phaseText = this.getPhaseText(todayInfo.termPhase);
        this.setData({
          loading: false,
          phaseText,
          title: `${fallback.semesterText || termConfig.semesterText || "当前学期"}教学周历`,
          currentWeekText: todayInfo.isInTerm
            ? `${todayInfo.dateLabel} ${todayInfo.weekdayLabel} 第${todayInfo.weekNo}周`
            : (phaseText || "教学安排待维护"),
          weeks: decorated,
        });
      });
  },

  decorateWeeks(calendar, termConfig) {
    const weeks = calendar && Array.isArray(calendar.weeks) ? calendar.weeks : [];
    const effectiveConfig = calendar && calendar.termConfig || termConfig;
    const todayInfo = getTodayTeachingInfo(new Date(), weeks, effectiveConfig);
    return weeks.map((item) => Object.assign({}, item, {
      rangeText: item.startDate && item.endDate ? formatWeekRange(item.startDate, item.endDate) : "",
      typeText: item.typeText || this.getTypeText(item.type),
      active: todayInfo.termPhase === "in-term" && item.weekNo === todayInfo.weekNo,
    }));
  },

  getPhaseText(phase) {
    if (phase === "before-term") return "尚未开学";
    if (phase === "after-term") return "本学期已结束";
    if (phase === "unknown") return "学期日期待配置";
    return "";
  },

  getTypeText(type) {
    const map = {
      opening: "开学教学周",
      teaching: "正常教学周",
      holiday: "节假日/调休周",
      adjustment: "调整教学周",
      midterm: "期中教学检查",
      closing: "结课周",
      review: "复习周",
      exam: "考试周",
      flexible: "机动周",
      pending: "教学安排待维护",
    };
    return map[type] || "正常教学周";
  },
});
