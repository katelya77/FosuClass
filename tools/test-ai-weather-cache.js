const assert = require("assert");

process.env.AI_WEATHER_ENABLED = "true";
process.env.AI_WEATHER_CACHE_TTL_MS = "60000";

const weatherService = require("../server/src/services/ai/weatherService");

async function run() {
  let calls = 0;
  weatherService.__setFetcherForTest(async () => {
    calls += 1;
    return {
      data: {
        current: {
          time: "2026-06-16T08:00",
          temperature_2m: 30,
          relative_humidity_2m: 72,
          precipitation: 0,
          weather_code: 1,
          wind_speed_10m: 8,
        },
        hourly: {
          precipitation_probability: [10, 20, 30],
        },
      },
    };
  });

  const first = await weatherService.getCampusWeather({ campus: "\u4ed9\u6eaa\u6821\u533a" });
  const second = await weatherService.getCampusWeather({ campus: "\u4ed9\u6eaa\u6821\u533a" });

  assert.strictEqual(first.success, true);
  assert.strictEqual(second.success, true);
  assert.strictEqual(first.cached, false);
  assert.strictEqual(second.cached, true);
  assert.strictEqual(calls, 1);
  weatherService.__resetForTest();
  console.log("test-ai-weather-cache passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
