const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { calculateFingerprint } = require("../server/src/utils/stagingFingerprint");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-c1-"));
process.env.FOSU_STORAGE_DIR = path.join(tmp, "storage");
process.env.FOSU_DATA_DIR = path.join(tmp, "data");
process.env.FOSU_QUALITY_IGNORE_LOCK_WAIT_MS = "60";
fs.mkdirSync(process.env.FOSU_STORAGE_DIR, { recursive: true });
fs.mkdirSync(process.env.FOSU_DATA_DIR, { recursive: true });

for (const key of Object.keys(require.cache)) {
  if (key.includes("modules") || key.includes("appConfigService") || key.includes("settings")) {
    delete require.cache[key];
  }
}

const settings = require("../server/src/modules/settings/service");
const catalog = require("../server/src/modules/catalog/service");
const catalogImportService = require("../server/src/modules/catalog/importService");
const catalogRepository = require("../server/src/modules/catalog/repository");
const quality = require("../server/src/modules/quality/service");
const appConfig = require("../server/src/services/appConfigService");
const adminAuditService = require("../server/src/services/adminAuditService");
const repositorySource = fs.readFileSync(path.join(__dirname, "../server/src/modules/quality/repository.js"), "utf8");
assert.ok(!repositorySource.includes("fs.openSync"), "lock initialization must not expose an open/write/close descriptor sequence");
assert.ok(!repositorySource.includes("fs.closeSync"), "lock initialization must not expose a closeSync failure path");
assert.ok(!repositorySource.includes("leaseExpiresAt"), "live owners must never be reclaimed by an elapsed lease");

// seed config
appConfig.saveAdminConfig({ appName: "C1 Test App" });

const typed = settings.getTypedSettings();
assert.ok(typed.version);
assert.ok(typed.fields.length >= 5);

const saved = settings.saveTypedSettings(
  { appName: "C1 Renamed", expectedVersion: typed.version },
  { expectedVersion: typed.version, requireIfMatch: true }
);
assert.ok(saved.version !== typed.version);

let conflict = false;
try {
  settings.saveTypedSettings({ appName: "x" }, { expectedVersion: typed.version, requireIfMatch: true });
} catch (e) {
  conflict = e.statusCode === 409;
}
assert.ok(conflict);

const meta1 = catalog.getCatalogMetaDocument();
const entry = catalog.saveCatalogMetaEntry(
  "class::TEST",
  { displayName: "测试班", note: "n", hidden: false },
  { expectedVersion: meta1.version, requireIfMatch: true }
);
assert.ok(entry.version);

function seedCatalogFixture() {
  const storage = process.env.FOSU_STORAGE_DIR;
  fs.rmSync(path.join(process.env.FOSU_DATA_DIR, "admin-catalog-staging"), { recursive: true, force: true });
  fs.writeFileSync(path.join(storage, "catalog.json"), JSON.stringify({
    semesters: ["2025-2026-2"],
    colleges: [{ code: "04", name: "Engineering, \"North\"" }],
    grades: ["2025", "2024"],
  }, null, 2));
  fs.writeFileSync(path.join(storage, "majors-index.json"), JSON.stringify({
    version: "major-seed",
    semester: "2025-2026-2",
    grades: ["2025", "2024"],
    colleges: [{
      collegeCode: "04",
      collegeName: "Engineering, \"North\"",
      grades: [
        { grade: "2025", majors: [{ majorCode: "0401", majorName: "Software" }] },
        { grade: "2024", majors: [{ majorCode: "0402", majorName: "Networks" }] },
      ],
    }],
  }, null, 2));
  const repeatedCourse = { courseName: "Catalog Course", teacherName: "Teacher One", className: "Class One", classroom: "A101", weekday: 1, startSection: 1, endSection: 2, weeks: [1], sections: [1, 2] };
  fs.writeFileSync(path.join(storage, "class-schedules.json"), JSON.stringify([
    { className: "Class One", semester: "2025-2026-2", collegeCode: "04", collegeName: "Engineering, \"North\"", grade: "2025", majorCode: "0401", majorName: "Software", courses: [repeatedCourse] },
    { className: "Class Two", semester: "2025-2026-2", collegeCode: "04", collegeName: "Engineering, \"North\"", grade: "2024", majorCode: "0402", majorName: "Networks", courses: [] },
  ], null, 2));
  fs.writeFileSync(path.join(storage, "teacher-schedules.json"), JSON.stringify([
    { teacherName: "Teacher One", semester: "2025-2026-2", collegeName: "Engineering, \"North\"", courses: [repeatedCourse] },
    { teacherName: "Teacher Two", semester: "2025-2026-2", collegeName: "Engineering, \"North\"", courses: [] },
  ], null, 2));
  fs.writeFileSync(path.join(storage, "classroom-schedules.json"), JSON.stringify([
    { roomName: "A101", semester: "2025-2026-2", courses: [repeatedCourse] },
    { roomName: "A102", semester: "2025-2026-2", courses: [] },
  ], null, 2));
  fs.writeFileSync(path.join(storage, "course-schedules.json"), JSON.stringify([
    { courseName: "Catalog Course", semester: "2025-2026-2", collegeName: "Engineering, \"North\"", courses: [repeatedCourse] },
    { courseName: "Other Course", semester: "2025-2026-2", collegeName: "Engineering, \"North\"", courses: [] },
  ], null, 2));
  writeCatalogActiveFixtureFromLegacy();
}

function writeCatalogActiveFixtureFromLegacy(version = "c1-modules-active") {
  const storage = process.env.FOSU_STORAGE_DIR;
  const catalogDocument = JSON.parse(fs.readFileSync(path.join(storage, "catalog.json"), "utf8"));
  const majorsDocument = JSON.parse(fs.readFileSync(path.join(storage, "majors-index.json"), "utf8"));
  const majors = [];
  for (const college of majorsDocument.colleges || []) for (const grade of college.grades || []) for (const major of grade.majors || []) majors.push({
    collegeCode: college.collegeCode || college.code,
    collegeName: college.collegeName || college.name,
    code: major.majorCode || major.code,
    name: major.majorName || major.name,
    grade: grade.grade,
  });
  const classSchedules = JSON.parse(fs.readFileSync(path.join(storage, "class-schedules.json"), "utf8"));
  const teacherSchedules = JSON.parse(fs.readFileSync(path.join(storage, "teacher-schedules.json"), "utf8"));
  const classroomSchedules = JSON.parse(fs.readFileSync(path.join(storage, "classroom-schedules.json"), "utf8"));
  const courseSchedules = JSON.parse(fs.readFileSync(path.join(storage, "course-schedules.json"), "utf8"));
  const snapshot = {
    schemaVersion: 1,
    version,
    releaseVersion: version,
    term: majorsDocument.semester,
    semester: majorsDocument.semester,
    termStartDate: "2026-03-09",
    totalWeeks: 20,
    weekStart: "monday",
    updatedAt: "2026-07-19T00:00:00.000Z",
    catalog: catalogDocument,
    majors,
    classSchedules,
    resources: {
      teachers: teacherSchedules.map((row) => ({ teacherName: row.teacherName, collegeName: row.collegeName })),
      classrooms: classroomSchedules.map((row) => ({ roomName: row.roomName, buildingName: row.buildingName })),
      courses: courseSchedules.map((row) => ({ courseName: row.courseName, collegeName: row.collegeName })),
      teacherSchedules,
      classroomSchedules,
      courseSchedules,
    },
  };
  const canonicalHash = calculateFingerprint(snapshot).canonicalHash;
  const releaseRoot = path.join(storage, "releases");
  const releaseDir = path.join(releaseRoot, version);
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(releaseDir, "snapshot.json"), JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(path.join(releaseDir, "manifest.json"), JSON.stringify({ success: true, schemaVersion: 2, releaseVersion: version, version, term: snapshot.term, semester: snapshot.semester, canonicalHash, packHealth: { valid: true, errors: [] } }, null, 2));
  fs.writeFileSync(path.join(releaseRoot, "active.json"), JSON.stringify({ version, releaseVersion: version, term: snapshot.term, semester: snapshot.semester, canonicalHash, packStatus: { healthy: true, manifestExists: true, manifestValid: true, hashValid: true, missing: [], hashErrors: [] } }, null, 2));
}

function expectCatalogError(fn, code, statusCode) {
  assert.throws(fn, (error) => error && error.code === code && (!statusCode || error.statusCode === statusCode));
}

function recursiveFileSnapshot(root) {
  const out = {};
  if (!fs.existsSync(root)) return out;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).replace(/\\/g, "/");
      if (entry.isDirectory()) visit(target);
      else {
        const stat = fs.lstatSync(target);
        out[relative] = { bytes: fs.readFileSync(target).toString("base64"), mtimeMs: stat.mtimeMs, mode: stat.mode };
      }
    }
  };
  visit(root);
  return out;
}

function assertCatalogBootstrapCrashRecoveryContracts() {
  const servicePath = path.resolve(__dirname, "../server/src/modules/catalog/service");
  const stagingRoot = path.join(process.env.FOSU_DATA_DIR, "admin-catalog-staging");
  const currentPath = path.join(stagingRoot, "current.json");
  const legacyFiles = ["catalog.json", "class-schedules.json", "teacher-schedules.json", "classroom-schedules.json", "course-schedules.json", "majors-index.json"];
  for (const boundary of ["staging-mkdir", "bootstrap-journal-temp", "partial-build", "generation-renamed", "pointer-temp", "pointer-committed"]) {
    seedCatalogFixture();
    const legacyBefore = Object.fromEntries(legacyFiles.map((name) => [name, fs.readFileSync(path.join(process.env.FOSU_STORAGE_DIR, name)).toString("base64")]));
    const program = `
      const fs = require("fs");
      const path = require("path");
      const staging = ${JSON.stringify(stagingRoot)};
      const current = ${JSON.stringify(currentPath)};
      const boundary = ${JSON.stringify(boundary)};
      let injected = false;
      const originalMkdir = fs.mkdirSync;
      const originalWrite = fs.writeFileSync;
      const originalRename = fs.renameSync;
      const originalUnlink = fs.unlinkSync;
      const originalOpen = fs.openSync;
      const originalFsync = fs.fsyncSync;
      const descriptorPaths = new Map();
      fs.openSync = function(target, ...args) {
        const descriptor = originalOpen.call(fs, target, ...args);
        descriptorPaths.set(descriptor, String(target));
        return descriptor;
      };
      fs.fsyncSync = function(descriptor) {
        const result = originalFsync.call(fs, descriptor);
        const target = descriptorPaths.get(descriptor) || "";
        if (!injected && boundary === "bootstrap-journal-temp" && path.basename(target).startsWith(".bootstrap.json.") && path.basename(target).endsWith(".tmp")) { injected = true; process.exit(91); }
        if (!injected && boundary === "partial-build" && target.includes(".building-") && path.basename(target).includes("catalog.json")) { injected = true; process.exit(91); }
        return result;
      };
      fs.mkdirSync = function(target, ...args) {
        const result = originalMkdir.call(fs, target, ...args);
        if (!injected && boundary === "staging-mkdir" && path.resolve(target) === path.resolve(staging)) { injected = true; process.exit(91); }
        return result;
      };
      fs.writeFileSync = function(target, data, ...args) {
        const result = originalWrite.call(fs, target, data, ...args);
        if (!injected && boundary === "partial-build" && String(target).includes(".building-") && path.basename(target) === "catalog.json") { injected = true; process.exit(91); }
        return result;
      };
      fs.renameSync = function(from, to) {
        if (!injected && boundary === "pointer-temp" && path.resolve(to) === path.resolve(current)) { injected = true; process.exit(91); }
        const result = originalRename.call(fs, from, to);
        if (!injected && boundary === "generation-renamed" && path.basename(String(from)).startsWith(".building-") && path.basename(path.dirname(String(to))) === "generations") { injected = true; process.exit(91); }
        return result;
      };
      fs.unlinkSync = function(target, ...args) {
        if (!injected && boundary === "pointer-committed" && path.basename(String(target)) === "bootstrap.json" && fs.existsSync(current)) { injected = true; process.exit(91); }
        return originalUnlink.call(fs, target, ...args);
      };
      require(${JSON.stringify(servicePath)}).listResources({ type: "class", page: 1, pageSize: 1 });
      process.exit(92);
    `;
    const crashed = spawnSync(process.execPath, ["-e", program], { env: { ...process.env }, encoding: "utf8" });
    assert.strictEqual(crashed.status, 91, `${boundary} did not stop at the intended bootstrap crash point: ${crashed.stderr}`);
    let recovered;
    try { recovered = catalog.listResources({ type: "class", page: 1, pageSize: 1 }); }
    catch (error) { error.message = `${boundary} recovery failed: ${error.message}`; throw error; }
    assert.strictEqual(recovered.source.label, "Catalog 工作区（未发布）");
    assert.ok(fs.existsSync(currentPath), `${boundary} recovery did not publish current.json`);
    assert.strictEqual(fs.existsSync(catalogRepository.BOOTSTRAP_JOURNAL_PATH), false, `${boundary} recovery left a bootstrap journal`);
    assert.strictEqual(fs.readdirSync(path.join(stagingRoot, "generations")).length, 1, `${boundary} recovery must publish exactly one generation`);
    assert.strictEqual(fs.readdirSync(stagingRoot).some((name) => name.startsWith(".building-") || name.startsWith(".current-")), false, `${boundary} recovery left temporary artifacts`);
    const legacyAfter = Object.fromEntries(legacyFiles.map((name) => [name, fs.readFileSync(path.join(process.env.FOSU_STORAGE_DIR, name)).toString("base64")]));
    assert.deepStrictEqual(legacyAfter, legacyBefore, `${boundary} bootstrap recovery mutated a Legacy seed`);
  }

  seedCatalogFixture();
  const outsideStaging = path.join(tmp, "outside-staging-junction");
  fs.mkdirSync(outsideStaging, { recursive: true });
  fs.writeFileSync(path.join(outsideStaging, "sentinel"), "outside-staging");
  fs.symlinkSync(outsideStaging, stagingRoot, "junction");
  expectCatalogError(() => catalog.listResources({ type: "class", page: 1, pageSize: 1 }), "CATALOG_TARGET_INVALID", 500);
  assert.strictEqual(fs.readFileSync(path.join(outsideStaging, "sentinel"), "utf8"), "outside-staging");
  fs.unlinkSync(stagingRoot);

  fs.mkdirSync(stagingRoot, { recursive: true });
  const outsideJournal = path.join(tmp, "outside-bootstrap-journal");
  fs.mkdirSync(outsideJournal, { recursive: true });
  fs.writeFileSync(path.join(outsideJournal, "sentinel"), "outside-journal");
  fs.symlinkSync(outsideJournal, catalogRepository.BOOTSTRAP_JOURNAL_PATH, "junction");
  expectCatalogError(() => catalog.listResources({ type: "class", page: 1, pageSize: 1 }), "CATALOG_TARGET_INVALID", 500);
  assert.strictEqual(fs.readFileSync(path.join(outsideJournal, "sentinel"), "utf8"), "outside-journal");
  fs.unlinkSync(catalogRepository.BOOTSTRAP_JOURNAL_PATH);
  fs.rmdirSync(stagingRoot);
}

function assertCatalogReadContracts() {
  seedCatalogFixture();
  const expected = {
    class: ["class:2025-2026-2:04:2024:0402:Class Two", "className", "coursesCount"],
    teacher: ["teacher:2025-2026-2:Teacher One", "teacherName", "classesCount"],
    classroom: ["classroom:2025-2026-2:A101", "roomName", "occupationRate"],
    course: ["course:2025-2026-2:Catalog Course", "courseName", "teachersCount"],
    major: ["major:2025-2026-2:04:2024:0402", "majorName", "collegeCode"],
  };
  for (const [type, [firstId, nameField, countField]] of Object.entries(expected)) {
    const result = catalog.listResources({ type, page: 1, pageSize: 1 });
    assert.strictEqual(result.source.kind, "catalog-staging", `${type} must identify the unpublished staging plane`);
    assert.strictEqual(result.source.published, false);
    assert.strictEqual(result.source.label, "Catalog 工作区（未发布）", `${type} must expose the exact Chinese staging label`);
    assert.ok(path.resolve(catalog.getCatalogTargetPath(type)).startsWith(path.resolve(process.env.FOSU_DATA_DIR, "admin-catalog-staging") + path.sep));
    assert.strictEqual(result.items[0].id, firstId, `${type} stable id`);
    assert.ok(Object.prototype.hasOwnProperty.call(result.items[0], nameField), `${type} name field`);
    assert.ok(Object.prototype.hasOwnProperty.call(result.items[0], countField), `${type} type-specific field`);
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.totalPages, 2);
    const pastLast = catalog.listResources({ type, page: 3, pageSize: 1 });
    assert.deepStrictEqual(pastLast.items, []);
    assert.strictEqual(pastLast.page, 3);
    assert.strictEqual(pastLast.totalPages, 2);
  }
  for (const pageSize of [0, 101, "NaN", -1, 1.5]) {
    expectCatalogError(() => catalog.listResources({ type: "class", pageSize }), "INVALID_PAGINATION", 400);
  }
  for (const page of [0, "NaN", -1, 1.5]) {
    expectCatalogError(() => catalog.listResources({ type: "class", page }), "INVALID_PAGINATION", 400);
  }
  assert.strictEqual(catalog.listResources({ type: "class", semester: "2025-2026-2" }).total, 2);
  assert.strictEqual(catalog.listResources({ type: "class", keyword: "software" }).total, 1);

  const relationshipResult = catalog.getRelationships();
  assert.strictEqual(relationshipResult.source.kind, "catalog-staging");
  assert.strictEqual(relationshipResult.source.label, "Catalog 工作区（未发布）");
  assert.ok(relationshipResult.generationId && relationshipResult.relationshipVersion);
  assert.deepStrictEqual(relationshipResult.colleges, [{
      id: "04",
      name: "Engineering, \"North\"",
      grades: [
        { grade: "2025", majors: [{ id: "0401", name: "Software" }] },
        { grade: "2024", majors: [{ id: "0402", name: "Networks" }] },
      ],
    }]);

  const jsonExport = catalog.exportRows({ type: "class", format: "json" });
  const csvExport = catalog.exportRows({ type: "class", format: "csv" });
  const unpaged = catalog.listResources({ type: "class", page: 1, pageSize: 100 }).items;
  assert.deepStrictEqual(jsonExport.rows, unpaged);
  assert.strictEqual(JSON.parse(jsonExport.body).length, unpaged.length);
  assert.match(jsonExport.contentType, /^application\/json/);
  assert.match(csvExport.contentType, /^text\/csv/);
  assert.match(csvExport.body, /"Engineering, ""North"""/);
  const csvLines = csvExport.body.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  assert.strictEqual(csvLines.length, unpaged.length + 1, "CSV and JSON must contain the same rows");

  const stagingBeforeRepeats = recursiveFileSnapshot(path.join(process.env.FOSU_DATA_DIR, "admin-catalog-staging"));
  for (let index = 0; index < 10; index += 1) {
    catalog.listResources({ type: "class", page: 1, pageSize: 1 });
    catalog.getRelationships();
    catalog.exportRows({ type: "class", format: index % 2 ? "csv" : "json" });
  }
  assert.deepStrictEqual(recursiveFileSnapshot(path.join(process.env.FOSU_DATA_DIR, "admin-catalog-staging")), stagingBeforeRepeats, "repeated valid reads must not change staging bytes or mtimes");

  seedCatalogFixture();
  const manyTeachers = Array.from({ length: 137 }, (_, index) => ({
    teacherName: `Teacher ${String(index).padStart(3, "0")}`,
    semester: "2025-2026-2",
    collegeName: "Engineering, \"North\"",
    courses: [],
  }));
  fs.writeFileSync(path.join(process.env.FOSU_STORAGE_DIR, "teacher-schedules.json"), JSON.stringify(manyTeachers, null, 2));
  writeCatalogActiveFixtureFromLegacy("c1-modules-many-teachers");
  const firstHundred = catalog.listResources({ type: "teacher", page: 1, pageSize: 100 });
  const manyJson = catalog.exportRows({ type: "teacher", format: "json" });
  const manyCsv = catalog.exportRows({ type: "teacher", format: "csv" });
  assert.strictEqual(firstHundred.items.length, 100);
  assert.strictEqual(firstHundred.total, 137);
  assert.strictEqual(manyJson.rows.length, 137, "JSON export must not inherit the list page-size ceiling");
  assert.strictEqual(JSON.parse(manyJson.body).length, 137);
  assert.strictEqual(manyCsv.body.replace(/^\uFEFF/, "").trim().split(/\r?\n/).length, 138, "CSV export must include every one of 137 rows plus its header");
  for (const prefix of [" ", "\t", "\r", "\n"]) {
    for (const formula of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      assert.strictEqual(catalog._test.csvCell(`${prefix}${formula}`).startsWith(`"'`), true, `CSV must neutralize ${JSON.stringify(prefix + formula)}`);
    }
  }
  seedCatalogFixture();
}

function assertCatalogImportContracts() {
  const sourcePath = catalog.getCatalogTargetPath("teacher");
  const valid = {
    type: "teacher",
    semester: "2025-2026-2",
    items: [{ teacherName: "Teacher Three", collegeName: "Engineering, \"North\"", courses: [] }],
  };
  for (const [document, code] of [
    [{ ...valid, replace: true }, "DELETE_NOT_ALLOWED"],
    [{ ...valid, unknown: true }, "INVALID_IMPORT_DOCUMENT"],
    [{ ...valid, items: [{ ...valid.items[0], token: "secret" }] }, "SENSITIVE_DATA_REJECTED"],
    [{ ...valid, items: [valid.items[0], { ...valid.items[0] }] }, "DUPLICATE_IMPORT_ID"],
    [{ type: "major", semester: "2025-2026-2", items: [{ majorCode: "9999", majorName: "Orphan", collegeCode: "99", collegeName: "Missing", grade: "2025" }] }, "ORPHAN_RELATIONSHIP"],
    [{ type: "major", semester: "2025-2026-2", items: [{ majorCode: "0403", majorName: "Bad grade", collegeCode: "04", collegeName: "Engineering", grade: "2099" }] }, "ORPHAN_RELATIONSHIP"],
    [{ type: "teacher", semester: "2025-2026-2", items: [{ teacherName: "Wrong Term", semester: "2024-2025-2", courses: [] }] }, "SEMESTER_MISMATCH"],
  ]) expectCatalogError(() => catalog.previewImport(document), code, 400);

  const beforeSource = fs.readFileSync(sourcePath, "utf8");
  const first = catalog.previewImport(valid);
  const second = catalog.previewImport({ items: [{ courses: [], collegeName: "Engineering, \"North\"", teacherName: "Teacher Three" }], semester: "2025-2026-2", type: "teacher" });
  assert.strictEqual(first.sourceFingerprint, second.sourceFingerprint);
  assert.strictEqual(first.source.kind, "catalog-staging");
  assert.strictEqual(first.source.published, false);
  assert.strictEqual(first.source.label, "Catalog 工作区（未发布）");
  assert.deepStrictEqual(first.summary, { added: 1, updated: 0, unchanged: 0, deleted: 0 });
  assert.deepStrictEqual(first.changes, second.changes);
  assert.strictEqual(fs.readFileSync(sourcePath, "utf8"), beforeSource, "preview must not mutate source");
  expectCatalogError(() => catalog.applyImport(first.previewId, { confirm: true }), "PRECONDITION_REQUIRED", 428);
  expectCatalogError(() => catalog.applyImport(first.previewId, { ifMatch: first.baseVersion, confirm: false }), "CONFIRM_REQUIRED", 400);
  expectCatalogError(() => catalog.applyImport(first.previewId, { ifMatch: "stale", confirm: true }), "CONFLICT", 409);

  const tampered = catalog.previewImport(valid);
  const tamperedPath = path.join(catalog.CATALOG_PREVIEWS_DIR, `${tampered.previewId}.json`);
  const tamperedRecord = JSON.parse(fs.readFileSync(tamperedPath, "utf8"));
  tamperedRecord.document.items[0].teacherName = "Tampered";
  fs.writeFileSync(tamperedPath, JSON.stringify(tamperedRecord, null, 2));
  expectCatalogError(() => catalog.applyImport(tampered.previewId, { ifMatch: tampered.baseVersion, confirm: true }), "PREVIEW_TAMPERED", 409);

  const sourceChanged = catalog.previewImport(valid);
  const competing = catalog.previewImport({ type: "teacher", semester: "2025-2026-2", items: [{ teacherName: "External", courses: [] }] });
  catalog.applyImport(competing.previewId, { ifMatch: competing.baseVersion, confirm: true });
  expectCatalogError(() => catalog.applyImport(sourceChanged.previewId, { ifMatch: sourceChanged.baseVersion, confirm: true }), "CONFLICT", 409);
  seedCatalogFixture();

  process.env.FOSU_CATALOG_PREVIEW_TTL_MS = "40";
  const expired = catalog.previewImport(valid);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 55);
  expectCatalogError(() => catalog.applyImport(expired.previewId, { ifMatch: expired.baseVersion, confirm: true }), "PREVIEW_EXPIRED", 409);
  delete process.env.FOSU_CATALOG_PREVIEW_TTL_MS;

  const appliedPreview = catalog.previewImport(valid);
  const applied = catalog.applyImport(appliedPreview.previewId, { ifMatch: appliedPreview.baseVersion, confirm: true });
  assert.ok(applied.version && applied.version !== appliedPreview.baseVersion);
  assert.strictEqual(applied.summary.deleted, 0);
  const backupPath = path.join(process.env.FOSU_DATA_DIR, "backups", `${applied.backup.id}.json`);
  const backupManifestPath = path.join(process.env.FOSU_DATA_DIR, "backups", `${applied.backup.id}.manifest`);
  assert.ok(applied.backup && fs.existsSync(backupPath));
  assert.ok(fs.existsSync(backupManifestPath));
  const backupBytes = fs.readFileSync(backupPath);
  assert.strictEqual(applied.backup.sha256, require("crypto").createHash("sha256").update(backupBytes).digest("hex"));
  assert.ok(JSON.parse(fs.readFileSync(catalog.getCatalogTargetPath("teacher"), "utf8")).some((item) => item.teacherName === "Teacher Three"));
  const operationAudit = fs.readFileSync(adminAuditService.AUDIT_LOG_PATH, "utf8")
    .trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    .filter((entry) => entry.operationId === applied.operationId);
  assert.strictEqual(operationAudit.length, 1, "apply without an injected callback must durably append exactly one Catalog audit event");
  expectCatalogError(() => catalog.applyImport(appliedPreview.previewId, { ifMatch: appliedPreview.baseVersion, confirm: true }), "PREVIEW_REPLAYED", 409);

  const perType = {
    class: { className: "Class Two", semester: "2025-2026-2", collegeCode: "04", collegeName: "Engineering, \"North\"", grade: "2025", majorCode: "0401", majorName: "Software", courses: [] },
    classroom: { roomName: "=A102", semester: "2025-2026-2", buildingName: "A", courses: [] },
    course: { courseName: "+Catalog Formula", semester: "2025-2026-2", collegeName: "Engineering, \"North\"", courses: [] },
    major: { majorCode: "0403", majorName: "Data", collegeCode: "04", collegeName: "Engineering, \"North\"", grade: "2025", semester: "2025-2026-2" },
  };
  for (const [type, item] of Object.entries(perType)) {
    const preview = catalog.previewImport({ type, semester: "2025-2026-2", items: [item] });
    const result = catalog.applyImport(preview.previewId, { ifMatch: preview.baseVersion, confirm: true });
    assert.strictEqual(result.summary.deleted, 0);
    const raw = JSON.parse(fs.readFileSync(catalog.getCatalogTargetPath(type), "utf8"));
    if (type === "major") {
      assert.ok(!Array.isArray(raw) && Array.isArray(raw.colleges), "major upsert must preserve the nested majors-index shape");
      assert.ok(raw.colleges[0].grades.some((grade) => grade.majors.some((major) => major.majorCode === "0403")));
    } else {
      assert.ok(Array.isArray(raw), `${type} upsert must preserve the schedule-array shape`);
    }
  }
  const formulaCsv = catalog.exportRows({ type: "course", format: "csv" }).body;
  assert.match(formulaCsv, /"'\+Catalog Formula"/, "CSV must neutralize spreadsheet formula prefixes");
}

function catalogAuditEvents(operationId) {
  if (!fs.existsSync(adminAuditService.AUDIT_LOG_PATH)) return [];
  return fs.readFileSync(adminAuditService.AUDIT_LOG_PATH, "utf8")
    .split(/\r?\n/).filter(Boolean).map(JSON.parse)
    .filter((entry) => entry.operationId === operationId);
}

function recoveryDocument(name) {
  return { type: "teacher", semester: "2025-2026-2", items: [{ teacherName: name, collegeName: "Engineering, \"North\"", courses: [] }] };
}

function applyExpectingRecoveryConflict(preview) {
  process.env.FOSU_CATALOG_PREVIEW_TTL_MS = "600000";
  const trigger = catalog.previewImport(recoveryDocument(`Trigger ${preview.previewId.slice(0, 8)}`));
  expectCatalogError(
    () => catalog.applyImport(trigger.previewId, { ifMatch: trigger.baseVersion, confirm: true }),
    "CONFLICT",
    409
  );
}

function assertRecoveredOperation(preview, teacherName) {
  const operation = catalogImportService.readOperation(preview.previewId);
  assert.strictEqual(operation.state, "complete", `${teacherName} operation must recover to complete`);
  assert.strictEqual(catalogAuditEvents(operation.operationId).length, 1, `${teacherName} recovery must append one audit event`);
  assert.ok(JSON.parse(fs.readFileSync(catalog.getCatalogTargetPath("teacher"), "utf8")).some((item) => item.teacherName === teacherName));
  const backupPath = path.join(process.env.FOSU_DATA_DIR, "backups", `${operation.backup.id}.json`);
  const manifestPath = path.join(process.env.FOSU_DATA_DIR, "backups", `${operation.backup.id}.manifest`);
  assert.ok(fs.existsSync(backupPath) && fs.existsSync(manifestPath), `${teacherName} recovery must leave a complete backup pair`);
  assert.strictEqual(require("crypto").createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex"), operation.backup.sha256);
  return operation;
}

function assertCatalogCrashRecoveryContracts() {
  seedCatalogFixture();
  // CI runners can be slow between previewImport and applyImport; 200ms TTL
  // flaked as "catalog preview expired" before the injected crash ran.
  // Keep TTL long enough for apply + injection; recovery is driven by
  // recoverOtherPendingOperations on the next apply, not by preview expiry.
  const CRASH_PREVIEW_TTL_MS = "10000";
  const CRASH_SETTLE_MS = 300;
  process.env.FOSU_CATALOG_PREVIEW_TTL_MS = CRASH_PREVIEW_TTL_MS;

  const preparedPreview = catalog.previewImport(recoveryDocument("Prepared Recovery"));
  const originalCreateBackup = catalogRepository.createBackup;
  catalogRepository.createBackup = () => { throw Object.assign(new Error("injected before backup"), { code: "INJECTED_PREPARED_FAILURE" }); };
  try {
    assert.throws(() => catalog.applyImport(preparedPreview.previewId, { ifMatch: preparedPreview.baseVersion, confirm: true }), /injected before backup/);
  } finally { catalogRepository.createBackup = originalCreateBackup; }
  assert.strictEqual(catalogImportService.readOperation(preparedPreview.previewId).state, "prepared");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, CRASH_SETTLE_MS);
  applyExpectingRecoveryConflict(preparedPreview);
  assertRecoveredOperation(preparedPreview, "Prepared Recovery");

  for (const missing of ["manifest", "json"]) {
    process.env.FOSU_CATALOG_PREVIEW_TTL_MS = CRASH_PREVIEW_TTL_MS;
    const name = `Partial Backup ${missing}`;
    const preview = catalog.previewImport(recoveryDocument(name));
    catalogRepository.createBackup = (...args) => {
      const made = originalCreateBackup(...args);
      fs.unlinkSync(missing === "manifest" ? made.manifestPath : made.path);
      throw Object.assign(new Error(`injected ${missing}-missing backup pair`), { code: "INJECTED_PARTIAL_BACKUP" });
    };
    try {
      assert.throws(() => catalog.applyImport(preview.previewId, { ifMatch: preview.baseVersion, confirm: true }), /injected .*missing backup pair/);
    } finally { catalogRepository.createBackup = originalCreateBackup; }
    assert.strictEqual(catalogImportService.readOperation(preview.previewId).state, "prepared");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, CRASH_SETTLE_MS);
    applyExpectingRecoveryConflict(preview);
    assertRecoveredOperation(preview, name);
  }

  const originalCommit = catalogRepository.commitPlannedGeneration;
  for (const boundary of ["before-manifest", "after-manifest", "before-rename"]) {
    process.env.FOSU_CATALOG_PREVIEW_TTL_MS = CRASH_PREVIEW_TTL_MS;
    const name = `Building Recovery ${boundary}`;
    // Create preview immediately before apply to minimize wall-clock gap on slow CI.
    catalogRepository.commitPlannedGeneration = (plan) => {
      const building = path.join(catalogRepository.CATALOG_STAGING_DIR, `.building-${plan.generationId}-${plan.manifest.operationId}`);
      fs.mkdirSync(building, { recursive: false });
      const ownerPath = path.join(building, ".owner.json");
      fs.writeFileSync(ownerPath, `${JSON.stringify({ schemaVersion: 1, generationId: plan.generationId, operationId: plan.manifest.operationId })}\n`, "utf8");
      const types = Object.keys(catalogRepository.FILE_NAMES);
      const writtenTypes = boundary === "before-manifest" ? types.slice(0, 2) : types;
      for (const type of writtenTypes) fs.writeFileSync(path.join(building, catalogRepository.FILE_NAMES[type]), plan.bytes[type]);
      if (boundary !== "before-manifest") fs.writeFileSync(path.join(building, "manifest.json"), `${JSON.stringify(plan.manifest, null, 2)}\n`, "utf8");
      if (boundary === "before-rename") fs.unlinkSync(ownerPath);
      throw Object.assign(new Error(`injected generation crash ${boundary}`), { code: "INJECTED_BUILD_CRASH" });
    };
    const preview = catalog.previewImport(recoveryDocument(name));
    try {
      assert.throws(() => catalog.applyImport(preview.previewId, { ifMatch: preview.baseVersion, confirm: true }), /injected generation crash/);
    } finally { catalogRepository.commitPlannedGeneration = originalCommit; }
    assert.strictEqual(catalogImportService.readOperation(preview.previewId).state, "backup_verified");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, CRASH_SETTLE_MS);
    applyExpectingRecoveryConflict(preview);
    const operation = assertRecoveredOperation(preview, name);
    const committed = catalogRepository.readGeneration(operation.result.generationId);
    assert.strictEqual(committed.files.teacher.rawSha256, operation.result.rawSha256);
    assert.strictEqual(committed.files.teacher.logicalSha256, operation.result.logicalSha256);
    assert.strictEqual(committed.files.teacher.version, operation.result.version);
  }

  process.env.FOSU_CATALOG_PREVIEW_TTL_MS = "600000";
  const auditFailurePreview = catalog.previewImport(recoveryDocument("Audit Recovery"));
  const originalAppendCatalog = adminAuditService.appendCatalogOperation;
  adminAuditService.appendCatalogOperation = () => { throw Object.assign(new Error("injected audit unavailable"), { code: "ADMIN_AUDIT_LOCK_TIMEOUT" }); };
  let pending;
  try {
    pending = catalog.applyImport(auditFailurePreview.previewId, { ifMatch: auditFailurePreview.baseVersion, confirm: true });
    assert.strictEqual(pending.committed, true);
    assert.strictEqual(pending.auditPending, true);
    assert.strictEqual(catalogAuditEvents(pending.operationId).length, 0);
    const blocked = catalog.previewImport(recoveryDocument("Blocked By Audit"));
    expectCatalogError(() => catalog.applyImport(blocked.previewId, { ifMatch: blocked.baseVersion, confirm: true }), "CATALOG_AUDIT_PENDING", 503);
  } finally { adminAuditService.appendCatalogOperation = originalAppendCatalog; }
  const reconciled = catalog.applyImport(auditFailurePreview.previewId, { ifMatch: auditFailurePreview.baseVersion, confirm: true });
  assert.strictEqual(reconciled.reconciled, true);
  assert.strictEqual(reconciled.auditPending, false);
  assert.strictEqual(catalogAuditEvents(reconciled.operationId).length, 1);
  assert.strictEqual(catalogImportService.readOperation(auditFailurePreview.previewId).state, "complete");

  const auditJournalPreview = catalog.previewImport(recoveryDocument("Audit Journal Recovery"));
  const operationPath = path.join(catalogImportService.CATALOG_OPERATIONS_DIR, `${catalogImportService.operationIdFor(auditJournalPreview.previewId)}.json`);
  const originalRename = fs.renameSync;
  let injectedAuditTransition = false;
  fs.renameSync = (from, to) => {
    if (!injectedAuditTransition && path.resolve(to) === path.resolve(operationPath)) {
      try {
        const candidate = JSON.parse(fs.readFileSync(from, "utf8"));
        if (candidate.state === "audit_committed") {
          injectedAuditTransition = true;
          throw Object.assign(new Error("injected after audit append"), { code: "INJECTED_AUDIT_JOURNAL_FAILURE" });
        }
      } catch (error) {
        if (error && error.code === "INJECTED_AUDIT_JOURNAL_FAILURE") throw error;
      }
    }
    return originalRename(from, to);
  };
  try {
    pending = catalog.applyImport(auditJournalPreview.previewId, { ifMatch: auditJournalPreview.baseVersion, confirm: true });
    assert.strictEqual(pending.auditPending, true);
    assert.strictEqual(catalogAuditEvents(pending.operationId).length, 1, "audit append before journal failure must be durable");
  } finally { fs.renameSync = originalRename; }
  const journalReconciled = catalog.applyImport(auditJournalPreview.previewId, { ifMatch: auditJournalPreview.baseVersion, confirm: true });
  assert.strictEqual(journalReconciled.auditPending, false);
  assert.strictEqual(catalogAuditEvents(journalReconciled.operationId).length, 1, "journal recovery must deduplicate the prior audit append");
  delete process.env.FOSU_CATALOG_PREVIEW_TTL_MS;
}

function runAuditChild(program) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", program], {
      env: { ...process.env, FOSU_DATA_DIR: process.env.FOSU_DATA_DIR },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`audit child exited ${code}: ${errors}`));
      resolve(output);
    });
  });
}

async function assertUnifiedAdminAuditProtocol() {
  const routesSource = fs.readFileSync(path.join(__dirname, "../server/src/routes/admin.js"), "utf8");
  const finalizeSource = fs.readFileSync(path.join(__dirname, "../server/src/services/stagingFinalizeService.js"), "utf8");
  const publishSource = fs.readFileSync(path.join(__dirname, "../server/src/services/stagingPublishService.js"), "utf8");
  const importSource = fs.readFileSync(path.join(__dirname, "../server/src/modules/catalog/importService.js"), "utf8");
  assert.ok(!routesSource.includes("function appendCatalogAuditOnce"), "routes must not own a second Catalog audit protocol");
  assert.ok(!routesSource.includes("fs.appendFileSync(AUDIT_LOG_PATH"), "route audit writes must use the shared service");
  assert.ok(!finalizeSource.includes("fs.appendFileSync(AUDIT_LOG_PATH"), "staging finalize audit writes must use the shared service");
  assert.ok(!publishSource.includes("fs.appendFileSync(AUDIT_LOG_PATH"), "staging publish audit writes must use the shared service");
  assert.ok(importSource.includes("adminAuditService.appendCatalogOperation"), "Catalog apply must own a non-optional durable audit dependency");
  assert.ok(!importSource.includes("typeof options.audit"), "Catalog audit durability must not depend on an optional route callback");

  fs.mkdirSync(path.dirname(adminAuditService.AUDIT_LOG_PATH), { recursive: true });
  fs.writeFileSync(adminAuditService.AUDIT_LOG_PATH, `${JSON.stringify({ action: "seed-audit" })}\n{\"partial\"`, "utf8");
  const readyDir = path.join(tmp, "audit-ready");
  const goPath = path.join(tmp, "audit-go");
  fs.mkdirSync(readyDir, { recursive: true });
  const servicePath = path.resolve(__dirname, "../server/src/services/adminAuditService");
  const genericProgram = `
    const fs = require("fs");
    const path = require("path");
    const service = require(${JSON.stringify(servicePath)});
    fs.writeFileSync(path.join(${JSON.stringify(readyDir)}, "generic"), "ready");
    const pause = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(${JSON.stringify(goPath)})) Atomics.wait(pause, 0, 0, 10);
    service.append({ action: "generic-concurrent", module: "settings" });
  `;
  const catalogProgram = `
    const fs = require("fs");
    const path = require("path");
    const service = require(${JSON.stringify(servicePath)});
    fs.writeFileSync(path.join(${JSON.stringify(readyDir)}, "catalog"), "ready");
    const pause = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(${JSON.stringify(goPath)})) Atomics.wait(pause, 0, 0, 10);
    service.appendCatalogOperation({ operationId: "catop_audit_protocol", type: "teacher", previewIdPrefix: "preview", sourceFingerprint: "sha", baseVersion: "v1", resultVersion: "v2", generationId: "generation", summary: { added: 1 }, backupId: "backup", identity: {} });
  `;
  const generic = runAuditChild(genericProgram);
  const catalogAppend = runAuditChild(catalogProgram);
  await waitFor(() => fs.readdirSync(readyDir).length === 2);
  fs.writeFileSync(goPath, "go", "utf8");
  await Promise.all([generic, catalogAppend]);
  const lines = fs.readFileSync(adminAuditService.AUDIT_LOG_PATH, "utf8").trim().split(/\r?\n/);
  const events = lines.map(JSON.parse);
  assert.strictEqual(events.filter((entry) => entry.action === "seed-audit").length, 1, "tail repair must retain committed events");
  assert.strictEqual(events.filter((entry) => entry.action === "generic-concurrent").length, 1, "generic audit event must not be lost");
  assert.strictEqual(events.filter((entry) => entry.operationId === "catop_audit_protocol").length, 1, "Catalog audit event must be exactly once");
  assert.ok(!fs.readFileSync(adminAuditService.AUDIT_LOG_PATH, "utf8").includes("partial"), "malformed partial tail must be removed under the shared lock");
}

function spawnCatalogApplyRacer(label, preview, readyDir, goPath) {
  const servicePath = path.resolve(__dirname, "../server/src/modules/catalog/service");
  const program = `
    const fs = require("fs");
    const path = require("path");
    const service = require(${JSON.stringify(servicePath)});
    fs.writeFileSync(path.join(${JSON.stringify(readyDir)}, ${JSON.stringify(label)}), "ready");
    const pause = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(${JSON.stringify(goPath)})) Atomics.wait(pause, 0, 0, 5);
    try {
      const result = service.applyImport(${JSON.stringify(preview.previewId)}, { ifMatch: ${JSON.stringify(preview.baseVersion)}, confirm: true, auditContext: { operator: ${JSON.stringify(label)} } });
      process.stdout.write(JSON.stringify({ ok: true, operationId: result.operationId, generationId: result.generationId }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error.code, statusCode: error.statusCode }));
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", program], { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`catalog racer ${label} exited ${code}: ${errors}`));
      resolve(JSON.parse(output));
    });
  });
}

function spawnCatalogReadRacer(label, readyDir, goPath) {
  const servicePath = path.resolve(__dirname, "../server/src/modules/catalog/service");
  const program = `
    const fs = require("fs");
    const path = require("path");
    const service = require(${JSON.stringify(servicePath)});
    fs.writeFileSync(path.join(${JSON.stringify(readyDir)}, ${JSON.stringify(label)}), "ready");
    const pause = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(${JSON.stringify(goPath)})) Atomics.wait(pause, 0, 0, 5);
    try {
      const result = service.listResources({ type: "class", page: 1, pageSize: 1 });
      process.stdout.write(JSON.stringify({ ok: true, generationId: result.generationId, id: result.items[0].id }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error.code, statusCode: error.statusCode, message: error.message }));
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", program], { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`catalog read racer ${label} exited ${code}: ${errors}`));
      resolve(JSON.parse(output));
    });
  });
}

async function assertCrossProcessCatalogBootstrap() {
  seedCatalogFixture();
  const auditBefore = fs.existsSync(adminAuditService.AUDIT_LOG_PATH) ? fs.readFileSync(adminAuditService.AUDIT_LOG_PATH, "utf8").split(/\r?\n/).filter(Boolean).length : 0;
  const readyDir = path.join(tmp, "catalog-bootstrap-race");
  const goPath = path.join(tmp, "catalog-bootstrap-race-go");
  fs.mkdirSync(readyDir, { recursive: true });
  const left = spawnCatalogReadRacer("left", readyDir, goPath);
  const right = spawnCatalogReadRacer("right", readyDir, goPath);
  await waitFor(() => fs.readdirSync(readyDir).length === 2);
  fs.writeFileSync(goPath, "go");
  const results = await Promise.all([left, right]);
  assert.ok(results.every((result) => result.ok), JSON.stringify(results));
  assert.strictEqual(new Set(results.map((result) => result.generationId)).size, 1, "concurrent first readers must converge on one immutable generation");
  assert.strictEqual(fs.readdirSync(catalogRepository.GENERATIONS_DIR).length, 1, "bootstrap race must publish exactly one generation");
  assert.strictEqual(fs.existsSync(catalogRepository.BOOTSTRAP_JOURNAL_PATH), false);
  assert.strictEqual(fs.existsSync(path.join(process.env.FOSU_DATA_DIR, "catalog-control", ".integrity-key")), false, "bootstrap reads must not create import integrity state");
  const auditAfter = fs.existsSync(adminAuditService.AUDIT_LOG_PATH) ? fs.readFileSync(adminAuditService.AUDIT_LOG_PATH, "utf8").split(/\r?\n/).filter(Boolean).length : 0;
  assert.strictEqual(auditAfter, auditBefore, "bootstrap reads must not append mutation audit events");
}

async function assertCrossProcessCatalogApply() {
  seedCatalogFixture();
  const document = recoveryDocument("Cross Process Teacher");
  for (const mode of ["changed", "no-op"]) {
    const preview = catalog.previewImport(document);
    if (mode === "changed") assert.strictEqual(preview.summary.added, 1);
    else assert.strictEqual(preview.summary.unchanged, 1);
    const readyDir = path.join(tmp, `catalog-race-${mode}`);
    const goPath = path.join(tmp, `catalog-race-${mode}-go`);
    fs.mkdirSync(readyDir, { recursive: true });
    const left = spawnCatalogApplyRacer(`${mode}-left`, preview, readyDir, goPath);
    const right = spawnCatalogApplyRacer(`${mode}-right`, preview, readyDir, goPath);
    await waitFor(() => fs.readdirSync(readyDir).length === 2);
    fs.writeFileSync(goPath, "go");
    const results = await Promise.all([left, right]);
    assert.strictEqual(results.filter((result) => result.ok).length, 1, `${mode} preview must have exactly one cross-process winner`);
    assert.strictEqual(results.filter((result) => result.code === "PREVIEW_REPLAYED" && result.statusCode === 409).length, 1, `${mode} preview loser must be a deterministic replay`);
    const winner = results.find((result) => result.ok);
    assert.strictEqual(catalogAuditEvents(winner.operationId).length, 1, `${mode} race must append exactly one audit event`);
    const backups = fs.readdirSync(path.join(process.env.FOSU_DATA_DIR, "backups")).filter((name) => name.includes(winner.operationId));
    assert.deepStrictEqual(backups.sort(), [`catalog-import-teacher-${winner.operationId}.json`, `catalog-import-teacher-${winner.operationId}.manifest`].sort());
  }
}

const q1 = quality.listIgnores();
const marked = quality.markIgnore(
  { fingerprint: "missingTeacher::x", category: "missingTeacher", reason: "known" },
  { expectedVersion: q1.version, requireIfMatch: true }
);
assert.ok(marked.version);
const unmarked = quality.unmarkIgnore("missingTeacher::x", {
  expectedVersion: marked.version,
  requireIfMatch: true,
});
assert.ok(unmarked.version);

// Task 3 quality contract: a versioned rule partitions the report, recovery
// returns the anomaly to active, and legacy arrays remain read-only until write.
fs.writeFileSync(path.join(process.env.FOSU_STORAGE_DIR, "class-schedules.json"), JSON.stringify([
  { className: "C1", courses: [] },
  { className: "C2", courses: [{ weeks: [], sections: [] }] },
], null, 2));
fs.writeFileSync(path.join(process.env.FOSU_STORAGE_DIR, "teacher-schedules.json"), "[]");
fs.writeFileSync(path.join(process.env.FOSU_STORAGE_DIR, "classroom-schedules.json"), JSON.stringify([{
  roomName: "",
  courses: [
    { weeks: [1], sections: [1], teacherName: "A", className: "A" },
    { weeks: [1], sections: [1], teacherName: "B", className: "B" },
  ],
}], null, 2));
fs.writeFileSync(path.join(process.env.FOSU_STORAGE_DIR, "quality-ignores.json"), JSON.stringify({
  version: "qi_seed",
  updatedAt: "2026-07-18T00:00:00.000Z",
  rules: [{
    id: "seed-rule",
    fingerprint: "empty-schedule::C1",
    reason: "known empty class",
    category: "empty-schedule",
    severity: "warning",
    createdAt: "2026-07-18T00:00:00.000Z",
    ignored: true,
  }, {
    id: "legacy-missing-teacher",
    fingerprint: "missing-teacher::C2:undefined",
    reason: "legacy undefined target",
    category: "missing-teacher",
    createdAt: "2026-07-18T00:00:00.000Z",
    ignored: true,
  }],
}, null, 2));

const report = quality.buildQualityReport();
assert.ok(report.generatedAt);
assert.strictEqual(report.active.some((item) => item.fingerprint === "empty-schedule::C1"), false);
const ignoredAnomaly = report.ignored.find((item) => item.fingerprint === "empty-schedule::C1");
assert.ok(ignoredAnomaly, "versioned ignored anomaly must be reported in ignored");
assert.strictEqual(ignoredAnomaly.reason, "known empty class");
assert.strictEqual(ignoredAnomaly.status, "ignored");
assert.strictEqual(ignoredAnomaly.rule.category, "empty-schedule");
assert.ok(report.ignored.some((item) => item.fingerprint === "missing-teacher::C2:undefined"), "legacy undefined target must still match its ignore");
assert.strictEqual(report.active.some((item) => item.type === "classroom-conflict"), false, "blank classroom names must remain skipped");
assert.strictEqual(report.summary.activeCount + report.summary.ignoredCount, report.summary.totalCount);
assert.strictEqual(report.stats, report.summary, "legacy stats alias must retain the canonical summary");
assert.strictEqual(report.anomalies, report.active, "legacy anomalies alias must expose active anomalies only");

const seeded = quality.listIgnores();
const recovered = quality.unmarkIgnore("empty-schedule::C1", {
  expectedVersion: seeded.version,
  requireIfMatch: true,
});
assert.ok(recovered.version);
const recoveredReport = quality.buildQualityReport();
assert.ok(recoveredReport.active.some((item) => item.fingerprint === "empty-schedule::C1"));
let staleRecovery = null;
try {
  quality.unmarkIgnore("empty-schedule::C1", { expectedVersion: seeded.version, requireIfMatch: true });
} catch (error) {
  staleRecovery = error;
}
assert.ok(staleRecovery && staleRecovery.statusCode === 409 && staleRecovery.currentVersion);

const legacyRules = [{ type: "empty-schedule", target: "Legacy" }];
fs.writeFileSync(path.join(process.env.FOSU_STORAGE_DIR, "quality-ignores.json"), JSON.stringify(legacyRules, null, 2));
const legacy = quality.listIgnores();
assert.deepStrictEqual(legacy.rules, legacyRules);
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(process.env.FOSU_STORAGE_DIR, "quality-ignores.json"), "utf8")).length, 1);
quality.markIgnore({ fingerprint: "empty-schedule::Legacy", reason: "migrate" }, {
  expectedVersion: legacy.version,
  requireIfMatch: true,
});
assert.ok(Array.isArray(JSON.parse(fs.readFileSync(path.join(process.env.FOSU_STORAGE_DIR, "quality-ignores.json"), "utf8")).rules));

const malformedIgnorePath = path.join(process.env.FOSU_STORAGE_DIR, "quality-ignores.json");
const malformedBytes = '{"rules":';
fs.writeFileSync(malformedIgnorePath, malformedBytes, "utf8");
assert.throws(() => quality.listIgnores(), (error) => error && error.statusCode === 500 && error.code === "QUALITY_IGNORES_MALFORMED");
assert.throws(() => quality.markIgnore({ fingerprint: "empty-schedule::malformed" }), (error) => error && error.code === "QUALITY_IGNORES_MALFORMED");
assert.strictEqual(fs.readFileSync(malformedIgnorePath, "utf8"), malformedBytes, "malformed file must remain byte-identical");

fs.writeFileSync(malformedIgnorePath, JSON.stringify({ version: "qi_replace_seed", updatedAt: null, rules: [] }, null, 2));
const beforeReplaceFailure = fs.readFileSync(malformedIgnorePath, "utf8");
const originalRename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (path.resolve(to) === path.resolve(malformedIgnorePath)) {
    const error = new Error("injected rename failure");
    error.code = "EACCES";
    throw error;
  }
  return originalRename(from, to);
};
try {
  assert.throws(
    () => quality.markIgnore({ fingerprint: "empty-schedule::replace-failure", reason: "must not overwrite" }),
    (error) => error && error.statusCode === 500 && error.code === "QUALITY_IGNORES_REPLACE_FAILED"
  );
} finally {
  fs.renameSync = originalRename;
}
assert.strictEqual(fs.readFileSync(malformedIgnorePath, "utf8"), beforeReplaceFailure, "rename failure must preserve original bytes");

const lockPath = `${malformedIgnorePath}.lock`;
const originalLockWrite = fs.writeFileSync;
let injectedLockWrite = false;
fs.writeFileSync = (target, ...args) => {
  if (!injectedLockWrite && path.resolve(target) === path.resolve(lockPath)) {
    injectedLockWrite = true;
    const error = new Error("injected lock write failure");
    error.code = "EIO";
    throw error;
  }
  return originalLockWrite(target, ...args);
};
try {
  assert.throws(
    () => quality.markIgnore({ fingerprint: "empty-schedule::lock-write", reason: "lock write" }),
    (error) => error && error.code === "QUALITY_IGNORES_LOCK_FAILED"
  );
} finally {
  fs.writeFileSync = originalLockWrite;
}
assert.strictEqual(fs.existsSync(lockPath), false, "failed lock initialization must not strand the canonical lock");
assert.doesNotThrow(() => quality.markIgnore({ fingerprint: "empty-schedule::after-lock-write", reason: "acquire immediately" }));

const foreignLockBytes = JSON.stringify({ pid: process.pid, token: "foreign-lock-token", instanceId: "foreign-instance", createdAt: new Date().toISOString() });
fs.writeFileSync(lockPath, foreignLockBytes, "utf8");
fs.writeFileSync = (target, ...args) => {
  if (path.resolve(target) === path.resolve(lockPath)) {
    const error = new Error("injected non-EEXIST lock write failure");
    error.code = "EACCES";
    throw error;
  }
  return originalLockWrite(target, ...args);
};
try {
  assert.throws(
    () => quality.markIgnore({ fingerprint: "empty-schedule::foreign-lock-write", reason: "must not delete another owner" }),
    (error) => error && error.code === "QUALITY_IGNORES_LOCK_FAILED"
  );
} finally {
  fs.writeFileSync = originalLockWrite;
}
assert.strictEqual(fs.readFileSync(lockPath, "utf8"), foreignLockBytes, "a non-EEXIST write failure must not delete an unverified canonical lock");
fs.unlinkSync(lockPath);

const originalLockUnlink = fs.unlinkSync;
let injectedLockUnlink = false;
fs.unlinkSync = (target, ...args) => {
  if (!injectedLockUnlink && path.resolve(target) === path.resolve(lockPath)) {
    injectedLockUnlink = true;
    const error = new Error("injected lock unlink failure");
    error.code = "EBUSY";
    throw error;
  }
  return originalLockUnlink(target, ...args);
};
try {
  assert.doesNotThrow(() => quality.markIgnore({ fingerprint: "empty-schedule::lock-unlink", reason: "release retry" }));
} finally {
  fs.unlinkSync = originalLockUnlink;
}
assert.strictEqual(fs.existsSync(lockPath), false, "release retry must remove the canonical lock");
assert.doesNotThrow(() => quality.markIgnore({ fingerprint: "empty-schedule::after-lock-unlink", reason: "acquire after release" }));

const originalLockRead = fs.readFileSync;
let lockReadFailures = 0;
fs.readFileSync = (target, ...args) => {
  if (path.resolve(target) === path.resolve(lockPath) && lockReadFailures < 2) {
    lockReadFailures += 1;
    const error = new Error("injected lock read failure");
    error.code = "EIO";
    throw error;
  }
  return originalLockRead(target, ...args);
};
let readRecovery;
try {
  readRecovery = quality.markIgnore({ fingerprint: "empty-schedule::lock-read", reason: "retire after unreadable lock" });
} finally {
  fs.readFileSync = originalLockRead;
}
assert.ok(readRecovery.lockWarning && readRecovery.lockWarning.code === "QUALITY_IGNORES_LOCK_RELEASE_FAILED", "unreadable owned lock must surface a non-secret warning after commit");
assert.strictEqual(fs.existsSync(lockPath), false, "unreadable owned lock must be retired");
assert.doesNotThrow(() => quality.markIgnore({ fingerprint: "empty-schedule::after-lock-read", reason: "acquire after read recovery" }));

const originalPersistentUnlink = fs.unlinkSync;
const originalPersistentRename = fs.renameSync;
fs.unlinkSync = (target, ...args) => {
  if (path.resolve(target) === path.resolve(lockPath)) {
    const error = new Error("persistent Windows unlink failure");
    error.code = "EBUSY";
    throw error;
  }
  return originalPersistentUnlink(target, ...args);
};
fs.renameSync = (from, to) => {
  if (path.resolve(from) === path.resolve(lockPath)) {
    const error = new Error("persistent Windows rename failure");
    error.code = "EACCES";
    throw error;
  }
  return originalPersistentRename(from, to);
};
let persistentRelease;
try {
  persistentRelease = quality.markIgnore({ fingerprint: "empty-schedule::persistent-release", reason: "committed despite release failure" });
} finally {
  fs.unlinkSync = originalPersistentUnlink;
  fs.renameSync = originalPersistentRename;
}
assert.ok(persistentRelease.lockWarning && persistentRelease.lockWarning.code === "QUALITY_IGNORES_LOCK_RELEASE_FAILED", "persistent release failure must report a committed warning");
const originalLockStat = fs.statSync;
fs.statSync = (target, ...args) => {
  if (path.resolve(target) === path.resolve(lockPath)) {
    const error = new Error("injected lock identity failure");
    error.code = "EIO";
    throw error;
  }
  return originalLockStat(target, ...args);
};
try {
  assert.throws(
    () => quality.markIgnore({ fingerprint: "empty-schedule::null-lock-identity", reason: "must not claim null identity" }),
    (error) => error && error.code === "QUALITY_IGNORES_LOCK_TIMEOUT" && error.statusCode === 503
  );
} finally {
  fs.statSync = originalLockStat;
}
assert.strictEqual(fs.existsSync(lockPath), true, "null lock identity must not prove ownership of an abandoned canonical lock");
assert.doesNotThrow(() => quality.markIgnore({ fingerprint: "empty-schedule::after-persistent-release", reason: "owner recovery" }), "same-process abandoned lock must be recoverable without a lease takeover");

fs.writeFileSync(lockPath, JSON.stringify({
  pid: process.pid,
  token: "prior-container-token",
  instanceId: "prior-container-instance",
  createdAt: "1970-01-01T00:00:00.000Z",
}), "utf8");
assert.doesNotThrow(() => quality.markIgnore({ fingerprint: "empty-schedule::after-container-recreate", reason: "prior instance recovery" }), "a known prior-instance same-PID lock must not permanently block a recreated container");

fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999999, token: "dead-owner", instanceId: "dead-owner", createdAt: new Date().toISOString() }), "utf8");
assert.doesNotThrow(() => quality.markIgnore({ fingerprint: "empty-schedule::after-dead-owner", reason: "dead pid recovery" }), "dead PID locks must remain recoverable");
const malformedLockVariants = [
  ["empty object", "{}"],
  ["array", "[]"],
  ["invalid pid", JSON.stringify({ pid: 0, token: "invalid-pid", instanceId: "invalid-pid", createdAt: new Date().toISOString() })],
  ["empty token", JSON.stringify({ pid: process.pid, token: "", instanceId: "invalid-token", createdAt: new Date().toISOString() })],
  ["empty instance ID", JSON.stringify({ pid: process.pid, token: "invalid-instance", instanceId: "", createdAt: new Date().toISOString() })],
  ["invalid date", JSON.stringify({ pid: process.pid, token: "invalid-date", instanceId: "invalid-date", createdAt: "not-a-date" })],
  ["non-JSON", "not-json"],
];
for (const [label, bytes] of malformedLockVariants) {
  fs.writeFileSync(lockPath, bytes, "utf8");
  assert.throws(
    () => quality.markIgnore({ fingerprint: `empty-schedule::fresh-malformed-${label}`, reason: "fresh malformed lock" }),
    (error) => error && error.code === "QUALITY_IGNORES_LOCK_TIMEOUT" && error.statusCode === 503,
    `fresh ${label} metadata must fail closed`
  );
  assert.strictEqual(fs.readFileSync(lockPath, "utf8"), bytes, `fresh ${label} metadata must remain byte-identical`);
  const staleAt = new Date(Date.now() - 60 * 1000);
  fs.utimesSync(lockPath, staleAt, staleAt);
  assert.doesNotThrow(
    () => quality.markIgnore({ fingerprint: `empty-schedule::stale-malformed-${label}`, reason: "stale malformed recovery" }),
    `stale ${label} metadata must be recoverable`
  );
}

function waitFor(condition, timeoutMs = 3000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error("timed out waiting for cross-process writer"));
      setTimeout(check, 10);
    };
    check();
  });
}

function spawnCasWriter(label, repositoryPath, readyDir, goPath) {
  const program = `
    const fs = require("fs");
    const repository = require(${JSON.stringify(path.resolve(__dirname, "../server/src/modules/quality/repository"))});
    const doc = repository.readIgnoreDocument();
    const prepared = repository.prepareIgnoreMutation({ action: "mark", fingerprint: "empty-schedule::${label}", reason: "cas" }, { expectedVersion: doc.version, requireIfMatch: true });
    fs.writeFileSync(${JSON.stringify(path.join(tmp, "ready-"))} + process.pid, ${JSON.stringify(label)});
    const pause = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(${JSON.stringify(goPath)})) Atomics.wait(pause, 0, 0, 10);
    try {
      const result = repository.commitPreparedIgnoreMutation(prepared);
      process.stdout.write(JSON.stringify({ ok: true, version: result.version }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error.code, statusCode: error.statusCode }));
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", program], {
      env: { ...process.env, FOSU_STORAGE_DIR: process.env.FOSU_STORAGE_DIR },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`cas writer ${label} exited ${code}: ${errors}`));
      resolve(JSON.parse(output));
    });
  });
}

async function assertCrossProcessCas() {
  fs.writeFileSync(malformedIgnorePath, JSON.stringify({ version: "qi_cas_seed", updatedAt: null, rules: [] }, null, 2));
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: 2147483647,
    token: "dead-owner-race",
    instanceId: "dead-owner-race",
    createdAt: "2020-01-01T00:00:00.000Z",
  }), "utf8");
  const staleAt = new Date(Date.now() - 60 * 1000);
  fs.utimesSync(lockPath, staleAt, staleAt);
  const goPath = path.join(tmp, "cas-go");
  const left = spawnCasWriter("left", null, tmp, goPath);
  const right = spawnCasWriter("right", null, tmp, goPath);
  await waitFor(() => fs.readdirSync(tmp).filter((name) => name.startsWith("ready-")).length === 2);
  fs.writeFileSync(goPath, "go");
  const results = await Promise.all([left, right]);
  assert.strictEqual(results.filter((result) => result.ok).length, 1, "exactly one process must commit");
  assert.strictEqual(results.filter((result) => result.code === "CONFLICT" && result.statusCode === 409).length, 1, "the losing process must report 409 conflict");
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(malformedIgnorePath, "utf8")), "CAS output must remain parseable JSON");
  assert.strictEqual(fs.existsSync(lockPath), false, "two stale-lock reclaimers must not strand or retire a live successor lock");
  assert.strictEqual(fs.existsSync(`${lockPath}.reclaim`), false, "successful reclamation must release its short-lived guard");
}

function spawnReclaimRacer(label, targetPath, raceLockPath, readyDir, goPath, releasePath) {
  const lockServicePath = path.resolve(__dirname, "../server/src/services/exclusiveFileLockService");
  const program = `
    const fs = require("fs");
    const path = require("path");
    const { acquireExclusiveFileLock } = require(${JSON.stringify(lockServicePath)});
    fs.writeFileSync(path.join(${JSON.stringify(readyDir)}, "ready-${label}"), "ready");
    const pause = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(${JSON.stringify(goPath)})) Atomics.wait(pause, 0, 0, 5);
    try {
      const release = acquireExclusiveFileLock(${JSON.stringify(targetPath)}, { lockPath: ${JSON.stringify(raceLockPath)}, codePrefix: "RECLAIM_RACE", waitMs: 70, staleMs: 20 });
      fs.writeFileSync(path.join(${JSON.stringify(readyDir)}, "entered-${label}"), "entered");
      while (!fs.existsSync(${JSON.stringify(releasePath)})) Atomics.wait(pause, 0, 0, 5);
      release();
      process.stdout.write(JSON.stringify({ ok: true }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error.code, statusCode: error.statusCode }));
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", program], { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`reclaim racer ${label} exited ${code}: ${errors}`));
      resolve(JSON.parse(output));
    });
  });
}

async function assertTwoReclaimersCannotRetireLiveReplacement() {
  const readyDir = path.join(tmp, "reclaim-race");
  const targetPath = path.join(tmp, "reclaim-target");
  const raceLockPath = `${targetPath}.lock`;
  const goPath = path.join(tmp, "reclaim-go");
  const releasePath = path.join(tmp, "reclaim-release");
  fs.mkdirSync(readyDir, { recursive: true });
  fs.writeFileSync(raceLockPath, JSON.stringify({ pid: 2147483647, token: "dead-race-owner", instanceId: "dead-race-owner", createdAt: "2020-01-01T00:00:00.000Z" }), "utf8");
  const staleAt = new Date(Date.now() - 60 * 1000);
  fs.utimesSync(raceLockPath, staleAt, staleAt);
  const left = spawnReclaimRacer("left", targetPath, raceLockPath, readyDir, goPath, releasePath);
  const right = spawnReclaimRacer("right", targetPath, raceLockPath, readyDir, goPath, releasePath);
  try {
    await waitFor(() => fs.readdirSync(readyDir).filter((name) => name.startsWith("ready-")).length === 2);
    fs.writeFileSync(goPath, "go");
    await waitFor(() => fs.readdirSync(readyDir).filter((name) => name.startsWith("entered-")).length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.strictEqual(fs.readdirSync(readyDir).filter((name) => name.startsWith("entered-")).length, 1, "a second stale-lock reclaimer must not retire the first racer\'s live replacement");
    fs.writeFileSync(releasePath, "release");
    const results = await Promise.all([left, right]);
    assert.strictEqual(results.filter((result) => result.ok).length, 1);
    assert.strictEqual(results.filter((result) => result.code === "RECLAIM_RACE_LOCK_TIMEOUT" && result.statusCode === 503).length, 1);
    assert.strictEqual(fs.existsSync(raceLockPath), false);
    assert.strictEqual(fs.existsSync(`${raceLockPath}.reclaim`), false);
  } finally {
    if (!fs.existsSync(releasePath)) fs.writeFileSync(releasePath, "release");
    await Promise.allSettled([left, right]);
  }
}

function runQualityChild(program, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", program], {
      env: { ...process.env, FOSU_STORAGE_DIR: process.env.FOSU_STORAGE_DIR, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`quality child exited ${code}: ${errors}`));
      resolve(JSON.parse(output));
    });
  });
}

async function assertLiveOwnerCannotBeReclaimed() {
  fs.writeFileSync(malformedIgnorePath, JSON.stringify({ version: "qi_live_seed", updatedAt: null, rules: [] }, null, 2));
  const readyPath = path.join(tmp, "live-owner-ready");
  const resumePath = path.join(tmp, "live-owner-resume");
  const repositoryPath = path.resolve(__dirname, "../server/src/modules/quality/repository");
  const ownerProgram = `
    const fs = require("fs");
    const repository = require(${JSON.stringify(repositoryPath)});
    const doc = repository.readIgnoreDocument();
    const prepared = repository.prepareIgnoreMutation({ action: "mark", fingerprint: "empty-schedule::live-owner", reason: "A" }, { expectedVersion: doc.version, requireIfMatch: true });
    const pause = new Int32Array(new SharedArrayBuffer(4));
    const result = repository.commitPreparedIgnoreMutation(prepared, { afterRead: () => {
      fs.writeFileSync(${JSON.stringify(readyPath)}, "ready");
      while (!fs.existsSync(${JSON.stringify(resumePath)})) Atomics.wait(pause, 0, 0, 10);
    }});
    process.stdout.write(JSON.stringify({ ok: true, version: result.version }));
  `;
  const owner = runQualityChild(ownerProgram, { FOSU_QUALITY_IGNORE_LOCK_LEASE_MS: "20" });
  try {
    await waitFor(() => fs.existsSync(readyPath));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const blockedProgram = `
      const repository = require(${JSON.stringify(repositoryPath)});
      const doc = repository.readIgnoreDocument();
      const prepared = repository.prepareIgnoreMutation({ action: "mark", fingerprint: "empty-schedule::blocked-writer", reason: "B" }, { expectedVersion: doc.version, requireIfMatch: true });
      try { repository.commitPreparedIgnoreMutation(prepared); process.stdout.write(JSON.stringify({ ok: true })); }
      catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.code, statusCode: error.statusCode })); }
    `;
    const blocked = await runQualityChild(blockedProgram, { FOSU_QUALITY_IGNORE_LOCK_WAIT_MS: "40", FOSU_QUALITY_IGNORE_LOCK_LEASE_MS: "20" });
    assert.deepStrictEqual(blocked, { ok: false, code: "QUALITY_IGNORES_LOCK_TIMEOUT", statusCode: 503 }, "a live owner must not be reclaimed after the old lease threshold");
    fs.writeFileSync(resumePath, "resume");
    await owner;
    const afterProgram = `
      const repository = require(${JSON.stringify(repositoryPath)});
      const doc = repository.readIgnoreDocument();
      const prepared = repository.prepareIgnoreMutation({ action: "mark", fingerprint: "empty-schedule::after-live-owner", reason: "B2" }, { expectedVersion: doc.version, requireIfMatch: true });
      try { const result = repository.commitPreparedIgnoreMutation(prepared); process.stdout.write(JSON.stringify({ ok: true, version: result.version })); }
      catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.code, statusCode: error.statusCode })); }
    `;
    const after = await runQualityChild(afterProgram);
    assert.strictEqual(after.ok, true, "a writer with the new version must commit after the live owner releases");
    const finalRules = JSON.parse(fs.readFileSync(malformedIgnorePath, "utf8")).rules;
    assert.ok(finalRules.some((rule) => rule.fingerprint === "empty-schedule::live-owner"));
    assert.ok(finalRules.some((rule) => rule.fingerprint === "empty-schedule::after-live-owner"));
    assert.strictEqual(finalRules.some((rule) => rule.fingerprint === "empty-schedule::blocked-writer"), false, "blocked writer must never overwrite the live owner");
  } finally {
    if (!fs.existsSync(resumePath)) fs.writeFileSync(resumePath, "resume");
    await owner.catch(() => {});
  }
}

assertCrossProcessCas().then(assertTwoReclaimersCannotRetireLiveReplacement).then(assertLiveOwnerCannotBeReclaimed).then(assertUnifiedAdminAuditProtocol).then(assertCrossProcessCatalogBootstrap).then(assertCrossProcessCatalogApply).then(() => {
  assertCatalogBootstrapCrashRecoveryContracts();
  assertCatalogReadContracts();
  assertCatalogImportContracts();
  assertCatalogCrashRecoveryContracts();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("Admin C1 modules tests passed.");
}).catch((error) => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.error(error.stack || error);
  process.exitCode = 1;
});
