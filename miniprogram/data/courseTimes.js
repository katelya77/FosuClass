const courseTimes = [
  { section: 1, start: "08:00", end: "08:40", period: "上午", axisLabel: "08:00" },
  { section: 2, start: "08:45", end: "09:25", period: "上午", axisLabel: "09:25" },

  { section: 3, start: "09:40", end: "10:20", period: "上午", axisLabel: "09:40" },
  { section: 4, start: "10:25", end: "11:05", period: "上午", axisLabel: "11:05" },

  { section: 5, start: "11:10", end: "11:50", period: "上午", axisLabel: "11:50" },

  { section: 6, start: "13:30", end: "14:10", period: "下午", axisLabel: "13:30" },
  { section: 7, start: "14:15", end: "14:55", period: "下午", axisLabel: "14:55" },

  { section: 8, start: "15:10", end: "15:50", period: "下午", axisLabel: "15:10" },
  { section: 9, start: "15:55", end: "16:35", period: "下午", axisLabel: "16:35" },
  { section: 10, start: "16:40", end: "17:20", period: "下午", axisLabel: "17:20" },

  { section: 11, start: "18:30", end: "19:10", period: "晚上", axisLabel: "18:30" },
  { section: 12, start: "19:15", end: "19:55", period: "晚上", axisLabel: "19:55" },

  { section: 13, start: "20:05", end: "20:45", period: "晚上", axisLabel: "20:05" },
  { section: 14, start: "20:50", end: "21:30", period: "晚上", axisLabel: "21:30" },
];

const courseTimesMeta = {
  version: "26.05.29.02",
  name: "推荐作息时间",
  source: "参考伴你上课时间轴校准",
  updatedAt: "2026-05-29"
};

module.exports = {
  courseTimes,
  courseTimesMeta,
};

