const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { startAdminHttpHarness } = require("./test-helpers/admin-http-harness");

const HARNESS_ENV_KEYS = [
  "NODE_ENV", "PORT", "FOSU_STORAGE_DIR", "FOSU_DATA_DIR", "ADMIN_PASSWORD", "ADMIN_API_TOKEN",
  "FOSU_ADMIN_NEXT_WRITE_MODULES",
  "FOSU_RELEASE_WORKER_ENABLED", "FOSU_CONFIG_HARD_FAIL", "FOSU_ALLOWED_ADMIN_ORIGINS",
  "FOSU_ALLOWED_PUBLIC_ORIGINS", "ADMIN_SERVICE_TOKENS", "FOSU_QUALITY_IGNORE_LOCK_WAIT_MS",
  "FOSU_CATALOG_LOCK_WAIT_MS", "FOSU_CATALOG_PREVIEW_TTL_MS", "FOSU_ADMIN_AUDIT_LOCK_WAIT_MS", "OPENRESTY_STATIC_RUNTIME_DIR",
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

function auditEntries(paths) {
  const file = path.join(paths.data, "admin-audit-log.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function recursiveSnapshot(root) {
  const out = {};
  if (!fs.existsSync(root)) return out;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else {
        const stat = fs.lstatSync(target);
        out[path.relative(root, target).replace(/\\/g, "/")] = { bytes: fs.readFileSync(target).toString("base64"), mtimeMs: stat.mtimeMs };
      }
    }
  };
  visit(root);
  return out;
}

function seedCatalogHttpFixture(paths) {
  const { calculateFingerprint } = require("../server/src/utils/stagingFingerprint");
  const catalog = {
    semesters: ["2025-2026-2"],
    colleges: [{ code: "04", name: "Engineering, \"North\"" }],
    grades: ["2025"],
  };
  const nestedMajors = {
    semester: "2025-2026-2",
    colleges: [{ collegeCode: "04", collegeName: "Engineering, \"North\"", grades: [{ grade: "2025", majors: [{ majorCode: "0401", majorName: "Software" }] }] }],
  };
  const course = { courseName: "Catalog Course", teacherName: "Teacher One", className: "Class One", classroom: "A101", weekday: 1, startSection: 1, endSection: 1, weeks: [1], sections: [1] };
  const classSchedules = [{ className: "Class One", semester: "2025-2026-2", collegeCode: "04", collegeName: "Engineering, \"North\"", grade: "2025", majorCode: "0401", majorName: "Software", courses: [course] }];
  const teacherSchedules = [{ teacherName: "Teacher One", semester: "2025-2026-2", collegeName: "Engineering, \"North\"", courses: [course] }];
  const classroomSchedules = [{ roomName: "A101", semester: "2025-2026-2", courses: [course] }];
  const courseSchedules = [{ courseName: "Catalog Course", semester: "2025-2026-2", collegeName: "Engineering, \"North\"", courses: [course] }];
  const legacy = { "catalog.json": catalog, "majors-index.json": nestedMajors, "class-schedules.json": classSchedules, "teacher-schedules.json": teacherSchedules, "classroom-schedules.json": classroomSchedules, "course-schedules.json": courseSchedules };
  for (const [name, value] of Object.entries(legacy)) fs.writeFileSync(path.join(paths.storage, name), JSON.stringify(value, null, 2));
  const version = "c1-http-active";
  const snapshot = {
    schemaVersion: 1,
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    termStartDate: "2026-03-09",
    totalWeeks: 20,
    weekStart: "monday",
    updatedAt: "2026-07-19T00:00:00.000Z",
    catalog,
    majors: [{ collegeCode: "04", collegeName: "Engineering, \"North\"", code: "0401", name: "Software", grade: "2025" }],
    classSchedules,
    resources: { teachers: [{ teacherName: "Teacher One" }], classrooms: [{ roomName: "A101" }], courses: [{ courseName: "Catalog Course" }], teacherSchedules, classroomSchedules, courseSchedules },
  };
  const canonicalHash = calculateFingerprint(snapshot).canonicalHash;
  const releaseRoot = path.join(paths.storage, "releases");
  const releaseDir = path.join(releaseRoot, version);
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(releaseDir, "snapshot.json"), JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(path.join(releaseDir, "manifest.json"), JSON.stringify({ success: true, schemaVersion: 2, releaseVersion: version, version, term: snapshot.term, semester: snapshot.semester, canonicalHash, packHealth: { valid: true, errors: [] } }, null, 2));
  fs.writeFileSync(path.join(releaseRoot, "active.json"), JSON.stringify({ version, releaseVersion: version, term: snapshot.term, semester: snapshot.semester, canonicalHash, packStatus: { healthy: true, manifestExists: true, manifestValid: true, hashValid: true, missing: [], hashErrors: [] } }, null, 2));
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

async function assertCatalogOperationsHttpContract() {
  const harness = await startAdminHttpHarness({ environment: { FOSU_ADMIN_AUDIT_LOCK_WAIT_MS: "60" } });
  try {
    seedCatalogHttpFixture(harness.paths);
    const session = await harness.login();
    const stagingRoot = path.join(harness.paths.data, "admin-catalog-staging");
    assert.strictEqual(fs.existsSync(stagingRoot), false);
    const anonymousRead = await harness.request("/api/admin/catalog/resources?type=class&page=1&pageSize=1");
    assert.strictEqual(anonymousRead.status, 401, anonymousRead.text);
    assert.strictEqual(fs.existsSync(stagingRoot), false, "anonymous Catalog GET must not bootstrap staging");
    for (const invalidPath of [
      "/api/admin/catalog/resources?type=unknown&page=1&pageSize=1",
      "/api/admin/catalog/resources?type=class&page=0&pageSize=1",
      "/api/admin/catalog/resources?type=class&page=1&pageSize=101",
      "/api/admin/catalog/export?type=unknown&format=json",
      "/api/admin/catalog/export?type=class&format=xml",
    ]) {
      const invalidRead = await harness.request(invalidPath, { cookie: session.cookie });
      assert.strictEqual(invalidRead.status, 400, invalidRead.text);
      assert.strictEqual(fs.existsSync(stagingRoot), false, `${invalidPath} must fail before bootstrap`);
      assert.strictEqual(fs.existsSync(path.join(harness.paths.data, "catalog-control", ".integrity-key")), false, `${invalidPath} must not create private import state`);
    }
    const guardDocument = { type: "teacher", semester: "2025-2026-2", items: [{ teacherName: "Teacher Two", collegeName: "Engineering, \"North\"", courses: [] }] };
    const guardBackups = backupFiles(harness.paths, "catalog-import-").length;
    const guardAudit = auditCount(harness.paths);
    const missingCsrf = await harness.request("/api/admin/catalog/import/preview", {
      method: "POST", cookie: session.cookie, headers: { Origin: "http://admin.test", "X-Fosu-Admin-Client": "next" }, body: guardDocument,
    });
    assert.strictEqual(missingCsrf.status, 403, missingCsrf.text);
    const rejectedOrigin = await harness.request("/api/admin/catalog/import/preview", {
      method: "POST", cookie: session.cookie, headers: { Origin: "http://public.test", "X-Fosu-Admin-Client": "next", "X-Fosu-CSRF": session.csrfToken }, body: guardDocument,
    });
    assert.strictEqual(rejectedOrigin.status, 403, rejectedOrigin.text);
    assert.strictEqual(fs.existsSync(stagingRoot), false, "rejected import guards must run before staging bootstrap");
    assert.strictEqual(fs.existsSync(path.join(harness.paths.data, "catalog-control")), false, "rejected import guards must not create preview or HMAC state");
    assert.strictEqual(backupFiles(harness.paths, "catalog-import-").length, guardBackups);
    assert.strictEqual(auditCount(harness.paths), guardAudit);
    const read = await harness.request("/api/admin/catalog/resources?type=class&page=1&pageSize=1", { cookie: session.cookie });
    assert.strictEqual(read.status, 200, read.text);
    assert.strictEqual(read.json.items[0].id, "class:2025-2026-2:04:2025:0401:Class One");
    assert.strictEqual(read.json.totalPages, 1);
    assert.strictEqual(read.json.source.label, "Catalog 工作区（未发布）");
    assert.ok(fs.existsSync(stagingRoot));
    assert.strictEqual(fs.existsSync(path.join(harness.paths.storage, "admin-catalog-staging")), false, "mutable staging must live under FOSU_DATA_DIR");
    const badPage = await harness.request("/api/admin/catalog/resources?type=class&pageSize=101", { cookie: session.cookie });
    assert.strictEqual(badPage.status, 400, badPage.text);
    assert.strictEqual(badPage.json && badPage.json.code, "INVALID_PAGINATION");
    const relationships = await harness.request("/api/admin/catalog/relationships", { cookie: session.cookie });
    assert.strictEqual(relationships.status, 200, relationships.text);
    assert.strictEqual(relationships.json.colleges[0].grades[0].majors[0].id, "0401");

    const jsonExport = await harness.request("/api/admin/catalog/export?type=class&format=json", { cookie: session.cookie });
    const csvExport = await harness.request("/api/admin/catalog/export?type=class&format=csv", { cookie: session.cookie });
    assert.strictEqual(jsonExport.status, 200, jsonExport.text);
    assert.ok(Array.isArray(jsonExport.json));
    assert.match(String(jsonExport.headers["content-type"]), /^application\/json/);
    assert.match(String(jsonExport.headers["content-disposition"]), /attachment/);
    assert.strictEqual(csvExport.status, 200, csvExport.text);
    assert.match(String(csvExport.headers["content-type"]), /^text\/csv/);
    assert.match(csvExport.text, /"Engineering, ""North"""/);
    assert.strictEqual(csvExport.text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).length, jsonExport.json.length + 1);
    const repeatSnapshot = recursiveSnapshot(stagingRoot);
    for (let index = 0; index < 10; index += 1) {
      const repeated = await harness.request(index % 2 ? "/api/admin/catalog/relationships" : "/api/admin/catalog/resources?type=class&page=1&pageSize=1", { cookie: session.cookie });
      assert.strictEqual(repeated.status, 200, repeated.text);
    }
    assert.deepStrictEqual(recursiveSnapshot(stagingRoot), repeatSnapshot, "repeated HTTP reads must preserve staging bytes and mtimes");

    const document = guardDocument;
    const anonymous = await harness.request("/api/admin/catalog/import/preview", { method: "POST", headers: { "X-Fosu-Admin-Client": "next" }, body: document });
    assert.strictEqual(anonymous.status, 401, anonymous.text);
    const wrongScope = await harness.request("/api/admin/catalog/import/preview", {
      method: "POST", headers: { "X-Admin-Token": "c1-settings-token", "X-Fosu-Client": "service", "X-Fosu-Admin-Client": "next" }, body: document,
    });
    assert.strictEqual(wrongScope.status, 403, wrongScope.text);
    const beforePreviewBackups = backupFiles(harness.paths, "catalog-import-").length;
    const beforePreviewAudit = auditCount(harness.paths);
    const preview = await harness.request("/api/admin/catalog/import/preview", {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session), body: document,
    });
    assert.strictEqual(preview.status, 200, preview.text);
    assert.strictEqual(preview.json.summary.deleted, 0);
    assert.strictEqual(backupFiles(harness.paths, "catalog-import-").length, beforePreviewBackups, "preview must not create backup");
    assert.strictEqual(auditCount(harness.paths), beforePreviewAudit, "preview must not audit");

    const missingIfMatch = await harness.request("/api/admin/catalog/import/apply", {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session), body: { previewId: preview.json.previewId, confirm: true },
    });
    assert.strictEqual(missingIfMatch.status, 428, missingIfMatch.text);
    const missingConfirm = await harness.request("/api/admin/catalog/import/apply", {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, preview.json.baseVersion), body: { previewId: preview.json.previewId },
    });
    assert.strictEqual(missingConfirm.status, 400, missingConfirm.text);
    const stale = await harness.request("/api/admin/catalog/import/apply", {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, "stale"), body: { previewId: preview.json.previewId, confirm: true },
    });
    assert.strictEqual(stale.status, 409, stale.text);
    assert.strictEqual(backupFiles(harness.paths, "catalog-import-").length, beforePreviewBackups);
    assert.strictEqual(auditCount(harness.paths), beforePreviewAudit);

    const invalid = await harness.request("/api/admin/catalog/import/preview", {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session), body: { ...document, replace: true },
    });
    assert.strictEqual(invalid.status, 400, invalid.text);
    assert.strictEqual(invalid.json && invalid.json.code, "DELETE_NOT_ALLOWED");

    const concurrentPreview = await harness.request("/api/admin/catalog/import/preview", {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session), body: document,
    });
    assert.strictEqual(concurrentPreview.status, 200, concurrentPreview.text);
    const beforeApplyBackups = backupFiles(harness.paths, "catalog-import-").length;
    const beforeApplyAudit = auditCount(harness.paths);
    const applyOptions = {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, concurrentPreview.json.baseVersion), body: { previewId: concurrentPreview.json.previewId, confirm: true },
    };
    const [left, right] = await Promise.all([
      harness.request("/api/admin/catalog/import/apply", applyOptions),
      harness.request("/api/admin/catalog/import/apply", applyOptions),
    ]);
    assert.deepStrictEqual([left.status, right.status].sort(), [200, 409], `${left.text}\n${right.text}`);
    assert.strictEqual(backupFiles(harness.paths, "catalog-import-").length, beforeApplyBackups + 1, "one winning apply must create one backup");
    assert.strictEqual(auditCount(harness.paths), beforeApplyAudit + 1, "one winning apply must create one audit");
    const winner = left.status === 200 ? left : right;
    assert.strictEqual(winner.json.summary.deleted, 0);
    assert.ok(winner.json.backup && winner.json.backup.sha256);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(winner.json.backup, "path"), false, "HTTP backup evidence must not expose absolute paths");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(winner.json.backup, "manifestPath"), false, "HTTP backup evidence must not expose manifest paths");
    const winnerBackupPath = path.join(harness.paths.data, "backups", `${winner.json.backup.id}.json`);
    const winnerManifestPath = path.join(harness.paths.data, "backups", `${winner.json.backup.id}.manifest`);
    assert.strictEqual(require("crypto").createHash("sha256").update(fs.readFileSync(winnerBackupPath)).digest("hex"), winner.json.backup.sha256);
    assert.ok(fs.existsSync(winnerManifestPath));
    const lastAudit = auditEntries(harness.paths).at(-1);
    assert.strictEqual(lastAudit.action, "catalog-import-apply");
    assert.strictEqual(lastAudit.module, "catalog");
    assert.ok(!JSON.stringify(lastAudit).includes("Teacher Two"), "catalog audit must not contain imported rows");

    const replay = await harness.request("/api/admin/catalog/import/apply", applyOptions);
    assert.strictEqual(replay.status, 409, replay.text);
    assert.strictEqual(replay.json && replay.json.code, "PREVIEW_REPLAYED");
    assert.strictEqual(backupFiles(harness.paths, "catalog-import-").length, beforeApplyBackups + 1);
    assert.strictEqual(auditCount(harness.paths), beforeApplyAudit + 1);

    const pendingDocument = { type: "teacher", semester: "2025-2026-2", items: [{ teacherName: "Audit Pending", collegeName: "Engineering, \"North\"", courses: [] }] };
    const pendingPreview = await harness.request("/api/admin/catalog/import/preview", {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session), body: pendingDocument,
    });
    assert.strictEqual(pendingPreview.status, 200, pendingPreview.text);
    const auditLockPath = path.join(harness.paths.data, "admin-audit-log.jsonl.lock");
    fs.writeFileSync(auditLockPath, JSON.stringify({ pid: process.pid, token: "held-audit", instanceId: "external-live-owner", createdAt: new Date().toISOString() }), "utf8");
    const auditBeforePending = auditCount(harness.paths);
    let pendingApply;
    try {
      pendingApply = await harness.request("/api/admin/catalog/import/apply", {
        method: "POST", cookie: session.cookie, headers: browserHeaders(session, pendingPreview.json.baseVersion), body: { previewId: pendingPreview.json.previewId, confirm: true },
      });
      assert.strictEqual(pendingApply.status, 200, pendingApply.text);
      assert.strictEqual(pendingApply.json.success, true);
      assert.strictEqual(pendingApply.json.committed, true);
      assert.strictEqual(pendingApply.json.auditPending, true);
      assert.ok(pendingApply.json.operationId && Array.isArray(pendingApply.json.warnings));
      assert.strictEqual(auditCount(harness.paths), auditBeforePending, "committed response must expose auditPending without claiming a missing audit exists");

      const blockedPreview = await harness.request("/api/admin/catalog/import/preview", {
        method: "POST", cookie: session.cookie, headers: browserHeaders(session), body: { ...pendingDocument, items: [{ ...pendingDocument.items[0], teacherName: "Blocked Audit Writer" }] },
      });
      assert.strictEqual(blockedPreview.status, 200, blockedPreview.text);
      const blockedApply = await harness.request("/api/admin/catalog/import/apply", {
        method: "POST", cookie: session.cookie, headers: browserHeaders(session, blockedPreview.json.baseVersion), body: { previewId: blockedPreview.json.previewId, confirm: true },
      });
      assert.strictEqual(blockedApply.status, 503, blockedApply.text);
      assert.strictEqual(blockedApply.json.code, "CATALOG_AUDIT_PENDING");
    } finally {
      fs.unlinkSync(auditLockPath);
    }
    const recoveredAudit = await harness.request("/api/admin/catalog/import/apply", {
      method: "POST", cookie: session.cookie, headers: browserHeaders(session, pendingPreview.json.baseVersion), body: { previewId: pendingPreview.json.previewId, confirm: true },
    });
    assert.strictEqual(recoveredAudit.status, 200, recoveredAudit.text);
    assert.strictEqual(recoveredAudit.json.reconciled, true);
    assert.strictEqual(recoveredAudit.json.auditPending, false);
    assert.strictEqual(auditEntries(harness.paths).filter((entry) => entry.operationId === pendingApply.json.operationId).length, 1, "audit recovery must append exactly once");
  } finally {
    await harness.close();
  }
}

async function assertCatalogRouteOwnedRolloutGate() {
  const harness = await startAdminHttpHarness({ enabledModules: "" });
  try {
    seedCatalogHttpFixture(harness.paths);
    const session = await harness.login();
    const response = await harness.request("/api/admin/catalog/import/preview", {
      method: "POST",
      cookie: session.cookie,
      headers: { Origin: "http://admin.test", "X-Fosu-CSRF": session.csrfToken },
      body: { type: "teacher", semester: "2025-2026-2", items: [{ teacherName: "Headerless Writer", courses: [] }] },
    });
    assert.strictEqual(response.status, 403, response.text);
    assert.strictEqual(response.json && response.json.code, "MODULE_WRITE_DISABLED");
    assert.strictEqual(response.json && response.json.module, "catalog");
    assert.strictEqual(fs.existsSync(path.join(harness.paths.data, "admin-catalog-staging")), false, "disabled headerless write must not bootstrap staging");
    assert.strictEqual(fs.existsSync(path.join(harness.paths.data, "catalog-control")), false, "disabled headerless write must not create private records");
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
  await assertCatalogRouteOwnedRolloutGate();
  await assertCatalogOperationsHttpContract();
  console.log("Admin C1 real HTTP write contracts passed.");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
