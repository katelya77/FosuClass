const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { startAdminHttpHarness } = require("./test-helpers/admin-http-harness");

const HARNESS_ENV_KEYS = [
  "NODE_ENV", "PORT", "FOSU_STORAGE_DIR", "FOSU_DATA_DIR", "ADMIN_PASSWORD", "ADMIN_API_TOKEN",
  "FOSU_ADMIN_NEXT_ENABLED", "FOSU_ADMIN_PRIMARY", "FOSU_ADMIN_NEXT_WRITE_MODULES",
  "FOSU_RELEASE_WORKER_ENABLED", "FOSU_CONFIG_HARD_FAIL", "FOSU_ALLOWED_ADMIN_ORIGINS",
  "FOSU_ALLOWED_PUBLIC_ORIGINS", "ADMIN_SERVICE_TOKENS", "FOSU_QUALITY_IGNORE_LOCK_WAIT_MS",
];

function snapshotHarnessEnv() {
  return Object.fromEntries(HARNESS_ENV_KEYS.map((key) => [key, process.env[key]]));
}

function serverCacheKeys() {
  return Object.keys(require.cache)
    .filter((key) => key.replace(/\\/g, "/").includes("/server/src/"))
    .sort();
}

function harnessTempRoots() {
  return fs.readdirSync(os.tmpdir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("fosu-admin-c1-http-"))
    .map((entry) => entry.name)
    .sort();
}

const DOMAINS = {
  settings: {
    readPath: "/api/admin/settings",
    writePath: "/api/admin/settings",
    scope: "settings:write",
    backupPrefix: "config-",
    valid: (suffix) => ({ appName: `C1 settings ${suffix}` }),
    invalid: () => ({ publishStatus: "not-a-status" }),
    servicePath: "../server/src/modules/settings/service",
    commitMethod: "commitPreparedTypedSettingsMutation",
    storageFile: "admin-config.json",
  },
  catalog: {
    readPath: "/api/admin/catalog/meta",
    writePath: "/api/admin/catalog/meta",
    scope: "catalog:write",
    backupPrefix: "catalog-meta-",
    valid: (suffix) => ({ type: "class", id: `C1-${suffix}`, displayName: `C1 class ${suffix}`, note: "", hidden: false, tags: [] }),
    invalid: () => ({ type: "class" }),
    servicePath: "../server/src/modules/catalog/service",
    commitMethod: "commitPreparedCatalogMetaEntryMutation",
    storageFile: "catalog-meta.json",
  },
  quality: {
    readPath: "/api/admin/quality/ignores",
    writePath: "/api/admin/quality/mark",
    scope: "quality:write",
    backupPrefix: "quality-",
    valid: (suffix) => ({ type: "missingTeacher", target: `C1-${suffix}`, ignore: true, reason: "fixture", severity: "info" }),
    invalid: () => ({ type: "missingTeacher" }),
    servicePath: "../server/src/modules/quality/service",
    commitMethod: "commitPreparedQualityMutation",
    storageFile: "quality-ignores.json",
  },
};

async function assertHarnessFailureCleanup(label, options, expectedMessage) {
  const express = require("../server/node_modules/express");
  const beforeExpressListen = express.application.listen;
  const beforeEnv = snapshotHarnessEnv();
  const beforeCache = serverCacheKeys();
  const beforeRoots = harnessTempRoots();
  let unexpectedHarness = null;
  let failure = null;
  try {
    unexpectedHarness = await startAdminHttpHarness(options);
  } catch (error) {
    failure = error;
  }
  if (unexpectedHarness) await unexpectedHarness.close();
  assert.ok(failure, `${label} did not fail`);
  assert.match(failure.message, expectedMessage, `${label} returned the wrong error`);
  assert.ok(options.captured.paths, `${label} did not expose its temporary paths to the injected failure`);
  assert.strictEqual(fs.existsSync(options.captured.paths.root), false, `${label} leaked its temporary root`);
  assert.deepStrictEqual(snapshotHarnessEnv(), beforeEnv, `${label} leaked environment overrides`);
  assert.deepStrictEqual(serverCacheKeys(), beforeCache, `${label} leaked server/src module cache`);
  assert.deepStrictEqual(harnessTempRoots(), beforeRoots, `${label} leaked a prefixed temporary root`);
  assert.strictEqual(express.application.listen, beforeExpressListen, `${label} leaked its Express listen instrumentation`);
}

async function assertHarnessStartupFailureCleanup() {
  const importFailure = { captured: {} };
  importFailure.onPaths = (paths) => { importFailure.captured.paths = paths; };
  importFailure.importApp = () => {
    require("../server/src/config");
    throw new Error("INJECTED_ADMIN_IMPORT_FAILURE");
  };
  await assertHarnessFailureCleanup("import failure", importFailure, /INJECTED_ADMIN_IMPORT_FAILURE/);

  const listenFailure = { captured: {} };
  listenFailure.onPaths = (paths) => { listenFailure.captured.paths = paths; };
  listenFailure.listenServer = async (server) => {
    listenFailure.captured.server = server;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    throw new Error("INJECTED_ADMIN_LISTEN_FAILURE");
  };
  await assertHarnessFailureCleanup("listen failure", listenFailure, /INJECTED_ADMIN_LISTEN_FAILURE/);
  assert.strictEqual(listenFailure.captured.server.listening, false, "listen failure leaked a partial listener");
}

function backupFiles(paths, prefix) {
  const directory = path.join(paths.data, "backups");
  return fs.readdirSync(directory).filter((name) => name.startsWith(prefix) && name.endsWith(".json"));
}

function auditCount(paths) {
  const file = path.join(paths.data, "admin-audit-log.jsonl");
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).length;
}

function writeExternalVersion(name, domain, paths) {
  const file = path.join(paths.storage, domain.storageFile);
  const document = JSON.parse(fs.readFileSync(file, "utf8"));
  const externalVersion = `external_${name}_${Date.now()}`;
  if (name === "settings") {
    document.appName = externalVersion;
    document.updatedAt = new Date().toISOString();
  } else if (name === "catalog") {
    document.__meta = { ...(document.__meta || {}), version: externalVersion, updatedAt: new Date().toISOString() };
    document.entries = document.entries || {};
  } else {
    document.version = externalVersion;
    document.updatedAt = new Date().toISOString();
    document.rules = Array.isArray(document.rules) ? document.rules : [];
  }
  fs.writeFileSync(file, JSON.stringify(document, null, 2), "utf8");
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

    const service = require(domain.servicePath);
    const originalCommit = service[domain.commitMethod];
    service[domain.commitMethod] = (prepared) => {
      writeExternalVersion(name, domain, harness.paths);
      return originalCommit(prepared);
    };
    let commitConflict;
    try {
      commitConflict = await harness.request(domain.writePath, {
        method: "POST", cookie: session.cookie, headers: browserHeaders(session, initialVersion), body: domain.valid("commit-conflict"),
      });
    } finally {
      service[domain.commitMethod] = originalCommit;
    }
    assert.strictEqual(commitConflict.status, 409, `${name} forced commit conflict: ${commitConflict.text}`);
    assert.strictEqual(commitConflict.json && commitConflict.json.code, "CONFLICT", `${name} forced conflict code`);
    assert.strictEqual(backupFiles(harness.paths, domain.backupPrefix).length, beforeBackups, `${name} commit-time 409 left a backup`);
    assert.strictEqual(auditCount(harness.paths), beforeAudit, `${name} commit-time 409 created audit`);

    const validVersion = await getVersion(harness, domain, session);
    const beforeRecoveryBackups = backupFiles(harness.paths, domain.backupPrefix).length;
    const beforeRecoveryAudit = auditCount(harness.paths);
    service[domain.commitMethod] = () => {
      const error = new Error("INJECTED_NON_CONFLICT_COMMIT_FAILURE");
      error.code = "INJECTED_COMMIT_FAILURE";
      error.statusCode = 500;
      throw error;
    };
    let commitFailure;
    try {
      commitFailure = await harness.request(domain.writePath, {
        method: "POST", cookie: session.cookie, headers: browserHeaders(session, validVersion), body: domain.valid("recovery-backup"),
      });
    } finally {
      service[domain.commitMethod] = originalCommit;
    }
    assert.strictEqual(commitFailure.status, 500, `${name} forced non-conflict failure: ${commitFailure.text}`);
    assert.strictEqual(backupFiles(harness.paths, domain.backupPrefix).length, beforeRecoveryBackups + 1, `${name} non-conflict failure lost its recovery backup`);
    assert.strictEqual(auditCount(harness.paths), beforeRecoveryAudit, `${name} non-conflict failure created audit`);

    const beforeSuccessFiles = new Set(backupFiles(harness.paths, domain.backupPrefix));
    const beforeSuccessAudit = auditCount(harness.paths);

    const first = await assertStatus(harness, domain, {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, validVersion), body: domain.valid("first"),
    }, 200, `${name} valid mutation`);
    assert.ok(first.json && first.json.version, `${name} success did not return version`);
    const backups = backupFiles(harness.paths, domain.backupPrefix);
    assert.strictEqual(backups.length, beforeSuccessFiles.size + 1, `${name} success must create exactly one backup`);
    assert.strictEqual(auditCount(harness.paths), beforeSuccessAudit + 1, `${name} success must append exactly one audit record`);
    const successBackup = backups.find((filename) => !beforeSuccessFiles.has(filename));
    assert.ok(successBackup, `${name} success backup could not be identified`);

    const preflight = await harness.request("/api/admin/backups/preflight", {
      method: "POST", cookie: session.cookie, headers: { Origin: "http://admin.test", "X-Fosu-CSRF": session.csrfToken }, body: { filename: successBackup },
    });
    assert.strictEqual(preflight.status, 200, `${name} backup preflight: ${preflight.text}`);
    assert.strictEqual(preflight.json && preflight.json.preflight && preflight.json.preflight.ok, true, `${name} backup is not recoverable`);

    const stale = await assertStatus(harness, domain, {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, validVersion), body: domain.valid("stale"),
    }, 409, `${name} stale If-Match`);
    assert.ok(stale.json && stale.json.currentVersion, `${name} stale response lacks current version`);
    assert.strictEqual(backupFiles(harness.paths, domain.backupPrefix).length, beforeSuccessFiles.size + 1, `${name} 409 created a backup`);
    assert.strictEqual(auditCount(harness.paths), beforeSuccessAudit + 1, `${name} 409 created audit`);

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
  } finally {
    await disabled.close();
    await disabled.close();
  }

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

async function assertQualityRecheckContract() {
  const harness = await startAdminHttpHarness();
  try {
    const session = await harness.login();
    const qualityService = require("../server/src/modules/quality/service");
    const originalStart = qualityService.startQualityRecheck;
    let releaseReport;
    const reportDeferred = new Promise((resolve) => { releaseReport = resolve; });
    qualityService.startQualityRecheck = (input) => originalStart(input, {
      buildReport: async () => {
        await reportDeferred;
        return qualityService.buildQualityReport();
      },
    });
    const beforeAudit = auditCount(harness.paths);
    try {
      const started = await harness.request("/api/admin/quality/recheck/start", {
        method: "POST", cookie: session.cookie, headers: browserHeaders(session), body: {},
      });
      assert.strictEqual(started.status, 202, started.text);
      assert.ok(started.json && started.json.job && started.json.job.id);
      assert.strictEqual(started.json.job.type, "quality-recheck");
      assert.strictEqual(auditCount(harness.paths), beforeAudit + 1, "successful recheck creation must audit once");

      const second = await harness.request("/api/admin/quality/recheck/start", {
        method: "POST", cookie: session.cookie, headers: browserHeaders(session), body: {},
      });
      assert.strictEqual(second.status, 409, second.text);
      assert.strictEqual(second.json && second.json.code, "JOB_ALREADY_RUNNING");
      assert.strictEqual(auditCount(harness.paths), beforeAudit + 1, "singleton rejection must not audit");
      releaseReport();

      let current = started.json.job;
      for (let attempt = 0; attempt < 60 && ["queued", "running"].includes(current.status); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const status = await harness.request(`/api/admin/quality/recheck/${current.id}`, { cookie: session.cookie });
        assert.strictEqual(status.status, 200, status.text);
        current = status.json && status.json.job;
      }
      assert.strictEqual(current.status, "success");
      assert.ok(current.result && Number.isInteger(current.result.totalCount));
      assert.strictEqual(auditCount(harness.paths), beforeAudit + 1, "polling must not audit");

      const nonQuality = path.join(harness.paths.storage, "jobs", "other-job.json");
      fs.mkdirSync(path.dirname(nonQuality), { recursive: true });
      fs.writeFileSync(nonQuality, JSON.stringify({ id: "other-job", type: "catalog-rebuild", status: "success", logs: [] }));
      const hidden = await harness.request("/api/admin/quality/recheck/other-job", { cookie: session.cookie });
      assert.strictEqual(hidden.status, 404, hidden.text);
    } finally {
      releaseReport();
      qualityService.startQualityRecheck = originalStart;
    }
  } finally {
    await harness.close();
  }
}

async function assertQualityRecheckFailureContract() {
  const harness = await startAdminHttpHarness();
  try {
    const session = await harness.login();
    const qualityService = require("../server/src/modules/quality/service");
    const originalStart = qualityService.startQualityRecheck;
    qualityService.startQualityRecheck = (input) => originalStart(input, {
      buildReport: () => {
        const error = new Error("injected quality recheck failure");
        error.code = "QUALITY_RECHECK_INJECTED_FAILURE";
        throw error;
      },
    });
    try {
      const started = await harness.request("/api/admin/quality/recheck/start", {
        method: "POST", cookie: session.cookie, headers: browserHeaders(session), body: {},
      });
      assert.strictEqual(started.status, 202, started.text);
      let current = started.json.job;
      for (let attempt = 0; attempt < 60 && ["queued", "running"].includes(current.status); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const status = await harness.request(`/api/admin/quality/recheck/${current.id}`, { cookie: session.cookie });
        assert.strictEqual(status.status, 200, status.text);
        current = status.json.job;
      }
      assert.strictEqual(current.status, "failed");
      assert.strictEqual(current.error && current.error.code, "QUALITY_RECHECK_INJECTED_FAILURE");
    } finally {
      qualityService.startQualityRecheck = originalStart;
    }
  } finally {
    await harness.close();
  }
}

async function assertMalformedQualityIgnoreContract() {
  const harness = await startAdminHttpHarness();
  try {
    const session = await harness.login();
    const ignorePath = path.join(harness.paths.storage, "quality-ignores.json");
    const malformed = '{"rules":';
    fs.writeFileSync(ignorePath, malformed, "utf8");
    const beforeBackups = backupFiles(harness.paths, "quality-").length;
    const beforeAudit = auditCount(harness.paths);
    const response = await harness.request("/api/admin/quality/mark", {
      method: "POST",
      cookie: session.cookie,
      headers: browserHeaders(session, "ignored"),
      body: DOMAINS.quality.valid("malformed"),
    });
    assert.strictEqual(response.status, 500, response.text);
    assert.strictEqual(response.json && response.json.code, "QUALITY_IGNORES_MALFORMED");
    assert.strictEqual(fs.readFileSync(ignorePath, "utf8"), malformed, "malformed ignore file must remain byte-identical");
    assert.strictEqual(backupFiles(harness.paths, "quality-").length, beforeBackups, "malformed request must not create backup");
    assert.strictEqual(auditCount(harness.paths), beforeAudit, "malformed request must not audit");
  } finally {
    await harness.close();
  }
}

async function assertQualityLockTimeoutContract() {
  const harness = await startAdminHttpHarness({ environment: { FOSU_QUALITY_IGNORE_LOCK_WAIT_MS: "30" } });
  try {
    const session = await harness.login();
    const version = await getVersion(harness, DOMAINS.quality, session);
    const lockPath = path.join(harness.paths.storage, "quality-ignores.json.lock");
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token: "held-by-test", createdAt: new Date().toISOString() }), "utf8");
    const beforeBackups = backupFiles(harness.paths, "quality-").length;
    const beforeAudit = auditCount(harness.paths);
    const held = await harness.request("/api/admin/quality/mark", {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, version), body: DOMAINS.quality.valid("held-lock"),
    });
    assert.strictEqual(held.status, 503, held.text);
    assert.strictEqual(held.json && held.json.code, "QUALITY_IGNORES_LOCK_TIMEOUT");
    assert.strictEqual(auditCount(harness.paths), beforeAudit, "lock timeout must not audit");
    assert.strictEqual(backupFiles(harness.paths, "quality-").length, beforeBackups + 1, "lock timeout must retain recovery backup");
    fs.unlinkSync(lockPath);
    const recovered = await harness.request("/api/admin/quality/mark", {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, version), body: DOMAINS.quality.valid("after-lock"),
    });
    assert.strictEqual(recovered.status, 200, recovered.text);
  } finally {
    await harness.close();
  }
}

async function assertCommittedQualityReleaseFailureContract() {
  const harness = await startAdminHttpHarness();
  try {
    const session = await harness.login();
    const version = await getVersion(harness, DOMAINS.quality, session);
    const lockPath = path.join(harness.paths.storage, "quality-ignores.json.lock");
    const beforeBackups = backupFiles(harness.paths, "quality-").length;
    const beforeAudit = auditCount(harness.paths);
    const originalRead = fs.readFileSync;
    let injectedReads = 0;
    fs.readFileSync = (target, ...args) => {
      if (path.resolve(target) === path.resolve(lockPath) && injectedReads < 2) {
        injectedReads += 1;
        const error = new Error("injected post-commit lock read failure");
        error.code = "EIO";
        throw error;
      }
      return originalRead(target, ...args);
    };
    let committed;
    try {
      committed = await harness.request("/api/admin/quality/mark", {
        method: "POST", cookie: session.cookie, headers: browserHeaders(session, version), body: DOMAINS.quality.valid("release-warning"),
      });
    } finally {
      fs.readFileSync = originalRead;
    }
    assert.strictEqual(committed.status, 200, committed.text);
    assert.strictEqual(committed.json && committed.json.lockWarning && committed.json.lockWarning.code, "QUALITY_IGNORES_LOCK_RELEASE_FAILED");
    assert.strictEqual(auditCount(harness.paths), beforeAudit + 1, "committed mutation with release warning must audit exactly once");
    assert.strictEqual(backupFiles(harness.paths, "quality-").length, beforeBackups + 1, "committed mutation must retain exactly one backup");
    const retry = await harness.request("/api/admin/quality/mark", {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, version), body: DOMAINS.quality.valid("release-warning-retry"),
    });
    assert.strictEqual(retry.status, 409, retry.text);
    assert.strictEqual(auditCount(harness.paths), beforeAudit + 1, "stale retry must not duplicate audit");
  } finally {
    await harness.close();
  }
}

async function main() {
  await assertHarnessStartupFailureCleanup();
  await assertModuleGuards();
  for (const [name, domain] of Object.entries(DOMAINS)) await exerciseDomain(name, domain);
  await assertQualityRecheckContract();
  await assertQualityRecheckFailureContract();
  await assertMalformedQualityIgnoreContract();
  await assertQualityLockTimeoutContract();
  await assertCommittedQualityReleaseFailureContract();
  console.log("Admin C1 real HTTP write contracts passed.");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
