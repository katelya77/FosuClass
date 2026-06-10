const {
  formatWeekRange,
  getRuntimeTermConfig,
  getTodayTeachingInfo,
} = require("../../utils/week");
const teachingCalendarService = require("../../services/teachingCalendarService");

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
    this.setData({
      loading: true,
      title: `${termConfig.semesterText || termConfig.term || "当前学期"}教学周历`,
      currentWeekText: "正在获取当前学期",
    });

    teachingCalendarService.loadActiveTeachingCalendar({ timeout: 8000 })
      .then((calendar) => {
        if (seq !== this._calendarSeq) return;
        const todayInfo = getTodayTeachingInfo(new Date(), calendar.weeks || [], calendar.termConfig || termConfig);
        const phaseText = this.getPhaseText(todayInfo.termPhase);
        this.setData({
          loading: false,
          title: `${calendar.semesterText || termConfig.semesterText || calendar.term || "当前学期"}教学周历`,
          currentWeek: todayInfo.isInTerm ? todayInfo.weekNo : 0,
          currentWeekText: todayInfo.isInTerm
            ? `${todayInfo.dateLabel} ${todayInfo.weekdayLabel} 第${todayInfo.weekNo}周`
            : phaseText,
          phaseText,
          weeks: (calendar.weeks || []).map((item) => Object.assign({}, item, {
            rangeText: item.startDate && item.endDate ? formatWeekRange(item.startDate, item.endDate) : "",
            typeText: this.getTypeText(item.type),
            active: todayInfo.termPhase === "in-term" && item.weekNo === todayInfo.weekNo,
          })),
        });
      })
      .catch(() => {
        if (seq !== this._calendarSeq) return;
        const todayInfo = getTodayTeachingInfo(new Date(), [], termConfig);
        const phaseText = this.getPhaseText(todayInfo.termPhase);
        this.setData({
          loading: false,
          phaseText,
          currentWeekText: phaseText || "教学安排待维护",
          weeks: [],
        });
      });
  },

  getPhaseText(phase) {
    if (phase === "before-term") return "尚未开学";
    if (phase === "after-term") return "本学期已结束";
    if (phase === "unknown") return "学期日期待配置";
    return "";
  },

  getTypeText(type) {
    const map = {
      opening: "开学",
      teaching: "教学",
      holiday: "假期",
      adjustment: "调整",
      midterm: "期中",
      closing: "结课",
      review: "复习",
      exam: "考试",
      flexible: "机动",
      pending: "待维护",
    };
    return map[type] || "教学";
  },
});
