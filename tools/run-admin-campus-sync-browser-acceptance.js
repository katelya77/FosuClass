const fs = require("fs");
const http = require("http");
const path = require("path");

const OUT_DIR = path.resolve("output/admin-campus-sync-acceptance");
const { CAMPUS_SYNC_SCRIPT, CAMPUS_SYNC_SECTION, CAMPUS_SYNC_STYLES } = require("../server/src/routes/adminCampusSyncAssets");

function page(seed) {
  return `<!doctype html><html data-resolved-theme="${seed.theme}"><head><meta charset="utf-8"><style>
    :root { --surface:#fbfaf7; --surface-muted:#eeece6; --border:#d9d5cc; --text-primary:#181b20; --text-secondary:#4b515b; --text-muted:#626a75; --success:#14795a; --success-soft:#e5f3ed; --warning:#9a5d08; --warning-soft:#f8edd9; --danger:#b42318; --danger-soft:#f8e6e3; --radius:9px; }
    html[data-resolved-theme="dark"] { --surface:#171b21; --surface-muted:#222832; --border:#303742; --text-primary:#f0f2f4; --text-muted:#949eaa; --success:#5bc69a; --success-soft:rgba(91,198,154,.14); --warning:#e3ad55; --warning-soft:rgba(227,173,85,.14); --danger:#f0877f; --danger-soft:rgba(240,135,127,.14); color-scheme:dark; }
    body { margin:0; background:${seed.theme === "dark" ? "#101318" : "#f4f2ed"}; color:var(--text-primary); font-family:Segoe UI, sans-serif; }
    ${CAMPUS_SYNC_STYLES}
    #section-campus-sync { display:grid; }
  </style></head><body>
    <button data-section="campus-sync">个人课表同步</button>
    ${CAMPUS_SYNC_SECTION}
    <script>
      var seed = ${JSON.stringify(seed.payload)};
      function api(url) {
        if (seed.mode === "error") return Promise.reject(new Error("offline"));
        if (url.indexOf("overview") >= 0) return Promise.resolve({ overview: seed.overview });
        if (url.indexOf("timeseries") >= 0) return Promise.resolve({ points: seed.points });
        if (url.indexOf("security") >= 0) return Promise.resolve({ security: seed.security });
        if (url.indexOf("config") >= 0) return Promise.resolve({ config: seed.config });
        if (url.indexOf("events") >= 0) return Promise.resolve({ events: seed.events, nextCursor: "" });
        return Promise.resolve({});
      }
      ${CAMPUS_SYNC_SCRIPT}
      document.getElementById("section-campus-sync").classList.add("active");
    </script>
  </body></html>`;
}

function seed(mode) {
  const healthy = mode !== "offline";
  return {
    theme: "light",
    mode,
    payload: {
      mode,
      overview: {
        status: mode === "offline" ? "offline" : (mode === "busy" ? "busy" : "normal"),
        securityPosture: mode === "security" ? "watch" : "normal",
        agent: { online: healthy, lastHeartbeatAgeMs: healthy ? 1200 : null },
        queue: { queued: mode === "busy" ? 10 : 1, processing: mode === "busy" ? 1 : 0, active: mode === "busy" ? 11 : 1, cap: 10, oldestQueuedMs: 400, activeWorker: mode === "busy" ? 1 : 0, estimatedWaitMs: 800 },
        window24h: { attempts: 20, success: 16, failed: 2, successRate: 88.9, rateLimited: 1, systemFailureRate: 10, credentialFailureRate: 5 },
        performance: { avgDurationMs: 900, p95DurationMs: 2400 },
        pipeline: [
          { label: "Mini Program API", status: "ok", errors: 0 },
          { label: "Campus Sync Broker", status: "ok", errors: 0 },
          { label: "WYZ Agent", status: healthy ? "online" : "offline", errors: healthy ? 0 : 2 },
          { label: "School Gateway", status: "inferred", errors: 0 },
        ],
        errors: mode === "failed" ? { TIMEOUT: 2, INVALID_CREDENTIALS: 3 } : {},
      },
      points: [{ attempts: 4, success: 3, failed: 1 }, { attempts: 6, success: 5, failed: 0 }],
      security: { recent: mode === "security" ? [{ reasonCode: "CAMPUS_SYNC_REPLAY_BLOCKED", count: 4, principalHashPrefix: "abcd1234", anonymizedIp: "203.0.113.0" }] : [], suspensions: [] },
      config: { perUserConcurrency: 1, rateLimit: 5, dailyLimit: 10, globalCap: 10, jobTtlSeconds: 90, previewRetentionSeconds: 900, heartbeatIntervalMs: 30000, offlineTtlMs: 90000, workerConcurrency: 1, circuit: { state: "CLOSED" }, secrets: { campusAgentToken: "Configured", campusAgentSigningSecret: "Configured" } },
      events: mode === "empty" ? [] : [{ t: Date.now(), jobIdShort: "abc12345", principalHashPrefix: "abcd1234", status: mode === "failed" ? "failed" : "completed", queueWaitMs: 20, durationMs: 800, courseCount: 23, retryCount: 0, resultCode: mode === "failed" ? "TIMEOUT" : "OK", source: "campus-sync", requestId: "req123" }],
    },
  };
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (error) {
    try {
      ({ chromium } = require(path.join(__dirname, "fosu-sync-client", "node_modules", "playwright")));
    } catch (inner) {
      fs.writeFileSync(path.join(OUT_DIR, "RESULT.txt"), "PLAYWRIGHT_UNAVAILABLE\n");
      console.log("admin-campus-sync-browser SKIP playwright unavailable");
      return;
    }
  }
  const server = http.createServer((req, res) => {
    const mode = new URL(req.url, "http://127.0.0.1").searchParams.get("mode") || "healthy";
    const theme = new URL(req.url, "http://127.0.0.1").searchParams.get("theme") || "light";
    const body = page(Object.assign(seed(mode), { theme }));
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, channel: process.env.FOSU_BROWSER_CHANNEL || undefined }).catch(async () => {
    return chromium.launch({ headless: true, channel: "msedge" });
  });
  const shots = [
    ["desktop-light", 1280, 800, "healthy", "light"],
    ["desktop-dark", 1280, 800, "healthy", "dark"],
    ["narrow", 390, 844, "security", "light"],
    ["busy", 1280, 800, "busy", "light"],
    ["offline", 1280, 800, "offline", "light"],
    ["empty", 1280, 800, "empty", "light"],
  ];
  for (const [name, width, height, mode, theme] of shots) {
    const pageHandle = await browser.newPage({ viewport: { width, height } });
    await pageHandle.goto(`http://127.0.0.1:${port}/?mode=${mode}&theme=${theme}`);
    await pageHandle.waitForSelector("#csOverview .cs-stat");
    await pageHandle.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
    await pageHandle.close();
  }
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT_DIR, "RESULT.txt"), "PASS\n");
  console.log("admin-campus-sync-browser PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
