const assert = require("assert");
const { buildCampusSyncTrend, niceYTicks } = require("../server/src/services/campusSyncTrendChart");

assert.deepStrictEqual(niceYTicks(0), [0, 1]);
assert.deepStrictEqual(niceYTicks(3), [0, 1, 2, 3]);
const ticks37 = niceYTicks(37);
assert.deepStrictEqual(ticks37, [0, 10, 20, 30, 40]);
assert.ok(ticks37.every((tick) => Number.isInteger(tick) && tick >= 0));

const empty = buildCampusSyncTrend([], "24h");
assert.strictEqual(empty.empty, true);
assert.strictEqual(empty.message, "当前时间范围暂无同步请求");
assert.strictEqual(empty.svg, "");

const one = buildCampusSyncTrend([{
  bucket: "2026-09-26T10:00:00.000Z",
  attempts: 4,
  success: 3,
  systemFailures: 1,
  credentialFailures: 0,
  rateLimited: 0,
}], "1h");
assert.strictEqual(one.empty, false);
assert.strictEqual(one.points.length, 1);
assert.ok(one.svg.includes("<circle"));
assert.strictEqual(one.points[0].values.attempts, 4);
assert.ok(one.points[0].time.includes("18:00") || one.points[0].time.includes("2026-09-26"));
assert.ok(one.yTicks[0] === 0);
assert.ok(one.legend.map((item) => item.label).join(",").includes("请求量"));
assert.ok(one.legend.map((item) => item.label).join(",").includes("凭证失败"));

const zeros = buildCampusSyncTrend([{
  bucket: "2026-09-26T10",
  attempts: 0,
  success: 0,
  systemFailures: 0,
  credentialFailures: 0,
  rateLimited: 0,
}], "24h");
assert.strictEqual(zeros.empty, false);
assert.deepStrictEqual(zeros.yTicks.slice(0, 2), [0, 1]);
assert.ok(!zeros.svg.includes("NaN"));
assert.ok(!zeros.svg.includes("Infinity"));

function series(count, range) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    rows.push({
      bucket: new Date(Date.UTC(2026, 8, 1, index)).toISOString(),
      attempts: index,
      success: index,
      systemFailures: 0,
      credentialFailures: 0,
      rateLimited: 0,
    });
  }
  return buildCampusSyncTrend(rows, range);
}

["1h", "24h", "7d", "30d"].forEach((range) => {
  const count = range === "30d" ? 30 : range === "7d" ? 14 : range === "1h" ? 12 : 24;
  const chart = series(count, range);
  assert.ok(chart.viewBox.indexOf("0 0") === 0, range);
  assert.ok(chart.xLabels.length >= 2, range);
  assert.ok(chart.xLabels.length <= 8, range + " " + chart.xLabels.length);
  assert.strictEqual(chart.xLabels[0].anchor, "start");
  assert.strictEqual(chart.xLabels[chart.xLabels.length - 1].anchor, "end");
  assert.ok(chart.yTicks.includes(0));
});

const partial = buildCampusSyncTrend([{ bucket: "2026-09-26T10:00:00.000Z", attempts: 2, success: 2 }], "1h");
assert.deepStrictEqual(partial.legend.map((item) => item.key), ["attempts", "success"]);

console.log("campus sync trend chart PASS");
