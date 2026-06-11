const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const files = [
  "server/src/services/termRegistryService.js",
  "server/src/services/runtimePointerService.js",
  "server/src/services/releaseService.js",
  "server/src/services/teachingCalendarService.js",
  "server/src/services/schoolCatalogService.js",
  "server/src/routes/admin.js",
  "server/src/routes/adminPages.js",
  "server/src/shared/syncPlan.js",
];

const offenders = [];
files.forEach((file) => {
  const text = fs.readFileSync(path.join(root, file), "utf-8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/totalWeeks[^;\n]*\|\|\s*20|defaultTotalWeeks\s*\|\|\s*20|Number\([^)]*totalWeeks[^)]*\|\|\s*20/.test(line)) {
      offenders.push(`${file}:${index + 1}:${line.trim()}`);
    }
  });
});

assert.deepStrictEqual(offenders, [], `production totalWeeks must not silently default to 20:\n${offenders.join("\n")}`);
console.log("test-no-silent-total-weeks-20 passed");
