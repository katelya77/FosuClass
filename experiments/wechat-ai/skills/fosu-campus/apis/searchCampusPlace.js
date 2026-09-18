const publicData = require('../client');

module.exports = async function searchCampusPlace(args) {
  const keyword = publicData.text(args && args.keyword, 40);
  if (!keyword || publicData.isSensitive(keyword)) {
    return publicData.resultError('请提供要查找的公开校园地点名称，不要输入个人信息。');
  }
  try {
    const response = await publicData.get('/api/ai/campus-map/published');
    const data = response.data && typeof response.data === 'object' ? response.data : {};
    const normalized = keyword.replace(/\s+/g, '').toLowerCase();
    const matches = (Array.isArray(data.places) ? data.places : [])
      .filter((place) => place && place.verified === true)
      .filter((place) => [place.name, place.code, place.campus, place.area].concat(place.aliases || [])
        .some((value) => String(value || '').replace(/\s+/g, '').toLowerCase().includes(normalized)))
      .slice(0, 6)
      .map((place) => ({
        name: publicData.text(place.name, 60),
        campus: publicData.text(place.campus, 30),
        area: publicData.text(place.area, 30),
      }))
      .filter((place) => place.name);
    const pagePath = `/packageMaps/pages/campus-map/campus-map?${publicData.queryString({ q: keyword })}`;
    return publicData.resultOk(matches.length
      ? `已发布校园地图中找到 ${matches.length} 项已核验地点；具体位置以现场标识为准。`
      : '已发布校园地图中没有可核验的匹配地点，请在小程序内搜索或以现场标识为准。', {
      keyword, version: publicData.text(data.version, 60), matches,
      pageTitle: '打开校园地图', pagePath,
    }, publicData.pageHandoff(pagePath));
  } catch (error) {
    return publicData.resultError('已发布校园地图暂不可用，请稍后重试。');
  }
};
