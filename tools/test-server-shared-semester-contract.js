"use strict";
const assert = require("assert");
const rootTerms = require("../shared/termVisibility");
const serverTerms = require("../server/src/shared/termVisibility");
const rootEvents = require("../shared/teachingEventResolver");
const serverEvents = require("../server/src/shared/teachingEventResolver");

const records = [{ term: "2025-2026-2", termStartDate: "2026-03-09" }, { term: "2026-2027-1", termStartDate: "2026-09-07" }];
assert.deepStrictEqual(serverTerms.sortVisibleTerms(records, "2026-2027-1"), rootTerms.sortVisibleTerms(records, "2026-2027-1"));
for (const value of [
  { date: "2026-09-25", type: "holiday", note: "中秋节" },
  { date: "2026-09-20", type: "makeup", scheduleSourceDate: "2026-10-06" },
  { date: "bad", type: "holiday" },
]) assert.deepStrictEqual(serverEvents.normalizeSpecialDate(value), rootEvents.normalizeSpecialDate(value));
console.log("test-server-shared-semester-contract passed");
