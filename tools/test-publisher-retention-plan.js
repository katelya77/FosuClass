"use strict";
const assert = require("assert/strict"), fs = require("fs"), os = require("os"), path = require("path");
const publisher = require("./fosu-publisher/publish"), retention = require("./fosu-publisher/retentionPlan");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-publisher-retention-"));
function run(id, status, term = "2026-2027-1", completedAt = "2026-01-01T00:00:00Z") {
  const directory = path.join(root, id); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify({ status, term, receipt: { completedAt } }));
  fs.writeFileSync(path.join(directory, "checkpoint.json"), "synthetic resume checkpoint");
}
async function main() {
  try {
    run("current", "running"); run("last-good", "completed", "2026-2027-1", "2026-10-08T00:00:00Z");
    run("older-complete", "completed"); run("retry", "partial-success"); run("failed", "failed");
    run("historic-term", "completed", "2025-2026-2"); run("unknown-finish", "completed", "2026-2027-1", "");
    run("corrupt-state", "completed"); fs.writeFileSync(path.join(root, "corrupt-state", "state.json"), "null");
    const before = fs.readdirSync(root), options = { currentRunId: "current", latestRunId: "last-good", now: Date.parse("2026-10-09T00:00:00Z") };
    const unknown = retention.plan(root, options);
    assert.equal(unknown.candidates.length, 0); assert.equal(unknown.executeAllowed, false);
    const attested = retention.plan(root, { ...options, referencesComplete: true });
    assert.deepEqual(attested.candidates.map(entry => entry.runId), ["older-complete"]);
    assert.ok(attested.estimatedReclaimBytes > 0); assert.deepEqual(attested.removed, []);
    assert.deepEqual(fs.readdirSync(root), before); assert.equal(attested.executeAllowed, false);
    for (const args of [{}, { "prune-cloudbase": true }, { "prune-cloudbase": true, execute: true, confirm: "CONFIRM_DELETE_CLOUDBASE_OLD_RELEASES" }]) {
      for (const enabled of ["true", "false"]) {
        const plan = publisher.resolveCloudbaseRetentionPlan(args, { action: "uploaded-and-cutover" }, { FOSU_CLOUDBASE_AUTO_PRUNE: enabled });
        assert.equal(plan.shouldPrune, false); assert.equal(plan.executeAllowed, false); assert.equal(plan.dryRun, true);
      }
    }
    const previous = process.env.FOSU_PUBLISHER_MOCK; process.env.FOSU_PUBLISHER_MOCK = "0";
    try {
      let previews = 0;
      const result = await publisher.cloudbasePreflightAndMirror({ "prune-cloudbase": true }, {
        runCommand: () => {}, mirrorCloudbase: async () => ({ action: "uploaded-and-cutover", releaseVersion: "fixture-v2" }),
        pruneRemoteReleasePack: async options => { previews++; assert.equal(options.execute, false); assert.equal(options.dryRun, true); assert.equal(options.confirm, undefined); return { dryRun: true, deletions: [] }; },
      });
      assert.equal(result.success, true); assert.equal(previews, 1); assert.equal(result.retention.dryRun, true);
    } finally { if (previous === undefined) delete process.env.FOSU_PUBLISHER_MOCK; else process.env.FOSU_PUBLISHER_MOCK = previous; }
    console.log("publisher retention: protected history/checkpoints, incomplete references, measured dry-run, legacy flags never authorize remote deletion PASS; production requests=0");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
