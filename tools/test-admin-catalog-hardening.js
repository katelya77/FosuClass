const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-catalog-hardening-"));
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");
process.env.FOSU_CATALOG_LOCK_WAIT_MS = "80";
process.env.FOSU_ADMIN_AUDIT_LOCK_WAIT_MS = "80";

const { calculateFingerprint } = require("../server/src/utils/stagingFingerprint");
const catalog = require("../server/src/modules/catalog/service");
const durableStore = require("../server/src/modules/catalog/durableStore");
const repository = require("../server/src/modules/catalog/repository");
const importService = require("../server/src/modules/catalog/importService");

const TERM = "2025-2026-2";
const RELEASE_VERSION = "catalog-hardening-active-a";

function sha256(value) {
  return crypto.createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value)).digest("hex");
}

function course49(overrides = {}) {
  return {
    adminClass: "",
    audience: "",
    audienceType: "public",
    canonicalClassroom: "A101",
    canonicalCourseName: "Data Structures",
    canonicalTeacherName: "Teacher One",
    classId: "",
    className: "Class One",
    classNames: ["Class One"],
    classroom: "A101",
    collegeCode: "04",
    collegeName: "Engineering",
    color: "",
    courseIdentityType: "canonical",
    courseName: "Data Structures",
    displayClassroom: "A101",
    displayCourseName: "Data Structures",
    displayTeacherName: "Teacher One",
    endSection: 2,
    endWeek: 16,
    grade: "2025",
    id: "course-fixture-1",
    isPhysicalEducationLike: false,
    isTeacherFieldActuallyCourseName: false,
    isVenueCandidate: false,
    majorCode: "0401",
    majorName: "Software",
    normalizationReason: "fixture",
    originalClassName: "Class One",
    rawClassText: "Class One",
    rawClassroom: "A101",
    rawCourseName: "Data Structures",
    rawHtml: "<td>Data Structures</td>\r\n\t<td>A101</td>",
    rawTeacherName: "Teacher One",
    rawText: "Data Structures\r\nA101",
    remark: "",
    semester: TERM,
    source: "fixture",
    sourceClassNameUnreliable: false,
    sourceType: "html",
    startSection: 1,
    startWeek: 1,
    teacherName: "Teacher One",
    teachingClass: "",
    venueCandidates: ["A101"],
    weekText: "1-16",
    weekType: "all",
    weekday: 2,
    weeks: [1, 2, 3],
    ...overrides,
  };
}

function baseSnapshot(options = {}) {
  const teacherName = options.teacherName || "Active Teacher";
  const course = options.course || course49({ teacherName, canonicalTeacherName: teacherName, displayTeacherName: teacherName, rawTeacherName: teacherName });
  return {
    schemaVersion: 1,
    version: options.version || RELEASE_VERSION,
    releaseVersion: options.version || RELEASE_VERSION,
    term: TERM,
    semester: TERM,
    termStartDate: "2026-03-09",
    totalWeeks: 20,
    weekStart: "monday",
    updatedAt: "2026-07-19T00:00:00.000Z",
    catalog: {
      semesters: [{ value: TERM, label: TERM }],
      colleges: [{ code: "04", name: "Engineering" }],
      grades: ["2030", "2025"],
    },
    majors: [{ collegeCode: "04", collegeName: "Engineering", code: "0401", name: "Software", grade: "2025" }],
    classSchedules: [{
      className: "Class One",
      collegeCode: "04",
      collegeName: "Engineering",
      grade: "2025",
      majorCode: "0401",
      majorName: "Software",
      courses: [{ courseName: "Data Structures", teacherName, classroom: "A101", dayOfWeek: 2, startSection: 1, endSection: 2, sections: [1, 2], weeks: [1, 2, 3] }],
    }],
    resources: {
      teachers: [{ teacherName }],
      classrooms: [{ roomName: "A101" }],
      courses: [{ courseName: "Data Structures" }],
      teacherSchedules: [{ teacherName, courses: [course] }],
      classroomSchedules: [{ roomName: "A101", courses: [course] }],
      courseSchedules: [{ courseName: "Data Structures", courses: [course] }],
    },
  };
}

function nestedMajors(snapshot) {
  const colleges = new Map();
  for (const major of snapshot.majors) {
    const collegeCode = String(major.collegeCode || "").trim();
    let college = colleges.get(collegeCode);
    if (!college) {
      college = { collegeCode, collegeName: major.collegeName || "Engineering", grades: [] };
      colleges.set(collegeCode, college);
    }
    let grade = college.grades.find((entry) => entry.grade === String(major.grade));
    if (!grade) {
      grade = { grade: String(major.grade), majors: [] };
      college.grades.push(grade);
    }
    grade.majors.push({ majorCode: major.majorCode || major.code, majorName: major.majorName || major.name });
  }
  return {
    version: `release_${snapshot.version}`,
    semester: snapshot.term,
    grades: snapshot.catalog.grades.slice(),
    colleges: Array.from(colleges.values()),
  };
}

function writeLegacyFiles(snapshot, teacherName = "Legacy Teacher") {
  const storage = process.env.FOSU_STORAGE_DIR;
  const legacyCourse = { courseName: "Legacy Course", teacherName, classroom: "L101", weeks: [1], sections: [1] };
  const docs = {
    "catalog.json": snapshot.catalog,
    "majors-index.json": nestedMajors(snapshot),
    "class-schedules.json": [{ className: "Legacy Class", semester: TERM, collegeCode: "04", collegeName: "Engineering", grade: "2025", majorCode: "0401", majorName: "Software", courses: [legacyCourse] }],
    "teacher-schedules.json": [{ teacherName, semester: TERM, courses: [legacyCourse] }],
    "classroom-schedules.json": [{ roomName: "L101", semester: TERM, courses: [legacyCourse] }],
    "course-schedules.json": [{ courseName: "Legacy Course", semester: TERM, courses: [legacyCourse] }],
  };
  for (const [name, value] of Object.entries(docs)) fs.writeFileSync(path.join(storage, name), `${JSON.stringify(value, null, 2)}\n`);
}

function writeActiveRelease(snapshot, options = {}) {
  const releaseRoot = path.join(process.env.FOSU_STORAGE_DIR, "releases");
  const releaseDir = path.join(releaseRoot, snapshot.version);
  fs.mkdirSync(releaseDir, { recursive: true });
  const canonicalHash = calculateFingerprint(snapshot).canonicalHash;
  const snapshotBytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`);
  const manifest = {
    success: true,
    schemaVersion: 2,
    releaseVersion: snapshot.version,
    version: snapshot.version,
    term: snapshot.term,
    semester: snapshot.semester,
    canonicalHash: options.manifestCanonicalHash || canonicalHash,
    packHealth: { valid: options.manifestValid !== false, errors: options.manifestValid === false ? ["fixture invalid"] : [] },
  };
  fs.writeFileSync(path.join(releaseDir, "snapshot.json"), snapshotBytes);
  fs.writeFileSync(path.join(releaseDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const active = {
    version: snapshot.version,
    releaseVersion: snapshot.version,
    term: snapshot.term,
    semester: snapshot.semester,
    canonicalHash: options.activeCanonicalHash || canonicalHash,
    packStatus: { healthy: options.healthy !== false, manifestExists: true, manifestValid: true, hashValid: true, missing: [], hashErrors: [] },
  };
  fs.writeFileSync(path.join(releaseRoot, "active.json"), `${JSON.stringify(active, null, 2)}\n`);
  return { active, manifest, snapshotSha256: sha256(snapshotBytes) };
}

function resetFixture(options = {}) {
  fs.rmSync(process.env.FOSU_STORAGE_DIR, { recursive: true, force: true });
  fs.rmSync(process.env.FOSU_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(process.env.FOSU_STORAGE_DIR, { recursive: true });
  fs.mkdirSync(process.env.FOSU_DATA_DIR, { recursive: true });
  const snapshot = options.snapshot || baseSnapshot();
  writeLegacyFiles(snapshot, options.legacyTeacherName || "Legacy Teacher");
  if (options.active !== false) writeActiveRelease(snapshot, options.releaseOptions || {});
  return snapshot;
}

function expectCatalogError(fn, code, statusCode) {
  assert.throws(fn, (error) => error && error.code === code && (!statusCode || error.statusCode === statusCode));
}

const failures = [];
function test(name, fn) {
  try {
    fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push({ name, error });
    process.stderr.write(`FAIL ${name}: ${error.stack || error}\n`);
  }
}

test("bootstrap trusts only the coherent Active release and preserves 49-field courses", () => {
  const snapshot = resetFixture({ legacyTeacherName: "Legacy Only" });
  const result = catalog.listResources({ type: "teacher", page: 1, pageSize: 10 });
  assert.strictEqual(result.total, 1);
  assert.strictEqual(result.items[0].teacherName, "Active Teacher");
  const raw = JSON.parse(fs.readFileSync(catalog.getCatalogTargetPath("teacher"), "utf8"));
  assert.strictEqual(raw[0].semester, TERM, "a missing outer semester must be filled from one proven release term");
  assert.deepStrictEqual(Object.keys(raw[0].courses[0]).sort(), Object.keys(course49()).sort());
  assert.strictEqual(raw[0].courses[0].rawHtml, "<td>Data Structures</td>\n\t<td>A101</td>");
  assert.strictEqual(snapshot.resources.teacherSchedules[0].semester, undefined, "the immutable release source must not be mutated");
});

test("bootstrap rejects a tampered Active release before journal, generation, or pointer", () => {
  resetFixture({ releaseOptions: { manifestCanonicalHash: "0".repeat(64) } });
  expectCatalogError(() => catalog.listResources({ type: "teacher", page: 1, pageSize: 10 }), "CATALOG_RELEASE_SEED_INVALID", 503);
  assert.strictEqual(fs.existsSync(repository.CURRENT_GENERATION_PATH), false);
  assert.strictEqual(fs.existsSync(repository.BOOTSTRAP_JOURNAL_PATH), false);
  assert.strictEqual(fs.existsSync(repository.GENERATIONS_DIR), false);
});

test("bootstrap fails closed without a trusted Active release and never falls back to Legacy", () => {
  resetFixture({ active: false });
  expectCatalogError(() => catalog.listResources({ type: "teacher", page: 1, pageSize: 10 }), "CATALOG_RELEASE_SEED_UNAVAILABLE", 503);
  assert.strictEqual(fs.existsSync(repository.CURRENT_GENERATION_PATH), false);
});

test("Active pointer churn retries to one whole release without mixing A and B", () => {
  const snapshotA = baseSnapshot({ version: "catalog-churn-a", teacherName: "Teacher A" });
  const snapshotB = baseSnapshot({ version: "catalog-churn-b", teacherName: "Teacher B" });
  resetFixture({ snapshot: snapshotB });
  const activeB = fs.readFileSync(path.join(process.env.FOSU_STORAGE_DIR, "releases", "active.json"));
  writeActiveRelease(snapshotA);
  const activePath = path.join(process.env.FOSU_STORAGE_DIR, "releases", "active.json");
  const legacyBefore = Object.fromEntries(Object.values(repository.LEGACY_PATHS).map((filePath) => [path.basename(filePath), { hash: sha256(fs.readFileSync(filePath)), mtimeMs: fs.statSync(filePath).mtimeMs }]));
  const originalRead = fs.readFileSync;
  let activeReads = 0;
  fs.readFileSync = (target, ...args) => {
    const value = originalRead(target, ...args);
    if (path.resolve(String(target)) === path.resolve(activePath) && ++activeReads === 1) fs.writeFileSync(activePath, activeB);
    return value;
  };
  try {
    const result = catalog.listResources({ type: "teacher", page: 1, pageSize: 10 });
    assert.deepStrictEqual(result.items.map((item) => item.teacherName), ["Teacher B"]);
  } finally {
    fs.readFileSync = originalRead;
  }
  assert.ok(activeReads >= 4, "the stable barrier must re-read both attempts");
  const legacyAfter = Object.fromEntries(Object.values(repository.LEGACY_PATHS).map((filePath) => [path.basename(filePath), { hash: sha256(fs.readFileSync(filePath)), mtimeMs: fs.statSync(filePath).mtimeMs }]));
  assert.deepStrictEqual(legacyAfter, legacyBefore, "Active churn handling must not touch Legacy files");
});

test("bootstrap crash recovery remains pinned to its journaled release", () => {
  const snapshotA = baseSnapshot({ version: "catalog-pinned-a", teacherName: "Pinned A" });
  resetFixture({ snapshot: snapshotA });
  const originalMkdir = fs.mkdirSync;
  let injected = false;
  fs.mkdirSync = (target, ...args) => {
    if (!injected && path.basename(String(target)).startsWith(".building-")) {
      injected = true;
      throw Object.assign(new Error("injected after bootstrap journal"), { code: "INJECTED_AFTER_JOURNAL" });
    }
    return originalMkdir(target, ...args);
  };
  try {
    assert.throws(() => catalog.listResources({ type: "teacher", page: 1, pageSize: 10 }), /injected after bootstrap journal/);
  } finally {
    fs.mkdirSync = originalMkdir;
  }
  assert.strictEqual(fs.existsSync(repository.BOOTSTRAP_JOURNAL_PATH), true);
  writeActiveRelease(baseSnapshot({ version: "catalog-pinned-b", teacherName: "Active B" }));
  const recovered = catalog.listResources({ type: "teacher", page: 1, pageSize: 10 });
  assert.deepStrictEqual(recovered.items.map((item) => item.teacherName), ["Pinned A"]);
  const generation = repository.readCurrentGeneration();
  assert.strictEqual(generation.manifest.files.teacher.seed.releaseVersion, "catalog-pinned-a");
});

test("directory-only resource entities survive the Active release mapping", () => {
  const snapshot = baseSnapshot();
  snapshot.resources.teachers.push({ teacherName: "Directory Only", collegeName: "Engineering", title: "Professor" });
  resetFixture({ snapshot });
  const result = catalog.listResources({ type: "teacher", page: 1, pageSize: 10 });
  assert.deepStrictEqual(result.items.map((item) => item.teacherName), ["Active Teacher", "Directory Only"]);
  const stored = JSON.parse(fs.readFileSync(catalog.getCatalogTargetPath("teacher"), "utf8"));
  const directoryOnly = stored.find((row) => row.teacherName === "Directory Only");
  assert.strictEqual(directoryOnly.title, "Professor");
  assert.deepStrictEqual(directoryOnly.courses, []);
});

test("semantic validation rejects an invalid release before publishing current.json", () => {
  const snapshot = baseSnapshot();
  snapshot.resources.teacherSchedules[0].courses[0].weeks = ["1"];
  resetFixture({ snapshot });
  expectCatalogError(() => catalog.listResources({ type: "teacher", page: 1, pageSize: 10 }), "CATALOG_SOURCE_INVALID", 500);
  assert.strictEqual(fs.existsSync(repository.CURRENT_GENERATION_PATH), false);
});

test("semantic validation rejects mixed release terms before publishing current.json", () => {
  const snapshot = baseSnapshot();
  snapshot.resources.teacherSchedules[0].semester = "2024-2025-2";
  snapshot.resources.teacherSchedules[0].courses[0].semester = "2024-2025-2";
  resetFixture({ snapshot });
  expectCatalogError(() => catalog.listResources({ type: "teacher", page: 1, pageSize: 10 }), "CATALOG_SOURCE_INVALID", 500);
  assert.strictEqual(fs.existsSync(repository.CURRENT_GENERATION_PATH), false);
  assert.strictEqual(fs.existsSync(repository.BOOTSTRAP_JOURNAL_PATH), false);
});

test("import canonicalizes identifiers, enforces field types, and retains every supported course field", () => {
  resetFixture();
  catalog.listResources({ type: "teacher", page: 1, pageSize: 1 });
  const canonical = catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: "  Canonical Teacher  ", collegeName: " Engineering ", courses: [] }] });
  const equivalent = catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: "Canonical Teacher", collegeName: "Engineering", courses: [] }] });
  assert.strictEqual(canonical.sourceFingerprint, equivalent.sourceFingerprint);
  assert.deepStrictEqual(canonical.changes, equivalent.changes);
  expectCatalogError(
    () => catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: "Object Value", collegeName: { nested: true }, courses: [] }] }),
    "INVALID_IMPORT_DOCUMENT",
    400
  );
  expectCatalogError(
    () => catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: "Bad Week", courses: [course49({ weeks: ["1"] })] }] }),
    "INVALID_IMPORT_DOCUMENT",
    400
  );
  const full = catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: "Full Course Teacher", collegeName: "Engineering", courses: [course49()] }] });
  const applied = catalog.applyImport(full.previewId, { ifMatch: full.baseVersion, confirm: true });
  assert.strictEqual(applied.committed, true);
  const stored = JSON.parse(fs.readFileSync(catalog.getCatalogTargetPath("teacher"), "utf8"));
  assert.deepStrictEqual(Object.keys(stored.find((row) => row.teacherName === "Full Course Teacher").courses[0]).sort(), Object.keys(course49()).sort());
});

test("secret-shaped values are rejected even when the field name itself is ordinary", () => {
  resetFixture();
  catalog.listResources({ type: "teacher", page: 1, pageSize: 1 });
  for (const value of ["password=hunter2", "token: abcdefghijklmnop", "Authorization: Basic Zm9vOmJhcg=="]) {
    expectCatalogError(
      () => catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: "Secret Shape", collegeName: value, courses: [] }] }),
      "SENSITIVE_DATA_REJECTED",
      400
    );
  }
});

test("major upsert preserves unrelated top-level grades", () => {
  resetFixture();
  catalog.listResources({ type: "major", page: 1, pageSize: 10 });
  const preview = catalog.previewImport({
    type: "major",
    semester: TERM,
    items: [{ collegeCode: "04", collegeName: "Engineering", grade: "2025", majorCode: "0402", majorName: "Networks" }],
  });
  catalog.applyImport(preview.previewId, { ifMatch: preview.baseVersion, confirm: true });
  const raw = JSON.parse(fs.readFileSync(catalog.getCatalogTargetPath("major"), "utf8"));
  assert.ok(raw.grades.includes("2030"), "an unrelated existing dimension must not be silently deleted");
});

test("existing Active orphan relationships are grandfathered but new or changed orphans are rejected", () => {
  const snapshot = baseSnapshot();
  snapshot.majors.push({ collegeCode: "99", collegeName: "Historic College", code: "9901", name: "Historic Major", grade: "2025" });
  resetFixture({ snapshot });
  const initial = catalog.listResources({ type: "major", page: 1, pageSize: 20 });
  assert.ok(initial.items.some((item) => item.id === `major:${TERM}:99:2025:9901`));
  const grandfathered = catalog.previewImport({ type: "major", semester: TERM, items: [{ collegeCode: "99", collegeName: "Historic College", grade: "2025", majorCode: "9901", majorName: "Historic Major Updated" }] });
  catalog.applyImport(grandfathered.previewId, { ifMatch: grandfathered.baseVersion, confirm: true });
  expectCatalogError(
    () => catalog.previewImport({ type: "major", semester: TERM, items: [{ collegeCode: "99", collegeName: "Historic College", grade: "2025", majorCode: "9902", majorName: "New Orphan" }] }),
    "ORPHAN_RELATIONSHIP",
    400
  );
  expectCatalogError(
    () => catalog.previewImport({ type: "major", semester: TERM, items: [{ collegeCode: "99", collegeName: "Historic College", grade: "2099", majorCode: "9901", majorName: "Changed Orphan" }] }),
    "ORPHAN_RELATIONSHIP",
    400
  );
});

test("non-throwing lock release warnings reach the committed result", () => {
  resetFixture();
  catalog.listResources({ type: "teacher", page: 1, pageSize: 1 });
  const preview = catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: "Warning Teacher", courses: [] }] });
  const originalAcquire = repository.acquireMutationLocks;
  repository.acquireMutationLocks = () => () => ({ warnings: [{ code: "CATALOG_LOCK_RELEASE_OWNER_MISMATCH" }] });
  try {
    const result = catalog.applyImport(preview.previewId, { ifMatch: preview.baseVersion, confirm: true });
    assert.ok(result.warnings.some((warning) => warning.code === "CATALOG_LOCK_RELEASE_OWNER_MISMATCH"));
  } finally {
    repository.acquireMutationLocks = originalAcquire;
  }
});

test("preview and completed-operation stores are bounded", () => {
  resetFixture();
  process.env.FOSU_CATALOG_PREVIEW_MAX_RECORDS = "3";
  process.env.FOSU_CATALOG_COMPLETED_MAX_RECORDS = "2";
  try {
    for (let index = 0; index < 7; index += 1) {
      catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: `Unused ${index}`, courses: [] }] });
    }
    assert.ok(fs.readdirSync(importService.CATALOG_PREVIEWS_DIR).filter((name) => name.endsWith(".json")).length <= 3);
    for (let index = 0; index < 4; index += 1) {
      const preview = catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: `Applied ${index}`, courses: [] }] });
      catalog.applyImport(preview.previewId, { ifMatch: preview.baseVersion, confirm: true });
    }
    assert.ok(fs.readdirSync(importService.CATALOG_OPERATIONS_DIR).filter((name) => name.endsWith(".json")).length <= 2);
  } finally {
    delete process.env.FOSU_CATALOG_PREVIEW_MAX_RECORDS;
    delete process.env.FOSU_CATALOG_COMPLETED_MAX_RECORDS;
  }
});

test("malformed unpaired preview records cannot evade the retention bound", () => {
  resetFixture();
  process.env.FOSU_CATALOG_PREVIEW_MAX_RECORDS = "2";
  try {
    catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: "Retention Seed", courses: [] }] });
    for (let index = 0; index < 5; index += 1) {
      fs.writeFileSync(path.join(importService.CATALOG_PREVIEWS_DIR, `${crypto.randomUUID()}.json`), "{malformed");
    }
    catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: "Retention Trigger", courses: [] }] });
    assert.ok(fs.readdirSync(importService.CATALOG_PREVIEWS_DIR).filter((name) => name.endsWith(".json")).length <= 2);
  } finally {
    delete process.env.FOSU_CATALOG_PREVIEW_MAX_RECORDS;
  }
});

test("exclusive durable creation publishes only fully written bytes", () => {
  const root = path.join(tempRoot, "exclusive-create");
  const target = path.join(root, "key");
  fs.mkdirSync(root, { recursive: true });
  let targetStateDuringWrite = "not-observed";
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = (destination, ...args) => {
    if (typeof destination === "number" && targetStateDuringWrite === "not-observed") {
      targetStateDuringWrite = fs.existsSync(target) ? fs.readFileSync(target).length : "absent";
    }
    return originalWrite(destination, ...args);
  };
  try {
    durableStore.writeFileExclusive(root, target, "complete-key");
  } finally {
    fs.writeFileSync = originalWrite;
  }
  assert.strictEqual(targetStateDuringWrite, "absent");
  assert.strictEqual(fs.readFileSync(target, "utf8"), "complete-key");
});

test("managed backup roots reject junction escape before any outside write", () => {
  resetFixture();
  catalog.listResources({ type: "teacher", page: 1, pageSize: 1 });
  const outside = path.join(tempRoot, "outside-backups");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "sentinel"), "unchanged");
  fs.symlinkSync(outside, repository.BACKUPS_DIR, "junction");
  const preview = catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: "Junction Teacher", courses: [] }] });
  expectCatalogError(() => catalog.applyImport(preview.previewId, { ifMatch: preview.baseVersion, confirm: true }), "CATALOG_TARGET_INVALID", 500);
  assert.deepStrictEqual(fs.readdirSync(outside), ["sentinel"]);
});

test("managed lock roots reject junction escape before mutation", () => {
  resetFixture();
  catalog.listResources({ type: "teacher", page: 1, pageSize: 1 });
  const outside = path.join(tempRoot, "outside-locks");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "sentinel"), "unchanged");
  const locksDir = path.join(repository.CATALOG_STAGING_DIR, "locks");
  fs.symlinkSync(outside, locksDir, "junction");
  const preview = catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: "Lock Junction", courses: [] }] });
  expectCatalogError(() => catalog.applyImport(preview.previewId, { ifMatch: preview.baseVersion, confirm: true }), "CATALOG_TARGET_INVALID", 500);
  assert.deepStrictEqual(fs.readdirSync(outside), ["sentinel"]);
});

test("managed private roots reject junction escape before preview persistence", () => {
  resetFixture();
  catalog.listResources({ type: "teacher", page: 1, pageSize: 1 });
  const outside = path.join(tempRoot, "outside-private");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "sentinel"), "unchanged");
  fs.symlinkSync(outside, importService.PRIVATE_DIR, "junction");
  expectCatalogError(
    () => catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: "Private Junction", courses: [] }] }),
    "CATALOG_PRIVATE_PATH_INVALID",
    500
  );
  assert.deepStrictEqual(fs.readdirSync(outside), ["sentinel"]);
});

test("journal, backup, generation, and pointer writes pass through fsync durability barriers", () => {
  resetFixture();
  let fsyncCalls = 0;
  const originalFsync = fs.fsyncSync;
  fs.fsyncSync = (...args) => {
    fsyncCalls += 1;
    return originalFsync(...args);
  };
  try {
    catalog.listResources({ type: "teacher", page: 1, pageSize: 1 });
    const preview = catalog.previewImport({ type: "teacher", semester: TERM, items: [{ teacherName: "Durable Teacher", courses: [] }] });
    catalog.applyImport(preview.previewId, { ifMatch: preview.baseVersion, confirm: true });
  } finally {
    fs.fsyncSync = originalFsync;
  }
  assert.ok(fsyncCalls >= 12, `expected durable fsync barriers, observed ${fsyncCalls}`);
});

try {
  if (failures.length) {
    const error = new Error(`${failures.length} Catalog hardening contract(s) failed`);
    error.failures = failures;
    throw error;
  }
  console.log("Admin Catalog hardening contracts passed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
