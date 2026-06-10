const fs = require("fs");
const path = require("path");

const appConfigService = require("./appConfigService");
const releaseService = require("./releaseService");
const runtimePointerService = require("./runtimePointerService");
const termRegistryService = require("./termRegistryService");
const termReleaseIndexService = require("./termReleaseIndexService");
const {
  readFileBufferIfExists,
  restoreFileBuffer,
} = require("../utils/jsonFileStore");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const ADMIN_CONFIG_PATH = path.join(STORAGE_DIR, "admin-config.json");
const CURRENT_SNAPSHOT_PATH = path.join(STORAGE_DIR, "snapshots", "current.json");
const CURRENT_SNAPSHOT_GZ_PATH = path.join(STORAGE_DIR, "snapshots", "current.json.gz");

let activationQueue = Promise.resolve();

function enqueue(task) {
  const run = activationQueue.then(task, task);
  activationQueue = run.catch(() => {});
  return run;
}

function assertReady(term, releaseVersion) {
  const record = termRegistryService.getTerm(term);
  if (!record) {
    const error = new Error("TERM_NOT_FOUND");
    error.code = "TERM_NOT_FOUND";
    throw error;
  }
  if (!["ready", "current"].includes(record.status)) {
    const error = new Error("TERM_NOT_READY");
    error.code = "TERM_NOT_READY";
    throw error;
  }
  if (record.releaseVersion !== releaseVersion) {
    const error = new Error("TERM_REGISTRY_RELEASE_MISMATCH");
    error.code = "TERM_REGISTRY_RELEASE_MISMATCH";
    throw error;
  }
  const manifestCheck = termRegistryService.validateManifestForTerm(term, releaseVersion);
  if (!manifestCheck.valid) {
    const error = new Error(`TERM_RELEASE_MISMATCH: ${manifestCheck.errors.join("; ")}`);
    error.code = "TERM_RELEASE_MISMATCH";
    error.errors = manifestCheck.errors;
    throw error;
  }
  const pack = releaseService.getReleasePackQuickHealth(releaseVersion);
  if (!pack || !pack.healthy) {
    const error = new Error("RELEASE_PACK_UNHEALTHY");
    error.code = "RELEASE_PACK_UNHEALTHY";
    error.pack = pack;
    throw error;
  }
  const files = releaseService.getReleaseFiles(releaseVersion);
  if (!fs.existsSync(files.manifestPath) || !fs.existsSync(path.join(files.publicReleaseDir, "manifest.json"))) {
    const error = new Error("STATIC_RELEASE_FILES_MISSING");
    error.code = "STATIC_RELEASE_FILES_MISSING";
    throw error;
  }
  return { record, manifest: manifestCheck.manifest, pack };
}

function backupState() {
  return [
    releaseService.ACTIVE_RELEASE_PATH,
    CURRENT_SNAPSHOT_PATH,
    CURRENT_SNAPSHOT_GZ_PATH,
    termReleaseIndexService.TERM_INDEX_PATH,
    termRegistryService.REGISTRY_PATH,
    ADMIN_CONFIG_PATH,
    runtimePointerService.ACTIVE_RUNTIME_PATH,
  ].map((filePath) => ({
    filePath,
    buffer: readFileBufferIfExists(filePath),
  }));
}

function restoreState(state) {
  state.slice().reverse().forEach((item) => restoreFileBuffer(item.filePath, item.buffer));
  releaseService.clearDerivedCache();
  runtimePointerService.clearCache();
}

function activateTerm(term, releaseVersion, options = {}) {
  return enqueue(() => {
    const targetTerm = termRegistryService.validateTermId(term).term;
    const version = String(releaseVersion || "").trim();
    assertReady(targetTerm, version);
    const state = backupState();
    try {
      const activatedRelease = releaseService.activateReleaseVersion(version);
      const activeRecord = termRegistryService.getTerm(targetTerm);
      if (!activeRecord || activeRecord.status !== "current") {
        const error = new Error("TERM_ACTIVATION_REGISTRY_NOT_CURRENT");
        error.code = "TERM_ACTIVATION_REGISTRY_NOT_CURRENT";
        throw error;
      }
      appConfigService.touchDataVersionForSyncKey("release", {
        releaseVersion: version,
        semester: targetTerm,
        releaseNote: options.releaseNote || `Activated term ${targetTerm}`,
      });
      const manifest = releaseService.getReleasePackManifest(version);
      runtimePointerService.writeActivePointerForManifest(manifest);
      releaseService.clearDerivedCache();
      runtimePointerService.clearCache();
      return {
        success: true,
        term: activeRecord,
        releaseVersion: version,
        activatedRelease,
      };
    } catch (error) {
      restoreState(state);
      error.rollbackApplied = true;
      throw error;
    }
  });
}

module.exports = {
  activateTerm,
  backupState,
  restoreState,
};
