"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SCHEDULE_DIR_BY_SCOPE = Object.freeze({
  classSchedules: "class",
  teacherSchedules: "teacher",
  classroomSchedules: "classroom",
  courseSchedules: "course",
});

function safeTerm(term) {
  return String(term || "").trim().replace(/[^0-9A-Za-z._-]/g, "_") || "unknown-term";
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function cacheRoot(baseDir, term) {
  return path.join(baseDir, ".cache", safeTerm(term));
}

function ensureTermCache(baseDir, term) {
  const root = cacheRoot(baseDir, term);
  [
    "catalog",
    "progress",
    "negative",
    "staging",
    "reports",
    path.join("schedules", "class"),
    path.join("schedules", "teacher"),
    path.join("schedules", "classroom"),
    path.join("schedules", "course"),
  ].forEach((segment) => ensureDir(path.join(root, segment)));
  return root;
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value || null)).digest("hex");
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  try {
    if (process.platform === "win32" && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (error) {}
    }
    fs.renameSync(tmp, filePath);
  } catch (error) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    try { fs.unlinkSync(tmp); } catch (cleanupError) {}
  }
}

function readJson(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    return fallback;
  }
}

function scheduleDir(baseDir, term, scope) {
  const kind = SCHEDULE_DIR_BY_SCOPE[scope] || scope;
  return path.join(ensureTermCache(baseDir, term), "schedules", kind);
}

function scheduleLatestPath(baseDir, term, scope) {
  return path.join(scheduleDir(baseDir, term, scope), "latest.json");
}

function scheduleMetadataPath(baseDir, term, scope) {
  return path.join(scheduleDir(baseDir, term, scope), "metadata.json");
}

function buildMetadata(input = {}) {
  const itemCount = Number(input.itemCount || (Array.isArray(input.items) ? input.items.length : 0));
  const items = input.items === undefined ? null : input.items;
  return {
    schemaVersion: 1,
    term: String(input.term || ""),
    scope: String(input.scope || ""),
    source: input.source || "100.fosu.edu.cn",
    acquisition: input.acquisition || "network",
    sourceMode: input.sourceMode || "network-direct",
    endpointFamily: input.endpointFamily || "",
    crawledAt: input.crawledAt || new Date().toISOString(),
    command: input.command || "",
    runId: input.runId || "",
    itemCount,
    hash: input.hash || hashJson(items),
    sessionFingerprint: input.sessionFingerprint || "",
    fresh: input.fresh !== false,
    partial: Boolean(input.partial),
    cacheHits: Number(input.cacheHits || 0),
    requested: Number(input.requested || itemCount),
    succeeded: Number(input.succeeded || itemCount),
    failed: Number(input.failed || 0),
    derived: Number(input.derived || 0),
  };
}

function writeScheduleLatest(baseDir, term, scope, items, metadataInput = {}) {
  const dir = scheduleDir(baseDir, term, scope);
  const runId = metadataInput.runId || `run-${Date.now()}`;
  const payload = {
    success: true,
    type: scope,
    semester: term,
    term,
    generatedAt: new Date().toISOString(),
    itemCount: Array.isArray(items) ? items.length : 0,
    items: Array.isArray(items) ? items : [],
  };
  const metadata = buildMetadata(Object.assign({}, metadataInput, {
    term,
    scope,
    items: payload.items,
    itemCount: payload.itemCount,
  }));
  const runDir = path.join(dir, "runs");
  ensureDir(runDir);
  writeJsonAtomic(path.join(runDir, `${runId}.json`), payload);
  writeJsonAtomic(path.join(runDir, `${runId}.meta.json`), metadata);
  writeJsonAtomic(path.join(dir, "latest.json"), payload);
  writeJsonAtomic(path.join(dir, "metadata.json"), metadata);
  return {
    latestPath: path.join(dir, "latest.json"),
    metadataPath: path.join(dir, "metadata.json"),
    runPath: path.join(runDir, `${runId}.json`),
    metadata,
  };
}

function readScheduleLatest(baseDir, term, scope) {
  const payload = readJson(scheduleLatestPath(baseDir, term, scope), null);
  const metadata = readJson(scheduleMetadataPath(baseDir, term, scope), null);
  const items = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.items) ? payload.items : []);
  return {
    payload,
    metadata,
    items,
    filePath: scheduleLatestPath(baseDir, term, scope),
  };
}

function progressPath(baseDir, term, scope, runId) {
  const name = runId ? `${scope}-${runId}.json` : `${scope}.json`;
  return path.join(ensureTermCache(baseDir, term), "progress", name);
}

function negativePath(baseDir, term, scope, runId) {
  const name = runId ? `no-${scope}-${runId}.json` : `no-${scope}.json`;
  return path.join(ensureTermCache(baseDir, term), "negative", name);
}

function stagingPath(baseDir, term, name) {
  return path.join(ensureTermCache(baseDir, term), "staging", name || "latest.json");
}

function reportPath(baseDir, term, prefix) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(ensureTermCache(baseDir, term), "reports", `${prefix || "sync-report"}-${stamp}.json`);
}

module.exports = {
  SCHEDULE_DIR_BY_SCOPE,
  buildMetadata,
  cacheRoot,
  ensureTermCache,
  hashJson,
  negativePath,
  progressPath,
  readJson,
  readScheduleLatest,
  reportPath,
  safeTerm,
  scheduleLatestPath,
  scheduleMetadataPath,
  stagingPath,
  writeJsonAtomic,
  writeScheduleLatest,
};
