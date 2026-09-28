const fs = require("fs");
const http = require("http");
const path = require("path");
const { CAMPUS_SYNC_SCRIPT, CAMPUS_SYNC_SECTION, CAMPUS_SYNC_STYLES } = require("../server/src/routes/adminCampusSyncAssets");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CAMPUS_SYNC_STYLES} #section-campus-sync{display:grid}</style></head><body>
${CAMPUS_SYNC_SECTION}
<script>
var calls = [];
function api(url) {
  calls.push({ url: url, at: Date.now() });
  if (url.indexOf("snapshot") >= 0) return new Promise(function (resolve) { setTimeout(function () { resolve({ snapshot: { service: { status: "normal", maintenance: { paused: false }, agent: { online: true, lastHeartbeatAgeMs: 1000 }, queue: { queued: 0, processing: 0, active: 0, cap: 10 }, pipeline: [], securityPosture: "normal" }, policy: { rateLimit: 4, rateWindowSeconds: 720, dailyLimit: 7, globalActiveCap: 8, revision: "rev", source: "runtime", storageStatus: "ok" } } }); }, 30); });
  if (url.indexOf("timeseries") >= 0) return new Promise(function (resolve, reject) { setTimeout(function () { if (window.__failTrend) reject(new Error("trend")); else resolve({ points: [] }); }, 2000); });
  if (url.indexOf("security") >= 0) return new Promise(function (resolve, reject) { setTimeout(function () { if (window.__failSecurity) reject(new Error("security")); else resolve({ security: { recent: [], suspensions: [] } }); }, 50); });
  if (url.indexOf("events") >= 0) return new Promise(function (resolve, reject) { setTimeout(function () { if (window.__failEvents) reject(new Error("events")); else resolve({ events: [], nextCursor: "" }); }, 50); });
  if (url.indexOf("overview") >= 0) return Promise.resolve({ overview: { status: "normal", maintenance: { paused: false }, window24h: { attempts: 2, success: 2, failed: 0, successRate: 100, rateLimited: 0 }, performance: {}, pipeline: [], errors: {}, queue: { queued: 0, processing: 0, active: 0, cap: 10 }, agent: { online: true }, securityPosture: "normal" } });
  if (url.indexOf("config") >= 0) return Promise.resolve({ config: { perUserConcurrency: 1, rateLimit: 4, dailyLimit: 7, globalCap: 8, jobTtlSeconds: 90, previewRetentionSeconds: 900, heartbeatIntervalMs: 30000, offlineTtlMs: 90000, workerConcurrency: 1, circuit: { state: "CLOSED" }, secrets: { campusAgentToken: "Configured", campusAgentSigningSecret: "Configured" } } });
  if (url.indexOf("policy") >= 0) return Promise.resolve({ policy: { rateLimit: 4, rateWindowSeconds: 720, dailyLimit: 7, globalActiveCap: 8, revision: "rev", source: "runtime" }, usage: { attempts: 1, success: 1, failed: 0, rateLimited: 0, activeUsers: 1, shortLimitedUsers: 0, dailyLimitedUsers: 0, maxAccepted: 1, remaining: { zero: 0, oneToThree: 1, fourToSeven: 0, eightPlus: 0 } } });
  return Promise.resolve({});
}
${CAMPUS_SYNC_SCRIPT}
document.getElementById("section-campus-sync").classList.add("active");
</script></body></html>`;

async function main() {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (error) { ({ chromium } = require(path.join(__dirname, "fosu-sync-client", "node_modules", "playwright"))); }
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(html); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: "msedge" }));
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => document.getElementById("csServiceBadge").textContent.indexOf("运行中") >= 0, null, { timeout: 1000 });
  const early = await page.evaluate(() => ({
    service: document.getElementById("csServiceBadge").textContent,
    policy: document.getElementById("csDailyLimit").value,
    trend: document.getElementById("csChartStatus").textContent,
    calls: calls.filter((item) => item.url.indexOf("timeseries") >= 0).length,
  }));
  if (early.service.indexOf("运行中") < 0 || early.policy !== "7") throw new Error("critical content waited for trend");
  if (early.trend.indexOf("正在加载趋势") < 0) throw new Error("trend status missing while slow");
  await page.waitForFunction(() => document.getElementById("csChartStatus").textContent === "");
  await page.evaluate(() => { window.__failTrend = true; window.__failSecurity = true; window.__failEvents = true; });
  await page.click("#csRefreshBtn");
  await page.waitForFunction(() => document.getElementById("csChartStatus").textContent.indexOf("趋势暂时无法刷新") >= 0);
  await page.waitForFunction(() => document.getElementById("csSecurityStatus").textContent.indexOf("刷新失败") >= 0);
  await page.waitForFunction(() => document.getElementById("csEventsStatus").textContent.indexOf("刷新失败") >= 0);
  const isolated = await page.evaluate(() => ({
    service: document.getElementById("csServiceBadge").textContent,
    error: document.getElementById("csError").hidden,
    policy: document.getElementById("csDailyLimit").value,
  }));
  if (isolated.service.indexOf("运行中") < 0 || isolated.error !== true || isolated.policy !== "7") throw new Error(JSON.stringify(isolated));
  await browser.close();
  server.close();
  console.log("campus-sync-admin-progressive-load PASS");
}

main().catch((error) => { console.error(error); process.exit(1); });
