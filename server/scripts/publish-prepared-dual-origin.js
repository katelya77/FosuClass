#!/usr/bin/env node
"use strict";
const release = require("../src/services/releaseService");
const runtime = require("../src/services/runtimePointerService");
const adapter = require("../src/services/dualOriginReleaseService");
const cloudbase = require("../src/shared/releasePackDistribution").createReleasePackUtils({
  ENV_ID: process.env.FOSU_CLOUDBASE_ENV_ID,
  CLOUDBASE_HOSTING_BASE_URL: process.env.FOSU_CLOUDBASE_HOSTING_BASE_URL,
});
const distribution = require("../src/shared/verifyImmutableDistribution");
const { calculateFingerprint } = require("../src/utils/stagingFingerprint");

async function main(argv = process.argv.slice(2)) {
  const args = cloudbase.parseArgs(argv);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(args.release || "")) throw Object.assign(new Error("PUBLICATION_PLAN_REJECTED"), { code: "PUBLICATION_PLAN_REJECTED" });
  const snapshot = release.readReleaseSnapshot(args.release);
  if (!snapshot) throw Object.assign(new Error("RELEASE_SNAPSHOT_MISSING"), { code: "RELEASE_SNAPSHOT_MISSING" });
  const canonicalHash = calculateFingerprint(snapshot).canonicalHash;
  if (args.execute !== true) {
    const local = cloudbase.verifyLocalReleasePack({ releaseVersion: args.release });
    cloudbase.scanPrivacy(local.releaseDir);
    const inventory = distribution.inventory(local.releaseDir, local.manifest);
    const active = runtime.readActivePointer() || release.getActiveReleaseInfo() || {};
    return { dryRun: true, releaseVersion: args.release, canonicalHash, expectedActiveReleaseVersion: active.releaseVersion || active.version || "", filesToVerifyPerOrigin: inventory.length, verificationBodyBytesPerOrigin: inventory.reduce((sum, item) => sum + item.size, 0), productionWrites: 0, schoolRequests: 0, enabled: process.env.FOSU_DUAL_ORIGIN_PUBLICATION === "1" };
  }
  if (args["canonical-hash"] !== canonicalHash || typeof args["expected-active"] !== "string") throw Object.assign(new Error("PUBLICATION_PLAN_REJECTED"), { code: "PUBLICATION_PLAN_REJECTED" });
  return adapter.publishPrepared({ releaseVersion: args.release, canonicalHash, expectedActiveReleaseVersion: args["expected-active"], confirmation: args.confirm });
}
if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(error => {
  console.error(JSON.stringify({ status: "failed", code: /^[A-Z_]+$/.test(error.code || "") ? error.code : "DUAL_ORIGIN_PUBLICATION_FAILED", reconciliationRequired: Boolean(error.receipt && error.receipt.oracleActivated) }));
  process.exitCode = 1;
});
module.exports = { main };
