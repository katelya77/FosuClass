"use strict";

const assert = require("assert");
const path = require("path");
const {
  buildCrawlArgs,
  buildTermRegistryPatch,
  loadPublisherTermConfig,
  selectPublisherTerm,
} = require("./fosu-publisher/publish");

const staleEnvironment = selectPublisherTerm({
  envTerm: "2025-2026-2",
  activeTerm: "2026-2027-1",
  activeReleaseVersion: "release-2026",
  activeSource: "oracle-active-pointer",
});
assert.strictEqual(staleEnvironment.term, "2026-2027-1");
assert.strictEqual(staleEnvironment.ignoredEnvTerm, "2025-2026-2");

const explicitHistorical = selectPublisherTerm({
  cliTerm: "2025-2026-2",
  envTerm: "2026-2027-1",
  activeTerm: "2026-2027-1",
});
assert.strictEqual(explicitHistorical.term, "2025-2026-2");
assert.strictEqual(explicitHistorical.source, "cli");

const activeDefault = selectPublisherTerm({
  activeTerm: "2026-2027-1",
  activeReleaseVersion: "release-2026",
  activeSource: "oracle-active-pointer",
});
assert.strictEqual(activeDefault.term, "2026-2027-1");

assert.throws(() => selectPublisherTerm({}), (error) => error && error.code === "PUBLISHER_ACTIVE_TERM_MISSING");

const canonical = loadPublisherTermConfig("2026-2027-1");
assert.strictEqual(canonical.termStartDate, "2026-09-07");
assert.strictEqual(canonical.totalWeeks, 19);
const reconciliation = buildTermRegistryPatch({
  term: "2026-2027-1",
  semesterText: canonical.semesterText,
  termStartDate: "2026-09-07",
  totalWeeks: 20,
  weekStart: "monday",
}, canonical);
assert.strictEqual(reconciliation.changed, true);
assert.deepStrictEqual(reconciliation.differences, ["totalWeeks"]);
assert.strictEqual(reconciliation.patch.totalWeeks, 19);

const crawl = buildCrawlArgs("routine", {}, {
  runId: "publisher-canonical-term-test",
  runDir: path.join(__dirname, "..", ".local", "publisher-canonical-term-test"),
}, "2026-2027-1", canonical);
assert(crawl.args.includes("--term=2026-2027-1"));
assert(crawl.args.includes("--term-start-date=2026-09-07"));
assert(crawl.args.includes("--total-weeks=19"));
assert(crawl.args.includes("--week-start=monday"));
assert(crawl.args.includes("--override-term-config"));
console.log("test-publisher-term-selection passed");
