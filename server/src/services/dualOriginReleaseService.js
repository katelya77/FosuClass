"use strict";
const fs = require("fs"), path = require("path");
const guard = require("../shared/publicationGuard");
const contract = require("../shared/dualOriginPublication");
const distribution = require("../shared/verifyImmutableDistribution");
const release = require("./releaseService");
const runtime = require("./runtimePointerService");
const staticSync = require("./staticReleaseSyncService");
const { createReleasePackUtils } = require("../shared/releasePackDistribution");
const { calculateFingerprint } = require("../utils/stagingFingerprint");

const STORAGE = path.dirname(path.dirname(release.ACTIVE_RELEASE_PATH));
const LOCK_DIR = path.join(STORAGE, "ops", "publication");
const RECEIPTS = path.join(STORAGE, "ops", "dual-origin-publication");
function fail(code) { return Object.assign(new Error(code), { code, statusCode: 409 }); }
function assertApproval(plan, env = process.env) {
  if (env.FOSU_DUAL_ORIGIN_PUBLICATION !== "1") throw fail("DUAL_ORIGIN_PUBLICATION_DISABLED");
  if (plan.confirmation !== "CONFIRM_DUAL_ORIGIN_PUBLICATION") throw fail("PUBLICATION_APPROVAL_REQUIRED");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(plan.releaseVersion || "") || !/^[a-f0-9]{64}$/.test(plan.canonicalHash || "") || typeof plan.expectedActiveReleaseVersion !== "string") throw fail("PUBLICATION_PLAN_REJECTED");
}
function audit(event) {
  fs.mkdirSync(RECEIPTS, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(RECEIPTS).isSymbolicLink()) throw fail("PUBLICATION_RECEIPT_PATH_REJECTED");
  const record = { schema: 1, utc: new Date().toISOString(), releaseVersion: event.releaseVersion, canonicalHash: event.canonicalHash, cacheEpoch: event.cacheEpoch || null, status: event.status, event: event.event, state: event.state, code: event.code || "", oracleActivated: event.oracleActivated, cloudbaseActivated: event.cloudbaseActivated, events: event.events, verification: event.verification || {} };
  const file = path.join(RECEIPTS, event.releaseVersion + ".jsonl");
  if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) throw fail("PUBLICATION_RECEIPT_PATH_REJECTED");
  const fd = fs.openSync(file, "a", 0o600);
  try { fs.writeSync(fd, JSON.stringify(record) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
async function publishPrepared(plan, deps = {}) {
  assertApproval(plan, deps.env || process.env);
  const lease = guard.acquire(LOCK_DIR);
  try {
    const env = deps.env || process.env;
    const config = staticSync.getConfig(env);
    const hostingBaseUrl = env.FOSU_CLOUDBASE_HOSTING_BASE_URL;
    const envId = env.FOSU_CLOUDBASE_ENV_ID;
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,159}$/.test(envId || "") || !hostingBaseUrl) throw fail("PUBLICATION_DISTRIBUTION_CONFIG_REQUIRED");
    const cloudbase = createReleasePackUtils({ ENV_ID: envId, CLOUDBASE_HOSTING_BASE_URL: hostingBaseUrl });
    distribution.assertBaseUrl(config.publicBaseUrl, deps.fixtureOnly);
    distribution.assertBaseUrl(hostingBaseUrl, deps.fixtureOnly);
    const common = { releaseVersion: plan.releaseVersion, publicRoot: release.PUBLIC_RELEASES_DIR, hostingBaseUrl, envId, execute: true, dryRun: false };
    let local;
    const verifyAll = async base => distribution.verify({ releaseDir: local.releaseDir, manifest: local.manifest, releaseBaseUrl: base.replace(/\/+$/g, "") + "/" + plan.releaseVersion, fixtureOnly: deps.fixtureOnly === true });
    const readOracle = async () => {
      const pointer = runtime.readActivePointer() || {};
      const active = release.getActiveReleaseInfo() || {};
      if (pointer.releaseVersion && pointer.releaseVersion !== (active.releaseVersion || active.version)) throw fail("ORACLE_POINTER_INCONSISTENT");
      return pointer.releaseVersion ? pointer : { releaseVersion: active.releaseVersion || active.version || "" };
    };
    const readCloudbase = async () => {
      const response = await fetch(hostingBaseUrl.replace(/\/+$/g, "") + "/runtime/active.json?publication=" + Date.now(), { signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!response.ok) throw fail("CLOUDBASE_ROLLBACK_POINT_REQUIRED");
      const pointer = await response.json();
      if (!pointer.releaseVersion || !Number.isSafeInteger(pointer.cacheEpoch) || pointer.cacheEpoch <= 0) throw fail("CLOUDBASE_ROLLBACK_POINT_REQUIRED");
      return pointer;
    };
    let cloudbaseBaseline;
    const commandRunner = deps.commandRunner || ((localPath, remotePath, options) => cloudbase.runTcbHostingDeploy(localPath, remotePath, { ...options, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }));
    const operations = {
      audit: deps.audit || audit,
      readOraclePointer: readOracle,
      verifyImmutableRelease: async () => {
        const snapshot = release.readReleaseSnapshot(plan.releaseVersion);
        if (!snapshot || calculateFingerprint(snapshot).canonicalHash !== plan.canonicalHash) throw fail("PUBLICATION_IMMUTABLE_HASH_MISMATCH");
        if (!release.getReleasePackStatus(plan.releaseVersion).healthy) throw fail("RELEASE_PACK_UNHEALTHY");
        local = cloudbase.verifyLocalReleasePack(common);
        cloudbase.scanPrivacy(local.releaseDir);
        // Reject unsafe paths, metadata and budgets before any distribution write.
        distribution.inventory(local.releaseDir, local.manifest);
        const oracleBaseline = await readOracle();
        if (oracleBaseline.releaseVersion !== plan.releaseVersion) guard.assertExpectedVersion(oracleBaseline.releaseVersion, plan.expectedActiveReleaseVersion);
        cloudbaseBaseline = await readCloudbase();
        guard.assertNotOlder(oracleBaseline, cloudbaseBaseline);
        if (guard.epoch(oracleBaseline) === guard.epoch(cloudbaseBaseline) && oracleBaseline.releaseVersion !== cloudbaseBaseline.releaseVersion) throw fail("PUBLICATION_POINTER_CONFLICT");
      },
      prepareOracle: async () => {
        if (!config.enabled || !config.verifyHttp || !config.runtimeDst) throw fail("ORACLE_STATIC_PREPARATION_REQUIRED");
        return staticSync.syncIfEnabled(plan.releaseVersion, { env, prepareOnly: true });
      },
      mirrorCloudbase: async () => cloudbase.deployReleasePack({ ...common, commandRunner, verifyRemote: false }),
      verifyOracle: async () => verifyAll(config.publicBaseUrl),
      verifyCloudbase: async () => verifyAll(hostingBaseUrl.replace(/\/+$/g, "") + "/releases"),
      activateOracle: async () => {
        const currentCloudbase = await readCloudbase();
        guard.assertExpectedVersion(currentCloudbase.releaseVersion, cloudbaseBaseline.releaseVersion);
        if (currentCloudbase.cacheEpoch !== cloudbaseBaseline.cacheEpoch) throw fail("PUBLICATION_BASELINE_CHANGED");
        release.activateReleaseVersion(plan.releaseVersion, { expectedActiveReleaseVersion: plan.expectedActiveReleaseVersion, publicationLease: lease });
      },
      activateCloudbase: async committed => {
        const current = await readOracle();
        guard.assertExpectedVersion(current.releaseVersion, plan.releaseVersion);
        if (current.cacheEpoch !== committed.pointer.cacheEpoch) throw fail("PUBLICATION_BASELINE_CHANGED");
        const result = await cloudbase.cutoverReleasePack({ ...common, activePointerOverride: current, oracleActiveReleaseVersion: current.releaseVersion, publicationLease: lease, confirmation: "CONFIRM_CLOUDBASE_CUTOVER", gitStatusRecorded: true, commandRunner, strictPublication: true, currentPointerReader: readCloudbase });
        const remote = await readCloudbase();
        if (remote.releaseVersion !== current.releaseVersion || remote.cacheEpoch !== current.cacheEpoch || remote.term !== current.term) throw fail("PUBLICATION_POINTER_CONFLICT");
        return result;
      },
    };
    return await contract.publish({ ...plan, approved: true }, operations);
  } finally { lease(); }
}
module.exports = { assertApproval, publishPrepared, RECEIPTS };
