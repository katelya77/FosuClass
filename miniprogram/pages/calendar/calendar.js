const { mockCalendar } = require("../../data/mockCalendar");
const { getSettings } = require("../../utils/storage");

Page({
  data: {
    title: "2025-2026学年第二学期教学周历",
    currentWeek: 12,
    weeks: [],
  },

  onShow() {
    const settings = getSettings();
    this.setData({
      currentWeek: settings.currentWeek,
      weeks: mockCalendar.map((item) => Object.assign({}, item, {
        active: item.week === settings.currentWeek,
      })),
    });
  },
});
