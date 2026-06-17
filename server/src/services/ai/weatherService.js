const axios = require("axios");

const FRESH_CACHE = new Map();
const INFLIGHT = new Map();
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_STALE_MS = 60 * 60 * 1000;
let weatherFetcher = axios.get;
let nowFn = () => Date.now();

const CAMPUS = {
  xianxi: {
    id: "xianxi",
    name: "仙溪校区",
    latitude: 23.0336,
    longitude: 113.1222,
    configured: true,
  },
  jiangwan: {
    id: "jiangwan",
    name: "江湾校区",
    latitude: 23.0382,
    longitude: 113.1115,
    configured: true,
  },
  hebin: {
    id: "hebin",
    name: "河滨校区",
    configured: false,
  },
};

function fullWidthToHalfWidth(text) {
  return String(text || "").replace(/[\uFF01-\uFF5E]/g, (char) => {
    return String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
  });
}

function normalizeCampus(value) {
  const text = fullWidthToHalfWidth(value).trim().toLowerCase();
  if (/河滨|hebin|he\s*bin/.test(text)) return CAMPUS.hebin;
  if (/江湾|jiangwan|jiang\s*wan/.test(text)) return CAMPUS.jiangwan;
  if (/仙溪|xianxi|xiangxi|xian\s*xi|xiang\s*xi/.test(text)) return CAMPUS.xianxi;
  return null;
}

function resolveCampus(input = {}) {
  return normalizeCampus(input.campus || input.campusId || input.message) || CAMPUS.xianxi;
}

function readCache(key) {
  const item = FRESH_CACHE.get(key);
  if (!item) return { fresh: null, stale: null };
  const now = nowFn();
  const fresh = item.expiresAt > now ? Object.assign({}, item.value, { cached: true, stale: false }) : null;
  const stale = item.staleExpiresAt > now ? Object.assign({}, item.value, { cached: true, stale: true }) : null;
  return { fresh, stale };
}

function writeCache(key, value, ttlMs, staleMs) {
  const now = nowFn();
  FRESH_CACHE.set(key, {
    value: Object.assign({}, value, { cached: false, stale: false }),
    expiresAt: now + ttlMs,
    staleExpiresAt: now + staleMs,
  });
  return value;
}

function numberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function roundNumber(value, digits = 0) {
  const num = numberOrNull(value);
  if (num == null) return null;
  const factor = 10 ** digits;
  return Math.round(num * factor) / factor;
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

function compactHourLabel(value) {
  const text = String(value || "");
  const match = text.match(/T(\d{2}):/);
  return match ? `${match[1]}时` : text.slice(11, 16);
}

function getNextHours(hourly = {}, updatedAt) {
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  const temperatures = Array.isArray(hourly.temperature_2m) ? hourly.temperature_2m : [];
  const rainProb = Array.isArray(hourly.precipitation_probability) ? hourly.precipitation_probability : [];
  let startIndex = 0;
  if (updatedAt && times.length) {
    const exact = times.findIndex((item) => String(item).slice(0, 13) === String(updatedAt).slice(0, 13));
    startIndex = exact >= 0 ? exact : 0;
  }
  const output = [];
  for (let offset = 0; output.length < 6 && startIndex + offset < Math.max(times.length, temperatures.length, rainProb.length); offset += 1) {
    const index = startIndex + offset;
    output.push({
      time: compactHourLabel(times[index] || ""),
      temperatureC: roundNumber(temperatures[index], 0),
      rainProbability: Math.max(0, Math.min(100, roundNumber(rainProb[index], 0) || 0)),
    });
  }
  return output;
}

function maxRainProbability(hourly = {}, hours = 24) {
  const values = Array.isArray(hourly.precipitation_probability) ? hourly.precipitation_probability : [];
  if (!values.length) return 0;
  return Math.max(...values.slice(0, hours).map((item) => Math.max(0, Math.min(100, Number(item) || 0))));
}

function buildAdvice(result) {
  const advice = [];
  if (Number(result.precipitationMm) >= 1 || Number(result.rainProbabilityMax24h) >= 60) {
    advice.push("短时降雨概率较高，建议带伞并预留通行时间。");
  }
  if (Number(result.temperatureC) >= 33 || Number(result.highC) >= 34) {
    advice.push("气温偏高，课前通行注意补水和防晒。");
  }
  if (/雷/.test(result.weatherText)) {
    advice.push("有雷阵雨风险，尽量避开露天长距离通行。");
  }
  if (Number(result.windSpeedKmh) >= 28) {
    advice.push("风速偏大，骑行和过桥路段注意安全。");
  }
  if (!advice.length) advice.push("天气影响不大，按正常课前时间出发即可。");
  return advice[0];
}

async function fetchOpenMeteo(campus) {
  const response = await weatherFetcher("https://api.open-meteo.com/v1/forecast", {
    timeout: Number(process.env.AI_WEATHER_TIMEOUT_MS || 3500) || 3500,
    params: {
      latitude: campus.latitude,
      longitude: campus.longitude,
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
      hourly: "temperature_2m,precipitation_probability",
      daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      forecast_days: 2,
      timezone: "Asia/Shanghai",
    },
  });
  return response.data || {};
}

function buildWeatherResult(campus, data) {
  const current = data.current || {};
  const hourly = data.hourly || {};
  const daily = data.daily || {};
  const updatedAt = current.time || new Date(nowFn()).toISOString();
  const highC = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null;
  const lowC = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : null;
  const dailyRainMax = Array.isArray(daily.precipitation_probability_max) ? daily.precipitation_probability_max[0] : null;
  const result = {
    success: true,
    campus: campus.name,
    campusId: campus.id,
    provider: "open-meteo",
    sourceId: `open-meteo:${campus.id}`,
    updatedAt,
    temperatureC: roundNumber(current.temperature_2m, 0),
    apparentTemperatureC: roundNumber(current.apparent_temperature != null ? current.apparent_temperature : current.temperature_2m, 0),
    weatherCode: numberOrNull(current.weather_code),
    weatherText: weatherLabel(current.weather_code),
    humidity: roundNumber(current.relative_humidity_2m, 0),
    precipitationMm: roundNumber(current.precipitation, 1),
    windSpeedKmh: roundNumber(current.wind_speed_10m, 0),
    highC: roundNumber(highC != null ? highC : current.temperature_2m, 0),
    lowC: roundNumber(lowC != null ? lowC : current.temperature_2m, 0),
    next6Hours: getNextHours(hourly, updatedAt),
    rainProbabilityMax24h: Math.max(maxRainProbability(hourly, 24), roundNumber(dailyRainMax, 0) || 0),
    cached: false,
    stale: false,
  };
  result.advice = buildAdvice(result);
  result.alerts = [result.advice];
  result.summary = `${result.campus}${result.weatherText}，约 ${result.temperatureC || 0}℃。`;
  return result;
}

function unavailableCampus(campus) {
  return {
    success: false,
    code: "CAMPUS_WEATHER_LOCATION_UNCONFIGURED",
    campus: campus.name,
    campusId: campus.id,
    sourceId: "weather-location-unconfigured",
    summary: `${campus.name}天气位置尚未配置`,
    alerts: [],
    cached: false,
    stale: false,
  };
}

async function getCampusWeather(input = {}) {
  const campus = resolveCampus(input);
  if (String(process.env.AI_WEATHER_ENABLED || "true").toLowerCase() === "false") {
    return {
      success: false,
      code: "WEATHER_DISABLED",
      campus: campus.name,
      campusId: campus.id,
      sourceId: "weather-disabled",
      summary: "天气服务未启用，课表工具不受影响。",
      alerts: [],
      cached: false,
      stale: false,
    };
  }
  if (!campus.configured) return unavailableCampus(campus);

  const key = `campus:${campus.id}`;
  const ttlMs = Number(process.env.AI_WEATHER_CACHE_TTL_MS || DEFAULT_TTL_MS) || DEFAULT_TTL_MS;
  const staleMs = Number(process.env.AI_WEATHER_STALE_MAX_MS || DEFAULT_STALE_MS) || DEFAULT_STALE_MS;
  const cached = readCache(key);
  if (cached.fresh) return cached.fresh;

  if (INFLIGHT.has(key)) return INFLIGHT.get(key);

  const promise = fetchOpenMeteo(campus)
    .then((data) => writeCache(key, buildWeatherResult(campus, data), ttlMs, staleMs))
    .catch((error) => {
      const fallback = readCache(key).stale;
      if (fallback) {
        return Object.assign({}, fallback, {
          code: "WEATHER_PROVIDER_FAILED_USING_STALE",
          summary: `${campus.name}天气接口暂时不可用，已显示最近成功数据。`,
        });
      }
      return {
        success: false,
        code: error.code || "WEATHER_PROVIDER_FAILED",
        campus: campus.name,
        campusId: campus.id,
        sourceId: `open-meteo:${campus.id}`,
        summary: "天气暂时不可用，课表和空教室查询不受影响。",
        alerts: [],
        cached: false,
        stale: false,
      };
    })
    .finally(() => {
      INFLIGHT.delete(key);
    });

  INFLIGHT.set(key, promise);
  return promise;
}

async function getCourseWeatherAdvice(input = {}) {
  const weather = await getCampusWeather(input);
  if (!weather.success) return weather;
  return Object.assign({}, weather, {
    advice: weather.advice || buildAdvice(weather),
    summary: `${weather.campus}${weather.weatherText}，${weather.advice || "按正常课前时间出发即可。"}`,
  });
}

function __resetForTest() {
  FRESH_CACHE.clear();
  INFLIGHT.clear();
  weatherFetcher = axios.get;
  nowFn = () => Date.now();
}

function __setFetcherForTest(fetcher) {
  FRESH_CACHE.clear();
  INFLIGHT.clear();
  weatherFetcher = typeof fetcher === "function" ? fetcher : axios.get;
}

function __setNowForTest(fn) {
  nowFn = typeof fn === "function" ? fn : () => Date.now();
}

module.exports = {
  __resetForTest,
  __setFetcherForTest,
  __setNowForTest,
  getCampusWeather,
  getCourseWeatherAdvice,
  normalizeCampus,
};
