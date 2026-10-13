"use strict";
require("./fixture-network-only");
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const admin = require("./oracle-sample/maintenance-admin");
const { startAdminHttpHarness } = require("./test-helpers/admin-http-harness");
async function fixture() {
  const h = await startAdminHttpHarness({ environment: { PORT: "3000", FOSU_ALLOWED_ADMIN_ORIGINS: "https://class.katelya.eu.org", CAMPUS_SYNC_OPS_DIR: "fixture-placeholder" }, onPaths(paths) { process.env.CAMPUS_SYNC_OPS_DIR = path.join(paths.root, "campus-sync"); } });
  const env = path.join(h.paths.root, "protected.env"), state = path.join(h.paths.root, "maintenance.json");
  fs.writeFileSync(env, "ADMIN_PASSWORD=c1-password\nADMIN_API_TOKEN=c1-admin-full\n", { mode: 0o600 });
  const args = mode => [mode, "--app-dir=" + h.paths.root, "--credentials-file=" + env, "--state-file=" + state, ...(mode === "acquire" ? ["--approve-maintenance=PAUSE_PERSONAL_ADMISSION"] : [])];
  const deps = { skipRootCheck: true, base: h.baseUrl };
  return { h, env, state, args, deps };
}
test("approval is required before login, writes, or credential read", async () => {
  let reads = 0;
  await assert.rejects(admin.main(["acquire", "--app-dir=" + path.resolve("fixture"), "--credentials-file=" + path.resolve("protected.env"), "--state-file=" + path.resolve("state.json")], { skipRootCheck: true, readFile() { reads++; } }), { code: "MAINTENANCE_APPROVAL_REQUIRED" });
  assert.equal(reads, 0);
});
test("real cookie/CSRF maintenance saves original state before POST and confirms audit", async () => {
  const f = await fixture();
  try {
    let postCount = 0;
    f.deps.fetch = async (url, opts) => {
      if (url.endsWith("/actions/pause")) {
        postCount++;
        const saved = JSON.parse(fs.readFileSync(f.state));
        assert.equal(saved.originalPaused, false); assert.equal(saved.phase, "PAUSE_REQUESTED");
        assert.ok(opts.headers.cookie.includes("fosu_admin_session=")); assert.ok(opts.headers["x-fosu-csrf"]);
        assert.equal(opts.headers.origin, "https://class.katelya.eu.org"); assert.equal(opts.headers.authorization, undefined);
      }
      return fetch(url, opts);
    };
    const acquired = await admin.main(f.args("acquire"), f.deps);
    assert.equal(acquired.personalQueueIdle, true);
    await admin.main(f.args("acquire"), f.deps);
    assert.equal(postCount, 1, "state-based replay must not issue another pause POST");
    let saved = JSON.parse(fs.readFileSync(f.state));
    assert.equal(saved.pauseAudit.audited, true); assert.equal(saved.pauseAudit.authMethod, "admin-cookie");
    const result = await admin.main(f.args("restore"), f.deps);
    assert.equal(result.paused, false); assert.equal(result.originalAdmissionRestored, true);
    saved = JSON.parse(fs.readFileSync(f.state)); assert.equal(saved.restoreAudit.audited, true);
    const serialized = JSON.stringify(saved);
    for (const secret of ["c1-password", "c1-admin-full", "fosu_admin_session=", "csrfToken"]) assert.ok(!serialized.includes(secret));
    assert.equal((await admin.main(f.args("restore"), f.deps)).paused, false);
  } finally { await f.h.close(); }
});
test("uncertain pause response retains recoverable state and restores admission", async () => {
  const f = await fixture();
  try {
    f.deps.fetch = async (url, opts) => {
      const response = await fetch(url, opts);
      if (url.endsWith("/actions/pause")) throw new Error("fixture disconnected after protected server POST");
      return response;
    };
    await assert.rejects(admin.main(f.args("acquire"), f.deps));
    const saved = JSON.parse(fs.readFileSync(f.state)); assert.equal(saved.phase, "PAUSE_REQUESTED"); assert.equal(saved.originalPaused, false);
    delete f.deps.fetch;
    const result = await admin.main(f.args("restore"), f.deps); assert.equal(result.paused, false);
  } finally { await f.h.close(); }
});
test("existing paused admission is preserved on restore without extra mutation", async () => {
  const f = await fixture();
  try {
    const credentials = await f.h.login();
    await f.h.request("/api/admin/campus-sync/actions/pause", { method: "POST", cookie: credentials.cookie, headers: { origin: "https://class.katelya.eu.org", "x-fosu-csrf": credentials.csrfToken }, body: {} });
    let actions = 0;
    f.deps.fetch = (url, opts) => { if (url.includes("/actions/")) actions++; return fetch(url, opts); };
    assert.equal((await admin.main(f.args("acquire"), f.deps)).originalPaused, true);
    assert.equal((await admin.main(f.args("restore"), f.deps)).paused, true);
    assert.equal(actions, 0);
  } finally { await f.h.close(); }
});
test("bad real CSRF stops before container work and remains restorable", async () => {
  const f = await fixture();
  try {
    f.deps.fetch = (url, opts) => { if (url.endsWith("/actions/pause")) opts.headers["x-fosu-csrf"] = "fixture-invalid"; return fetch(url, opts); };
    await assert.rejects(admin.main(f.args("acquire"), f.deps), { code: "ADMIN_CSRF_REJECTED" });
    delete f.deps.fetch;
    assert.equal((await admin.main(f.args("restore"), f.deps)).paused, false);
  } finally { await f.h.close(); }
});
test("drain timeout cannot pretend personal jobs have completed", async () => {
  const f = await fixture();
  try {
    let clock = 0;
    f.deps.now = () => clock += 2000;
    f.deps.fetch = async (url, opts) => {
      const response = await fetch(url, opts);
      if (url.endsWith("/campus-sync/snapshot")) {
        const json = await response.json(); json.snapshot.service.queue = { queued: 0, processing: 1, active: 1 };
        return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
      }
      return response;
    };
    await assert.rejects(admin.main([...f.args("acquire"), "--wait-seconds=1"], f.deps), { code: "PERSONAL_BROKER_DRAIN_TIMEOUT" });
    delete f.deps.fetch;
    assert.equal((await admin.main(f.args("restore"), f.deps)).paused, false);
  } finally { await f.h.close(); }
});
test("publisher API token is never treated as a web login credential", async () => {
  const f = await fixture();
  try {
    fs.writeFileSync(f.env, "ADMIN_API_TOKEN=c1-admin-full\n");
    await assert.rejects(admin.main(f.args("acquire"), f.deps), { code: "ADMIN_LOGIN_CREDENTIAL_REQUIRED" });
    assert.equal(fs.existsSync(f.state), false);
  } finally { await f.h.close(); }
});
