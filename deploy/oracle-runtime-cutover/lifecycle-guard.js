"use strict";
// Operational acceptance only. Does not import or invoke reconcile/publish.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const META_KEYS = ["stagingUploadStatus", "releaseStatus", "publishedReleaseVersion", "publishedAt", "active", "reconciledAt"];
function fail(code) { throw Object.assign(new Error(code), { code }); }
function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function read(file) { const s = fs.lstatSync(file); if (!s.isFile() || s.isSymbolicLink()) fail("STAGING_EVIDENCE_PATH_REJECTED"); return JSON.parse(fs.readFileSync(file, "utf8")); }
function strictEqual(a, b, rootMeta = false) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((value, index) => strictEqual(value, b[index]));
  const keysA = Object.keys(a).filter(k => !rootMeta || !META_KEYS.includes(k)).sort(), keysB = Object.keys(b).filter(k => !rootMeta || !META_KEYS.includes(k)).sort();
  return keysA.length === keysB.length && keysA.every((k, i) => k === keysB[i] && strictEqual(a[k], b[k]));
}
function protectedEqual(a, b) {
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) || Array.isArray(b)) return a === b;
  const keysA = Object.keys(a).filter(k => k !== "meta").sort(), keysB = Object.keys(b).filter(k => k !== "meta").sort();
  return keysA.length === keysB.length && keysA.every((k, i) => k === keysB[i] && strictEqual(a[k], b[k])) && strictEqual(a.meta || {}, b.meta || {}, true);
}
function compareStaging(before, after, authority, window = {}) {
  if (before === undefined) fail("STAGING_PRESTATE_OBJECT_UNAVAILABLE");
  if (strictEqual(before, after)) return { status: "PASS", exact: true, metadataOnly: false, changedPaths: [] };
  if (!before || !after || !protectedEqual(before, after)) fail("STAGING_PROTECTED_CONTENT_CHANGED");
  const canonicalHash = authority?.canonicalHash;
  if (!/^[a-f0-9]{64}$/.test(canonicalHash || "") || !/^[A-Za-z0-9._-]+$/.test(authority?.version || "")) fail("STAGING_ACTIVE_AUTHORITY_INVALID");
  const beforeHash = before.canonicalHash || before.meta?.canonicalHash, afterHash = after.canonicalHash || after.meta?.canonicalHash;
  if (beforeHash !== canonicalHash || afterHash !== canonicalHash) fail("STAGING_CANONICAL_NOT_ACTIVE");
  const meta = after.meta || {}, earliest = Date.parse(window.earliest || ""), latest = Date.parse(window.latest || ""), reconciled = Date.parse(meta.reconciledAt || "");
  if (meta.stagingUploadStatus !== "published" || meta.releaseStatus !== "published" || meta.publishedReleaseVersion !== authority.version || meta.active !== true) fail("STAGING_LIFECYCLE_VALUE_INVALID");
  if (!Number.isFinite(earliest) || !Number.isFinite(latest) || latest < earliest || !Number.isFinite(reconciled) || reconciled < earliest || reconciled > latest) fail("STAGING_RECONCILE_TIME_INVALID");
  const publishedAt = authority.publishedAt || authority.activatedAt;
  if (publishedAt ? meta.publishedAt !== publishedAt : (!Number.isFinite(Date.parse(meta.publishedAt || "")) || Date.parse(meta.publishedAt) < earliest || Date.parse(meta.publishedAt) > latest)) fail("STAGING_PUBLISHED_TIME_INVALID");
  const changedPaths = META_KEYS.filter(k => !strictEqual(before.meta?.[k], meta[k])).map(k => "meta." + k);
  return { status: "PASS", exact: false, metadataOnly: true, changedPaths };
}
function captureStaging({ storageDir, stateDir, label, expectedHash }) {
  if (!/^[a-z][a-z0-9-]{0,50}$/.test(label || "")) fail("STAGING_CAPTURE_LABEL_REJECTED");
  const source = path.join(storageDir, "staging-latest.json"), capturedAt = new Date().toISOString();
  if (!fs.existsSync(source)) { if (expectedHash !== undefined && expectedHash !== null) fail("STAGING_CAPTURE_HASH_CHANGED"); return { exists: false, sha256: null, capturedAt, path: null }; }
  const sourceStat = fs.lstatSync(source), stateStat = fs.lstatSync(stateDir);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || !stateStat.isDirectory() || stateStat.isSymbolicLink() || process.platform !== "win32" && ((stateStat.mode & 0o077) !== 0 || stateStat.uid !== 0)) fail("STAGING_EVIDENCE_PATH_REJECTED");
  const bytes = fs.readFileSync(source), sha256 = hash(bytes);
  if (expectedHash !== undefined && sha256 !== expectedHash) fail("STAGING_CAPTURE_HASH_CHANGED");
  JSON.parse(bytes.toString("utf8"));
  const file = path.join(stateDir, "staging." + label + ".private.json"), temporary = file + ".tmp-" + process.pid;
  const fd = fs.openSync(temporary, "wx", 0o600); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  if (process.platform !== "win32") { const dir = fs.openSync(stateDir, "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
  return { exists: true, sha256, capturedAt, path: file };
}
function readActiveAuthority(storageDir) {
  const active = read(path.join(storageDir, "releases/active.json")), version = active.version || active.releaseVersion;
  if (!/^[A-Za-z0-9._-]+$/.test(version || "")) fail("STAGING_ACTIVE_AUTHORITY_INVALID");
  const candidates = [path.join(storageDir, "releases", version, "manifest.json"), path.join(storageDir, "public/releases", version, "manifest.json")];
  const manifest = read(candidates.find(file => fs.existsSync(file)) || candidates[0]);
  if (active.canonicalHash && manifest.canonicalHash && active.canonicalHash !== manifest.canonicalHash) fail("STAGING_ACTIVE_HASH_MISMATCH");
  const canonicalHash = active.canonicalHash || manifest.canonicalHash;
  if (!/^[a-f0-9]{64}$/.test(canonicalHash || "")) fail("STAGING_ACTIVE_AUTHORITY_INVALID");
  return { version, canonicalHash, publishedAt: active.activatedAt || active.updatedAt || "", activatedAt: active.activatedAt || "" };
}
module.exports = { META_KEYS, strictEqual, compareStaging, captureStaging, readActiveAuthority };
