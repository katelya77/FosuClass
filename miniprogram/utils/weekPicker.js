const { TOTAL_WEEKS, formatWeekRange, getWeekRangeByWeekNo } = require("./week");

function buildWeekPickerOptions(calendar) {
  const source = calendar || {};
  const config = source.termConfig || {};
  const count = Math.max(1, Number(config.totalWeeks || TOTAL_WEEKS));
  return Array.from({ length: count }, (_, index) => {
    const week = index + 1;
    const range = getWeekRangeByWeekNo(week, source.weeks || [], config);
    return {
      week,
      rangeText: range.startDate && range.endDate
        ? formatWeekRange(range.startDate, range.endDate)
        : "日期待同步",
    };
  });
}

module.exports = { buildWeekPickerOptions };
