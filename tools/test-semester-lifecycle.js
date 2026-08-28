const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const tempRoot = path.join(os.tmpdir(), `fosu-semester-lifecycle-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");
process.env.FOSU_RELEASE_RETENTION_COUNT = "1";
process.env.FOSU_RELEASE_RETENTION_DAYS = "1";
process.env.NODE_ENV = "test";

const termRegistryService = require("../server/src/services/termRegistryService");
const termReleaseIndexService = require("../server/src/services/termReleaseIndexService");
const releaseService = require("../server/src/services/releaseService");
const appConfigService = require("../server/src/services/appConfigService");
const schoolCatalogService = require("../server/src/services/schoolCatalogService");
const storageLifecycleService = require("../server/src/services/storageLifecycleService");
const weekRules = require("../server/src/shared/courseWeekRules");

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function course(name) {
  return {
    courseName: name,
    teacherName: "Teacher A",
    classroom: "C7-101",
    weekday: 1,
    dayOfWeek: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2],
  };
}

function snapshot(term, version, startDate) {
  const item = course(`Course ${term}`);
  return {
    schemaVersion: "1.0",
    version,
    releaseVersion: version,
    term,
    semester: term,
    termConfig: {
      term,
      semesterText: termRegistryService.generateSemesterText(term),
      termStartDate: startDate,
      totalWeeks: 20,
      weekStart: "monday",
      source: "test",
      releaseVersion: version,
    },
    termStartDate: startDate,
    totalWeeks: 20,
    generatedAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    catalog: {
      semesters: [{ value: term, label: termRegistryService.generateSemesterText(term) }],
      colleges: [{ code: "04", name: `College ${term}` }],
      grades: ["2025"],
    },
    majors: [{ collegeCode: "04", code: "0401", name: `Major ${term}`, grade: "2025" }],
    classSchedules: [{ semester: term, className: `25 ${term}`, collegeCode: "04", grade: "2025", majorCode: "0401", courses: [item] }],
    resources: {
      teachers: [{ teacherName: "Teacher A" }],
      classrooms: [{ roomName: "C7-101" }],
      courses: [{ courseName: item.courseName }],
      teacherSchedules: [{ term, semester: term, teacherName: "Teacher A", courses: [item] }],
      classroomSchedules: [{ term, semester: term, roomName: "C7-101", courses: [item] }],
      courseSchedules: [{ term, semester: term, courseName: item.courseName, courses: [item] }],
    },
  };
}

function resetMiniprogramService() {
  const mockEnvPath = require.resolve("./mock-env");
  const servicePath = require.resolve("../miniprogram/services/releasePackService");
  delete require.cache[mockEnvPath];
  delete require.cache[servicePath];
  const mockEnv = require("./mock-env");
  mockEnv.clearStorage();
  return require("../miniprogram/services/releasePackService");
}

async function testReleaseCacheIsolation() {
  const releasePackService = resetMiniprogramService();
  const termA = "2025-2026-2";
  const termB = "2026-2027-1";
  const manifests = {
    [termA]: { success: true, schemaVersion: 2, term: termA, semester: termA, releaseVersion: "a-v1", version: "a-v1", updatedAt: "2026-06-05T00:00:00.000Z" },
    [termB]: { success: true, schemaVersion: 2, term: termB, semester: termB, releaseVersion: "b-v1", version: "b-v1", updatedAt: "2026-09-07T00:00:00.000Z" },
  };
  global.wx.mockRequest = (options) => {
    const url = new URL(options.url);
    const requestedTerm = options.data && options.data.term || url.searchParams.get("term") || termA;
    options.success({ statusCode: 200, data: manifests[requestedTerm] || { success: false, code: "TERM_NOT_PUBLISHED" } });
  };

  const first = await releasePackService.getActiveManifest({ term: termA });
  assert.strictEqual(first.term, termA, "term A manifest should load");
  assert.strictEqual(releasePackService.getLastKnownGood(termB), null, "term B must not use term A last-good");

  global.wx.setStorageSync("fosu:v6:active-release", {
    term: termA,
    releaseVersion: "a-v1",
    manifest: manifests[termA],
    savedAt: Date.now(),
  });
  assert.strictEqual(releasePackService.getLocalActiveRelease(termB), null, "global active release must not pollute another term");

  manifests[termB] = Object.assign({}, manifests[termA], { releaseVersion: "wrong-term", version: "wrong-term", term: termA });
  await assert.rejects(
    () => releasePackService.getActiveManifest({ term: termB, forceNetwork: true }),
    /MANIFEST_TERM_MISMATCH|TERM_MISMATCH/,
    "mismatched term manifest must be rejected"
  );
  assert.strictEqual(releasePackService.getLastKnownGood(termB), null, "mismatched term must not become last-good");

  const legacyOnlyService = resetMiniprogramService();
  global.wx.setStorageSync("fosu:v5:last-good:2025-2026-2", {
    term: termA,
    releaseVersion: "a-v5",
    manifest: Object.assign({}, manifests[termA], { releaseVersion: "a-v5", version: "a-v5" }),
  });
  assert.strictEqual(legacyOnlyService.getLastKnownGood(termA).releaseVersion, "a-v5", "v5 cache should migrate lazily for the same term");
}

function testTermRegistry() {
  assert.strictEqual(termRegistryService.validateTermId("2026-2027-1").valid, true);
  assert.strictEqual(termRegistryService.validateTermId("2026-2028-1").valid, false);
  assert.strictEqual(termRegistryService.generateSemesterText("2026-2027-2"), "2026-2027学年第二学期");

  const planned = termRegistryService.createPlannedTerm({
    term: "2026-2027-1",
    totalWeeks: 20,
    weekStart: "monday",
  });
  assert.strictEqual(planned.status, "planned");
  assert.strictEqual(planned.termStartDate, "");
  assert.throws(() => termRegistryService.activateTerm("2026-2027-1"), /TERM_NOT_PUBLISHED|RELEASE_VERSION_REQUIRED/);

  const registry = termRegistryService.readRegistry();
  assert.strictEqual(registry.activeTerm, "", "planned-only registry should not invent an active term");
}

function testLegacyMigration() {
  const version = "legacy-active-v1";
  const releaseDir = path.join(process.env.FOSU_STORAGE_DIR, "releases", version);
  writeJson(path.join(releaseDir, "manifest.json"), {
    term: "2025-2026-2",
    semester: "2025-2026-2",
    releaseVersion: version,
    updatedAt: "2026-06-05T00:00:00.000Z",
    counts: {},
  });
  writeJson(path.join(process.env.FOSU_STORAGE_DIR, "releases", "active.json"), {
    term: "2025-2026-2",
    releaseVersion: version,
    activatedAt: "2026-06-05T00:00:00.000Z",
  });
  writeJson(path.join(process.env.FOSU_STORAGE_DIR, "catalog.json"), { colleges: [{ code: "04", name: "Legacy College" }], grades: ["2025"] });
  writeJson(path.join(process.env.FOSU_STORAGE_DIR, "majors-index.json"), { colleges: [] });
  writeJson(path.join(process.env.FOSU_STORAGE_DIR, "sync-meta.json"), { catalog: { itemCount: 1, updatedAt: "2026-06-05T00:00:00.000Z" } });

  const migration = termRegistryService.migrateLegacyTermState({ force: true });
  assert.strictEqual(migration.success, true);
  assert.strictEqual(migration.term, "2025-2026-2");
  assert.strictEqual(migration.usedLegacyFallback, true);
  assert(fs.existsSync(path.join(process.env.FOSU_STORAGE_DIR, "terms", "2025-2026-2", "catalog.json")), "legacy catalog should be copied into current term directory");

  const second = termRegistryService.migrateLegacyTermState();
  assert.strictEqual(second.migrated, false, "migration should be idempotent when registry exists");
}

function testReleaseLifecycle() {
  termRegistryService.createPlannedTerm({ term: "2026-2027-2", termStartDate: "2027-03-01", totalWeeks: 20 });
  const current = releaseService.activateReleaseFromSnapshot(snapshot("2025-2026-2", "current-v1", "2026-03-09"));
  assert.strictEqual(current.active.term, "2025-2026-2");

  const nextWritten = releaseService.writeReleaseSnapshot(snapshot("2026-2027-2", "next-v1", "2027-03-01"));
  const bound = termRegistryService.bindReleaseToTerm("2026-2027-2", "next-v1");
  termReleaseIndexService.bindRelease("2026-2027-2", "next-v1", { activeTerm: false });
  assert.strictEqual(bound.status, "ready");
  assert.strictEqual(nextWritten.version, "next-v1");

  const mismatch = releaseService.getReleasePackManifest("current-v1", { term: "2026-2027-2" });
  assert.strictEqual(mismatch.success, false, "manifest term mismatch should block publish/use");
  assert.strictEqual(mismatch.code, "TERM_DATA_MISMATCH");

  const activated = releaseService.activateReleaseVersion("next-v1");
  assert.strictEqual(activated.active.term, "2026-2027-2");
  assert.strictEqual(termRegistryService.getActiveTerm().term, "2026-2027-2");
  assert.strictEqual(termReleaseIndexService.readIndex().activeTerm, "2026-2027-2");

  const appConfig = appConfigService.getPublicAppConfig().data;
  assert.strictEqual(appConfig.currentSemester, "2026-2027-2");
  assert(Array.isArray(appConfig.availableTerms), "app-config should expose availableTerms");
  assert.deepStrictEqual(appConfig.availableTerms.map((item) => item.term), ["2026-2027-2"], "only the active term should remain public");

  const retention = storageLifecycleService.runMaintenance({ dryRun: true });
  const retentionText = JSON.stringify(retention);
  assert(retentionText.includes("current-v1") || retentionText.includes("next-v1"), "term-index/registry releases should be considered pinned");
}

async function testTermDataIsolation() {
  const termA = "2025-2026-2";
  const termB = "2026-2027-2";
  writeJson(termRegistryService.termDataPath(termA, "catalog.json"), { colleges: [{ code: "A", name: "A College" }], grades: ["2025"], semesters: [{ value: termA, label: termA }] });
  writeJson(termRegistryService.termDataPath(termB, "catalog.json"), { colleges: [{ code: "B", name: "B College" }], grades: ["2026"], semesters: [{ value: termB, label: termB }] });
  writeJson(termRegistryService.termDataPath(termA, "majors-index.json"), { colleges: [{ collegeCode: "A", grades: [{ grade: "2025", majors: [{ majorCode: "A1", majorName: "A Major" }] }] }] });
  writeJson(termRegistryService.termDataPath(termB, "majors-index.json"), { colleges: [{ collegeCode: "B", grades: [{ grade: "2026", majors: [{ majorCode: "B1", majorName: "B Major" }] }] }] });
  writeJson(termRegistryService.termDataPath(termA, "sync-meta.json"), { catalog: { term: termA, updatedAt: "2026-06-05T00:00:00.000Z" } });
  writeJson(termRegistryService.termDataPath(termB, "sync-meta.json"), { catalog: { term: termB, updatedAt: "2027-03-01T00:00:00.000Z" } });

  const catalogA = await schoolCatalogService.getCatalog(termA);
  const catalogB = await schoolCatalogService.getCatalog(termB);
  assert.strictEqual(catalogA.colleges[0].code, "A");
  assert.strictEqual(catalogB.colleges[0].code, "B");
  assert.strictEqual(catalogB.term, termB);
  const majorsB = await schoolCatalogService.getMajors("B", "2026", termB);
  assert.strictEqual(majorsB.dataSource, "release-class-index");
  assert.deepStrictEqual(majorsB.majors, [], "release class index must not expose majors without schedule data");

  const planned = termRegistryService.createPlannedTerm({ term: "2027-2028-1", totalWeeks: 20 });
  assert.strictEqual(planned.status, "planned");
  const plannedCatalog = await schoolCatalogService.getCatalog("2027-2028-1");
  assert.strictEqual(plannedCatalog.code, "TERM_NOT_PUBLISHED");
}

function testWeekPhases() {
  const before = weekRules.getTeachingWeekPhase("2026-08-31", "2026-09-07", 20);
  assert.strictEqual(before.termPhase, "before-term");
  assert.strictEqual(before.isInTerm, false);
  assert(before.rawWeekNo <= 0);
  const after = weekRules.getTeachingWeekPhase("2027-02-01", "2026-09-07", 20);
  assert.strictEqual(after.termPhase, "after-term");
  assert.strictEqual(after.isInTerm, false);
  assert(after.rawWeekNo > 20);
}

function testCliFutureStartDateGate() {
  const result = (() => {
    try {
      execFileSync("node", ["tools/fosu-sync-client/sync.js", "local-campus", "--term=2026-2027-1", "--dry-run"], {
        cwd: path.resolve(__dirname, ".."),
        env: Object.assign({}, process.env, {
          FOSU_API_BASE: "http://127.0.0.1:9",
          PREFERRED_SEMESTER: "2026-2027-1",
          PREFERRED_TERM_START_DATE: "",
        }),
        stdio: "pipe",
      });
      return "";
    } catch (error) {
      return `${error.stdout || ""}${error.stderr || ""}`;
    }
  })();
  assert(result.includes("Missing termStartDate for 2026-2027-1"), "sync CLI should fail before crawling future term without start date");
}

function cleanup() {
  const resolved = path.resolve(tempRoot);
  if (path.basename(resolved).startsWith("fosu-semester-lifecycle-")) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

(async () => {
  try {
    testTermRegistry();
    testLegacyMigration();
    testReleaseLifecycle();
    await testTermDataIsolation();
    await testReleaseCacheIsolation();
    testWeekPhases();
    testCliFutureStartDateGate();
    cleanup();
    console.log("test-semester-lifecycle passed");
  } catch (error) {
    console.error(error);
    try { cleanup(); } catch (cleanupError) {}
    process.exit(1);
  }
})();
