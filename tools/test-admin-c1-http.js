const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { startAdminHttpHarness } = require("./test-helpers/admin-http-harness");

const DOMAINS = {
  settings: {
    readPath: "/api/admin/settings",
    writePath: "/api/admin/settings",
    scope: "settings:write",
    backupPrefix: "config-",
    valid: (suffix) => ({ appName: `C1 settings ${suffix}` }),
    invalid: () => ({ publishStatus: "not-a-status" }),
  },
  catalog: {
    readPath: "/api/admin/catalog/meta",
    writePath: "/api/admin/catalog/meta",
    scope: "catalog:write",
    backupPrefix: "catalog-meta-",
    valid: (suffix) => ({ type: "class", id: `C1-${suffix}`, displayName: `C1 class ${suffix}`, note: "", hidden: false, tags: [] }),
    invalid: () => ({ type: "class" }),
  },
  quality: {
    readPath: "/api/admin/quality/ignores",
    writePath: "/api/admin/quality/mark",
    scope: "quality:write",
    backupPrefix: "quality-",
    valid: (suffix) => ({ type: "missingTeacher", target: `C1-${suffix}`, ignore: true, reason: "fixture", severity: "info" }),
    invalid: () => ({ type: "missingTeacher" }),
  },
};

function backupFiles(paths, prefix) {
  const directory = path.join(paths.data, "backups");
  return fs.readdirSync(directory).filter((name) => name.startsWith(prefix) && name.endsWith(".json"));
}

function auditCount(paths) {
  const file = path.join(paths.data, "admin-audit-log.jsonl");
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).length;
}

function browserHeaders(session, version) {
  return {
    Origin: "http://admin.test",
    "X-Fosu-Admin-Client": "next",
    "X-Fosu-CSRF": session.csrfToken,
    ...(version ? { "If-Match": version } : {}),
  };
}

async function getVersion(harness, domain, session) {
  const response = await harness.request(domain.readPath, { cookie: session.cookie });
  assert.strictEqual(response.status, 200, response.text);
  assert.ok(response.json && response.json.version, `${domain.readPath} did not return a version`);
  return response.json.version;
}

async function assertStatus(harness, domain, options, expected, label) {
  const response = await harness.request(domain.writePath, options);
  assert.strictEqual(response.status, expected, `${label}: ${response.text}`);
  return response;
}

async function exerciseDomain(name, domain) {
  const harness = await startAdminHttpHarness();
  try {
    const session = await harness.login();
    const initialVersion = await getVersion(harness, domain, session);
    const beforeBackups = backupFiles(harness.paths, domain.backupPrefix).length;
    const beforeAudit = auditCount(harness.paths);

    await assertStatus(harness, domain, {
      method: "POST", headers: { "X-Fosu-Admin-Client": "next", "If-Match": initialVersion }, body: domain.valid("anonymous"),
    }, 401, `${name} anonymous write`);
    await assertStatus(harness, domain, {
      method: "POST", cookie: session.cookie, headers: { "X-Fosu-Admin-Client": "next", Origin: "http://admin.test", "If-Match": initialVersion }, body: domain.valid("missing-csrf"),
    }, 403, `${name} cookie without CSRF`);
    await assertStatus(harness, domain, {
      method: "POST", cookie: session.cookie, headers: { ...browserHeaders(session, initialVersion), "X-Fosu-CSRF": "bad" }, body: domain.valid("bad-csrf"),
    }, 403, `${name} cookie with bad CSRF`);
    await assertStatus(harness, domain, {
      method: "POST", cookie: session.cookie, headers: { ...browserHeaders(session, initialVersion), Origin: "http://public.test" }, body: domain.valid("public-origin"),
    }, 403, `${name} public but non-admin origin`);
    const wrongToken = name === "catalog" ? "c1-settings-token" : "c1-catalog-token";
    const scopeDenied = await assertStatus(harness, domain, {
      method: "POST", headers: { "X-Admin-Token": wrongToken, "X-Fosu-Client": "service", "X-Fosu-Admin-Client": "next", "If-Match": initialVersion }, body: domain.valid("scope-denied"),
    }, 403, `${name} scoped token without domain scope`);
    assert.strictEqual(scopeDenied.json && scopeDenied.json.code, "ADMIN_SCOPE_DENIED");

    await assertStatus(harness, domain, {
      method: "POST", headers: { "X-Admin-Token": `c1-${name}-token`, "X-Fosu-Client": "service", "X-Fosu-Admin-Client": "next" }, body: domain.valid("scope-allowed"),
    }, 428, `${name} domain-scoped service token`);

    const security = await harness.request("/api/admin/security/status", { cookie: session.cookie });
    assert.strictEqual(security.status, 200, security.text);
    const scopeEvent = (security.json.events && security.json.events.recentEvents || []).find((event) => event.reasonCode === "ADMIN_SCOPE_DENIED");
    assert.ok(scopeEvent, `${name} scope denial did not record a security event`);
    assert.ok(!JSON.stringify(scopeEvent).includes(wrongToken), "security event exposed a service token");
    assert.strictEqual(backupFiles(harness.paths, domain.backupPrefix).length, beforeBackups, `${name} rejected request created a backup`);
    assert.strictEqual(auditCount(harness.paths), beforeAudit, `${name} rejected request created audit`);

    await assertStatus(harness, domain, {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session), body: domain.valid("missing-if-match"),
    }, 428, `${name} missing If-Match`);
    assert.strictEqual(backupFiles(harness.paths, domain.backupPrefix).length, beforeBackups, `${name} 428 created a backup`);
    assert.strictEqual(auditCount(harness.paths), beforeAudit, `${name} 428 created audit`);

    await assertStatus(harness, domain, {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, initialVersion), body: domain.invalid(),
    }, 400, `${name} invalid body`);
    assert.strictEqual(backupFiles(harness.paths, domain.backupPrefix).length, beforeBackups, `${name} 400 created a backup`);
    assert.strictEqual(auditCount(harness.paths), beforeAudit, `${name} 400 created audit`);

    const first = await assertStatus(harness, domain, {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, initialVersion), body: domain.valid("first"),
    }, 200, `${name} valid mutation`);
    assert.ok(first.json && first.json.version, `${name} success did not return version`);
    const backups = backupFiles(harness.paths, domain.backupPrefix);
    assert.strictEqual(backups.length, beforeBackups + 1, `${name} success must create exactly one backup`);
    assert.strictEqual(auditCount(harness.paths), beforeAudit + 1, `${name} success must append exactly one audit record`);

    const preflight = await harness.request("/api/admin/backups/preflight", {
      method: "POST", cookie: session.cookie, headers: { Origin: "http://admin.test", "X-Fosu-CSRF": session.csrfToken }, body: { filename: backups[backups.length - 1] },
    });
    assert.strictEqual(preflight.status, 200, `${name} backup preflight: ${preflight.text}`);
    assert.strictEqual(preflight.json && preflight.json.preflight && preflight.json.preflight.ok, true, `${name} backup is not recoverable`);

    const stale = await assertStatus(harness, domain, {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, initialVersion), body: domain.valid("stale"),
    }, 409, `${name} stale If-Match`);
    assert.ok(stale.json && stale.json.currentVersion, `${name} stale response lacks current version`);
    assert.strictEqual(backupFiles(harness.paths, domain.backupPrefix).length, beforeBackups + 1, `${name} 409 created a backup`);
    assert.strictEqual(auditCount(harness.paths), beforeAudit + 1, `${name} 409 created audit`);

    const concurrentVersion = await getVersion(harness, domain, session);
    const beforeConcurrentBackups = backupFiles(harness.paths, domain.backupPrefix).length;
    const beforeConcurrentAudit = auditCount(harness.paths);
    const [left, right] = await Promise.all(["left", "right"].map((suffix) => harness.request(domain.writePath, {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, concurrentVersion), body: domain.valid(`concurrent-${suffix}`),
    })));
    assert.deepStrictEqual([left.status, right.status].sort(), [200, 409], `${name} same-version writes must yield one 200 and one 409`);
    assert.strictEqual(backupFiles(harness.paths, domain.backupPrefix).length, beforeConcurrentBackups + 1, `${name} concurrent conflict created an extra backup`);
    assert.strictEqual(auditCount(harness.paths), beforeConcurrentAudit + 1, `${name} concurrent conflict created an extra audit`);
  } finally {
    await harness.close();
  }
}

async function assertModuleGuards() {
  const disabled = await startAdminHttpHarness({ enabledModules: "" });
  try {
    const session = await disabled.login();
    const response = await disabled.request(DOMAINS.settings.writePath, {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, "ignored"), body: DOMAINS.settings.valid("disabled"),
    });
    assert.strictEqual(response.status, 403, response.text);
    assert.strictEqual(response.json && response.json.code, "MODULE_WRITE_DISABLED");
  } finally { await disabled.close(); }

  const enabled = await startAdminHttpHarness();
  try {
    const session = await enabled.login();
    const response = await enabled.request("/api/admin/unknown-c1-mutation", {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, "ignored"), body: {},
    });
    assert.strictEqual(response.status, 403, response.text);
    assert.strictEqual(response.json && response.json.code, "MODULE_WRITE_DISABLED");
  } finally { await enabled.close(); }
}

async function main() {
  await assertModuleGuards();
  for (const [name, domain] of Object.entries(DOMAINS)) await exerciseDomain(name, domain);
  console.log("Admin C1 real HTTP write contracts passed.");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
