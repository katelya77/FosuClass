const publicData = require('../client');

module.exports = async function getTeachingWeek(args) {
  const date = publicData.isoDate(args && args.date);
  if (!date) return publicData.resultError('日期格式无效，请使用年-月-日。');
  try {
    const result = await publicData.getCalendar(date);
    const calendar = result.calendar;
    const week = result.week;
    if (!week || !Number.isInteger(Number(week.weekNo))) {
      return publicData.resultOk(`${date} 不在已发布教学周内，无法确定该日期的教学周。`, {
        date, inTerm: false, term: publicData.text(calendar.term, 40),
        releaseVersion: publicData.text(calendar.releaseVersion, 80),
        pageTitle: '打开周历', pagePath: '/pages/calendar/calendar',
      }, publicData.pageHandoff('/pages/calendar/calendar'));
    }
    const info = {
      date, inTerm: true, weekNo: Number(week.weekNo),
      startDate: publicData.text(week.startDate, 10),
      endDate: publicData.text(week.endDate, 10),
      title: publicData.text(week.title, 60),
      note: publicData.text(week.note || week.notes, 180),
      term: publicData.text(calendar.term, 40),
      releaseVersion: publicData.text(calendar.releaseVersion, 80),
      pageTitle: '打开周历', pagePath: '/pages/calendar/calendar',
    };
    return publicData.resultOk(`${date} 属于${info.term}第 ${info.weekNo} 教学周（${info.startDate} 至 ${info.endDate}）。${info.title ? `周历标注：${info.title}。` : ''}`, info, publicData.pageHandoff(info.pagePath));
  } catch (error) {
    return publicData.resultError('教学周数据暂不可用。请稍后重试，或进入佛课小表查看已缓存的周历。');
  }
};
