const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(os.tmpdir(), `fosu-term-concurrent-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.NODE_ENV = "test";

const termRegistryService = require("../server/src/services/termRegistryService");

try {
  Promise.all([
    Promise.resolve().then(() => termRegistryService.createPlannedTerm({ term: "2026-2027-1", termStartDate: "", totalWeeks: 20 })),
    Promise.resolve().then(() => termRegistryService.createPlannedTerm({ term: "2027-2028-1", termStartDate: "", totalWeeks: 20 })),
  ]).then(() => {
    const registry = termRegistryService.readRegistry();
    const terms = registry.terms.map((item) => item.term);
    assert(terms.includes("2026-2027-1"));
    assert(terms.includes("2027-2028-1"));

    termRegistryService.updateTerm("2026-2027-1", { semesterText: "A" });
    termRegistryService.updateTerm("2026-2027-1", { totalWeeks: 18 });
    const updated = termRegistryService.getTerm("2026-2027-1");
    assert.strictEqual(updated.semesterText, "A");
    assert.strictEqual(updated.totalWeeks, 18);
    console.log("test-term-registry-concurrent-writes passed");
  }).finally(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
} catch (error) {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  throw error;
}
