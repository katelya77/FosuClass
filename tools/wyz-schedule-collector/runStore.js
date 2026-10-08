"use strict";
const fs = require("fs");
const path = require("path");
const { writeJsonAtomic, readJson } = require("../../shared/syncCacheStore");

function safeId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(String(value || ""))) throw Object.assign(new Error("RUN_ID_INVALID"), { code: "RUN_ID_INVALID" });
  return value;
}

function runDirectory(root, term, runId) {
  return path.join(path.resolve(root), "runs", safeId(term), safeId(runId));
}

function acquireLock(root) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, "collector.lock");
  if (fs.existsSync(file)) {
    const old = readJson(file, {});
    let alive = true;
    try { process.kill(Number(old.pid), 0); } catch (error) { alive = error.code !== "ESRCH"; }
    if (alive) throw Object.assign(new Error("COLLECTOR_LOCKED"), { code: "COLLECTOR_LOCKED" });
    fs.unlinkSync(file);
  }
  const fd = fs.openSync(file, "wx", 0o600);
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
  fs.closeSync(fd);
  return () => { const owner = readJson(file, {}); if (owner.pid === process.pid) fs.unlinkSync(file); };
}

function pruneRuns(root, current, lastSuccess) {
  const runs = path.join(root, "runs");
  if (!fs.existsSync(runs)) return;
  for (const term of fs.readdirSync(runs, { withFileTypes: true })) {
    if (!term.isDirectory() || term.isSymbolicLink()) continue;
    const termDir = path.join(runs, term.name);
    for (const run of fs.readdirSync(termDir, { withFileTypes: true })) {
      if (!run.isDirectory() || run.isSymbolicLink()) continue;
      const target = path.join(termDir, run.name);
      if ([current, lastSuccess].includes(target)) continue;
      const state = readJson(path.join(target, "state.json"), {});
      // Preserve unfinished checkpoints; prune only terminal runs owned by this collector.
      if (!["completed", "cancelled"].includes(state.status)) continue;
      if (!path.relative(path.resolve(runs), path.resolve(target)).startsWith("..")) fs.rmSync(target, { recursive: true });
    }
  }
}

module.exports = { acquireLock, pruneRuns, runDirectory, safeId, readJson, writeJsonAtomic };
