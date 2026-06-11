const os = require("os");
const { monitorEventLoopDelay, performance } = require("perf_hooks");

const ROUTE_SAMPLE_LIMIT = 300;
const TIMEOUT_SAMPLE_LIMIT = 100;
const delayHistogram = monitorEventLoopDelay({ resolution: 20 });
delayHistogram.enable();

let lastElu = performance.eventLoopUtilization();
const routeSamples = [];
const timeoutSamples = [];

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function pushRing(buffer, item, limit) {
  buffer.push(item);
  while (buffer.length > limit) buffer.shift();
}

function recordRoute(path, method, durationMs, statusCode) {
  pushRing(routeSamples, {
    at: new Date().toISOString(),
    path,
    method,
    durationMs,
    statusCode,
  }, ROUTE_SAMPLE_LIMIT);
  if (Number(statusCode) === 504 || durationMs >= 15000) {
    pushRing(timeoutSamples, {
      at: new Date().toISOString(),
      path,
      method,
      durationMs,
      statusCode,
    }, TIMEOUT_SAMPLE_LIMIT);
  }
}

function middleware(req, res, next) {
  const started = performance.now();
  res.on("finish", () => {
    recordRoute(req.path || req.originalUrl || "", req.method || "GET", Math.round(performance.now() - started), res.statusCode);
  });
  next();
}

function nsToMs(value) {
  if (!Number.isFinite(value)) return 0;
  return Number((value / 1e6).toFixed(2));
}

function routeStats() {
  const durations = routeSamples.map((item) => Number(item.durationMs || 0));
  return {
    sampleCount: routeSamples.length,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    maxMs: durations.length ? Math.max.apply(Math, durations) : 0,
    recentSlow: routeSamples.filter((item) => item.durationMs >= 1000).slice(-20),
    timeoutCount: timeoutSamples.length,
    recentTimeouts: timeoutSamples.slice(-20),
  };
}

function getSnapshot(extra = {}) {
  const memory = process.memoryUsage();
  const elu = performance.eventLoopUtilization(lastElu);
  lastElu = performance.eventLoopUtilization();
  const snapshot = {
    success: true,
    serverTime: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    eventLoopDelay: {
      p50Ms: nsToMs(delayHistogram.percentile(50)),
      p95Ms: nsToMs(delayHistogram.percentile(95)),
      p99Ms: nsToMs(delayHistogram.percentile(99)),
      maxMs: nsToMs(delayHistogram.max),
      meanMs: nsToMs(delayHistogram.mean),
    },
    eventLoopUtilization: Number((elu.utilization || 0).toFixed(4)),
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers || 0,
    },
    loadAverage: os.loadavg ? os.loadavg() : [0, 0, 0],
    routes: routeStats(),
  };
  return Object.assign(snapshot, extra || {});
}

function getLiveStatus() {
  return {
    success: true,
    status: "live",
    serverTime: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  };
}

function resetHistogram() {
  delayHistogram.reset();
}

module.exports = {
  getLiveStatus,
  getSnapshot,
  middleware,
  recordRoute,
  resetHistogram,
};
