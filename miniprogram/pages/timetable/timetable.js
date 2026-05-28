const { courseTimes } = require("../../data/courseTimes");

function groupTimes(times) {
  const groups = [];
  times.forEach((item) => {
    let group = groups.find((entry) => entry.period === item.period);
    if (!group) {
      group = {
        period: item.period,
        items: [],
      };
      groups.push(group);
    }
    group.items.push(item);
  });
  return groups;
}

Page({
  data: {
    groups: groupTimes(courseTimes),
  },
});
