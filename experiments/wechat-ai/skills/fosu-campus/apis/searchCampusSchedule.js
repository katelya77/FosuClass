const publicData = require('../client');

const TYPES = ['class', 'teacher', 'classroom', 'course'];

module.exports = async function searchCampusSchedule(args) {
  const input = args && typeof args === 'object' ? args : {};
  const type = publicData.text(input.type, 20);
  const keyword = publicData.text(input.keyword, 80);
  if (TYPES.indexOf(type) < 0 || !keyword || publicData.isSensitive(keyword)) {
    return publicData.resultError('请提供班级、教师、教室或课程的公开名称；不要输入学号、密码或登录凭据。');
  }

  try {
    const data = await publicData.get('/api/fosu/release-pack/search', { type, q: keyword, limit: 8 });
    const decision = data.decision && typeof data.decision === 'object' ? data.decision : {};
    const raw = decision.kind === 'unique' && decision.item
      ? [{ item: decision.item, name: decision.navigation && decision.navigation.name }]
      : (Array.isArray(decision.candidates) ? decision.candidates : []);
    const results = raw.slice(0, 8).map((candidate) => {
      const item = candidate.item || {};
      const name = publicData.text(candidate.name || item.teacherName || item.className || item.roomName || item.courseName, 80);
      const navigation = candidate.navigation || (decision.kind === 'unique' ? decision.navigation : null);
      const pagePath = navigation && navigation.canOpen
        && /^\/pages\/schedule-view\/schedule-view\?/.test(navigation.url || '')
        ? navigation.url : '';
      return name ? { name, pagePath } : null;
    }).filter(Boolean);
    const total = Math.max(0, Number(data.total) || 0);
    const pagePath = decision.kind === 'unique' && decision.navigation && decision.navigation.canOpen
      && /^\/pages\/schedule-view\/schedule-view\?/.test(decision.navigation.url || '')
      ? decision.navigation.url
      : `/pages/school/school?${publicData.queryString({ type, q: keyword })}`;
    const pageTitle = decision.kind === 'unique' && results[0] ? `查看${results[0].name}课表` : '打开全校课表搜索';
    const summary = total === 0
      ? `发布课表中未找到“${keyword}”。请换公开名称或到全校课表页面筛选。`
      : `发布课表中找到 ${total} 项匹配结果。${total > results.length ? `这里展示前 ${results.length} 项，请打开全校课表查看其余结果。` : '请核对名称后打开课表。'}`;
    return publicData.resultOk(summary, {
      type,
      keyword,
      total,
      results,
      term: publicData.text(data.term, 40),
      releaseVersion: publicData.text(data.releaseVersion, 80),
      pageTitle,
      pagePath,
    }, publicData.pageHandoff(pagePath));
  } catch (error) {
    return publicData.resultError('发布课表暂不可用。请稍后重试，或进入佛课小表查看已缓存的数据。');
  }
};
