const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-openresty-status-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");
process.env.RELEASE_PACK_SRC = path.join(process.env.FOSU_STORAGE_DIR, "public", "releases");
process.env.PUBLIC_BASE_URL = "http://127.0.0.1/static/releases";
process.env.STATIC_RELEASE_SYNC_VERIFY_HTTP = "false";
process.env.STATIC_RELEASE_KEEP_LATEST = "3";
process.env.NODE_ENV = "test";

const releaseService = require("../server/src/services/releaseService");
const staticReleaseSyncService = require("../server/src/services/staticReleaseSyncService");

function snapshot(version) {
  const course = {
    courseName: "OpenResty Course",
    teacherName: "Teacher A",
    classroom: "C7-101",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2],
  };
  return {
    schemaVersion: "1.0",
    version,
    releaseVersion: version,
    term: "2025-2026-2",
    semester: "2025-2026-2",
    termStartDate: "2026-03-09",
    generatedAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "Test College" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "Test Major", grade: "2025" }],
    classSchedules: [{ className: "25 OpenResty 1", courses: [course] }],
    resources: {
      teachers: [{ teacherName: "Teacher A" }],
      classrooms: [{ roomName: "C7-101" }],
      courses: [{ courseName: "OpenResty Course" }],
      teacherSchedules: [{ teacherName: "Teacher A", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-101", courses: [course] }],
      courseSchedules: [{ courseName: "OpenResty Course", courses: [course] }],
    },
  };
}

function cleanup() {
  const resolved = path.resolve(tempRoot);
  if (!path.basename(resolved).startsWith("fosu-openresty-status-")) {
    throw new Error(`refusing cleanup: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

(async () => {
  try {
    const version = "openresty-status-2026-06-05";
    releaseService.activateReleaseFromSnapshot(snapshot(version));

    delete process.env.OPENRESTY_STATIC_RELEASE_DIR;
    process.env.STATIC_RELEASE_SYNC_ENABLED = "false";
    let status = staticReleaseSyncService.getSyncStatus({ version });
    assert.strictEqual(status.enabled, false);
    assert.strictEqual(status.configured, false);
    assert.strictEqual(status.needsSync, false);
    assert.strictEqual(status.needsSyncReason, "feature-disabled");
    assert(Array.isArray(status.retainedReleases), "retainedReleases should be an array");

    process.env.STATIC_RELEASE_SYNC_ENABLED = "true";
    process.env.OPENRESTY_STATIC_RELEASE_DIR = path.join(tempRoot, "openresty", "releases");
    process.env.OPENRESTY_STATIC_RUNTIME_DIR = path.join(tempRoot, "openresty", "runtime");
    fs.mkdirSync(process.env.OPENRESTY_STATIC_RELEASE_DIR, { recursive: true });
    fs.mkdirSync(process.env.OPENRESTY_STATIC_RUNTIME_DIR, { recursive: true });
    status = staticReleaseSyncService.getSyncStatus({ version });
    assert.strictEqual(status.enabled, true);
    assert.strictEqual(status.configured, true);
    assert.strictEqual(status.targetDirExists, true);
    assert.strictEqual(status.targetDirWritable, true);
    assert.strictEqual(status.runtimeDirExists, true);
    assert.strictEqual(status.runtimeDirWritable, true);
    assert.strictEqual(status.versionMatched, false);
    assert.strictEqual(status.needsSync, true);

    const synced = await staticReleaseSyncService.syncStaticRelease(version, { timeoutMs: 1000 });
    assert.strictEqual(synced.status, "success");
    status = staticReleaseSyncService.getSyncStatus({ version });
    assert.strictEqual(status.versionMatched, true);
    assert.strictEqual(status.needsSync, false);
    assert.strictEqual(status.manifestStatus, 200);
    assert(status.manifestUrl.includes(`${version}/manifest.json`));
    assert(status.retainedReleases.some((item) => item.version === version && item.role === "active"));
    assert(status.keptReleases.includes(version));

    cleanup();
    console.log("test-openresty-status-schema passed");
  } catch (error) {
    console.error(error);
    try { cleanup(); } catch (cleanupError) {}
    process.exit(1);
  }
})();
