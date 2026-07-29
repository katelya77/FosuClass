function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

function createMetricsStore(options = {}) {
  const sampleLimit = Math.max(10, Math.min(10000, Number(options.sampleLimit || 1000) || 1000));
  const stages = new Map();

  function bucket(stage) {
    const key = String(stage || "unknown").replace(/[^a-z0-9_.-]/gi, "_").slice(0, 48) || "unknown";
    if (!stages.has(key)) stages.set(key, { durations: [], success: 0, failed: 0, cancelled: 0, fallback: 0 });
    return { key, value: stages.get(key) };
  }

  function record(stage, input = {}) {
    const item = bucket(stage).value;
    item.durations.push(Math.max(0, Number(input.durationMs) || 0));
    if (item.durations.length > sampleLimit) item.durations.splice(0, item.durations.length - sampleLimit);
    const outcome = String(input.outcome || "success");
    if (outcome === "success") item.success += 1;
    else if (outcome === "cancelled") item.cancelled += 1;
    else item.failed += 1;
    if (input.fallback === true) item.fallback += 1;
  }

  function summarizeValue(item) {
    return Object.freeze({
      count: item.durations.length,
      successCount: item.success,
      failureCount: item.failed,
      cancelledCount: item.cancelled,
      fallbackCount: item.fallback,
      p50Ms: percentile(item.durations, 50),
      p95Ms: percentile(item.durations, 95),
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
  createMetricsStore,
  percentile,
};
