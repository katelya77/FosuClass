const { mockCalendar } = require("../../data/mockCalendar");
const { formatWeekRange, getTodayTeachingInfo } = require("../../utils/week");

Page({
  data: {
    title: "2025-2026学年第二学期教学周历",
    currentWeek: 12,
    currentWeekText: "",
    weeks: [],
  },

  onShow() {
    const todayInfo = getTodayTeachingInfo(new Date(), mockCalendar);
    this.setData({
      currentWeek: todayInfo.weekNo,
      currentWeekText: `${todayInfo.dateLabel} ${todayInfo.weekdayLabel} · 第${todayInfo.weekNo}周`,
      weeks: mockCalendar.map((item) => Object.assign({}, item, {
        rangeText: formatWeekRange(item.startDate, item.endDate),
        active: item.weekNo === todayInfo.weekNo,
      })),
    });
  },
});
