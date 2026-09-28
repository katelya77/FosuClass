const publicData = require('../client');

const CAMPUS = new Set(['仙溪校区', '江湾校区', '河滨校区']);
const DATE_HINTS = new Set(['today', 'tomorrow']);

module.exports = async function getCampusWeather(args) {
  const input = args && typeof args === 'object' ? args : {};
  const campus = publicData.text(input.campus, 20);
  const dateHint = publicData.text(input.dateHint || 'today', 20);
  if (!CAMPUS.has(campus) || !DATE_HINTS.has(dateHint)) {
    return publicData.resultError('请明确仙溪、江湾或河滨校区，以及今天或明天。');
  }
  try {
    const response = await publicData.get('/api/ai/weather', { campus, dateHint });
    const weather = response.weather && typeof response.weather === 'object' ? response.weather : {};
    if (weather.success === false || !weather.weatherText || !weather.updatedAt) {
      return publicData.resultError('校区天气数据暂不可用，请稍后重试。');
    }
    const result = {
      campus: publicData.text(weather.campus || campus, 20),
      dateLabel: dateHint === 'tomorrow' ? '明天' : '今天',
      weatherText: publicData.text(weather.weatherText, 40),
      updatedAt: publicData.text(weather.updatedAt, 40),
      sourceId: publicData.text(weather.sourceId, 80),
    };
    const temperature = Number(weather.temperatureC);
    if (weather.temperatureC != null && Number.isFinite(temperature)) result.temperatureC = temperature;
    const rain = Number(weather.rainProbabilityMax24h);
    if (weather.rainProbabilityMax24h != null && Number.isFinite(rain)) result.rainProbabilityMax24h = rain;
    const temperatureText = result.temperatureC === undefined ? '' : `，约 ${result.temperatureC}℃`;
    return publicData.resultOk(`${result.campus}附近${result.dateLabel}${result.weatherText}${temperatureText}。天气来源更新时间 ${result.updatedAt}；请以临近时段预报为准。`, result);
  } catch (error) {
    return publicData.resultError('校区天气数据暂不可用，请稍后重试。');
  }
};
