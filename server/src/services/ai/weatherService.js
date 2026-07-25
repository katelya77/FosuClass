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
    latitude: 23.14817,
    longitude: 113.04939,
    configured: true,
    coordinateNote: "按佛山大学站/仙溪校区附近坐标近似。",
  },
  jiangwan: {
    id: "jiangwan",
    name: "江湾校区",
    latitude: 23.02586,
    longitude: 113.09257,
    configured: true,
    coordinateNote: "按江湾校区校园范围坐标近似。",
  },
  hebin: {
    id: "hebin",
    name: "河滨校区",
    latitude: 23.05039,
    longitude: 113.11074,
    configured: true,
    coordinateNote: "TODO: 替换为官方校区中心点；当前按河滨路/中山公园站附近坐标近似。",
  },
  foshan: {
    id: "foshan",
    name: "佛山",
    latitude: 23.0215,
    longitude: 113.1214,
    configured: true,
  },
  nanhai: {
    id: "nanhai",
    name: "南海区",
    latitude: 23.0312,
    longitude: 113.1434,
    configured: true,
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
  if (/南海|nanhai|nan\s*hai/.test(text)) return CAMPUS.nanhai;
  if (/佛山|foshan|fo\s*shan/.test(text)) return CAMPUS.foshan;
  return null;
}

function resolveCampus(input = {}) {
  return normalizeCampus(input.campus || input.campusId || input.message) || CAMPUS.xianxi;
}

function resolveTargetDay(input = {}) {
  // Explicit numeric offset from GoalContract / follow-up inheritance wins.
  const explicitOffset = Number(input.dateOffset != null ? input.dateOffset : input.dayOffset);
  if ((input.dateOffset != null || input.dayOffset != null) && Number.isFinite(explicitOffset)) {
    if (explicitOffset === 2) return { dateHint: "day_after_tomorrow", dayOffset: 2, label: "后天" };
    if (explicitOffset === 1) return { dateHint: "tomorrow", dayOffset: 1, label: "明天" };
    if (explicitOffset === 0) return { dateHint: "today", dayOffset: 0, label: "今天" };
    if (explicitOffset === 3) return { dateHint: "in_3_days", dayOffset: 3, label: "大后天" };
    return { dateHint: `offset_${explicitOffset}`, dayOffset: explicitOffset, label: `${explicitOffset}天后` };
  }
  const text = fullWidthToHalfWidth(`${input.dateHint || ""} ${input.message || ""}`).trim().toLowerCase();
  if (/day_after_tomorrow|后天/.test(text)) return { dateHint: "day_after_tomorrow", dayOffset: 2, label: "后天" };
  if (/tomorrow|明天|明日/.test(text)) return { dateHint: "tomorrow", dayOffset: 1, label: "明天" };
  return { dateHint: "today", dayOffset: 0, label: "今天" };
}

function resolveTopic(input = {}) {
  const text = fullWidthToHalfWidth(`${input.topic || ""} ${input.message || ""}`).trim().toLowerCase();
  if (/running|跑步|晨跑|夜跑/.test(text)) return "running";
  if (/umbrella|带伞|伞|下雨|雨|降雨/.test(text)) return "rain";
  if (/temperature|温度|气温|热|冷/.test(text)) return "temperature";
  return "weather";
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

function getNextHoursForTarget(hourly = {}, updatedAt, targetDate) {
  if (!targetDate) return getNextHours(hourly, updatedAt);
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  const targetIndex = times.findIndex((item) => String(item || "").slice(0, 10) === targetDate && Number(String(item || "").slice(11, 13)) >= 6);
  if (targetIndex < 0) return getNextHours(hourly, updatedAt);
  return getNextHours(hourly, times[targetIndex]);
}

function maxRainProbability(hourly = {}, hours = 24) {
  const values = Array.isArray(hourly.precipitation_probability) ? hourly.precipitation_probability : [];
  if (!values.length) return null;
  return Math.max(...values.slice(0, hours).map((item) => Math.max(0, Math.min(100, Number(item) || 0))));
}

function buildAdvice(result, topic) {
  const advice = [];
  const precipitation = numberOrNull(result.precipitationMm);
  const rainProbability = numberOrNull(result.rainProbabilityMax24h);
  const temperature = numberOrNull(result.temperatureC);
  const high = numberOrNull(result.highC);
  const windSpeed = numberOrNull(result.windSpeedKmh);
  if ((precipitation != null && precipitation >= 1) || (rainProbability != null && rainProbability >= 60)) {
    advice.push("短时降雨概率较高，建议带伞并预留通行时间。");
  }
  if ((temperature != null && temperature >= 33) || (high != null && high >= 34)) {
    advice.push("气温偏高，课前通行注意补水和防晒。");
  }
  if (/雷/.test(result.weatherText)) {
    advice.push("有雷阵雨风险，尽量避开露天长距离通行。");
  }
  if (windSpeed != null && windSpeed >= 28) {
    advice.push("风速偏大，骑行和过桥路段注意安全。");
  }
  if (topic === "running") {
    if (advice.length) return `不太适合跑步：${advice[0]}`;
    return "适合轻量跑步，建议避开正午高温时段并及时补水。";
  }
  if (!advice.length) advice.push("天气影响不大，按正常课前时间出发即可。");
  return advice[0];
}

async function fetchOpenMeteo(campus, targetDay) {
  const response = await weatherFetcher("https://api.open-meteo.com/v1/forecast", {
    timeout: Number(process.env.AI_WEATHER_TIMEOUT_MS || 3500) || 3500,
    params: {
      latitude: campus.latitude,
      longitude: campus.longitude,
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
      hourly: "temperature_2m,precipitation_probability",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      forecast_days: Math.max(2, Math.min(3, Number(targetDay && targetDay.dayOffset || 0) + 1)),
      timezone: "Asia/Shanghai",
    },
  });
  return response.data || {};
}

function buildWeatherResult(campus, data, targetDay, topic) {
  const current = data.current || {};
  const hourly = data.hourly || {};
  const daily = data.daily || {};
  const updatedAt = current.time || new Date(nowFn()).toISOString();
  const dayOffset = Math.max(0, Math.min(2, Number(targetDay && targetDay.dayOffset || 0) || 0));
  const dailyTime = Array.isArray(daily.time) ? daily.time : [];
  const dayIndex = dailyTime.length > dayOffset ? dayOffset : 0;
  const targetDate = dailyTime[dayIndex] || String(updatedAt).slice(0, 10);
  const highC = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[dayIndex] : null;
  const lowC = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[dayIndex] : null;
  const dailyRainMax = Array.isArray(daily.precipitation_probability_max) ? daily.precipitation_probability_max[dayIndex] : null;
  const dailyCode = Array.isArray(daily.weather_code) ? daily.weather_code[dayIndex] : null;
  const currentTemp = dayOffset === 0 ? current.temperature_2m : null;
  const currentFeelsLike = dayOffset === 0 ? current.apparent_temperature : null;
  const displayTemp = currentTemp != null ? currentTemp : (highC != null && lowC != null ? (Number(highC) + Number(lowC)) / 2 : highC);
  const hourlyRainMax = maxRainProbability(hourly, 24);
  const dailyRainMaxRounded = roundNumber(dailyRainMax, 0);
  const rainProbabilityMax24h = dayOffset > 0
    ? dailyRainMaxRounded
    : (hourlyRainMax == null
      ? dailyRainMaxRounded
      : (dailyRainMaxRounded == null ? hourlyRainMax : Math.max(hourlyRainMax, dailyRainMaxRounded)));
  const result = {
    success: true,
    campus: campus.name,
    campusId: campus.id,
    provider: "open-meteo",
    sourceId: `open-meteo:${campus.id}`,
    coordinateNote: campus.coordinateNote || "",
    targetDate,
    targetLabel: targetDay && targetDay.label || "今天",
    dateHint: targetDay && targetDay.dateHint || "today",
    updatedAt,
    temperatureC: roundNumber(displayTemp, 0),
    apparentTemperatureC: roundNumber(currentFeelsLike != null ? currentFeelsLike : displayTemp, 0),
    weatherCode: numberOrNull(dailyCode != null ? dailyCode : current.weather_code),
    weatherText: weatherLabel(dailyCode != null ? dailyCode : current.weather_code),
    humidity: dayOffset === 0 ? roundNumber(current.relative_humidity_2m, 0) : null,
    precipitationMm: dayOffset === 0 ? roundNumber(current.precipitation, 1) : null,
    windSpeedKmh: dayOffset === 0 ? roundNumber(current.wind_speed_10m, 0) : null,
    highC: roundNumber(highC != null ? highC : current.temperature_2m, 0),
    lowC: roundNumber(lowC != null ? lowC : current.temperature_2m, 0),
    next6Hours: getNextHoursForTarget(hourly, updatedAt, targetDate),
    rainProbabilityMax24h,
    cached: false,
    stale: false,
  };
  result.advice = buildAdvice(result, topic);
  result.alerts = [result.advice];
  const tempText = result.temperatureC == null ? "暂无温度数据" : `约 ${result.temperatureC}℃`;
  result.summary = `${result.campus}${result.targetLabel}${result.weatherText}，${tempText}。`;
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
  const targetDay = resolveTargetDay(input);
  const topic = resolveTopic(input);
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

  const key = `campus:${campus.id}:${targetDay.dateHint}:${topic}`;
  const ttlMs = Number(process.env.AI_WEATHER_CACHE_TTL_MS || DEFAULT_TTL_MS) || DEFAULT_TTL_MS;
  const staleMs = Number(process.env.AI_WEATHER_STALE_MAX_MS || DEFAULT_STALE_MS) || DEFAULT_STALE_MS;
  const cached = readCache(key);
  if (cached.fresh) return cached.fresh;

  if (INFLIGHT.has(key)) return INFLIGHT.get(key);

  const promise = fetchOpenMeteo(campus, targetDay)
    .then((data) => writeCache(key, buildWeatherResult(campus, data, targetDay, topic), ttlMs, staleMs))
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
        targetLabel: targetDay.label,
        dateHint: targetDay.dateHint,
        sourceId: `open-meteo:${campus.id}`,
        summary: "Open-Meteo 天气接口暂时不可用，课表和空教室查询不受影响。",
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
