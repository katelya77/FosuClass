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

function pruneRuns(root, current, lastSuccess, options = {}) {
  const plan = require("./retentionPlan").plan(root,current,lastSuccess,options);
  writeJsonAtomic(path.join(root,"cleanup-plan.json"),plan);
  return plan;
}
module.exports = { acquireLock, pruneRuns, runDirectory, safeId, readJson, writeJsonAtomic };
