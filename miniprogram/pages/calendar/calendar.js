const {
  formatWeekRange,
  getTodayTeachingInfo,
} = require("../../utils/week");
const teachingCalendarService = require("../../services/teachingCalendarService");

function lastValidWeekNo(weeks) {
  const list = Array.isArray(weeks) ? weeks : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const weekNo = Number(list[index] && list[index].weekNo);
    if (weekNo > 0) return weekNo;
  }
  return 0;
}

Page({
  data: {
    title: "教学周历",
    loading: true,
    phaseText: "",
    currentWeek: 0,
    currentWeekText: "",
    targetWeekNo: 0,
    weeks: [],
    scrollTop: 0,
    showBackToCurrentWeek: false,
  },

  onShow() {
    this._calendarSeq = (this._calendarSeq || 0) + 1;
    this._calendarUserScrolled = false;
    this._autoCentering = false;
    this._lastAutoCenteredWeek = 0;
    this._lastTargetScrollTop = 0;
    const seq = this._calendarSeq;
    const immediate = teachingCalendarService.getImmediateActiveCalendar();
    const termConfig = immediate.termConfig || {};
    this.renderCalendar(immediate, termConfig, { forceCenter: true });

    teachingCalendarService.loadActiveTeachingCalendar({ pointerTimeout: 1800, calendarTimeout: 2200 })
      .then((calendar) => {
        if (seq !== this._calendarSeq) return;
        this.renderCalendar(calendar, calendar.termConfig || termConfig, {
          forceCenter: false,
          allowChangedWeekCenter: true,
        });
      })
      .catch(() => {
        if (seq !== this._calendarSeq) return;
        const fallback = teachingCalendarService.getBuiltinCalendar("page-network-failed");
        this.renderCalendar(fallback, fallback.termConfig || termConfig, {
          forceCenter: false,
          allowChangedWeekCenter: true,
        });
      });
  },

  renderCalendar(calendar, termConfig, options = {}) {
    const effectiveConfig = calendar && calendar.termConfig || termConfig || {};
    const decorated = this.decorateWeeks(calendar, effectiveConfig);
    const todayInfo = getTodayTeachingInfo(new Date(), decorated, effectiveConfig);
    const phaseText = this.getPhaseText(todayInfo.termPhase);
    const targetWeekNo = this.resolveTargetWeekNo(todayInfo, decorated);
    const previousTarget = this.data.targetWeekNo;
    this.setData({
      loading: false,
      title: `${calendar.semesterText || effectiveConfig.semesterText || calendar.term || "当前学期"}教学周历`,
      currentWeek: todayInfo.isInTerm ? todayInfo.weekNo : 0,
      targetWeekNo,
      currentWeekText: todayInfo.isInTerm
        ? `${todayInfo.dateLabel} ${todayInfo.weekdayLabel} 第${todayInfo.weekNo}周`
        : (phaseText || "教学安排待维护"),
      phaseText,
      weeks: decorated,
    });

    const shouldCenter = targetWeekNo > 0 && (
      options.forceCenter ||
      (options.allowChangedWeekCenter && !this._calendarUserScrolled && targetWeekNo !== previousTarget)
    );
    if (shouldCenter) {
      this.centerTargetWeek({ force: options.forceCenter === true });
    }
  },

  resolveTargetWeekNo(todayInfo, weeks) {
    if (todayInfo.termPhase === "in-term" && todayInfo.weekNo > 0) return todayInfo.weekNo;
    if (todayInfo.termPhase === "before-term") return weeks.length ? Number(weeks[0].weekNo || 1) : 1;
    if (todayInfo.termPhase === "after-term") return lastValidWeekNo(weeks);
    return 0;
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

  centerTargetWeek(options = {}) {
    const targetWeekNo = Number(this.data.targetWeekNo || 0);
    if (!targetWeekNo) return;
    if (!options.force && this._calendarUserScrolled) return;
    if (!options.force && this._lastAutoCenteredWeek === targetWeekNo) return;
    const runAfterRender = wx && typeof wx.nextTick === "function"
      ? wx.nextTick.bind(wx)
      : (callback) => setTimeout(callback, 0);
    runAfterRender(() => {
      if (!wx || typeof wx.createSelectorQuery !== "function") return;
      const query = wx.createSelectorQuery().in(this);
      query.select(".week-scroll").boundingClientRect();
      query.select(`#week-${targetWeekNo}`).boundingClientRect();
      query.exec((rects) => {
        const scrollRect = rects && rects[0];
        const cardRect = rects && rects[1];
        if (!scrollRect || !cardRect) return;
        const currentTop = Number(this.data.scrollTop || 0);
        const targetTop = Math.max(
          0,
          currentTop + cardRect.top - scrollRect.top - (scrollRect.height / 2) + (cardRect.height / 2)
        );
        this._autoCentering = true;
        this._lastTargetScrollTop = targetTop;
        this._lastAutoCenteredWeek = targetWeekNo;
        this.setData({
          scrollTop: targetTop,
          showBackToCurrentWeek: false,
        });
        setTimeout(() => {
          this._autoCentering = false;
        }, 240);
      });
    });
  },

  onCalendarScroll(event) {
    const scrollTop = Number(event.detail && event.detail.scrollTop || 0);
    if (this._autoCentering) {
      this._lastScrollTop = scrollTop;
      return;
    }
    this._calendarUserScrolled = true;
    this._lastScrollTop = scrollTop;
    const targetWeekNo = Number(this.data.targetWeekNo || 0);
    const distance = Math.abs(scrollTop - Number(this._lastTargetScrollTop || 0));
    const shouldShow = targetWeekNo > 0 && distance > 260;
    if (shouldShow !== this.data.showBackToCurrentWeek) {
      this.setData({ showBackToCurrentWeek: shouldShow });
    }
  },

  backToCurrentWeek() {
    this._calendarUserScrolled = false;
    this.centerTargetWeek({ force: true });
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
