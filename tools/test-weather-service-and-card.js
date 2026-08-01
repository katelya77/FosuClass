const assert = require("assert");

process.env.AI_WEATHER_ENABLED = "true";
process.env.AI_WEATHER_CACHE_TTL_MS = String(10 * 60 * 1000);
process.env.AI_WEATHER_STALE_MAX_MS = String(60 * 60 * 1000);

const weatherService = require("../server/src/services/ai/weatherService");
const payloadContract = require("../server/src/services/ai/generatedPayloadContract");
const mockProvider = require("../server/src/services/ai/providers/mockProvider");

const XIANXI = "\u4ed9\u6eaa\u6821\u533a";
const JIANGWAN = "\u6c5f\u6e7e\u6821\u533a";
const HEBIN = "\u6cb3\u6ee8\u6821\u533a";

function sampleWeather(temp = 31) {
  return {
    data: {
      current: {
        time: "2026-06-17T09:00",
        temperature_2m: temp,
        apparent_temperature: temp + 2,
        relative_humidity_2m: 72,
        precipitation: 0.3,
        weather_code: 2,
        wind_speed_10m: 11,
      },
      hourly: {
        time: Array.from({ length: 30 }, (_, index) => `2026-06-17T${String(index).padStart(2, "0")}:00`),
        temperature_2m: Array.from({ length: 30 }, (_, index) => temp + index / 10),
        precipitation_probability: Array.from({ length: 30 }, (_, index) => Math.min(100, index * 3)),
      },
      daily: {
        time: ["2026-06-17", "2026-06-18", "2026-06-19"],
        weather_code: [2, 61, 0],
        temperature_2m_max: [35, 32, 30],
        temperature_2m_min: [27, 26, 24],
        precipitation_probability_max: [68, 75, 10],
      },
    },
  };
}

async function testOpenMeteoFieldsAndCache() {
  weatherService.__resetForTest();
  let now = 0;
  weatherService.__setNowForTest(() => now);
  const calls = [];
  weatherService.__setFetcherForTest(async (url, options) => {
    calls.push({ url, options });
    return sampleWeather(31);
  });

  const first = await weatherService.getCampusWeather({ campus: XIANXI });
  const second = await weatherService.getCampusWeather({ campus: XIANXI });

  assert.strictEqual(first.success, true);
  assert.strictEqual(first.provider, "open-meteo");
  assert.strictEqual(first.campusId, "xianxi");
  assert.strictEqual(first.temperatureC, 31);
  assert.strictEqual(first.apparentTemperatureC, 33);
  assert.strictEqual(first.humidity, 72);
  assert.strictEqual(first.precipitationMm, 0.3);
  assert.strictEqual(first.windSpeedKmh, 11);
  assert.strictEqual(first.highC, 35);
  assert.strictEqual(first.lowC, 27);
  assert.strictEqual(first.rainProbabilityMax24h, 69);
  assert.strictEqual(first.next6Hours.length, 6);
  assert.strictEqual(first.cached, false);
  assert.strictEqual(second.cached, true);
  assert.strictEqual(calls.length, 1, "fresh cache should avoid duplicate Open-Meteo requests");
  assert(!Object.prototype.hasOwnProperty.call(first, "hourly"), "service should not return full hourly payload");

  const params = calls[0].options.params;
  assert.strictEqual(calls[0].url, "https://api.open-meteo.com/v1/forecast");
  assert(params.current.includes("temperature_2m"));
  assert(params.current.includes("apparent_temperature"));
  assert(params.current.includes("relative_humidity_2m"));
  assert(params.current.includes("precipitation"));
  assert(params.current.includes("wind_speed_10m"));
  assert(params.hourly.includes("temperature_2m"));
  assert(params.hourly.includes("precipitation_probability"));
  assert(params.daily.includes("temperature_2m_max"));
  assert(params.daily.includes("temperature_2m_min"));
  assert(params.daily.includes("precipitation_probability_max"));
  assert.strictEqual(params.forecast_days, 2);
  assert.strictEqual(params.timezone, "Asia/Shanghai");
}

async function testSingleflightAndStaleLimit() {
  weatherService.__resetForTest();
  let now = 0;
  weatherService.__setNowForTest(() => now);
  let resolveFetch;
  let calls = 0;
  weatherService.__setFetcherForTest(() => {
    calls += 1;
    return new Promise((resolve) => {
      resolveFetch = () => resolve(sampleWeather(29));
    });
  });
  const first = weatherService.getCampusWeather({ campus: JIANGWAN });
  const second = weatherService.getCampusWeather({ campus: JIANGWAN });
  assert.strictEqual(calls, 1, "same-campus concurrent requests should share one fetch");
  resolveFetch();
  const resolved = await Promise.all([first, second]);
  assert(resolved.every((item) => item.success && item.campusId === "jiangwan"));

  weatherService.__resetForTest();
  calls = 0;
  now = 0;
  weatherService.__setNowForTest(() => now);
  weatherService.__setFetcherForTest(async () => {
    calls += 1;
    if (calls === 1) return sampleWeather(28);
    throw new Error("provider down");
  });
  const ok = await weatherService.getCampusWeather({ campus: XIANXI });
  assert.strictEqual(ok.success, true);
  now = 11 * 60 * 1000;
  const stale = await weatherService.getCampusWeather({ campus: XIANXI });
  assert.strictEqual(stale.success, true);
  assert.strictEqual(stale.cached, true);
  assert.strictEqual(stale.stale, true);
  assert.strictEqual(stale.code, "WEATHER_PROVIDER_FAILED_USING_STALE");
  now = 61 * 60 * 1000;
  const failed = await weatherService.getCampusWeather({ campus: XIANXI });
  assert.strictEqual(failed.success, false, "stale weather older than 60 minutes must not be treated as live data");
}

async function testCampusSeparationAndHebin() {
  weatherService.__resetForTest();
  const calls = [];
  weatherService.__setFetcherForTest(async (_url, options) => {
    calls.push(options.params);
    return sampleWeather(options.params.latitude > 23.035 ? 27 : 30);
  });
  const xianxi = await weatherService.getCampusWeather({ campus: XIANXI });
  const jiangwan = await weatherService.getCampusWeather({ campus: JIANGWAN });
  assert.strictEqual(xianxi.campusId, "xianxi");
  assert.strictEqual(jiangwan.campusId, "jiangwan");
  assert.notStrictEqual(calls[0].latitude, calls[1].latitude, "campuses should not reuse coordinates");

  weatherService.__resetForTest();
  const hebinCalls = [];
  weatherService.__setFetcherForTest(async (_url, options) => {
    hebinCalls.push(options.params);
    return sampleWeather();
  });
  const hebin = await weatherService.getCampusWeather({ campus: HEBIN });
  assert.strictEqual(hebin.success, true);
  assert.strictEqual(hebin.campusId, "hebin");
  assert.strictEqual(hebin.provider, "open-meteo");
  assert.strictEqual(hebinCalls.length, 1, "hebin should query its own configured coordinate");
  assert.notStrictEqual(hebinCalls[0].latitude, calls[0].latitude, "hebin should not fall back to xianxi weather");
}

async function testTomorrowRunningAdvice() {
  weatherService.__resetForTest();
  const calls = [];
  weatherService.__setFetcherForTest(async (_url, options) => {
    calls.push(options.params);
    return sampleWeather(30);
  });
  const tomorrow = await weatherService.getCampusWeather({
    campus: XIANXI,
    dateHint: "tomorrow",
    topic: "running",
    message: "明天适合跑步吗",
  });
  assert.strictEqual(tomorrow.success, true);
  assert.strictEqual(tomorrow.targetLabel, "明天");
  assert.strictEqual(tomorrow.dateHint, "tomorrow");
  assert.strictEqual(tomorrow.weatherText, "有雨");
  assert.strictEqual(tomorrow.rainProbabilityMax24h, 75);
  assert.match(tomorrow.advice, /不太适合跑步|带伞/);
  assert.strictEqual(calls[0].forecast_days, 2);
}

function testWeatherCardContract() {
  const card = payloadContract.stableCard({
    type: "weather",
    title: XIANXI,
    subtitle: "weather",
    weather: {
      campus: XIANXI,
      temperatureC: 31,
      apparentTemperatureC: 33,
      weatherText: "多云",
      humidity: 72,
      precipitationMm: 0.3,
      windSpeedKmh: 11,
      highC: 35,
      lowC: 27,
      next6Hours: [{ time: "09时", temperatureC: 31, rainProbability: 10 }],
      rainProbabilityMax24h: 68,
      updatedAt: "2026-06-17T09:00",
      cached: false,
      advice: "课前正常出发即可。",
    },
  });
  assert.strictEqual(card.type, "weather");
  assert(card.weather, "weather card should keep dedicated payload");
  [
    "campus",
    "temperatureC",
    "apparentTemperatureC",
    "weatherText",
    "humidity",
    "precipitationMm",
    "windSpeedKmh",
    "highC",
    "lowC",
    "next6Hours",
    "rainProbabilityMax24h",
    "updatedAt",
    "cached",
    "advice",
  ].forEach((field) => assert(Object.prototype.hasOwnProperty.call(card.weather, field), `weather card missing ${field}`));

  const rendered = mockProvider.generate({
    intent: { name: "get_campus_weather" },
    toolResults: [{ name: "get_campus_weather", result: Object.assign({ success: true }, card.weather) }],
  });
  assert.strictEqual(rendered.cards[0].type, "weather", "mock/provider fallback should produce weather card");
}

async function testDeadlineTransport() {
  weatherService.__resetForTest();
  const controller = new AbortController();
  let requestOptions = null;
  weatherService.__setFetcherForTest(async (_url, options) => {
    requestOptions = options;
    return sampleWeather(3);
  });
  const result = await weatherService.getCampusWeather({
    campus: XIANXI,
    timeoutMs: 600,
    abortSignal: controller.signal,
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(requestOptions.signal, controller.signal);
  assert.ok(requestOptions.timeout <= 450, "weather request must preserve a stage completion reserve");
}

async function run() {
  await testOpenMeteoFieldsAndCache();
  await testSingleflightAndStaleLimit();
  await testCampusSeparationAndHebin();
  await testTomorrowRunningAdvice();
  await testDeadlineTransport();
  testWeatherCardContract();
  weatherService.__resetForTest();
  console.log("test-weather-service-and-card passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
