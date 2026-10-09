"use strict";
const assert = require("assert/strict"), crypto = require("crypto"), fs = require("fs"), path = require("path"), os = require("os"), { spawn } = require("child_process");
const collector = require("./wyz-schedule-collector/collector"), recovery = require("./wyz-schedule-collector/heartbeatRecovery");
const signature = require("../server/src/security/fullSyncSignature");
const env = { FULL_SYNC_AGENT_ID: "wyz-schedule-collector", FULL_SYNC_AGENT_TOKEN: crypto.randomBytes(32).toString("hex"), FULL_SYNC_SIGNING_SECRET: crypto.randomBytes(32).toString("hex"), FOSU_COLLECTOR_EXECUTE: "0" };
Object.assign(process.env, env);
const cfg = collector.config(env), fixture = code => new TypeError("private network detail", { cause: Object.assign(new Error("private cause"), { code }) });
const ok = () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
let cases = 0;
async function check(name, action) { await action(); cases++; console.log("PASS " + name); }
async function main() {
  await check("reset recovers, re-signs every retry, failure count resets and logs are private", async () => {
    let clock = Date.now(), attempts = 0; const delays = [], logs = [], headers = [];
    const request = collector.client(cfg, async (url, options) => {
      assert.equal(url, "https://class.katelya.eu.org" + recovery.HEARTBEAT);
      headers.push(options.headers);
      assert.equal(signature.verifySignedRequest({ method: "POST", originalUrl: recovery.HEARTBEAT, headers: options.headers, rawBody: options.body }, clock).ok, true);
      if (++attempts === 1) throw fixture("ECONNRESET");
      clock += 7; return ok();
    }, { now: () => clock });
    const heartbeat = recovery.createHeartbeat(request, { now: () => clock, sleep: async ms => { delays.push(ms); clock += ms; }, onState: state => logs.push(state) });
    await heartbeat(); assert.equal(attempts, 2); assert.deepEqual(delays, [15000]);
    assert.notEqual(headers[0]["x-full-sync-nonce"], headers[1]["x-full-sync-nonce"]);
    assert.notEqual(headers[0]["x-full-sync-signature"], headers[1]["x-full-sync-signature"]);
    assert.ok(Number(headers[1]["x-full-sync-timestamp"]) > Number(headers[0]["x-full-sync-timestamp"]));
    assert.equal(heartbeat.state.consecutiveFailures, 0); assert.equal(heartbeat.state.lastSuccessfulConnectionMs, 7); assert.equal(heartbeat.state.networkStatus, "recovering");
    await heartbeat(); await heartbeat(); assert.equal(heartbeat.state.networkStatus, "healthy"); assert.equal(heartbeat.readyToClaim(), true);
    const text = JSON.stringify(logs); assert.ok(!text.includes(env.FULL_SYNC_AGENT_TOKEN) && !text.includes(env.FULL_SYNC_SIGNING_SECRET) && !text.includes("private cause") && !text.includes("authorization"));
  });
  await check("four failed attempts use 15/30/60 second bounded backoff", async () => {
    let calls = 0; const delays = [];
    const heartbeat = recovery.createHeartbeat(collector.client(cfg, async () => { calls++; throw fixture("ECONNRESET"); }), { sleep: async ms => delays.push(ms) });
    await assert.rejects(heartbeat(), /ORACLE_CONNECTION_RESET/);
    assert.equal(calls, 4); assert.deepEqual(delays, [15000, 30000, 60000]); assert.equal(heartbeat.state.consecutiveFailures, 4); assert.equal(heartbeat.state.networkStatus, "degraded");
  });
  for (const [code, category] of [["EAI_AGAIN", "dns"], ["ETIMEDOUT", "timeout"], ["UND_ERR_CONNECT_TIMEOUT", "timeout"], ["UND_ERR_SOCKET", "connection-reset"]]) await check("transient " + code + " recovers", async () => {
    let count = 0;
    const heartbeat = recovery.createHeartbeat(collector.client(cfg, async () => { if (++count === 1) throw fixture(code); return ok(); }), { sleep: async () => {} });
    await heartbeat(); assert.equal(count, 2); assert.equal(recovery.classify(fixture(code)).errorCategory, category);
  });
  await check("HTTP 503 retries and disposes error response body", async () => {
    let count = 0, cancelled = 0;
    const heartbeat = recovery.createHeartbeat(collector.client(cfg, async () => ++count === 1 ? { ok: false, status: 503, body: { cancel: async () => cancelled++ } } : ok()), { sleep: async () => {} });
    await heartbeat(); assert.equal(count, 2); assert.equal(cancelled, 1);
  });
  for (const status of [401, 403, 404]) await check("HTTP " + status + " stops without retry", async () => {
    let count = 0;
    const heartbeat = recovery.createHeartbeat(collector.client(cfg, async () => { count++; return { ok: false, status }; }), { sleep: async () => assert.fail("fatal auth retried") });
    await assert.rejects(heartbeat(), error => recovery.exitCode(error) === 77); assert.equal(count, 1);
  });
  await check("TLS certificate failure is fatal, verification remains enabled", async () => {
    let count = 0;
    const heartbeat = recovery.createHeartbeat(collector.client(cfg, async (_, options) => { assert.equal(options.redirect, "error"); assert.equal(options.dispatcher, undefined); count++; throw fixture("CERT_HAS_EXPIRED"); }), { sleep: async () => assert.fail("TLS failure retried") });
    await assert.rejects(heartbeat(), error => error.code === "ORACLE_TLS_FAILED" && recovery.exitCode(error) === 78); assert.equal(count, 1);
    assert.throws(() => collector.config({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: "0" }), /TLS_POLICY_REJECTED/);
  });
  await check("aggregate family errors preserve known reset classification", () => assert.equal(recovery.classify(new TypeError("fetch failed", { cause: new AggregateError([fixture("ECONNRESET"), fixture("ECONNRESET")]) })).errorCategory, "connection-reset"));
  await check("real Node fetch socket reset recovers with fresh verified signatures", async () => {
    const http = require("http"), nonces = []; let count = 0;
    const server = http.createServer((req, res) => {
      const chunks = []; req.on("data", chunk => chunks.push(chunk)); req.on("end", () => {
        assert.equal(signature.verifySignedRequest({ method: req.method, originalUrl: req.url, headers: req.headers, rawBody: Buffer.concat(chunks) }).ok, true);
        nonces.push(req.headers["x-full-sync-nonce"]);
        if (++count === 1) req.socket.destroy(); else { res.setHeader("Content-Type", "application/json"); res.end('{"ok":true}'); }
      });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try { const heartbeat = recovery.createHeartbeat(collector.client({ ...cfg, oracle: "http://127.0.0.1:" + server.address().port }), { sleep: async () => {} }); await heartbeat(); assert.equal(count, 2); assert.equal(new Set(nonces).size, 2); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
  await check("redirect never forwards signed credentials to another origin", async () => {
    let calls = 0;
    await assert.rejects(collector.client(cfg, async (_, options) => { calls++; assert.equal(options.redirect, "error"); throw new TypeError("redirect rejected"); })("POST", recovery.HEARTBEAT, {}));
    assert.equal(calls, 1);
    for (const FOSU_API_BASE of ["invalid URL", "http://class.katelya.eu.org", "https://example.org", "https://class.katelya.eu.org/#fragment"]) assert.throws(() => collector.config({ ...env, FOSU_API_BASE }), /ORACLE_ORIGIN_REJECTED/);
  });
  await check("claim and finalize have no automatic retries", async () => {
    for (const route of ["/api/full-sync/v1/runs/claim", "/api/full-sync/v1/runs/sc-fixture/upload/finalize"]) {
      let count = 0; await assert.rejects(collector.client(cfg, async () => { count++; throw fixture("ECONNRESET"); })("POST", route, {})); assert.equal(count, 1);
    }
  });
  await check("execute mode cannot claim when heartbeat fails", async () => {
    const paths = [];
    const request = collector.client(cfg, async url => { paths.push(new URL(url).pathname); throw fixture("ECONNRESET"); });
    await assert.rejects(collector.runOnce({ ...cfg, execute: true }, { request, heartbeat: recovery.createHeartbeat(request, { sleep: async () => {} }), assertSession: () => assert.fail("session read") }));
    assert.deepEqual(paths, Array(4).fill(recovery.HEARTBEAT));
  });
  await check("read-only loop stays alive through outage, cooldown, and three successes; school calls zero", async () => {
    const control = new AbortController(), paths = [], waits = [], states = []; let attempts = 0, successes = 0;
    await collector.runLoop(cfg, { signal: control.signal, request: async (_, route) => { paths.push(route); if (++attempts <= 4) throw recovery.classify(fixture("ECONNRESET")); return { ok: true }; }, sleep: async ms => waits.push(ms), onState: state => states.push(state), onResult: () => { if (++successes === 3) control.abort(); }, assertSession: () => assert.fail("school session read"), executeSync: () => assert.fail("Playwright executed"), upload: () => assert.fail("Staging uploaded") });
    assert.deepEqual(waits, [15000, 30000, 60000, 300000, 30000, 30000]); assert.ok(paths.every(route => route === recovery.HEARTBEAT)); assert.equal(states.find(state => state.networkStatus === "healthy").consecutiveFailures, 0); assert.equal(states.at(-1).networkStatus, "stopped");
  });
  await check("ambiguous claim failure ends the loop; it is not silently repeated", async () => {
    let claims = 0;
    await assert.rejects(collector.runLoop({ ...cfg, execute: true }, { request: async (_, route) => { if (route === recovery.HEARTBEAT) return { ok: true }; claims++; throw recovery.classify(fixture("ECONNRESET")); }, sleep: async () => assert.fail("claim retry") }));
    assert.equal(claims, 1);
  });
  await check("SIGTERM-compatible abort interrupts retry wait immediately", async () => {
    const control = new AbortController(), begin = Date.now();
    const pending = recovery.wait(60000, control.signal); control.abort(); await assert.rejects(pending, /COLLECTOR_STOPPED/); assert.ok(Date.now() - begin < 500);
  });
  await check("request timeout is abortable and classified without private details", async () => {
    const keepAlive = setTimeout(() => {}, 1000);
    try { await assert.rejects(collector.client(cfg, async (_, options) => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })), { timeoutMs: 10 })("POST", recovery.HEARTBEAT, {}), /ORACLE_TIMEOUT/); }
    finally { clearTimeout(keepAlive); }
  });
  await check("diagnostic uses only public health, no credentials and bounded samples", async () => {
    const log = console.log, logs = [], waits = []; let calls = 0;
    console.log = value => logs.push(value);
    try { await require("./wyz-schedule-collector/diagnose-oracle-network").diagnose({ samples: 3, lookup: async () => [{ family: 4, address: "127.0.0.1" }], sleep: async ms => waits.push(ms), fetcher: async (url, options) => { calls++; assert.equal(url, "https://class.katelya.eu.org/api/health"); assert.equal(options.headers, undefined); assert.equal(options.redirect, "error"); return { ...ok(), body: { cancel: async () => {} } }; } }); }
    finally { console.log = log; }
    assert.equal(calls, 3); assert.deepEqual(waits, [30000, 30000]);
    const output = logs.join("\n"); assert.ok(!output.includes(env.FULL_SYNC_AGENT_TOKEN) && !output.includes(env.FULL_SYNC_SIGNING_SECRET) && !output.includes("127.0.0.1")); assert.match(output, /NOT_TESTED/);
    assert.equal(recovery.exitCode({ code: "COLLECTOR_CONFIGURATION_MISSING" }), 78); assert.equal(recovery.exitCode({ code: "COLLECTOR_LOCKED" }), 75);
    for (const code of ["ENOENT", "EACCES", "EPERM", "EROFS"]) assert.equal(recovery.exitCode({ code }), 78);
  });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-network-tests-"));
  try {
    await check("unconfirmed active lease stops worker and forbids finalize", async () => {
      const run = { id: "sc-fixture-lease", mode: "routine", term: "2026-2027-1", claimId: "a".repeat(48), termConfig: { term: "2026-2027-1", termStartDate: "2026-09-07", totalWeeks: 20, weekStart: "monday" } };
      const paths = [], request = async (_, route) => { paths.push(route); if (route.endsWith("/claim")) return { run }; if (route.endsWith("/report")) return {}; if (paths.filter(value => value === recovery.HEARTBEAT).length === 1) return { ok: true }; throw recovery.classify(fixture("ECONNRESET")); };
      let killed = false;
      await assert.rejects(collector.runOnce({ ...cfg, execute: true, dataRoot: temp }, { request, heartbeat: recovery.createHeartbeat(request, { delays: [20, 20, 20] }), leaseMs: 40, watchIntervalMs: 5, heartbeatIntervalMs: 5, assertSession: () => {}, executeSync: async (_, __, ___, onChild) => new Promise((_, reject) => onChild({ kill: () => { killed = true; reject(new Error("fixture worker stopped")); } })) }), /COLLECTOR_LEASE_EXPIRED/);
      assert.equal(killed, true); assert.ok(!paths.some(route => route.includes("/upload/"))); assert.equal(JSON.parse(fs.readFileSync(path.join(temp, "runs", run.term, run.id, "worker-lease.json"))).deadline, 0);
    });
    await check("lease lost during upload forbids subsequent chunks and completion", async () => {
      const data = require("./fixtures/four-direct-source")(), paths = [];
      const run = { id: "sc-fixture-upload", mode: "routine", term: data.term, claimId: "b".repeat(48), termConfig: data.termConfig };
      let attemptedAfterExpiry = false;
      await assert.rejects(collector.runOnce({ ...cfg, execute: true, dataRoot: temp }, {
        leaseMs: 40, watchIntervalMs: 5, heartbeatIntervalMs: 1000, assertSession: () => {},
        request: async (_, route) => { paths.push(route); if (route === recovery.HEARTBEAT) return { ok: true }; if (route.endsWith("/claim")) return { run }; return {}; },
        executeSync: async (_, __, dir) => fs.writeFileSync(path.join(dir, "staging.json"), JSON.stringify(data)),
        upload: async request => { await new Promise(resolve => setTimeout(resolve, 80)); attemptedAfterExpiry = true; await request("POST", "/api/full-sync/v1/runs/" + run.id + "/upload/finalize", {}); },
        promoteRun: () => assert.fail("failed run promoted")
      }), /COLLECTOR_LEASE_EXPIRED/);
      assert.equal(attemptedAfterExpiry, true); assert.ok(!paths.some(route => route.includes("/upload/")));
    });
    if (process.platform !== "win32") await check("real process SIGTERM during backoff exits zero and removes its lock", async () => {
      const file = path.join(temp, "child.js"), data = path.join(temp, "daemon");
      fs.writeFileSync(file, 'const c=require(' + JSON.stringify(path.resolve(__dirname, "wyz-schedule-collector/collector.js")) + ');c.main({env:' + JSON.stringify({ ...env, FOSU_COLLECTOR_DATA_DIR: data }) + ',request:async()=>{throw Object.assign(new Error("fixture reset"),{code:"ORACLE_CONNECTION_RESET",retryable:true,errorCategory:"connection-reset"})}}).catch(()=>{process.exitCode=1});');
      const child = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"] });
      const completion = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
      let output = "";
      const ready = new Promise(resolve => child.stdout.on("data", bytes => { output += bytes.toString(); if (output.includes('"retryWaitMs":15000')) resolve(); }));
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
      try { await Promise.race([ready, completion.then(() => { throw new Error("child exited before retry state"); })]); child.kill("SIGTERM"); const ended = await completion; assert.equal(ended.code, 0); assert.equal(fs.existsSync(path.join(data, "collector.lock")), false); }
      finally { clearTimeout(timeout); }
    }); else console.log("SKIP POSIX SIGTERM/lock cleanup on Windows; Linux CI must pass this case");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  console.log("collector-network-recovery: " + cases + " PASS (fixtures only; school requests 0)");
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
