"use strict";

const assert = require("assert");
const { compareTerms, sortVisibleTerms } = require("../shared/termVisibility");
assert(compareTerms({ term: "2026-2027-1" }, { term: "2025-2026-2" }) < 0);
assert(compareTerms({ term: "2025-2026-2" }, { term: "2025-2026-1" }) < 0);
const result = sortVisibleTerms([
  { term: "2025-2026-1", termStartDate: "2025-09-08" },
  { term: "2026-2027-1", termStartDate: "2026-09-07" },
  { term: "2025-2026-2", termStartDate: "2026-03-09" },
], "2025-2026-2");
assert.deepStrictEqual(result.map((item) => item.term), ["2025-2026-2", "2026-2027-1", "2025-2026-1"]);
console.log("test-term-sort passed");
