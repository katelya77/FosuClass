"use strict";

const assert = require("assert");
const path = require("path");
const {
  buildCrawlArgs,
  buildTermRegistryPatch,
  loadPublisherTermConfig,
  resolveCloudbaseRetentionPlan,
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

const explicitFuture = selectPublisherTerm({
  cliTerm: "2027-2028-1",
  activeTerm: "2026-2027-2",
  activeReleaseVersion: "release-2026-2",
});
assert.strictEqual(explicitFuture.promotedFromTerm, "2026-2027-2", "an explicit future term should auto-promote routine to full");

const activeDefault = selectPublisherTerm({
  activeTerm: "2026-2027-1",
  activeReleaseVersion: "release-2026",
  activeSource: "oracle-active-pointer",
});
assert.strictEqual(activeDefault.term, "2026-2027-1");

assert.throws(() => selectPublisherTerm({}), (error) => error && error.code === "PUBLISHER_ACTIVE_TERM_MISSING");

// A canonical preferred term ahead of the live active term is promoted
// automatically so routine publishes pick up newly released cohorts.
const promoted = selectPublisherTerm({
  activeTerm: "2025-2026-2",
  activeReleaseVersion: "release-2025",
  activeSource: "oracle-active-pointer",
  canonicalTerm: "2026-2027-1",
});
assert.strictEqual(promoted.term, "2026-2027-1");
assert.strictEqual(promoted.source, "canonical-preferred-term");
assert.strictEqual(promoted.promotedFromTerm, "2025-2026-2");

const promotedWithStaleEnv = selectPublisherTerm({
  envTerm: "2025-2026-2",
  activeTerm: "2025-2026-2",
  canonicalTerm: "2026-2027-1",
});
assert.strictEqual(promotedWithStaleEnv.term, "2026-2027-1");
assert.strictEqual(promotedWithStaleEnv.ignoredEnvTerm, "2025-2026-2");

// Canonical term equal to or older than the active term never hijacks a publish.
const canonicalSame = selectPublisherTerm({
  activeTerm: "2026-2027-1",
  activeSource: "oracle-active-pointer",
  canonicalTerm: "2026-2027-1",
});
assert.strictEqual(canonicalSame.term, "2026-2027-1");
assert.strictEqual(canonicalSame.promotedFromTerm, undefined);

const canonicalOlder = selectPublisherTerm({
  activeTerm: "2026-2027-1",
  activeSource: "oracle-active-pointer",
  canonicalTerm: "2025-2026-2",
});
assert.strictEqual(canonicalOlder.term, "2026-2027-1");
assert.strictEqual(canonicalOlder.promotedFromTerm, undefined);

// An explicit --term still beats canonical promotion.
const explicitBeatsCanonical = selectPublisherTerm({
  cliTerm: "2025-2026-2",
  activeTerm: "2025-2026-2",
  canonicalTerm: "2026-2027-1",
});
assert.strictEqual(explicitBeatsCanonical.term, "2025-2026-2");
assert.strictEqual(explicitBeatsCanonical.source, "cli");

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

assert.strictEqual(resolveCloudbaseRetentionPlan({}, { action: "uploaded-and-cutover" }, {}).shouldPrune, true);
assert.strictEqual(resolveCloudbaseRetentionPlan({}, { action: "no-op" }, {}).shouldPrune, false);
assert.strictEqual(resolveCloudbaseRetentionPlan({ "prune-cloudbase": true }, { action: "no-op" }, {}).shouldPrune, true);
assert.strictEqual(resolveCloudbaseRetentionPlan({ "skip-cloudbase-prune": true }, { action: "uploaded-and-cutover" }, {}).shouldPrune, false);
console.log("test-publisher-term-selection passed");
