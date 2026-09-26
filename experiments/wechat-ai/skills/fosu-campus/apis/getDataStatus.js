const publicData = require('../client');

module.exports = async function getDataStatus() {
  try {
    const response = await publicData.get('/api/fosu/app-config');
    const config = response.data && typeof response.data === 'object' ? response.data : {};
    const releaseVersion = publicData.text(config.releaseVersion || config.dataVersion && config.dataVersion.releaseVersion, 80);
    const term = publicData.text(config.term || config.currentSemester, 40);
    if (!releaseVersion || !term) {
      return publicData.resultError('当前发布版本暂无法核实，请在佛课小表内查看数据状态。');
    }
    const publishedAt = publicData.text(config.publishedAt || config.dataUpdatedAt, 40);
    const pagePath = '/pages/school/school';
    return publicData.resultOk(`当前已发布学期 ${term}，数据版本 ${releaseVersion}${publishedAt ? `，更新时间 ${publishedAt}` : ''}。`, {
      term, releaseVersion, publishedAt, pageTitle: '打开全校课表', pagePath,
    }, publicData.pageHandoff(pagePath));
  } catch (error) {
    return publicData.resultError('发布数据状态暂不可用，请稍后重试。');
  }
};
