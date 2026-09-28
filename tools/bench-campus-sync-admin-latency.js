const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-admin-bench-"));
const now = Date.now();
for (let index = 0; index < 90; index += 1) {
  const day = new Date(now - index * 86400000).toISOString().slice(0, 10);
  const key = new Date(now - index * 86400000).toISOString().slice(0, 13);
  const bucket = { attempts: 1, success: 1, failed: 0, rateLimited: 0, busy: 0, timeout: 0, credentialFailures: 0, systemFailures: 0, durationCount: 1, durationSum: 10, queueWaitCount: 0, queueWaitSum: 0, histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], errors: {} };
  fs.writeFileSync(path.join(dir, `hours-${day}.json`), JSON.stringify({ [key]: bucket }));
}
process.env.CAMPUS_SYNC_OPS_DIR = dir;
process.env.NODE_ENV = "test";
process.env.FOSU_SESSION_SECRET_CURRENT = "bench-secret";
process.env.ADMIN_PASSWORD = "bench-admin";

const express = require("../server/node_modules/express");
const adminAuth = require("../server/src/services/adminAuth");
const app = express();
app.use(express.json({ limit: "8kb" }));
app.use("/api/admin", require("../server/src/modules/campus-sync-ops/routes"));

function pct(values, ratio) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function once(port, url, cookie) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const req = http.request({ hostname: "127.0.0.1", port, path: url, headers: { cookie } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({ ms: Number(process.hrtime.bigint() - started) / 1e6, bytes: buf.length, status: res.statusCode });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const paths = [
  "/api/admin/campus-sync/snapshot",
  "/api/admin/campus-sync/overview",
  "/api/admin/campus-sync/timeseries?range=24h",
  "/api/admin/campus-sync/timeseries?range=30d",
  "/api/admin/campus-sync/security",
  "/api/admin/campus-sync/config",
  "/api/admin/campus-sync/policy",
  "/api/admin/campus-sync/events?limit=50",
];

const server = app.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  const cookie = `${adminAuth.ADMIN_SESSION_COOKIE}=${encodeURIComponent(adminAuth.createSessionToken())}`;
  for (const url of paths) {
    let cold;
    try {
      cold = await once(port, url, cookie);
    } catch (error) {
      console.log(url, "UNAVAILABLE");
      continue;
    }
    const warm = [];
    let bytes = cold.bytes;
    for (let index = 0; index < 20; index += 1) {
      const row = await once(port, url, cookie);
      warm.push(row.ms);
      bytes = row.bytes;
    }
    console.log([url, cold.status, "cold", cold.ms.toFixed(2), "warmP50", pct(warm, 0.5).toFixed(2), "warmP95", pct(warm, 0.95).toFixed(2), "bytes", bytes].join(" "));
  }
  server.close();
});
