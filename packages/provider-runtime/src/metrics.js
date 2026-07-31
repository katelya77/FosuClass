// P2R Wave 2：outcome-aware 指标桶（R3.7）。
// 低基数标签词表全部集中定义在本文件，桶键只允许这些枚举值：
// 禁止 runId / conversationId / 完整 model 名 / 用户消息等自由文本进入桶键。
// record 对未知标签键与未知标签值一律抛 METRICS_LABEL_INVALID，保证基数有界。
const METRIC_LABEL_VALUES = Object.freeze({
  outcome: Object.freeze(["ok", "degraded", "failed", "cancelled", "timeout"]),
  executionPolicy: Object.freeze(["deterministic", "strict_model_first", "adaptive"]),
  usedFallback: Object.freeze([false, true]),
  providerClass: Object.freeze(["mock", "external", "none"]),
  taskComplexity: Object.freeze(["simple", "multi_tool"]),
  environment: Object.freeze(["public", "trial", "dev"]),
});

// 桶键标签顺序固定，同一标签组合始终得到同一个键。
const METRIC_LABEL_ORDER = Object.freeze([
  "outcome",
  "executionPolicy",
  "usedFallback",
  "providerClass",
  "taskComplexity",
  "environment",
]);

// 旧调用方（providerRuntime 的尝试级记录）仍传 outcome:"success" 与
// fallback:boolean，在此归一到新词表；其他值一律拒绝。
const OUTCOME_ALIASES = Object.freeze({
  success: "ok",
});

function codedError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

function normalizeOutcome(value) {
  const raw = String(value == null || value === "" ? "ok" : value);
  const outcome = OUTCOME_ALIASES[raw] || raw;
  if (!METRIC_LABEL_VALUES.outcome.includes(outcome)) {
    throw codedError("METRICS_LABEL_INVALID", `unknown outcome: ${raw}`);
  }
  return outcome;
}

// 只保留词表内的低基数标签；未提供的标签直接省略（不伪造取值）。
function normalizeLabels(input = {}) {
  const source = input.labels && typeof input.labels === "object" ? input.labels : {};
  const labels = {};
  Object.keys(source).forEach((key) => {
    if (key === "outcome") return;
    if (!Object.prototype.hasOwnProperty.call(METRIC_LABEL_VALUES, key)) {
      throw codedError("METRICS_LABEL_INVALID", `unknown label: ${key}`);
    }
    const value = source[key];
    if (value === undefined || value === null || value === "") return;
    if (key === "usedFallback") {
      if (typeof value !== "boolean") throw codedError("METRICS_LABEL_INVALID", "usedFallback must be boolean");
      if (value) labels.usedFallback = true;
      return;
    }
    const normalized = String(value);
    if (!METRIC_LABEL_VALUES[key].includes(normalized)) {
      throw codedError("METRICS_LABEL_INVALID", `unknown ${key}: ${normalized.slice(0, 40)}`);
    }
    labels[key] = normalized;
  });
  if (labels.usedFallback === undefined && input.fallback === true) labels.usedFallback = true;
  return labels;
}

function createMetricsStore(options = {}) {
  const sampleLimit = Math.max(10, Math.min(10000, Number(options.sampleLimit || 1000) || 1000));
  const stages = new Map();

  function newSeries() {
    return { all: [], success: [] };
  }

  function newBucket() {
    return {
      series: newSeries(),
      fallbackSeries: newSeries(),
      nonFallbackSeries: newSeries(),
      outcomes: { ok: 0, degraded: 0, failed: 0, cancelled: 0, timeout: 0 },
      fallbackCount: 0,
      warmUpCount: 0,
      combos: new Map(),
    };
  }

  function bucket(stage) {
    const key = String(stage || "unknown").replace(/[^a-z0-9_.-]/gi, "_").slice(0, 48) || "unknown";
    if (!stages.has(key)) stages.set(key, newBucket());
    return { key, value: stages.get(key) };
  }

  function pushSample(series, durationMs, outcome) {
    series.all.push(durationMs);
    if (series.all.length > sampleLimit) series.all.splice(0, series.all.length - sampleLimit);
    // success-only 序列只收 outcome=ok：degraded/failed/cancelled/timeout 独立计数、不混入成功。
    if (outcome === "ok") {
      series.success.push(durationMs);
      if (series.success.length > sampleLimit) series.success.splice(0, series.success.length - sampleLimit);
    }
  }

  function record(stage, input = {}) {
    // 先校验再落桶：被拒绝的标签不得留下空桶污染 summary；warm-up 样本同样
    // 必须先通过标签校验，不能只计数不验证。
    const source = input.labels && typeof input.labels === "object" ? input.labels : {};
    const outcome = normalizeOutcome(source.outcome !== undefined ? source.outcome : input.outcome);
    const labels = normalizeLabels(input);
    if (input.warmUp === true) {
      bucket(stage).value.warmUpCount += 1;
      return;
    }
    labels.outcome = outcome;
    const durationMs = Math.max(0, Number(input.durationMs) || 0);
    const item = bucket(stage).value;
    pushSample(item.series, durationMs, outcome);
    pushSample(labels.usedFallback === true ? item.fallbackSeries : item.nonFallbackSeries, durationMs, outcome);
    if (labels.usedFallback === true) item.fallbackCount += 1;
    item.outcomes[outcome] += 1;
    const key = METRIC_LABEL_ORDER
      .map((name) => (labels[name] === undefined ? null : `${name}=${labels[name]}`))
      .filter(Boolean)
      .join(";");
    if (!item.combos.has(key)) item.combos.set(key, { labels: Object.freeze(Object.assign({}, labels)), series: newSeries() });
    pushSample(item.combos.get(key).series, durationMs, outcome);
  }

  function summarizeSeries(series) {
    return Object.freeze({
      count: series.all.length,
      successCount: series.success.length,
      p50Ms: percentile(series.success, 50),
      p95Ms: percentile(series.success, 95),
      allP50Ms: percentile(series.all, 50),
      allP95Ms: percentile(series.all, 95),
    });
  }

  function summarizeValue(item) {
    const series = summarizeSeries(item.series);
    // 兼容口径（Wave 2 起）：count 保持旧行为——记录的全部样本数（含 failed/
    // cancelled/degraded，warm-up 除外）；p50Ms/p95Ms 切换为 success-only 序列
    // （outcome=ok），失败/取消/降级不再混入头部延迟指标；all-runs 口径见
    // allRuns 与各序列的 allP50Ms/allP95Ms。既有测试只断言 count 与 number 类型，
    // 两种口径下均保持绿色。
    return Object.freeze({
      count: series.count,
      successCount: item.outcomes.ok,
      failureCount: item.outcomes.failed + item.outcomes.timeout,
      cancelledCount: item.outcomes.cancelled,
      degradedCount: item.outcomes.degraded,
      timeoutCount: item.outcomes.timeout,
      fallbackCount: item.fallbackCount,
      warmUpCount: item.warmUpCount,
      p50Ms: series.p50Ms,
      p95Ms: series.p95Ms,
      success: Object.freeze({ count: series.successCount, p50Ms: series.p50Ms, p95Ms: series.p95Ms }),
      allRuns: Object.freeze({ count: series.count, p50Ms: series.allP50Ms, p95Ms: series.allP95Ms }),
      fallback: summarizeSeries(item.fallbackSeries),
      nonFallback: summarizeSeries(item.nonFallbackSeries),
      byLabel: Object.freeze(Array.from(item.combos.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, combo]) => Object.freeze(Object.assign({ key, labels: combo.labels }, summarizeSeries(combo.series))))),
    });
  }

  function summary(stage) {
    if (stage !== undefined) return summarizeValue(bucket(stage).value);
    return Object.freeze(Object.fromEntries(Array.from(stages.entries()).map(([key, value]) => [key, summarizeValue(value)])));
  }

  function reset() {
    stages.clear();
  }

  return Object.freeze({ record, reset, summary });
}

module.exports = {
  METRIC_LABEL_VALUES,
  createMetricsStore,
  percentile,
};
