"use strict";

const assert = require("assert");
const { resolveSelectedTerm, sanitizeClientTerms } = require("../shared/termVisibility");
const canonical = [
  { term: "2026-2027-1", status: "current", dataAvailable: true, releaseVersion: "r261" },
  { term: "2025-2026-2", status: "archived", dataAvailable: true, releaseVersion: "r252" },
];
const sanitized = sanitizeClientTerms([
  ...canonical,
  { term: "2024-2025-2", status: "archived", dataAvailable: false, releaseVersion: "" },
], canonical);
assert.deepStrictEqual(sanitized.map((item) => item.term), ["2026-2027-1", "2025-2026-2"]);
const selection = resolveSelectedTerm("2024-2025-2", canonical, "2026-2027-1");
assert.strictEqual(selection.term, "2026-2027-1");
assert.strictEqual(selection.changed, true);
assert.strictEqual(selection.reason, "GHOST_TERM_FALLBACK");
console.log("test-ghost-term passed");
