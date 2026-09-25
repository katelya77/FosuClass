const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.CAMPUS_SYNC_OPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-sync-load-"));
const broker = require("../server/src/services/campusSyncBroker");

function percentile(samples, ratio) {
  if (!samples.length) return 0;
  const sorted = samples.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function lag() {
  const start = Date.now();
  await new Promise((resolve) => setImmediate(resolve));
  return Date.now() - start;
}

async function wave(concurrency) {
  broker.resetCampusSyncForTests();
  broker.heartbeat();
  const samples = [];
  const started = Date.now();
  let rejected = 0;
  let accepted = 0;
  await Promise.all(Array.from({ length: concurrency }, (_, index) => (async () => {
    const t0 = Date.now();
    try {
      broker.createJob({ fosuSession: { openidHash: `load-${concurrency}-${index}` } }, {
        studentId: "202500000303",
        password: "school-secret",
        semester: "",
      });
      accepted += 1;
    } catch (error) {
      rejected += 1;
    }
    samples.push(Date.now() - t0);
  })()));
  const elapsed = Math.max(1, Date.now() - started);
  return {
    concurrency,
    accepted,
    rejected,
    rps: Math.round((concurrency / elapsed) * 1000),
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
    rss: process.memoryUsage().rss,
    heap: process.memoryUsage().heapUsed,
    lag: await lag(),
  };
}

async function run() {
  const baseline = await wave(10);
  const after = [];
  for (const concurrency of [50, 100, 200, 500]) after.push(await wave(concurrency));
  const capped = after.every((item) => item.accepted <= 10 && item.rejected >= item.concurrency - 10);
  console.log(JSON.stringify({ baseline, after, capped, schoolSystemsLoadTested: false }, null, 2));
  if (!capped) process.exit(1);
  console.log("campus-sync-load PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
