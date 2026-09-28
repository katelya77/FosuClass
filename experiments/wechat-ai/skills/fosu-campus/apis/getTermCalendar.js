const publicData = require('../client');

module.exports = async function getTermCalendar() {
  try {
    const calendar = await publicData.get('/api/fosu/teaching-calendar');
    const term = publicData.text(calendar.term, 40);
    const releaseVersion = publicData.text(calendar.releaseVersion, 80);
    const weeks = (Array.isArray(calendar.weeks) ? calendar.weeks : [])
      .slice(0, 30)
      .map((week) => ({
        weekNo: Number(week.weekNo),
        startDate: publicData.text(week.startDate, 10),
        endDate: publicData.text(week.endDate, 10),
        title: publicData.text(week.title, 60),
        note: publicData.text(week.note || week.notes, 120),
      }))
      .filter((week) => Number.isInteger(week.weekNo) && week.weekNo > 0
        && /^\d{4}-\d{2}-\d{2}$/.test(week.startDate)
        && /^\d{4}-\d{2}-\d{2}$/.test(week.endDate));
    if (!term || !releaseVersion || !weeks.length) {
      return publicData.resultError('已发布学期校历暂不可用，请在佛课小表内查看周历。');
    }
    const pagePath = '/pages/calendar/calendar';
    return publicData.resultOk(`${term} 已发布 ${weeks.length} 个教学周。具体日期与标注以周历结果为准。`, {
      term, releaseVersion, weeks, pageTitle: '打开教学周历', pagePath,
    }, publicData.pageHandoff(pagePath));
  } catch (error) {
    return publicData.resultError('已发布学期校历暂不可用，请稍后重试。');
  }
};
