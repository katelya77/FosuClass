const publicData = require('../client');

module.exports = async function findEmptyClassrooms(args) {
  const input = args && typeof args === 'object' ? args : {};
  const date = publicData.isoDate(input.date);
  const sections = publicData.text(input.sections, 5);
  const building = publicData.text(input.building, 40);
  const range = sections.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!date || !range || Number(range[1]) < 1 || Number(range[2]) > 14 || Number(range[1]) > Number(range[2])
      || publicData.isSensitive(building)) {
    return publicData.resultError('请提供日期及明确的节次范围，例如第 3 到 4 节；不要输入个人信息。');
  }

  try {
    const calendarResult = await publicData.getCalendar(date);
    const calendar = calendarResult.calendar;
    const week = calendarResult.week;
    if (!week || !Number.isInteger(Number(week.weekNo)) || !calendar.releaseVersion) {
      return publicData.resultError('该日期不在已发布教学周内，无法核实空教室。请打开周历确认日期。');
    }
    const query = {
      date,
      week: Number(week.weekNo),
      sections,
      building,
      term: publicData.text(calendar.term, 40),
      releaseVersion: publicData.text(calendar.releaseVersion, 80),
      excludeUnknown: 1,
    };
    const data = await publicData.get('/api/fosu/empty-classrooms', query);
    if (data.releaseVersion !== query.releaseVersion || (data.term && data.term !== query.term)) {
      return publicData.resultError('课表版本发生变化，请稍后重试空教室查询。');
    }
    const rooms = (Array.isArray(data.rooms) ? data.rooms : []).slice(0, 8).map((room) => ({
      roomName: publicData.text(room.roomName, 60),
      building: publicData.text(room.building, 40),
      campus: publicData.text(room.campus, 40),
    })).filter((room) => room.roomName);
    const total = Math.max(0, Number(data.total) || 0);
    const pagePath = `/pages/empty-room/empty-room?${publicData.queryString({
      date, sections, building, term: query.term, releaseVersion: query.releaseVersion,
    })}`;
    const summary = total
      ? `${date} 第 ${sections.replace('-', ' 至 ')} 节查到 ${total} 间候选空教室，展示前 ${rooms.length} 间。结果基于已发布课表，临时占用请以现场为准。`
      : `${date} 第 ${sections.replace('-', ' 至 ')} 节未查到符合条件的空教室。可更换楼栋或节次。`;
    return publicData.resultOk(summary, {
      date, sections, building, term: query.term, releaseVersion: query.releaseVersion,
      total, rooms, pageTitle: '打开空教室查询', pagePath,
    }, publicData.pageHandoff(pagePath));
  } catch (error) {
    return publicData.resultError('空教室数据暂不可用。请稍后重试，或进入佛课小表查看已缓存的数据。');
  }
};
