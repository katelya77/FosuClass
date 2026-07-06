const request = require("../utils/request");

const DEFAULT_SOURCE = "weather-provider";

function safeText(value, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text.slice(0, maxLength || 120);
}

function normalizeCampusName(value, fallback) {
  const text = safeText(value || fallback || "", 40);
  if (/江湾/.test(text)) return "江湾校区";
  if (/河滨/.test(text)) return "河滨校区";
  if (/佛山/.test(text) && !/大学|佛大/.test(text)) return "佛山";
  if (/南海/.test(text)) return "南海区";
  return /仙溪/.test(text) ? "仙溪校区" : (text || "仙溪校区");
}

function normalizeWeatherResult(result, fallbackCampus) {
  const source = result && typeof result === "object" && !Array.isArray(result) ? result : {};
  const success = source.success !== false;
  return Object.assign({}, source, {
    success,
    campus: normalizeCampusName(source.campus, fallbackCampus),
    provider: safeText(source.provider || source.source || "", 40),
    sourceId: safeText(source.sourceId || source.provider || DEFAULT_SOURCE, 80),
    summary: safeText(source.summary || "", 200),
    weatherText: safeText(source.weatherText || "", 24),
    updatedAt: safeText(source.updatedAt || "", 40),
    advice: safeText(source.advice || (Array.isArray(source.alerts) ? source.alerts[0] : ""), 140),
    next6Hours: Array.isArray(source.next6Hours) ? source.next6Hours.slice(0, 6) : [],
  });
}

function unavailable(campus, code, message) {
  return normalizeWeatherResult({
    success: false,
    code: code || "WEATHER_SOURCE_UNAVAILABLE",
    campus,
    sourceId: DEFAULT_SOURCE,
    summary: message || "当前天气数据源暂不可用。",
    alerts: [],
  }, campus);
}

async function getCampusWeather(input = {}) {
  const campus = normalizeCampusName(input.campus || input.location || input.message, "仙溪校区");
  try {
    const payload = await request.get("/api/ai/weather", {
      campus,
      message: safeText(input.message || "", 300),
      dateHint: safeText(input.dateHint || "", 40),
      topic: safeText(input.topic || "", 40),
    }, {
      showLoading: false,
      silentError: true,
      timeout: 9000,
      retries: 1,
      dedupe: true,
      diagnosisClass: "background",
    });
    const weather = payload && (payload.weather || payload.data || payload.result || payload);
    return normalizeWeatherResult(weather, campus);
  } catch (error) {
    return unavailable(
      campus,
      error && (error.code || error.reasonCode) || "WEATHER_SOURCE_UNAVAILABLE",
      "当前天气数据源暂不可用，课表和校园入口查询不受影响。"
    );
  }
}

module.exports = {
  getCampusWeather,
  normalizeCampusName,
  normalizeWeatherResult,
  unavailable,
};
