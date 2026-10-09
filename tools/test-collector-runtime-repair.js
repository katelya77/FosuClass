"use strict";
const assert = require("assert/strict"), crypto = require("crypto"), fs = require("fs"), os = require("os"), path = require("path");
const collector = require("./wyz-schedule-collector/collector");
const credentials = require("./wyz-schedule-collector/credentials");
const signature = require("../server/src/security/fullSyncSignature");
const { workerCommand } = require("./wyz-schedule-collector/browserRuntime");
const { smoke } = require("./wyz-schedule-collector/browser-smoke");
let cases = 0;
async function check(action) { await action(); cases++; }
async function main() {
  const env = { FULL_SYNC_AGENT_ID: "wyz-schedule-collector", FULL_SYNC_AGENT_TOKEN: crypto.randomBytes(32).toString("hex"), FULL_SYNC_SIGNING_SECRET: crypto.randomBytes(32).toString("hex") };
  const cfg = collector.config(env);
  await check(() => assert.throws(() => collector.config({}), /COLLECTOR_CONFIGURATION_MISSING/));
  await check(() => assert.throws(() => collector.config({ ...env, FULL_SYNC_SIGNING_SECRET: env.FULL_SYNC_AGENT_TOKEN }), /COLLECTOR_CREDENTIALS_REJECTED/));
  await check(() => assert.throws(() => collector.config({ ...env, CAMPUS_AGENT_TOKEN: env.FULL_SYNC_SIGNING_SECRET }), /COLLECTOR_CREDENTIALS_REJECTED/));
  const calls = [];
  await check(async () => {
    const result = await collector.runOnce(cfg, { request: async (...args) => { calls.push(args); return { ok: true }; }, assertSession: () => assert.fail("disabled collector read a session"), executeSync: () => assert.fail("disabled collector executed") });
    assert.equal(result.status, "heartbeat-only"); assert.deepEqual(calls.map(call => call[1]), ["/api/full-sync/v1/heartbeat"]);
  });
  await check(() => assert.rejects(collector.runOnce(cfg, { request: async () => ({ success: true }) }), /ORACLE_HEARTBEAT_REJECTED/));
  for (const [status, code] of [[401, "ORACLE_AUTH_REJECTED"], [403, "ORACLE_SIGNATURE_OR_CLOCK_REJECTED"], [404, "ORACLE_AUTH_OR_ENDPOINT_REJECTED"], [500, "ORACLE_HTTP_500"]]) await check(() => assert.rejects(collector.client(cfg, async () => ({ status, ok: false }))("POST", "/api/full-sync/v1/heartbeat", {}), new RegExp(code)));
  for (const [name, code] of [["TimeoutError", "ORACLE_TIMEOUT"], ["TypeError", "ORACLE_NETWORK_FAILED"]]) await check(() => assert.rejects(collector.client(cfg, async () => { throw Object.assign(new Error("sensitive upstream detail"), { name }); })("POST", "/api/full-sync/v1/heartbeat", {}), error => error.code === code && !error.message.includes("sensitive")));
  await check(() => assert.rejects(collector.client(cfg, async () => ({ ok: true, status: 200, json: async () => { throw new Error("raw response"); } }))("POST", "/api/full-sync/v1/heartbeat", {}), /ORACLE_RESPONSE_INVALID/));
  Object.assign(process.env, env); signature.resetNonces();
  await check(async () => {
    let requests = 0;
    const request = collector.client(cfg, async (url, options) => {
      requests++;
      const value = signature.verifySignedRequest({ method: options.method, originalUrl: new URL(url).pathname, headers: options.headers, rawBody: options.body }, Date.now());
      assert.equal(value.ok, true);
      assert.equal(signature.verifySignedRequest({ method: options.method, originalUrl: new URL(url).pathname, headers: options.headers, rawBody: options.body }, Date.now()).status, 403);
      return { status: 200, ok: true, json: async () => ({ ok: true }) };
    });
    await collector.runOnce(cfg, { request }); assert.equal(requests, 1);
  });
  const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const envelope = credentials.seal(env, keys.publicKey);
  await check(() => { assert.equal(credentials.open(envelope, keys.privateKey).FULL_SYNC_AGENT_TOKEN, env.FULL_SYNC_AGENT_TOKEN); assert.ok(!JSON.stringify(envelope).includes(env.FULL_SYNC_AGENT_TOKEN)); });
  await check(() => assert.throws(() => credentials.open({ ...envelope, tag: crypto.randomBytes(16).toString("base64") }, keys.privateKey), /CREDENTIAL_ENVELOPE_REJECTED/));
  await check(() => assert.throws(() => credentials.open(envelope, keys.privateKey, envelope.expiresAt + 1), /CREDENTIAL_ENVELOPE_REJECTED/));
  await check(() => assert.throws(() => credentials.seal(env, crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey), /RECIPIENT_KEY_REJECTED/));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-runtime-repair-"));
  fs.chmodSync(dir, 0o700);
  try {
    const watcher = require("./wyz-schedule-collector/container-worker"), leaseFile = path.join(dir, "worker-lease.json");
    await check(() => assert.equal(watcher.leaseAlive(leaseFile), false));
    fs.writeFileSync(leaseFile, JSON.stringify({ deadline: Date.now() - 1 }));
    await check(async () => { assert.equal(watcher.leaseAlive(leaseFile), false); assert.equal(await watcher.run(["-e", "process.exit(0)"], { FOSU_COLLECTOR_WATCHDOG_FILE: leaseFile }), 65); });
    fs.writeFileSync(leaseFile, JSON.stringify({ deadline: Date.now() + 80000 }));
    await check(async () => assert.equal(await watcher.run(["-e", "process.exit(0)"], { FOSU_COLLECTOR_WATCHDOG_FILE: leaseFile }), 0));
    fs.writeFileSync(leaseFile, JSON.stringify({ deadline: Date.now() + 100 }));
    await check(async () => assert.equal(await watcher.run(["-e", "setInterval(()=>{},1000)"], { FOSU_COLLECTOR_WATCHDOG_FILE: leaseFile }), 65));
    const lease = path.join(dir, "session.json"), run = path.join(dir, "run"), catalog = path.join(dir, "catalog");
    fs.writeFileSync(lease, "{}", { mode: 0o600 }); fs.mkdirSync(run); fs.mkdirSync(catalog);
    await check(() => assert.equal(workerCommand("node", [], {}, { dataRoot: dir, sessionPath: lease }, run, dir).executable, "node"));
    const file = path.join(dir, "browser-runtime.json");
    fs.writeFileSync(file, JSON.stringify({ mode: "container", engine: "docker", image: "sha256:" + "a".repeat(64) }), { mode: 0o600 });
    if (process.platform === "win32" || process.getuid() === 0) {
      await check(() => { const command = workerCommand("node", ["tools/fosu-sync-client/sync.js"], { FOSU_COLLECTOR_MODE: "1" }, { dataRoot: dir, sessionPath: lease }, run, dir); assert.equal(command.executable, "/usr/bin/docker"); assert.ok(command.args.includes("--read-only")); assert.ok(command.args.includes("--cap-drop=ALL")); assert.equal(command.args.filter(value => value.startsWith("type=bind")).length, 3); assert.ok(!command.args.includes("--privileged")); });
      const transfer = path.join(dir, "encrypted.json"), key = path.join(dir, "transfer.key"), target = path.join(dir, "full-sync.env");
      fs.writeFileSync(transfer, JSON.stringify(envelope), { mode: 0o600 }); fs.writeFileSync(key, keys.privateKey, { mode: 0o600 });
      await check(async () => { await assert.rejects(credentials.importEnvelope(transfer, async () => { throw new Error("ORACLE_SIGNATURE_OR_CLOCK_REJECTED"); }, target, key)); assert.equal(fs.existsSync(target), false); assert.equal(fs.existsSync(transfer), true); });
      await check(async () => { await credentials.importEnvelope(transfer, async () => {}, target, key); assert.equal(credentials.readEnvFile(target).FOSU_COLLECTOR_EXECUTE, "0"); assert.equal(fs.existsSync(transfer), false); if (process.platform !== "win32") assert.equal(fs.statSync(target).mode & 0o077, 0); });
      fs.writeFileSync(transfer, JSON.stringify(envelope), { mode: 0o600 });
      await check(async () => { const before = fs.readFileSync(target); await credentials.importEnvelope(transfer, async () => {}, target, key); assert.deepEqual(fs.readFileSync(target), before); });
      fs.writeFileSync(transfer, JSON.stringify(credentials.seal({ ...env, FULL_SYNC_AGENT_TOKEN: crypto.randomBytes(32).toString("hex") }, keys.publicKey)), { mode: 0o600 });
      await check(() => assert.rejects(credentials.importEnvelope(transfer, async () => assert.fail("conflicting credentials probed"), target, key), /EXISTING_CREDENTIALS_CONFLICT/));
    } else {
      await check(() => assert.throws(() => workerCommand("node", [], {}, { dataRoot: dir, sessionPath: lease }, run, dir), /BROWSER_RUNTIME_PERMISSIONS_REJECTED/));
      console.log("ROOT_ONLY_IMPORT: requires the Linux root CI suite; not claimed by this non-root run");
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  await check(async () => {
    const events = [];
    const page = { goto: async url => { assert.match(url, /^file:/); events.push("goto"); }, title: async () => "Collector local smoke", locator: () => ({ innerText: async () => "rendered" }), close: async () => events.push("page.close") };
    const context = { route: async () => {}, newPage: async () => { events.push("newPage"); return page; }, close: async () => events.push("context.close") };
    const result = await smoke({ launch: async () => { events.push("launch"); return { newContext: async () => { events.push("newContext"); return context; }, close: async () => events.push("browser.close") }; } });
    assert.equal(result.schoolRequests, 0); assert.deepEqual(events, ["launch", "newContext", "newPage", "goto", "page.close", "context.close", "browser.close"]);
  });
  console.log("collector-runtime-repair: " + cases + " PASS (fixtures only)");
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
