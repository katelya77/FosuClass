"use strict";
const fs = require("fs"), path = require("path");
const TERMINAL = new Set(["completed", "failed", "partial-success", "no-change"]);
function readState(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4*1024*1024) return {};
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (_) { return {}; }
}
function measure(directory) {
  let bytes = 0, files = 0, unsafe = false;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) { unsafe = true; continue; }
    if (entry.isDirectory()) { const child = measure(file); bytes += child.bytes; files += child.files; unsafe = unsafe || child.unsafe; }
    else if (entry.isFile()) { bytes += fs.statSync(file).size; files++; }
  }
  return { bytes, files, unsafe };
}
function plan(root, options = {}) {
  const entries = [], references = new Set([options.currentRunId, options.latestRunId, ...(options.references || [])].filter(Boolean));
  const keepLatest = Math.max(1, Number(options.keepLatest) || 2), retentionDays = Math.max(1, Number(options.retentionDays) || 30);
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw Object.assign(new Error("PUBLISHER_RETENTION_PATH_REJECTED"), { code: "PUBLISHER_RETENTION_PATH_REJECTED" });
  if (fs.existsSync(root)) for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = path.join(root, entry.name), state = readState(path.join(directory, "state.json"));
    const receipt = state.receipt || {}, completedAt = Date.parse(receipt.completedAt || state.completedAt || "") || 0;
    const term = state.term || receipt.term || "";
    entries.push({ runId: entry.name, term: /^\d{4}-\d{4}-[12]$/.test(term) ? term : "UNKNOWN", status: TERMINAL.has(state.status) || state.status === "running" ? state.status : "UNKNOWN", completedAt, ...measure(directory), protection: [] });
  }
  entries.sort((a, b) => b.completedAt-a.completedAt);
  entries.slice(0, keepLatest).forEach(entry => references.add(entry.runId));
  for (const term of new Set(entries.map(entry => entry.term))) for (const status of TERMINAL) {
    const recovery = entries.find(entry => entry.term === term && entry.status === status);
    if (recovery) references.add(recovery.runId);
  }
  const now = options.now || Date.now();
  for (const entry of entries) {
    if (references.has(entry.runId)) entry.protection.push("referenced-or-term-recovery");
    if (!TERMINAL.has(entry.status)) entry.protection.push("non-terminal-or-unknown");
    if (entry.status === "failed" || entry.status === "partial-success") entry.protection.push("recoverable-failure");
    if (!entry.completedAt || now-entry.completedAt < retentionDays*86400000) entry.protection.push("unconfirmed-finish-or-retention");
    if (entry.unsafe) entry.protection.push("symlink-detected");
    if (options.referencesComplete !== true) entry.protection.push("external-references-not-attested");
  }
  const candidates = entries.filter(entry => !entry.protection.length);
  return { schema: 1, dryRun: true, executeAllowed: false, keepLatest, retentionDays,
    removed: [], kept: entries.map(entry => entry.runId), entries, candidates,
    estimatedDeleteDirectories: candidates.length, estimatedReclaimBytes: candidates.reduce((sum, entry) => sum+entry.bytes, 0),
    historyAffected: Array.from(new Set(candidates.map(entry => entry.term))),
    referencesComplete: options.referencesComplete === true,
    recovery: "No files deleted; quarantine, complete references, backup and manual approval required before cleanup" };
}
module.exports = { plan };
