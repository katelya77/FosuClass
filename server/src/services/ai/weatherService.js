const axios = require("axios");

const CACHE = new Map();
const DEFAULT_TTL_MS = 10 * 60 * 1000;
let weatherFetcher = axios.get;
const CAMPUS = {
  xiangxi: {
    id: "xiangxi",
    name: "仙溪校区",
    latitude: 23.0336,
    longitude: 113.1222,
  },
  jiangwan: {
    id: "jiangwan",
    name: "江湾校区",
    latitude: 23.0382,
    longitude: 113.1115,
  },
};

function normalizeCampus(value) {
  const text = String(value || "").toLowerCase();
  if (/江湾|jiang/.test(text)) return CAMPUS.jiangwan;
  return CAMPUS.xiangxi;
}

function getCache(key) {
  const item = CACHE.get(key);
  if (!item || item.expiresAt <= Date.now()) return null;
  return item.value;
}

function setCache(key, value, ttlMs) {
  CACHE.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

function weatherLabel(code) {
  const num = Number(code);
  if ([0, 1].includes(num)) return "晴或少云";
  if ([2, 3].includes(num)) return "多云";
  if ([45, 48].includes(num)) return "有雾";
  if ([51, 53, 55, 56, 57].includes(num)) return "毛毛雨";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(num)) return "有雨";
  if ([95, 96, 99].includes(num)) return "雷阵雨";
  return "天气待确认";
}

function buildAlerts(current = {}, hourly = {}) {
  const alerts = [];
  const temp = Number(current.temperature_2m);
  const wind = Number(current.wind_speed_10m);
  const rain = Number(current.precipitation);
  const code = Number(current.weather_code);
  if (Number.isFinite(rain) && rain >= 1) alerts.push("可能有降雨，出门带伞。");
  if (Number.isFinite(temp) && temp >= 33) alerts.push("气温偏高，注意补水和防晒。");
  if ([95, 96, 99].includes(code)) alerts.push("有雷暴风险，尽量避开露天长距离通行。");
  if (Number.isFinite(wind) && wind >= 28) alerts.push("风力偏大，骑行注意安全。");
  if (!alerts.length && hourly && Array.isArray(hourly.precipitation_probability)) {
    const maxRainProb = Math.max(...hourly.precipitation_probability.slice(0, 12).map((item) => Number(item) || 0));
    if (maxRainProb >= 60) alerts.push("短时降雨概率较高，建议预留通行时间。");
  }
  return alerts.slice(0, 3);
}

async function fetchOpenMeteo(campus) {
  const response = await weatherFetcher("https://api.open-meteo.com/v1/forecast", {
    timeout: Number(process.env.AI_WEATHER_TIMEOUT_MS || 3500) || 3500,
    params: {
      latitude: campus.latitude,
      longitude: campus.longitude,
      current: "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
      hourly: "temperature_2m,precipitation_probability,precipitation,weather_code",
      forecast_days: 2,
      timezone: "Asia/Shanghai",
    },
  });
  return response.data || {};
}

async function getCampusWeather(input = {}) {
  const campus = normalizeCampus(input.campus || input.campusId || input.message);
  if (String(process.env.AI_WEATHER_ENABLED || "true").toLowerCase() === "false") {
    return {
      success: false,
      code: "WEATHER_DISABLED",
      campus: campus.name,
      sourceId: "weather-disabled",
      summary: "天气服务未启用，课表工具不受影响。",
      alerts: [],
      cached: false,
    };
  }
  const key = `campus:${campus.id}`;
  const cached = getCache(key);
  if (cached) return Object.assign({}, cached, { cached: true });
  try {
    const data = await fetchOpenMeteo(campus);
    const current = data.current || {};
    const result = {
      success: true,
      campus: campus.name,
      provider: "open-meteo",
      sourceId: `open-meteo:${campus.id}`,
      updatedAt: current.time || new Date().toISOString(),
      temperatureC: Number(current.temperature_2m),
      humidity: Number(current.relative_humidity_2m),
      precipitationMm: Number(current.precipitation),
      windSpeedKmh: Number(current.wind_speed_10m),
      weatherCode: Number(current.weather_code),
      weatherText: weatherLabel(current.weather_code),
      alerts: buildAlerts(current, data.hourly || {}),
      summary: `${campus.name}${weatherLabel(current.weather_code)}，约 ${Number(current.temperature_2m) || 0}℃。`,
      cached: false,
    };
    return setCache(key, result, Number(process.env.AI_WEATHER_CACHE_TTL_MS || DEFAULT_TTL_MS) || DEFAULT_TTL_MS);
  } catch (error) {
    return {
      success: false,
      code: error.code || "WEATHER_PROVIDER_FAILED",
      campus: campus.name,
      sourceId: `open-meteo:${campus.id}`,
      summary: "天气暂时不可用，课表和空教室查询不受影响。",
      alerts: [],
      cached: false,
    };
  }
}

async function getCourseWeatherAdvice(input = {}) {
  const weather = await getCampusWeather(input);
  if (!weather.success) return weather;
  const advice = [];
  if (weather.alerts && weather.alerts.length) advice.push(...weather.alerts);
  if (Number(weather.temperatureC) >= 30) advice.push("上课前建议带水，跨楼栋通行预留 5-10 分钟。");
  if (Number(weather.precipitationMm) > 0) advice.push("课前通行尽量选择有遮挡路线。");
  if (!advice.length) advice.push("天气影响不大，按正常课前时间出发即可。");
  return Object.assign({}, weather, {
    advice: advice.slice(0, 4),
    summary: `${weather.campus}${weather.weatherText}，${advice[0]}`,
  });
}

function __resetForTest() {
  CACHE.clear();
  weatherFetcher = axios.get;
}

function __setFetcherForTest(fetcher) {
  CACHE.clear();
  weatherFetcher = typeof fetcher === "function" ? fetcher : axios.get;
}

module.exports = {
  __resetForTest,
  __setFetcherForTest,
  getCampusWeather,
  getCourseWeatherAdvice,
  normalizeCampus,
};
