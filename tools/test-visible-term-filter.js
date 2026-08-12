"use strict";

const assert = require("assert");
const { selectVisibleTerms } = require("../shared/termVisibility");
const records = [
  { term: "2025-2026-1", status: "ready", dataAvailable: true, releaseVersion: "r251", termStartDate: "2025-09-08" },
  { term: "2024-2025-2", status: "archived", dataAvailable: false, releaseVersion: "r242", termStartDate: "2025-03-03" },
  { term: "2026-2027-1", status: "current", dataAvailable: true, releaseVersion: "r261", termStartDate: "2026-09-07" },
  { term: "2025-2026-2", status: "archived", dataAvailable: true, releaseVersion: "r252", termStartDate: "2026-03-09" },
  { term: "2027-2028-1", status: "planned", dataAvailable: false, releaseVersion: "", termStartDate: "" },
  { term: "2023-2024-2", status: "disabled", dataAvailable: true, releaseVersion: "r232", termStartDate: "2024-03-04" },
  { term: "2022-2023-2", status: "archived", dataAvailable: true, releaseVersion: "missing", termStartDate: "2023-02-27" },
  { term: "2021-2022-2", status: "archived", dataAvailable: true, releaseVersion: "empty", termStartDate: "2022-02-28" },
];
const manifests = {
  r261: { healthy: true, counts: { classScheduleCount: 20 } },
  r252: { healthy: true, counts: { classScheduleCount: 10 } },
  r251: { healthy: true, counts: { classScheduleCount: 8 } },
  empty: { healthy: true, counts: { classScheduleCount: 0 } },
};
const visible = selectVisibleTerms(records, {
  activeTerm: "2026-2027-1",
  releaseResolver: (version) => manifests[version] || null,
});
assert.deepStrictEqual(visible.map((item) => item.term), ["2026-2027-1", "2025-2026-2", "2025-2026-1"]);
assert(visible.every((item) => item.dataAvailable && item.releaseHealthy));
console.log("test-visible-term-filter passed");
