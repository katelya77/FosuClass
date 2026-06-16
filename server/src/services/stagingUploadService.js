const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const zlib = require("zlib");
const { safeLog } = require("../utils/safeLogger");
const releaseService = require("./releaseService");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const UPLOAD_ROOT = process.env.STAGING_DIR
  ? path.resolve(process.env.STAGING_DIR)
  : path.join(STORAGE_DIR, "staging-uploads");
const INDEX_PATH = path.join(UPLOAD_ROOT, "uploads.json");
const RECORD_INDEX_PATH = path.join(STORAGE_DIR, "upload-record-index.json");
const DIRECT_STAGING_UPLOAD_DIR = path.join(STORAGE_DIR, "staging-direct-upload");
const RESOURCE_UPLOAD_STAGING_DIR = path.join(STORAGE_DIR, "resource-upload-staging");
const SYNC_HISTORY_PATH = path.join(path.resolve(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../data")), "sync-history.json");
const RELAY_UPLOADS_PATH = path.join(STORAGE_DIR, "relay", "uploads.json");
const STAGING_LATEST_PATH = path.join(STORAGE_DIR, "staging-latest.json");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureStorage() {
  ensureDir(UPLOAD_ROOT);
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return parsed == null ? fallback : parsed;
  } catch (error) {
    safeLog("staging-upload-read-json-failed", { filePath, error: error.message });
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  try {
    if (fs.existsSync(filePath) && process.platform === "win32") {
      try { fs.unlinkSync(filePath); } catch (error) {}
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    try { fs.unlinkSync(tempPath); } catch (cleanupError) {}
  }
}

function sanitizeFileName(value) {
  const base = path.basename(String(value || "staging.json"));
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  return safe || "staging.json";
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    const error = new Error("Invalid staging upload path");
    error.statusCode = 400;
    throw error;
  }
}

function getUploadDir(uploadId) {
  ensureStorage();
  const safeId = String(uploadId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) {
    const error = new Error("Missing uploadId");
    error.statusCode = 400;
    throw error;
  }
  const dir = path.join(UPLOAD_ROOT, safeId);
  assertInside(UPLOAD_ROOT, dir);
  return dir;
}

function getManifestPath(uploadId) {
  return path.join(getUploadDir(uploadId), "manifest.json");
}

function readIndex() {
  ensureStorage();
  const list = readJsonFile(INDEX_PATH, []);
  return Array.isArray(list) ? list : [];
}

function writeIndex(list) {
  writeJsonAtomic(INDEX_PATH, list.slice(0, 200));
}

function normalizeRecordTime(record) {
  return Date.parse(
    record.updatedAt ||
    record.pendingReviewAt ||
    record.finalizedAt ||
    record.createdAt ||
    ""
  ) || 0;
}

function toUploadRecord(manifest, extra = {}) {
  const item = publicManifest(manifest || {});
  if (!item) return null;
  const summary = item.summary || {};
  return Object.assign({
    schemaVersion: 1,
    uploadId: item.uploadId || extra.uploadId || "",
    source: item.source || item.actorType || extra.source || "cli",
    fileName: item.fileName || item.originalFileName || "",
    term: item.term || summary.term || "",
    releaseVersion: item.releaseVersion || summary.releaseVersion || "",
    canonicalHash: item.canonicalHash || summary.canonicalHash || "",
    canonicalHashPrefix: String(item.canonicalHash || summary.canonicalHash || "").slice(0, 12),
    fileSize: Number(item.originalSize || item.sourceSize || item.uploadSize || 0) || 0,
    uploadSize: Number(item.uploadSize || 0) || 0,
    chunkCount: Number(item.totalChunks || item.chunkCount || 0) || 0,
    uploadedChunks: Number(item.uploadedChunks || item.receivedCount || 0) || 0,
    stagingState: item.stagingState || item.status || "unknown",
    releaseState: item.releaseState || (item.publishedReleaseVersion ? "published" : "not-built"),
    runtimeState: item.runtimeState || (item.active ? "active" : "inactive"),
    failureReason: item.failureReason || item.error || "",
    publishedReleaseVersion: item.publishedReleaseVersion || item.publishedVersion || "",
    active: Boolean(item.active),
    status: item.status || item.stagingState || "unknown",
    createdAt: item.createdAt || "",
    updatedAt: item.updatedAt || item.createdAt || "",
    missingManifest: Boolean(extra.missingManifest),
    note: extra.missingManifest ? "历史索引记录，原始详情不可用" : "",
  }, item, extra);
}

function readRecordIndex() {
  ensureStorage();
  const payload = readJsonFile(RECORD_INDEX_PATH, null);
  const records = Array.isArray(payload) ? payload : Array.isArray(payload && payload.records) ? payload.records : null;
  if (records) return records;
  return rebuildUploadRecordIndex({ reason: "missing-index" }).records;
}

function writeRecordIndex(records, extra = {}) {
  const next = (records || [])
    .filter(Boolean)
    .sort((left, right) => normalizeRecordTime(right) - normalizeRecordTime(left))
    .slice(0, 5000);
  writeJsonAtomic(RECORD_INDEX_PATH, {
    schemaVersion: 1,
    rebuiltAt: extra.rebuiltAt || new Date().toISOString(),
    reason: extra.reason || "update",
    total: next.length,
    records: next,
  });
  return next;
}

function updateRecordIndex(manifest) {
  const record = toUploadRecord(manifest);
  if (!record || !record.uploadId) return null;
  const current = readRecordIndex().filter((item) => item.uploadId !== record.uploadId);
  current.unshift(record);
  writeRecordIndex(current, { reason: "manifest-update" });
  return record;
}

function publicManifest(manifest) {
  if (!manifest) return null;
  const copy = Object.assign({}, manifest);
  const chunkStatus = getChunkStatus(manifest);
  const summary = manifest.summary || {};
  const canonicalHash = manifest.canonicalHash || summary.canonicalHash || summary.stagingCanonicalHash || "";
  const publishedReleaseVersion = manifest.publishedReleaseVersion || manifest.publishedVersion || "";
  copy.sourceSize = manifest.originalSize || 0;
  copy.gzipSize = manifest.contentEncoding === "gzip" ? manifest.uploadSize || 0 : 0;
  copy.chunkCount = manifest.totalChunks || 0;
  copy.uploadedChunks = chunkStatus.receivedCount;
  copy.receivedCount = chunkStatus.receivedCount;
  copy.receivedBytes = chunkStatus.receivedBytes;
  copy.progress = chunkStatus.progress;
  copy.counts = summary.counts || summary || {};
  copy.resourceCounts = summary.resourceCounts || manifest.resourceCounts || null;
  copy.totalScheduleDocuments = Number(summary.totalScheduleDocuments || 0) || 0;
  copy.active = Boolean(manifest.active);
  copy.stagingState = summary.stagingState || manifest.stagingState || (
    manifest.status === "initialized" || manifest.status === "uploading" || manifest.status === "merging" ? "uploading" :
      manifest.status === "validating" ? "validating" :
      manifest.status === "failed" ? "validation-failed" :
      manifest.status === "unchanged" || manifest.status === "duplicate" ? "duplicate" :
      manifest.status === "published" || manifest.status === "pending-review" ? "pending-review" :
      manifest.status || "pending-review"
  );
  copy.releaseState = summary.releaseState || manifest.releaseState || (publishedReleaseVersion ? "published" : "not-built");
  copy.runtimeState = summary.runtimeState || manifest.runtimeState || (copy.active ? "active" : "inactive");
  copy.canonicalHash = canonicalHash;
  copy.publishedReleaseVersion = publishedReleaseVersion;
  copy.publishedVersion = publishedReleaseVersion;
  copy.sourceTaskId = manifest.sourceTaskId || manifest.relayTaskId || "";
  delete copy.uploadDir;
  delete copy.joinedPath;
  delete copy.jsonPath;
  return copy;
}

function updateIndex(manifest) {
  const current = readIndex();
  const publicCopy = publicManifest(manifest);
  const next = current.filter((item) => item.uploadId !== manifest.uploadId);
  next.unshift(publicCopy);
  writeIndex(next);
  updateRecordIndex(manifest);
}

function writeManifest(manifest) {
  const dir = getUploadDir(manifest.uploadId);
  manifest.uploadDir = dir;
  writeJsonAtomic(path.join(dir, "manifest.json"), manifest);
  updateIndex(manifest);
}

function readManifest(uploadId) {
  const manifest = readJsonFile(getManifestPath(uploadId), null);
  if (!manifest) {
    const error = new Error("staging upload not found");
    error.statusCode = 404;
    throw error;
  }
  manifest.uploadDir = getUploadDir(uploadId);
  return manifest;
}

function toPositiveInteger(value, fallback, max) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(num), max || Math.floor(num));
}

function normalizeHash(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : "";
}

function checkActor(manifest, actor) {
  if (actor && actor.type === "admin") {
    return true;
  }
  if (!manifest.actorType || manifest.actorType === "admin") {
    return true;
  }
  if (!actor || actor.type !== manifest.actorType || String(actor.id || "") !== String(manifest.actorId || "")) {
    const error = new Error("staging upload token cannot access this upload");
    error.statusCode = 403;
    throw error;
  }
  return true;
}

function chunkPath(manifest, chunkIndex) {
  const filePath = path.join(manifest.uploadDir, `chunk-${String(chunkIndex).padStart(6, "0")}.part`);
  assertInside(manifest.uploadDir, filePath);
  return filePath;
}

function getReceivedBytes(receivedChunks) {
  return Object.values(receivedChunks || {}).reduce((sum, chunk) => sum + Number(chunk.size || 0), 0);
}

function getChunkStatus(manifest) {
  const receivedChunks = manifest.receivedChunks || {};
  const receivedCount = Object.keys(receivedChunks).length;
  const receivedBytes = getReceivedBytes(receivedChunks);
  return {
    receivedCount,
    receivedBytes,
    totalChunks: manifest.totalChunks,
    progress: manifest.uploadSize > 0
      ? Number(Math.min(100, (receivedBytes / manifest.uploadSize) * 100).toFixed(2))
      : 0,
  };
}

function initUpload(input, actor) {
  ensureStorage();
  const chunkSize = toPositiveInteger(input.chunkSize, 8 * 1024 * 1024, 64 * 1024 * 1024);
  const uploadSize = toPositiveInteger(input.uploadSize || input.size, 0);
  if (!uploadSize) {
    const error = new Error("uploadSize must be greater than 0");
    error.statusCode = 400;
    throw error;
  }
  const totalChunks = toPositiveInteger(input.totalChunks, Math.ceil(uploadSize / chunkSize), 100000);
  if (totalChunks !== Math.ceil(uploadSize / chunkSize)) {
    const error = new Error("totalChunks does not match uploadSize and chunkSize");
    error.statusCode = 400;
    throw error;
  }

  const uploadId = `stg_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  const dir = getUploadDir(uploadId);
  ensureDir(dir);

  const manifest = {
    uploadId,
    fileName: sanitizeFileName(input.fileName),
    originalFileName: String(input.fileName || ""),
    term: String(input.term || ""),
    releaseVersion: String(input.releaseVersion || ""),
    note: String(input.note || ""),
    source: String(input.source || (actor && actor.type) || "local-upload"),
    actorType: actor && actor.type ? String(actor.type) : "admin",
    actorId: actor && actor.id ? String(actor.id) : "",
    contentEncoding: input.contentEncoding === "gzip" ? "gzip" : "identity",
    contentType: String(input.contentType || "application/json"),
    chunkSize,
    totalChunks,
    uploadSize,
    uploadSha256: normalizeHash(input.uploadSha256 || input.sha256),
    originalSize: toPositiveInteger(input.originalSize, 0),
    originalSha256: normalizeHash(input.originalSha256),
    canonicalHash: normalizeHash(input.canonicalHash),
    receivedChunks: {},
    status: "initialized",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    uploadDir: dir,
  };
  writeManifest(manifest);
  return publicManifest(manifest);
}

function writeChunk(uploadId, chunkIndexRaw, buffer, actor, options = {}) {
  const manifest = readManifest(uploadId);
  checkActor(manifest, actor);
  const chunkIndex = Number(chunkIndexRaw);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= manifest.totalChunks) {
    const error = new Error("Invalid chunkIndex");
    error.statusCode = 400;
    throw error;
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error("Chunk body cannot be empty");
    error.statusCode = 400;
    throw error;
  }

  const expectedSize = chunkIndex === manifest.totalChunks - 1
    ? manifest.uploadSize - manifest.chunkSize * (manifest.totalChunks - 1)
    : manifest.chunkSize;
  if (buffer.length !== expectedSize) {
    const error = new Error(`Chunk ${chunkIndex} size mismatch: expected ${expectedSize}, got ${buffer.length}`);
    error.statusCode = 400;
    throw error;
  }

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const expectedHash = normalizeHash(options.chunkSha256);
  if (expectedHash && expectedHash !== sha256) {
    const error = new Error(`Chunk ${chunkIndex} hash mismatch`);
    error.statusCode = 400;
    throw error;
  }

  fs.writeFileSync(chunkPath(manifest, chunkIndex), buffer);
  manifest.receivedChunks[String(chunkIndex)] = {
    size: buffer.length,
    sha256,
    receivedAt: new Date().toISOString(),
  };
  manifest.status = "uploading";
  manifest.updatedAt = new Date().toISOString();
  writeManifest(manifest);
  return Object.assign(publicManifest(manifest), getChunkStatus(manifest));
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(filePath, "r");
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function concatChunks(manifest) {
  const joinedPath = path.join(manifest.uploadDir, manifest.contentEncoding === "gzip" ? "payload.json.gz" : "payload.json");
  assertInside(manifest.uploadDir, joinedPath);
  const out = fs.openSync(joinedPath, "w");
  const hash = crypto.createHash("sha256");
  let totalSize = 0;
  try {
    for (let index = 0; index < manifest.totalChunks; index += 1) {
      const filePath = chunkPath(manifest, index);
      if (!fs.existsSync(filePath)) {
        const error = new Error(`Missing chunk ${index}`);
        error.statusCode = 400;
        throw error;
      }
      const buffer = fs.readFileSync(filePath);
      const recorded = manifest.receivedChunks[String(index)];
      const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      if (!recorded || recorded.size !== buffer.length || recorded.sha256 !== sha256) {
        const error = new Error(`Chunk ${index} verification failed`);
        error.statusCode = 400;
        throw error;
      }
      fs.writeSync(out, buffer);
      hash.update(buffer);
      totalSize += buffer.length;
    }
  } finally {
    fs.closeSync(out);
  }
  return {
    joinedPath,
    uploadSize: totalSize,
    uploadSha256: hash.digest("hex"),
  };
}

async function finalizeUploadFiles(uploadId, actor, expected = {}) {
  const manifest = readManifest(uploadId);
  checkActor(manifest, actor);
  const received = getChunkStatus(manifest);
  if (received.receivedCount !== manifest.totalChunks || received.receivedBytes !== manifest.uploadSize) {
    const error = new Error(`Upload is incomplete: ${received.receivedCount}/${manifest.totalChunks} chunks`);
    error.statusCode = 400;
    throw error;
  }

  manifest.status = "merging";
  manifest.updatedAt = new Date().toISOString();
  writeManifest(manifest);

  const merged = concatChunks(manifest);
  const expectedUploadHash = normalizeHash(expected.uploadSha256 || expected.sha256 || manifest.uploadSha256);
  if (merged.uploadSize !== manifest.uploadSize) {
    const error = new Error("Merged upload size mismatch");
    error.statusCode = 400;
    throw error;
  }
  if (expectedUploadHash && merged.uploadSha256 !== expectedUploadHash) {
    const error = new Error("Merged upload hash mismatch");
    error.statusCode = 400;
    throw error;
  }

  const jsonPath = path.join(manifest.uploadDir, "payload.json");
  assertInside(manifest.uploadDir, jsonPath);
  if (manifest.contentEncoding === "gzip") {
    await pipeline(
      fs.createReadStream(merged.joinedPath),
      zlib.createGunzip(),
      fs.createWriteStream(jsonPath)
    );
  } else if (merged.joinedPath !== jsonPath) {
    fs.copyFileSync(merged.joinedPath, jsonPath);
  }

  const originalStat = fs.statSync(jsonPath);
  const expectedOriginalSize = toPositiveInteger(expected.originalSize || manifest.originalSize, 0);
  if (expectedOriginalSize && originalStat.size !== expectedOriginalSize) {
    const error = new Error("Decompressed JSON size mismatch");
    error.statusCode = 400;
    throw error;
  }
  const expectedOriginalHash = normalizeHash(expected.originalSha256 || manifest.originalSha256);
  if (expectedOriginalHash && hashFile(jsonPath) !== expectedOriginalHash) {
    const error = new Error("Decompressed JSON hash mismatch");
    error.statusCode = 400;
    throw error;
  }

  manifest.status = "validating";
  manifest.joinedPath = merged.joinedPath;
  manifest.jsonPath = jsonPath;
  manifest.finalizedAt = new Date().toISOString();
  manifest.updatedAt = manifest.finalizedAt;
  writeManifest(manifest);

  return {
    manifest: publicManifest(readManifest(uploadId)),
    jsonPath,
    joinedPath: merged.joinedPath,
  };
}

async function finalizeUpload(uploadId, actor, expected = {}) {
  const finalized = await finalizeUploadFiles(uploadId, actor, expected);
  let stagingData;
  try {
    stagingData = JSON.parse(fs.readFileSync(finalized.jsonPath, "utf-8"));
  } catch (error) {
    markUploadFailed(uploadId, `JSON parse failed: ${error.message}`);
    error.statusCode = 400;
    throw error;
  }

  return {
    manifest: publicManifest(readManifest(uploadId)),
    stagingData,
    jsonPath: finalized.jsonPath,
  };
}

function markUploadPendingReview(uploadId, summary) {
  const manifest = readManifest(uploadId);
  manifest.status = "pending-review";
  manifest.summary = summary || {};
  manifest.resourceCounts = summary?.resourceCounts || manifest.resourceCounts || null;
  manifest.stagingState = summary?.stagingState || "pending-review";
  manifest.releaseState = summary?.releaseState || "not-built";
  manifest.runtimeState = summary?.runtimeState || "inactive";
  manifest.term = summary?.term || manifest.term;
  manifest.releaseVersion = summary?.releaseVersion || manifest.releaseVersion;
  manifest.pendingReviewAt = new Date().toISOString();
  manifest.updatedAt = manifest.pendingReviewAt;
  writeManifest(manifest);
  return publicManifest(manifest);
}

function normalizePublishedSummary(summary, manifest, version, extra = {}) {
  const next = Object.assign({}, summary || {});
  const publishedVersion = version || manifest.publishedReleaseVersion || manifest.publishedVersion || manifest.releaseVersion || next.releaseVersion || "";
  const publishedAt = extra.publishedAt || manifest.publishedAt || new Date().toISOString();
  const active = extra.active === undefined ? true : Boolean(extra.active);
  const previousBlockers = []
    .concat(Array.isArray(next.blockers) ? next.blockers : [])
    .concat(Array.isArray(next.blockerDetails) ? next.blockerDetails : []);
  const previousCodes = []
    .concat(Array.isArray(next.blockerCodes) ? next.blockerCodes : [])
    .concat(Array.isArray(next.contractComparison && next.contractComparison.blockers)
      ? next.contractComparison.blockers.map((item) => item && item.code).filter(Boolean)
      : []);

  next.releaseVersion = publishedVersion || next.releaseVersion || "";
  next.publishedReleaseVersion = publishedVersion;
  next.publishedVersion = publishedVersion;
  next.publishedAt = publishedAt;
  next.stagingState = "published";
  next.releaseState = "published";
  next.runtimeState = active ? "active" : "inactive";
  next.active = active;

  if (previousBlockers.length || previousCodes.length) {
    next.resolvedBlockers = next.resolvedBlockers || previousBlockers;
    next.resolvedBlockerCodes = next.resolvedBlockerCodes || Array.from(new Set(previousCodes));
    next.resolvedAt = next.resolvedAt || publishedAt;
    next.resolvedBy = next.resolvedBy || "publish-success";
  }
  next.blockers = [];
  next.blockerDetails = [];
  next.blockerCodes = [];
  if (next.safetyReport && typeof next.safetyReport === "object") {
    next.safetyReport = Object.assign({}, next.safetyReport, {
      allowPublish: true,
      blockers: [],
      blockerDetails: [],
      blockerCodes: [],
      resolvedAt: next.safetyReport.resolvedAt || publishedAt,
      resolvedBy: next.safetyReport.resolvedBy || "publish-success",
    });
  }
  if (next.contractComparison && typeof next.contractComparison === "object") {
    next.previousContractComparison = next.previousContractComparison || next.contractComparison;
    next.contractComparison = Object.assign({}, next.contractComparison, {
      allowPublish: true,
      blockers: [],
      resolvedAt: next.contractComparison.resolvedAt || publishedAt,
      resolvedBy: next.contractComparison.resolvedBy || "publish-success",
    });
  }
  return next;
}

function markUploadPublished(uploadId, version, extra = {}) {
  try {
    const manifest = readManifest(uploadId);
    manifest.status = "published";
    manifest.stagingState = "published";
    manifest.releaseState = "published";
    manifest.runtimeState = extra.active === false ? "inactive" : "active";
    manifest.publishedReleaseVersion = version || manifest.publishedReleaseVersion || manifest.publishedVersion || manifest.releaseVersion || "";
    manifest.publishedVersion = manifest.publishedReleaseVersion;
    manifest.publishedAt = extra.publishedAt || manifest.publishedAt || new Date().toISOString();
    manifest.active = extra.active === undefined ? Boolean(manifest.active) : Boolean(extra.active);
    manifest.sourceTaskId = extra.sourceTaskId || manifest.sourceTaskId || "";
    if (extra.canonicalHash) {
      manifest.canonicalHash = extra.canonicalHash;
    }
    manifest.summary = normalizePublishedSummary(manifest.summary, manifest, manifest.publishedReleaseVersion, extra);
    manifest.resourceCounts = manifest.summary.resourceCounts || manifest.resourceCounts || null;
    manifest.updatedAt = manifest.publishedAt;
    writeManifest(manifest);
    return publicManifest(manifest);
  } catch (error) {
    safeLog("staging-upload-mark-published-failed", { uploadId, error: error.message });
    return null;
  }
}

function markUploadSuperseded(uploadId, version, extra = {}) {
  try {
    const manifest = readManifest(uploadId);
    manifest.status = extra.status || "superseded";
    manifest.publishedReleaseVersion = version || manifest.publishedReleaseVersion || manifest.publishedVersion || manifest.releaseVersion || "";
    manifest.publishedVersion = manifest.publishedReleaseVersion;
    manifest.stagingState = manifest.status === "duplicate" ? "duplicate" : "archived";
    manifest.releaseState = manifest.publishedReleaseVersion ? "published" : "not-built";
    manifest.runtimeState = "inactive";
    manifest.supersededAt = extra.supersededAt || manifest.supersededAt || new Date().toISOString();
    manifest.publishedAt = manifest.publishedAt || extra.publishedAt || "";
    manifest.active = false;
    manifest.sourceTaskId = extra.sourceTaskId || manifest.sourceTaskId || "";
    if (extra.canonicalHash) {
      manifest.canonicalHash = extra.canonicalHash;
    }
    manifest.updatedAt = manifest.supersededAt;
    writeManifest(manifest);
    return publicManifest(manifest);
  } catch (error) {
    safeLog("staging-upload-mark-superseded-failed", { uploadId, error: error.message });
    return null;
  }
}

function markUploadUnchanged(uploadId, summary) {
  try {
    const manifest = readManifest(uploadId);
    manifest.status = "unchanged";
    manifest.summary = summary || {};
    manifest.resourceCounts = summary?.resourceCounts || manifest.resourceCounts || null;
    manifest.stagingState = summary?.stagingState || "duplicate";
    manifest.releaseState = summary?.releaseState || "not-built";
    manifest.runtimeState = summary?.runtimeState || "inactive";
    manifest.term = summary?.term || manifest.term;
    manifest.releaseVersion = summary?.releaseVersion || manifest.releaseVersion;
    manifest.canonicalHash = summary?.canonicalHash || manifest.canonicalHash || "";
    manifest.unchangedReason = summary?.unchangedReason || "same-canonical-hash";
    manifest.unchangedAt = new Date().toISOString();
    manifest.updatedAt = manifest.unchangedAt;
    writeManifest(manifest);
    return publicManifest(manifest);
  } catch (error) {
    safeLog("staging-upload-mark-unchanged-failed", { uploadId, error: error.message });
    return null;
  }
}

function markUploadFailed(uploadId, reason) {
  try {
    const manifest = readManifest(uploadId);
    manifest.status = "failed";
    manifest.stagingState = "validation-failed";
    manifest.releaseState = manifest.releaseState || "not-built";
    manifest.runtimeState = manifest.runtimeState || "inactive";
    manifest.failureReason = String(reason || "unknown error");
    manifest.failedAt = new Date().toISOString();
    manifest.updatedAt = manifest.failedAt;
    writeManifest(manifest);
    return publicManifest(manifest);
  } catch (error) {
    safeLog("staging-upload-mark-failed-failed", { uploadId, error: error.message });
    return null;
  }
}

function markUploadStage(uploadId, status, patch = {}) {
  const manifest = readManifest(uploadId);
  manifest.status = String(status || manifest.status || "uploading");
  manifest.stagingState = patch.stagingState || manifest.stagingState || manifest.status;
  manifest.releaseState = patch.releaseState || manifest.releaseState || "not-built";
  manifest.runtimeState = patch.runtimeState || manifest.runtimeState || "inactive";
  manifest.workerPid = patch.workerPid || manifest.workerPid || null;
  manifest.jobId = patch.jobId || manifest.jobId || "";
  manifest.phase = patch.phase || manifest.status;
  manifest.progress = patch.progress == null ? manifest.progress : patch.progress;
  manifest.updatedAt = new Date().toISOString();
  writeManifest(Object.assign(manifest, patch || {}));
  return publicManifest(readManifest(uploadId));
}

function getUploadStatus(uploadId, actor) {
  const manifest = readManifest(uploadId);
  checkActor(manifest, actor);
  return Object.assign(publicManifest(manifest), getChunkStatus(manifest));
}

function normalizeListOptions(input) {
  if (input && typeof input === "object") {
    return {
      limit: toPositiveInteger(input.limit, 50, 200),
      cursor: Math.max(0, Number(input.cursor || input.offset || 0) || 0),
      term: String(input.term || "").trim(),
      status: String(input.status || input.stagingState || "").trim(),
    };
  }
  return { limit: toPositiveInteger(input, 20, 200), cursor: 0, term: "", status: "" };
}

function matchesUploadRecordOptions(item, options) {
  if (!item) return false;
  if (options.term && String(item.term || item.semester || "").trim() !== options.term) return false;
  if (options.status) {
    const fields = [
      item.status,
      item.stagingState,
      item.uploadStatus,
      item.validationStatus,
      item.releaseState,
      item.runtimeState,
    ];
    if (!fields.some((value) => String(value || "").trim() === options.status)) return false;
  }
  return true;
}

function hydrateUploadRecord(item) {
  try {
    return publicManifest(readManifest(item.uploadId));
  } catch (error) {
    return toUploadRecord(item, { missingManifest: true });
  }
}

function decorateDuplicateUploadRecords(records) {
  const hydrated = (records || []).filter(Boolean);
  const groups = new Map();
  hydrated.forEach((item) => {
    const term = String(item.term || item.summary?.term || "").trim();
    const hash = getManifestCanonicalHash(item);
    const key = term && hash ? `${term}:${hash}` : "";
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item.uploadId);
  });

  return hydrated.map((item) => {
    const term = String(item.term || item.summary?.term || "").trim();
    const hash = getManifestCanonicalHash(item);
    const key = term && hash ? `${term}:${hash}` : "";
    const duplicates = key ? groups.get(key) || [] : [];
    return Object.assign({}, item, {
      duplicateReleaseVersion: duplicates.length > 1,
      duplicateKeepLatest: duplicates.length > 1 ? duplicates[0] === item.uploadId : true,
      duplicateUploadIds: duplicates,
      duplicateGroupKey: key,
      duplicateCount: Math.max(0, duplicates.length - 1),
    });
  });
}

function listUploads(input = 20) {
  const options = normalizeListOptions(input);
  const raw = readRecordIndex()
    .filter((item) => matchesUploadRecordOptions(item, options))
    .slice(options.cursor, options.cursor + options.limit);
  return decorateDuplicateUploadRecords(raw.map(hydrateUploadRecord));
}

function listUploadRecords(options = {}) {
  const normalized = normalizeListOptions(options);
  const all = readRecordIndex()
    .filter((item) => matchesUploadRecordOptions(item, normalized));
  const records = all
    .slice(normalized.cursor, normalized.cursor + normalized.limit)
    .map((item) => toUploadRecord(item, { missingManifest: Boolean(item.missingManifest) }))
    .filter(Boolean);
  return {
    success: true,
    records: decorateDuplicateUploadRecords(records),
    total: all.length,
    limit: normalized.limit,
    cursor: normalized.cursor,
    nextCursor: normalized.cursor + normalized.limit < all.length ? normalized.cursor + normalized.limit : null,
    indexPath: RECORD_INDEX_PATH,
  };
}

function pushUploadRecord(records, manifest, extra = {}) {
  const record = toUploadRecord(manifest, extra);
  if (record && record.uploadId) records.push(record);
}

function scanManifestDirectory(records, dirPath, source) {
  if (!fs.existsSync(dirPath)) return;
  fs.readdirSync(dirPath, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const manifestPath = path.join(fullPath, "manifest.json");
      const manifest = readJsonFile(manifestPath, null);
      if (manifest && manifest.uploadId) {
        pushUploadRecord(records, manifest, { source: manifest.source || source });
      } else {
        pushUploadRecord(records, {
          uploadId: entry.name,
          source,
          status: "unknown",
          createdAt: "",
          updatedAt: "",
        }, { missingManifest: true });
      }
      return;
    }
    if (!entry.isFile() || !/\.json$/i.test(entry.name)) return;
    const stat = fs.statSync(fullPath);
    if (stat.size > 2 * 1024 * 1024) {
      pushUploadRecord(records, {
        uploadId: path.basename(entry.name, path.extname(entry.name)),
        source,
        status: "unknown",
        fileName: entry.name,
        originalSize: stat.size,
        createdAt: new Date(stat.mtimeMs).toISOString(),
        updatedAt: new Date(stat.mtimeMs).toISOString(),
      }, { missingManifest: true });
      return;
    }
    const manifest = readJsonFile(fullPath, null);
    if (manifest && (manifest.uploadId || manifest.id || manifest.taskId)) {
      pushUploadRecord(records, Object.assign({}, manifest, {
        uploadId: manifest.uploadId || manifest.id || manifest.taskId,
        source: manifest.source || source,
      }));
    }
  });
}

function importSyncHistoryRecords(records) {
  const payload = readJsonFile(SYNC_HISTORY_PATH, null);
  const items = Array.isArray(payload) ? payload : Array.isArray(payload && payload.items) ? payload.items : Array.isArray(payload && payload.history) ? payload.history : [];
  items.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const uploadId = item.uploadId || item.stagingUploadId || item.taskId || item.id || `sync-history-${index}`;
    pushUploadRecord(records, {
      uploadId,
      source: item.source || item.syncSource || "sync-history",
      status: item.status || item.stagingState || "history",
      term: item.term || item.semester || "",
      releaseVersion: item.releaseVersion || item.version || "",
      canonicalHash: item.canonicalHash || item.hash || "",
      originalSize: item.fileSize || item.size || 0,
      createdAt: item.createdAt || item.startedAt || item.time || item.updatedAt || "",
      updatedAt: item.updatedAt || item.completedAt || item.time || item.createdAt || "",
      failureReason: item.failureReason || item.error || "",
      publishedReleaseVersion: item.publishedReleaseVersion || item.publishedVersion || "",
      summary: item.summary || null,
    }, { missingManifest: true });
  });
}

function importRelayUploadRecords(records) {
  const payload = readJsonFile(RELAY_UPLOADS_PATH, null);
  const items = Array.isArray(payload) ? payload : Array.isArray(payload && payload.uploads) ? payload.uploads : Array.isArray(payload && payload.items) ? payload.items : [];
  items.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    pushUploadRecord(records, Object.assign({}, item, {
      uploadId: item.uploadId || item.id || item.taskId || `relay-upload-${index}`,
      source: item.source || "relay",
      status: item.status || "history",
    }), { missingManifest: !item.uploadId });
  });
}

function rebuildUploadRecordIndex(options = {}) {
  ensureStorage();
  const records = [];
  readIndex().forEach((item) => {
    if (item && item.uploadId) pushUploadRecord(records, item);
  });
  if (fs.existsSync(UPLOAD_ROOT)) {
    fs.readdirSync(UPLOAD_ROOT, { withFileTypes: true }).forEach((entry) => {
      if (!entry.isDirectory()) return;
      const manifestPath = path.join(UPLOAD_ROOT, entry.name, "manifest.json");
      const manifest = readJsonFile(manifestPath, null);
      if (manifest && manifest.uploadId) {
        pushUploadRecord(records, manifest);
      } else {
        pushUploadRecord(records, {
          uploadId: entry.name,
          source: "cli",
          status: "unknown",
          createdAt: "",
          updatedAt: "",
        }, { missingManifest: true });
      }
    });
  }
  scanManifestDirectory(records, DIRECT_STAGING_UPLOAD_DIR, "staging-direct-upload");
  scanManifestDirectory(records, RESOURCE_UPLOAD_STAGING_DIR, "resource-upload-staging");
  importSyncHistoryRecords(records);
  importRelayUploadRecords(records);
  const byId = new Map();
  records.filter(Boolean).forEach((record) => {
    const id = record.uploadId;
    const existing = byId.get(id);
    if (!existing || normalizeRecordTime(record) >= normalizeRecordTime(existing)) byId.set(id, record);
  });
  const written = writeRecordIndex(Array.from(byId.values()), {
    reason: options.reason || "manual-rebuild",
    rebuiltAt: new Date().toISOString(),
  });
  return { success: true, rebuilt: true, total: written.length, records: written, indexPath: RECORD_INDEX_PATH };
}

function manifestTime(manifest) {
  return Date.parse(
    manifest.publishedAt ||
    manifest.pendingReviewAt ||
    manifest.finalizedAt ||
    manifest.updatedAt ||
    manifest.createdAt ||
    ""
  ) || 0;
}

function getManifestCanonicalHash(manifest) {
  const summary = manifest && manifest.summary || {};
  return String(
    manifest && manifest.canonicalHash ||
    summary.canonicalHash ||
    summary.stagingCanonicalHash ||
    summary.meta && summary.meta.canonicalHash ||
    ""
  ).trim().toLowerCase();
}

function getManifestReleaseVersion(manifest) {
  const summary = manifest && manifest.summary || {};
  return String(
    manifest && (manifest.publishedReleaseVersion || manifest.publishedVersion || manifest.releaseVersion) ||
    summary.publishedReleaseVersion ||
    summary.releaseVersion ||
    ""
  ).trim();
}

function getLatestStagingUploadId() {
  const latest = readJsonFile(STAGING_LATEST_PATH, null);
  const meta = latest && latest.meta || {};
  return String(
    latest && (latest.stagingUploadId || latest.uploadId) ||
    meta.stagingUploadId ||
    meta.uploadId ||
    ""
  ).trim();
}

function assertUploadCanDelete(uploadId, manifest) {
  const item = manifest || {};
  const status = String(item.status || item.stagingState || "").toLowerCase();
  const busyStates = new Set(["initialized", "uploading", "uploaded", "merging", "validating", "publishing"]);
  const time = Date.parse(item.updatedAt || item.createdAt || item.uploadedAt || "") || Date.now();
  const staleIncomplete = ["initialized", "uploading", "uploaded", "merging"].includes(status) && Date.now() - time > 24 * 3600000;
  if (busyStates.has(status) && !staleIncomplete) {
    const error = new Error("当前上传记录正在上传、校验或发布，禁止删除");
    error.statusCode = 409;
    error.code = "STAGING_UPLOAD_BUSY";
    throw error;
  }

  const latestUploadId = getLatestStagingUploadId();
  if (latestUploadId && latestUploadId === uploadId) {
    const error = new Error("当前 staging-latest 的唯一来源禁止删除，请先发布、替换或解除引用");
    error.statusCode = 409;
    error.code = "STAGING_UPLOAD_LATEST_REFERENCE";
    throw error;
  }

  let active = null;
  try {
    active = releaseService.getActiveReleaseInfoFast && releaseService.getActiveReleaseInfoFast();
  } catch (error) {
    active = null;
  }
  const activeHash = String(active && active.canonicalHash || "").trim().toLowerCase();
  const activeVersion = String(active && (active.version || active.releaseVersion) || "").trim();
  const uploadHash = getManifestCanonicalHash(item);
  const uploadVersion = getManifestReleaseVersion(item);
  if (item.active === true || (activeHash && uploadHash && activeHash === uploadHash) || (activeVersion && uploadVersion && activeVersion === uploadVersion)) {
    const error = new Error("Active 对应上传记录禁止删除");
    error.statusCode = 409;
    error.code = "STAGING_UPLOAD_ACTIVE_REFERENCE";
    throw error;
  }
}

function reconcileWithReleaseState(options = {}) {
  const active = options.activeRelease || {};
  const activeVersion = String(active.version || active.releaseVersion || options.activeReleaseVersion || "").trim();
  const activeCanonicalHash = String(active.canonicalHash || options.activeCanonicalHash || "").trim().toLowerCase();
  const publishedAt = active.publishedAt || active.activatedAt || active.updatedAt || new Date().toISOString();
  const sourceTaskId = options.sourceTaskId || "";
  const manifests = readIndex()
    .map((item) => {
      try {
        return readManifest(item.uploadId);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);

  const candidates = manifests.filter((manifest) => {
    const canonicalHash = getManifestCanonicalHash(manifest);
    const releaseVersion = getManifestReleaseVersion(manifest);
    if (activeCanonicalHash && canonicalHash && canonicalHash === activeCanonicalHash) return true;
    if (activeVersion && releaseVersion && releaseVersion === activeVersion) return true;
    if (options.uploadId && manifest.uploadId === options.uploadId) return true;
    return false;
  }).sort((left, right) => {
    if (options.uploadId) {
      if (left.uploadId === options.uploadId && right.uploadId !== options.uploadId) return -1;
      if (right.uploadId === options.uploadId && left.uploadId !== options.uploadId) return 1;
    }
    if (left.active === true && right.active !== true) return -1;
    if (right.active === true && left.active !== true) return 1;
    return manifestTime(right) - manifestTime(left);
  });

  let changed = 0;
  const touched = [];
  candidates.forEach((manifest, index) => {
    const canonicalHash = getManifestCanonicalHash(manifest) || activeCanonicalHash;
    if (index === 0) {
      const updated = markUploadPublished(manifest.uploadId, activeVersion, {
        active: true,
        publishedAt,
        sourceTaskId,
        canonicalHash,
      });
      if (updated) {
        changed += manifest.status !== "published" || manifest.active !== true ? 1 : 0;
        touched.push(updated);
      }
      return;
    }

    const status = manifest.status === "published" ? "superseded" : "duplicate";
    const updated = markUploadSuperseded(manifest.uploadId, activeVersion, {
      status,
      publishedAt,
      sourceTaskId,
      canonicalHash,
    });
    if (updated) {
      changed += manifest.status !== status || manifest.active !== false ? 1 : 0;
      touched.push(updated);
    }
  });

  return {
    changed,
    matched: candidates.length,
    activeReleaseVersion: activeVersion,
    activeCanonicalHash,
    uploads: touched,
  };
}

function deleteUpload(uploadId, actor) {
  const safeId = String(uploadId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) {
    const error = new Error("Missing uploadId");
    error.statusCode = 400;
    throw error;
  }

  let manifest = null;
  try {
    manifest = readManifest(safeId);
    checkActor(manifest, actor);
    assertUploadCanDelete(safeId, manifest);
  } catch (error) {
    if (error.statusCode !== 404) {
      throw error;
    }
  }

  const dir = getUploadDir(safeId);
  assertInside(UPLOAD_ROOT, dir);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const next = readIndex().filter((item) => item.uploadId !== safeId);
  writeIndex(next);
  writeRecordIndex(readRecordIndex().filter((item) => item.uploadId !== safeId), { reason: "delete-upload" });
  return publicManifest(manifest || { uploadId: safeId, status: "deleted" });
}

function normalizeStagingData(data) {
  const stagingData = Object.assign({}, data || {});
  if (!stagingData.classSchedules && stagingData.resources?.classSchedules) {
    stagingData.classSchedules = stagingData.resources.classSchedules;
  }
  if (!stagingData.resources || typeof stagingData.resources !== "object") {
    stagingData.resources = {};
  }
  stagingData.resources = Object.assign({
    teacherSchedules: stagingData.teacherSchedules || [],
    classroomSchedules: stagingData.classroomSchedules || [],
    courseSchedules: stagingData.courseSchedules || [],
    classrooms: stagingData.classrooms || [],
    teachers: stagingData.teachers || [],
    courses: stagingData.courses || [],
  }, stagingData.resources);
  return stagingData;
}

module.exports = {
  UPLOAD_ROOT,
  RECORD_INDEX_PATH,
  finalizeUploadFiles,
  finalizeUpload,
  getUploadStatus,
  initUpload,
  deleteUpload,
  listUploads,
  listUploadRecords,
  rebuildUploadRecordIndex,
  markUploadFailed,
  markUploadStage,
  markUploadUnchanged,
  markUploadPendingReview,
  markUploadPublished,
  markUploadSuperseded,
  normalizeStagingData,
  reconcileWithReleaseState,
  sanitizeFileName,
  writeChunk,
};
