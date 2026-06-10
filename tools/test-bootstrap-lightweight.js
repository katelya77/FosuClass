const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-bootstrap-light-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.NODE_ENV = "test";

const releaseService = require("../server/src/services/releaseService");
const schoolCatalogService = require("../server/src/services/schoolCatalogService");
const termRegistryService = require("../server/src/services/termRegistryService");

function snapshot(term, version) {
  const course = { courseName: term, teacherName: "T", classroom: "C7-101", weekday: 1, startSection: 1, endSection: 2, sections: [1, 2], weeks: [1] };
  return {
    version, releaseVersion: version, term, semester: term,
    termConfig: { term, semesterText: term, termStartDate: term === "2025-2026-2" ? "2026-03-09" : "2025-03-03", totalWeeks: 20, weekStart: "monday", releaseVersion: version },
    updatedAt: "2026-06-10T00:00:00.000Z",
    catalog: { colleges: [{ code: term, name: `College ${term}` }], grades: ["2025"] },
    majors: [{ collegeCode: term, code: "m", name: "M", grade: "2025" }],
    classSchedules: [{ semester: term, className: `Class ${term}`, courses: [course] }],
    resources: { teacherSchedules: [{ teacherName: "T", courses: [course] }], classroomSchedules: [], courseSchedules: [], teachers: [], classrooms: [], courses: [] },
  };
}

(async () => {
  try {
    const terms = ["2025-2026-2", "2024-2025-2"];
    const versions = ["boot-a", "boot-b"];
    termRegistryService.writeRegistry({ activeTerm: terms[0], terms: terms.map((term, index) => ({
      term, semesterText: term, termStartDate: index === 0 ? "2026-03-09" : "2025-03-03", totalWeeks: 20, weekStart: "monday", status: index === 0 ? "current" : "archived", releaseVersion: versions[index], dataAvailable: true,
    })) }, { backup: false });
    releaseService.writeReleaseSnapshot(snapshot(terms[0], versions[0]));
    releaseService.writeReleaseSnapshot(snapshot(terms[1], versions[1]));

    const original = releaseService.readReleaseSnapshot;
    releaseService.readReleaseSnapshot = () => { throw new Error("readReleaseSnapshot should not be called on normal bootstrap path"); };
    const a = await schoolCatalogService.getBootstrap(terms[0]);
    const b = await schoolCatalogService.getBootstrap(terms[1]);
    releaseService.readReleaseSnapshot = original;

    assert.strictEqual(a.releaseVersion, versions[0]);
    assert.strictEqual(b.releaseVersion, versions[1]);
    assert.strictEqual(a.catalog.colleges[0].code, terms[0]);
    assert.strictEqual(b.catalog.colleges[0].code, terms[1]);
    console.log("test-bootstrap-lightweight passed");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})();
