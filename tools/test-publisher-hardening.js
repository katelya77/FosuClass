const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  evaluateNetworkReadiness,
  probeHttp,
} = require("./fosu-sync-client/networkProbe");
const {
  DIRECT_NO_PROXY_HOSTS,
  PROXY_ENV_NAMES,
  loadSyncClientEnv,
  prepareDirectNetworkEnvironment,
} = require("./fosu-sync-client/syncEnv");
const {
  verifySession,
} = require("./fosu-sync-client/sessionVerifier");
const publisher = require("./fosu-publisher/publish");

const root = path.resolve(__dirname, "..");
const runsRoot = path.join(root, ".local", "publisher-runs");
const lockPath = path.join(runsRoot, "publisher.lock");
const originalEnv = Object.assign({}, process.env);
const originalLock = fs.existsSync(lockPath) ? fs.readFileSync(lockPath) : null;
const cleanupRunIds = [];

function restoreEnv() {
  Object.keys(process.env).forEach((key) => {
    if (!(key in originalEnv)) delete process.env[key];
  });
  Object.assign(process.env, originalEnv);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function runId(name) {
  const id = `hardening-${name}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  cleanupRunIds.push(id);
  return id;
}

async function expectReject(fn, code) {
  let failed = false;
  try {
    await fn();
  } catch (error) {
    failed = true;
    assert.strictEqual(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
  }
  assert(failed, `expected rejection ${code}`);
}

function fakeFsSession() {
  return {
    existsSync() { return true; },
    statSync() { return { size: 128 }; },
  };
}

function fakeChromium({ url, content }) {
  return {
    async launch() {
      const page = {
        async goto() {},
        url() { return url; },
        async content() { return content; },
      };
      const context = {
        async newPage() { return page; },
        async close() {},
      };
      return {
        async newContext() { return context; },
        async close() {},
      };
    },
  };
}

async function run() {
  let readiness = evaluateNetworkReadiness({
    dns: { ok: true, campusAddresses: ["172.16.72.173"], privateAddresses: ["172.16.72.173"] },
    tcp: { ok: true },
    http: { ok: false, status: 503 },
    auth: { ok: true, status: 200 },
  });
  assert.strictEqual(readiness.success, true);
  assert.strictEqual(readiness.readiness, "ready-with-warning");

  readiness = evaluateNetworkReadiness({
    dns: { ok: true, campusAddresses: ["172.16.72.173"], privateAddresses: ["172.16.72.173"] },
    tcp: { ok: true },
    http: { ok: true, status: 200 },
    auth: { ok: false, code: "ETIMEDOUT" },
    sessionCapable: true,
  });
  assert.strictEqual(readiness.readiness, "ready-with-warning");

  readiness = evaluateNetworkReadiness({
    dns: { ok: false, code: "ENOTFOUND" },
    tcp: { ok: false },
    http: { ok: false },
    auth: { ok: false },
    sessionCapable: false,
  });
  assert.strictEqual(readiness.readiness, "blocked");
  assert.strictEqual(readiness.success, false);

  readiness = evaluateNetworkReadiness({
    dns: { ok: true, addresses: ["8.8.8.8"] },
    tcp: { ok: true },
    http: { ok: false, status: 302, redirectedToLogin: true },
    auth: { ok: true, status: 200 },
  });
  assert.strictEqual(readiness.readiness, "ready");

  const proxyEnv = {
    HTTP_PROXY: "http://user:pass@127.0.0.1:10808",
    HTTPS_PROXY: "http://user:pass@127.0.0.1:10808",
  };
  const fakeAxios = { defaults: {} };
  const proxy = prepareDirectNetworkEnvironment(proxyEnv, { axios: fakeAxios });
  assert.deepStrictEqual(proxy.detectedProxyNames.sort(), ["HTTPS_PROXY", "HTTP_PROXY"].sort());
  assert.strictEqual(proxyEnv.HTTP_PROXY, undefined);
  assert.strictEqual(fakeAxios.defaults.proxy, false);
  for (const host of DIRECT_NO_PROXY_HOSTS) {
    assert(proxyEnv.NO_PROXY.includes(host), `NO_PROXY missing ${host}`);
  }

  const httpClient = {
    async get(url, config) {
      assert.strictEqual(config.proxy, false);
      return { status: 200, headers: {} };
    },
  };
  const http = await probeHttp("https://100.fosu.edu.cn", { axios: httpClient });
  assert.strictEqual(http.status, 200);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-sync-env-"));
  const envPath = path.join(tempRoot, ".env");
  fs.writeFileSync(envPath, [
    "FOSU_BASE_URL=https://from-client-env.example",
    "FOSU_AUTH_URL=https://auth-from-client-env.example",
    "FOSU_API_BASE=https://api-from-client-env.example",
    "SYNC_DISABLE_PROXY=true",
    "PREFERRED_SEMESTER=2025-2026-2",
  ].join(os.EOL), "utf8");
  const env = { FOSU_BASE_URL: "https://process-wins.example" };
  loadSyncClientEnv({ env, envPath });
  assert.strictEqual(env.FOSU_BASE_URL, "https://process-wins.example");
  assert.strictEqual(env.FOSU_API_BASE, "https://api-from-client-env.example");
  assert.strictEqual(env.PREFERRED_SEMESTER, "2025-2026-2");
  fs.rmSync(tempRoot, { recursive: true, force: true });

  let session = await verifySession({
    fs: fakeFsSession(),
    chromium: fakeChromium({
      url: "http://100.fosu.edu.cn/framework/xsMain.jsp",
      content: "教学一体化服务平台 我的桌面",
    }),
    sessionPath: "redacted-session.json",
  });
  assert.strictEqual(session.ok, true);
  assert.strictEqual(session.code, "SESSION_VALID");

  session = await verifySession({
    fs: fakeFsSession(),
    chromium: fakeChromium({
      url: "https://authserver.fosu.edu.cn/authserver/login",
      content: "统一身份认证 密码登录",
    }),
    sessionPath: "redacted-session.json",
  });
  assert.strictEqual(session.ok, false);
  assert.strictEqual(session.code, "SESSION_EXPIRED");
  assert(!JSON.stringify(session).toLowerCase().includes("cookie"), "session verifier must not expose cookie text");

  restoreEnv();
  process.env.FOSU_PUBLISHER_MOCK = "1";
  process.env.ADMIN_API_TOKEN = "publisher-test-token";
  process.env.FOSU_PUBLISHER_MOCK_CAMPUS_READINESS = "ready-with-warning";
  const warned = await publisher.main(["--mode=routine", "--term=2025-2026-2", `--run-id=${runId("network-warning")}`]);
  assert.strictEqual(warned.success, true);

  restoreEnv();
  process.env.FOSU_PUBLISHER_MOCK = "1";
  process.env.ADMIN_API_TOKEN = "publisher-test-token";
  process.env.FOSU_PUBLISHER_MOCK_CAMPUS_READINESS = "blocked";
  await expectReject(() => publisher.main(["--mode=routine", "--term=2025-2026-2", `--run-id=${runId("network-blocked")}`]), "CAMPUS_NETWORK_BLOCKED");

  const publishSource = fs.readFileSync(path.join(root, "tools", "fosu-publisher", "publish.js"), "utf8");
  assert(!publishSource.includes("run\", \"diagnose\""), "publisher must not call npm run diagnose");
  assert(!publishSource.includes("tools/fosu-sync-client\", \"run\", \"diagnose\""), "publisher must not call npm diagnose wrapper");
  assert(publishSource.includes("verify-session.js"), "publisher must call verify-session.js");
  assert(publishSource.includes("CRAWL_OUTPUT_MISSING"), "publisher should fail when crawl output is missing");
  assert(publishSource.includes("withHttpRetry"), "publisher admin HTTP calls should retry transient failures");
  assert(publishSource.includes("ECONNABORTED"), "publisher should classify write timeouts as retryable");
  assert(publishSource.includes("staging upload finalize"), "publisher should wait for staging finalize jobs before publishing");
  assert(publishSource.includes("staging-finalize-reconcile"), "publisher resume should reconcile old finalize-wait stages");
  const incrementalArgs = publisher.parseArgs(["--incremental", "--term=2026-2027-1", "--grade=2026", "--concurrency=8", "--resume"]);
  assert.strictEqual(publisher.normalizeRequestedMode(incrementalArgs), "routine");
  const crawlPlan = publisher.buildCrawlArgs("routine", incrementalArgs, { runDir: path.join(root, ".local", "test-run") }, "2026-2027-1");
  assert(crawlPlan.args.includes("--progress-policy=resume"));
  assert(crawlPlan.args.includes("--grades=2026"));
  assert(crawlPlan.args.includes("--concurrency=8"));

  const syncSource = fs.readFileSync(path.join(root, "tools", "fosu-sync-client", "sync.js"), "utf8");
  assert(syncSource.includes("loadSyncClientEnv()"), "sync.js should load explicit client .env");
  assert(syncSource.includes("main().catch"), "sync.js should set nonzero exit on fatal errors");
  assert(syncSource.includes("UNKNOWN_SYNC_ACTION"), "sync.js unknown action should be fatal");

  fs.mkdirSync(runsRoot, { recursive: true });

  const activeRunId = runId("active-lock");
  writeJson(path.join(runsRoot, activeRunId, "state.json"), {
    runId: activeRunId,
    status: "running",
    currentStage: "crawling",
  });
  writeJson(lockPath, { runId: activeRunId, pid: process.pid, createdAt: new Date().toISOString() });
  await expectReject(() => {
    const runObj = new publisher.PublisherRun({ mode: "routine", args: {}, runId: runId("active-lock-new") });
    publisher.acquireLock(runObj, { commandLine: "node tools/fosu-publisher/publish.js" });
  }, "PUBLISHER_LOCKED");

  const failedRunId = runId("failed-lock");
  writeJson(path.join(runsRoot, failedRunId, "state.json"), {
    runId: failedRunId,
    status: "failed",
    currentStage: "checking-campus-network",
  });
  writeJson(lockPath, { runId: failedRunId, pid: process.pid, createdAt: new Date().toISOString() });
  const failedLockRun = new publisher.PublisherRun({ mode: "routine", args: {}, runId: runId("failed-lock-new") });
  publisher.acquireLock(failedLockRun, { commandLine: "node tools/fosu-publisher/publish.js" });
  assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, "utf8")).runId, failedLockRun.runId);

  writeJson(lockPath, { runId: "dead-pid", pid: 99999999, createdAt: new Date().toISOString() });
  const deadLockRun = new publisher.PublisherRun({ mode: "routine", args: {}, runId: runId("dead-lock-new") });
  publisher.acquireLock(deadLockRun);
  assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, "utf8")).runId, deadLockRun.runId);

  const reuseRunId = runId("pid-reuse");
  writeJson(path.join(runsRoot, reuseRunId, "state.json"), {
    runId: reuseRunId,
    status: "running",
    currentStage: "crawling",
  });
  writeJson(lockPath, { runId: reuseRunId, pid: process.pid, createdAt: new Date().toISOString() });
  const reuseLockRun = new publisher.PublisherRun({ mode: "routine", args: {}, runId: runId("reuse-lock-new") });
  publisher.acquireLock(reuseLockRun, { commandLine: "node tools/test-publisher-hardening.js" });
  assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, "utf8")).runId, reuseLockRun.runId);

  writeJson(lockPath, { runId: "dry-run-lock", pid: 99999999, createdAt: new Date().toISOString() });
  const status = spawnSync(process.execPath, [path.join(root, "tools", "fosu-publisher", "status.js")], {
    cwd: root,
    encoding: "utf8",
  });
  assert.strictEqual(status.status, 0);
  assert(status.stdout.includes("safeUnlock: true"));
  const unlock = spawnSync(process.execPath, [path.join(root, "tools", "fosu-publisher", "unlock.js"), "--dry-run"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.strictEqual(unlock.status, 0);
  assert(unlock.stdout.includes("dry-run"));

  fs.rmSync(lockPath, { force: true });
  const doctor = spawnSync(process.execPath, [path.join(root, "tools", "fosu-publisher", "doctor.js"), "--json"], {
    cwd: root,
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      FOSU_PUBLISHER_MOCK: "1",
      ADMIN_API_TOKEN: "publisher-test-token",
    }),
  });
  assert.strictEqual(doctor.status, 0, doctor.stderr || doctor.stdout);
  const doctorJson = JSON.parse(doctor.stdout);
  assert.strictEqual(doctorJson.canStartPublisher, true);
  assert(doctorJson.checks.some((item) => item.name === "playwright-session" && item.level === "PASS"));

  const launcherSource = fs.readFileSync(path.join(root, "tools", "fosu-publisher", "run-publisher.ps1"), "utf8");
  assert(launcherSource.includes("Invoke-LockReconciliation"));
  assert(launcherSource.includes("publisher-lock-dry-run"));
  assert(launcherSource.includes("PUBLISHER_LOCKED"));
  assert(launcherSource.includes("checking-campus-network"));
  assert(launcherSource.includes("npm run sync:login"));

  const verifySessionSource = fs.readFileSync(path.join(root, "tools", "fosu-sync-client", "verify-session.js"), "utf8");
  assert(verifySessionSource.includes("npm run sync:login"));
  assert(!verifySessionSource.toLowerCase().includes("cookie"));

  console.log("test-publisher-hardening passed");
}

run().finally(() => {
  restoreEnv();
  cleanupRunIds.forEach((id) => {
    fs.rmSync(path.join(runsRoot, id), { recursive: true, force: true });
  });
  if (originalLock) {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, originalLock);
  } else {
    fs.rmSync(lockPath, { force: true });
  }
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
