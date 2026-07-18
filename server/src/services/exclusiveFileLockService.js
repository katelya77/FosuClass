const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

const PROCESS_STARTED_AT = Date.now();
const PROCESS_INSTANCE_ID = crypto.randomBytes(12).toString("hex");
const ownedLocks = new Map();
const abandonedReclaimTickets = new Set();

function linuxProcessStartIdentity(pid) {
  if (process.platform !== "linux") return "";
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return "";
    const fieldsAfterCommand = stat.slice(close + 2).trim().split(/\s+/);
    return String(fieldsAfterCommand[19] || "");
  } catch (_) { return ""; }
}

function windowsProcessStartIdentity(pid, timeoutMs = 2000) {
  if (process.platform !== "win32" || !Number.isInteger(pid) || pid <= 0) return "";
  const script = [
    "& { param([int]$targetPid)",
    "$ErrorActionPreference = 'Stop'",
    "$target = Get-Process -Id $targetPid -ErrorAction Stop",
    "[Console]::Out.Write($target.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture))",
    "}",
  ].join("; ");
  try {
    const result = spawnSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
      String(pid),
    ], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      shell: false,
    });
    const identity = String(result.stdout || "").trim();
    if (result.error || result.status !== 0 || !/^\d+$/.test(identity)) return "";
    return identity;
  } catch (_) { return ""; }
}

const processIdentityCache = new Map();

function processStartIdentity(pid) {
  const cached = processIdentityCache.get(pid);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;
  const identity = process.platform === "linux"
    ? linuxProcessStartIdentity(pid)
    : windowsProcessStartIdentity(pid, pid === process.pid ? 2000 : 500);
  const queryCompletedAt = Date.now();
  processIdentityCache.set(pid, { identity, expiresAt: queryCompletedAt + 1000 });
  return identity;
}

const PROCESS_START_IDENTITY = processStartIdentity(process.pid);

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function lockError(message, code, statusCode = 500, cause) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (cause) error.cause = cause;
  return error;
}

function fileIdentity(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.size}`;
  } catch (_) { return null; }
}

function validMetadata(details) {
  return Boolean(details)
    && typeof details === "object"
    && !Array.isArray(details)
    && Number.isInteger(details.pid)
    && details.pid > 0
    && typeof details.token === "string"
    && details.token.trim().length > 0
    && typeof details.instanceId === "string"
    && details.instanceId.trim().length > 0
    && (details.processStartIdentity === undefined || typeof details.processStartIdentity === "string")
    && typeof details.createdAt === "string"
    && Number.isFinite(Date.parse(details.createdAt));
}

function metadataOwnerIsRetired(details, stat, staleMs) {
  if (!validMetadata(details)) return Date.now() - stat.mtimeMs >= staleMs;
  if (details.pid === process.pid
    && details.instanceId === PROCESS_INSTANCE_ID
    && abandonedReclaimTickets.has(details.token)) return true;
  try {
    process.kill(details.pid, 0);
    const priorSamePidInstance = details.pid === process.pid
      && details.instanceId !== PROCESS_INSTANCE_ID
      && Date.parse(details.createdAt) < PROCESS_STARTED_AT;
    if (priorSamePidInstance) return true;
    if (Date.now() - stat.mtimeMs < staleMs) return false;
    const observedStartIdentity = processStartIdentity(details.pid);
    if (details.processStartIdentity && observedStartIdentity) return details.processStartIdentity !== observedStartIdentity;
    return false;
  } catch (error) {
    return Boolean(error && error.code === "ESRCH");
  }
}

function matchesOwned(lockPath, record, requireToken = true) {
  if (!record || !record.identity) return false;
  const identity = fileIdentity(lockPath);
  if (!identity || identity !== record.identity) return false;
  if (!requireToken) return true;
  try {
    const held = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return held && held.token === record.token;
  } catch (_) { return false; }
}

function retire(lockPath, label, codes) {
  const retired = `${lockPath}.${label}.${process.pid}.${crypto.randomBytes(3).toString("hex")}`;
  fs.renameSync(lockPath, retired);
  try { fs.unlinkSync(retired); } catch (error) {
    throw lockError("exclusive lock retired but cleanup failed", codes.release, 500, error);
  }
}

function reclaimStale(lockPath, staleMs, codes) {
  let stat;
  let details = null;
  let observedIdentity = null;
  try {
    stat = fs.statSync(lockPath);
    observedIdentity = fileIdentity(lockPath);
    try { details = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch (_) {}
  } catch (_) { return false; }
  const valid = validMetadata(details);
  if (!metadataOwnerIsRetired(details, stat, staleMs)) return false;
  try {
    if (fileIdentity(lockPath) !== observedIdentity) return false;
    if (valid) {
      const current = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (!current || current.token !== details.token || current.instanceId !== details.instanceId) return false;
    }
    retire(lockPath, valid ? `stale-${details.token}` : "stale-invalid", codes);
    return true;
  } catch (_) { return false; }
}

function readMetadata(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (_) { return null; }
}

function recoverLegacyReclaimGuard(guardPath, staleMs) {
  let stat;
  let identity;
  let details;
  try {
    stat = fs.lstatSync(guardPath);
    if (stat.isSymbolicLink()) return false;
    if (stat.isDirectory()) return true;
    identity = fileIdentity(guardPath);
    details = readMetadata(guardPath);
  } catch (_) { return false; }
  if (!metadataOwnerIsRetired(details, stat, staleMs)) return false;
  try {
    if (fileIdentity(guardPath) !== identity) return false;
    if (validMetadata(details)) {
      const current = readMetadata(guardPath);
      if (!current || current.token !== details.token || current.instanceId !== details.instanceId) return false;
    }
    fs.unlinkSync(guardPath);
    return true;
  } catch (_) { return false; }
}

function ensureReclaimDirectory(guardPath, staleMs, codes) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.mkdirSync(guardPath, { mode: 0o700 });
      return true;
    } catch (error) {
      if (!error || error.code !== "EEXIST") {
        throw lockError("exclusive lock reclamation guard failed", codes.failed, 500, error);
      }
      try {
        const existing = fs.lstatSync(guardPath);
        if (existing.isSymbolicLink()) return false;
        if (existing.isDirectory()) return true;
      } catch (_) { continue; }
      if (!recoverLegacyReclaimGuard(guardPath, staleMs)) return false;
    }
  }
  return false;
}

function reclaimTicketSequence(name) {
  const match = /^ticket-(\d+)\.json$/.exec(name);
  if (!match) return null;
  try { return BigInt(match[1]); } catch (_) { return null; }
}

function createReclaimTicket(guardPath, staleMs, codes) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!ensureReclaimDirectory(guardPath, staleMs, codes)) return null;
    let maximum = -1n;
    try {
      for (const name of fs.readdirSync(guardPath)) {
        const sequence = reclaimTicketSequence(name);
        if (sequence !== null && sequence > maximum) maximum = sequence;
      }
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
      throw lockError("exclusive lock reclamation guard failed", codes.failed, 500, error);
    }
    const sequence = maximum + 1n;
    const ticketPath = path.join(guardPath, `ticket-${sequence.toString().padStart(24, "0")}.json`);
    const token = crypto.randomBytes(12).toString("hex");
    try {
      fs.writeFileSync(ticketPath, JSON.stringify({
        pid: process.pid,
        token,
        instanceId: PROCESS_INSTANCE_ID,
        processStartIdentity: PROCESS_START_IDENTITY,
        createdAt: new Date().toISOString(),
      }), { encoding: "utf8", flag: "wx", mode: 0o600 });
      return { sequence, ticketPath, token, identity: fileIdentity(ticketPath) };
    } catch (error) {
      if (error && (error.code === "EEXIST" || error.code === "ENOENT")) continue;
      throw lockError("exclusive lock reclamation guard failed", codes.failed, 500, error);
    }
  }
  throw lockError("exclusive lock reclamation ticket allocation failed", codes.failed);
}

function retireReclaimTicket(ticketPath, observedIdentity, details, staleMs, codes) {
  let stat;
  try { stat = fs.statSync(ticketPath); } catch (_) { return true; }
  if (!metadataOwnerIsRetired(details, stat, staleMs)) return false;
  try {
    if (fileIdentity(ticketPath) !== observedIdentity) return false;
    if (validMetadata(details)) {
      const current = readMetadata(ticketPath);
      if (!current || current.token !== details.token || current.instanceId !== details.instanceId) return false;
    }
    retire(ticketPath, validMetadata(details) ? `stale-${details.token}` : "stale-invalid", codes);
    if (details && details.token) abandonedReclaimTickets.delete(details.token);
    return true;
  } catch (_) { return false; }
}

function reclaimTicketHasTurn(record, guardPath, staleMs, codes) {
  let entries;
  try {
    entries = fs.readdirSync(guardPath)
      .map((name) => ({ name, sequence: reclaimTicketSequence(name) }))
      .filter((entry) => entry.sequence !== null)
      .sort((left, right) => left.sequence < right.sequence ? -1 : left.sequence > right.sequence ? 1 : 0);
  } catch (_) { return false; }
  for (const entry of entries) {
    const ticketPath = path.join(guardPath, entry.name);
    const identity = fileIdentity(ticketPath);
    const details = readMetadata(ticketPath);
    if (ticketPath === record.ticketPath && identity === record.identity && details && details.token === record.token) return true;
    if (retireReclaimTicket(ticketPath, identity, details, staleMs, codes)) continue;
    return false;
  }
  return false;
}

function releaseReclaimTicket(record, guardPath, codes) {
  const details = readMetadata(record.ticketPath);
  if (fileIdentity(record.ticketPath) !== record.identity || !details || details.token !== record.token) {
    abandonedReclaimTickets.add(record.token);
    throw lockError("exclusive lock reclamation guard could not be released", codes.release, 500, new Error("reclamation ticket ownership changed"));
  }
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.unlinkSync(record.ticketPath);
      abandonedReclaimTickets.delete(record.token);
      lastError = null;
      break;
    } catch (error) {
      if (error && error.code === "ENOENT") {
        abandonedReclaimTickets.delete(record.token);
        lastError = null;
        break;
      }
      lastError = error;
      wait(5);
    }
  }
  if (lastError) {
    try {
      if (fileIdentity(record.ticketPath) !== record.identity) throw new Error("reclamation ticket identity changed");
      const current = readMetadata(record.ticketPath);
      if (!current || current.token !== record.token) throw new Error("reclamation ticket ownership changed");
      retire(record.ticketPath, `released-${record.token}`, codes);
      abandonedReclaimTickets.delete(record.token);
    } catch (error) {
      abandonedReclaimTickets.add(record.token);
      throw lockError("exclusive lock reclamation guard could not be released", codes.release, 500, error || lastError);
    }
  }
  try {
    fs.rmdirSync(guardPath);
  } catch (error) {
    if (!error || !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) {
      throw lockError("exclusive lock reclamation guard could not be released", codes.release, 500, error);
    }
  }
}

function withReclaimGuard(lockPath, staleMs, codes, waitBudget, callback) {
  const guardPath = `${lockPath}.reclaim`;
  const record = createReclaimTicket(guardPath, staleMs, codes);
  if (!record) return false;
  try {
    while (true) {
      const hasTurn = reclaimTicketHasTurn(record, guardPath, staleMs, codes);
      if (Date.now() > waitBudget.expiresAt) return false;
      if (hasTurn) break;
      wait(10);
    }
    callback();
    return true;
  } finally {
    releaseReclaimTicket(record, guardPath, codes);
  }
}

function reclaimOwnedAbandoned(lockPath, codes) {
  for (const record of ownedLocks.values()) {
    if (!record.abandoned || record.lockPath !== lockPath || !matchesOwned(lockPath, record)) continue;
    try {
      retire(lockPath, `abandoned-${record.token}`, codes);
      ownedLocks.delete(record.token);
      return true;
    } catch (_) { return false; }
  }
  return false;
}

function discardNew(lockPath, record, codes) {
  if (!matchesOwned(lockPath, record)) return false;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { fs.unlinkSync(lockPath); return true; } catch (error) {
      if (error && error.code === "ENOENT") return true;
      lastError = error;
      wait(5);
    }
  }
  try {
    if (!matchesOwned(lockPath, record)) return false;
    retire(lockPath, "aborted", codes);
    return true;
  } catch (error) { throw lockError("failed to discard newly-created exclusive lock", codes.release, 500, error || lastError); }
}

function createOwnedLockUnderReclaimGuard(lockPath, token, codes) {
  try {
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      token,
      instanceId: PROCESS_INSTANCE_ID,
      processStartIdentity: PROCESS_START_IDENTITY,
      createdAt: new Date().toISOString(),
    }), { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error && error.code === "EEXIST") return null;
    const record = { token, lockPath, identity: fileIdentity(lockPath), abandoned: true };
    if (matchesOwned(lockPath, record)) {
      ownedLocks.set(token, record);
      try { discardNew(lockPath, record, codes); ownedLocks.delete(token); } catch (cleanupError) {
        throw lockError("exclusive lock initialization cleanup failed", codes.release, 500, cleanupError);
      }
    }
    throw lockError("exclusive lock acquisition failed", codes.failed, 500, error);
  }
  const record = { token, lockPath, identity: fileIdentity(lockPath), abandoned: false };
  ownedLocks.set(token, record);
  return record;
}

function createOwnedLockWithReclaimGuard(lockPath, token, staleMs, codes, waitBudget) {
  let guardedRecord = null;
  try {
    withReclaimGuard(lockPath, staleMs, codes, waitBudget, () => {
      reclaimStale(lockPath, staleMs, codes);
      if (Date.now() <= waitBudget.expiresAt) guardedRecord = createOwnedLockUnderReclaimGuard(lockPath, token, codes);
    });
    return guardedRecord;
  } catch (error) {
    if (!guardedRecord) throw error;
    try {
      discardNew(lockPath, guardedRecord, codes);
      ownedLocks.delete(token);
    } catch (cleanupError) {
      guardedRecord.abandoned = true;
      throw lockError("exclusive lock initialization cleanup failed", codes.release, 500, cleanupError);
    }
    throw error;
  }
}

function releaseOwned(lockPath, token, codes) {
  const record = ownedLocks.get(token);
  let held = null;
  let readError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { held = JSON.parse(fs.readFileSync(lockPath, "utf8")); readError = null; break; } catch (error) { readError = error; wait(5); }
  }
  if (readError) {
    try {
      if (!matchesOwned(lockPath, record, false)) throw new Error("owned lock identity changed");
      retire(lockPath, `unverified-${token}`, codes);
      ownedLocks.delete(token);
      return { warning: { code: codes.release } };
    } catch (error) {
      if (record) record.abandoned = true;
      throw lockError("cannot recover unreadable owned exclusive lock", codes.release, 500, error);
    }
  }
  if (!held || held.token !== token) throw lockError("exclusive lock ownership changed", codes.release);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { fs.unlinkSync(lockPath); ownedLocks.delete(token); return undefined; } catch (error) { lastError = error; wait(5); }
  }
  try { retire(lockPath, "released", codes); ownedLocks.delete(token); } catch (error) {
    if (record) record.abandoned = true;
    throw lockError("failed to release exclusive lock", codes.release, 500, error || lastError);
  }
  return undefined;
}

function acquireExclusiveFileLock(filePath, options = {}) {
  const target = path.resolve(filePath);
  const lockPath = options.lockPath ? path.resolve(options.lockPath) : `${target}.lock`;
  const reclaimGuardPath = `${lockPath}.reclaim`;
  const waitMs = Number(options.waitMs === undefined ? 1000 : options.waitMs);
  const staleMs = Number(options.staleMs === undefined ? 30000 : options.staleMs);
  const prefix = String(options.codePrefix || "EXCLUSIVE_FILE").replace(/[^A-Z0-9_]/gi, "_").toUpperCase();
  const codes = { failed: `${prefix}_LOCK_FAILED`, timeout: `${prefix}_LOCK_TIMEOUT`, release: `${prefix}_LOCK_RELEASE_FAILED` };
  const token = crypto.randomBytes(12).toString("hex");
  const waitBudget = { expiresAt: Date.now() + waitMs };
  while (Date.now() <= waitBudget.expiresAt) {
    let attempted = false;
    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      if (fs.existsSync(reclaimGuardPath)) {
        const guardedRecord = createOwnedLockWithReclaimGuard(lockPath, token, staleMs, codes, waitBudget);
        if (guardedRecord) return () => releaseOwned(lockPath, token, codes);
        wait(10);
        continue;
      }
      attempted = true;
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token, instanceId: PROCESS_INSTANCE_ID, processStartIdentity: PROCESS_START_IDENTITY, createdAt: new Date().toISOString() }), { encoding: "utf8", flag: "wx", mode: 0o600 });
      const record = { token, lockPath, identity: fileIdentity(lockPath), abandoned: false };
      ownedLocks.set(token, record);
      if (fs.existsSync(reclaimGuardPath)) {
        discardNew(lockPath, record, codes);
        ownedLocks.delete(token);
        wait(10);
        continue;
      }
      return () => releaseOwned(lockPath, token, codes);
    } catch (error) {
      if (error && error.code === codes.release) throw error;
      if (!error || error.code !== "EEXIST") {
        const record = attempted && { token, lockPath, identity: fileIdentity(lockPath), abandoned: true };
        if (record && matchesOwned(lockPath, record)) {
          ownedLocks.set(token, record);
          try { discardNew(lockPath, record, codes); ownedLocks.delete(token); } catch (cleanupError) { throw lockError("exclusive lock initialization cleanup failed", codes.release, 500, cleanupError); }
        }
        throw lockError("exclusive lock acquisition failed", codes.failed, 500, error);
      }
      if (reclaimOwnedAbandoned(lockPath, codes)) continue;
      const guardedRecord = createOwnedLockWithReclaimGuard(lockPath, token, staleMs, codes, waitBudget);
      if (guardedRecord) return () => releaseOwned(lockPath, token, codes);
      wait(10);
    }
  }
  throw lockError("timed out waiting for exclusive lock", codes.timeout, 503);
}

function acquireExclusiveFileLocks(filePaths, options = {}) {
  const releases = [];
  try {
    for (const filePath of Array.from(new Set(filePaths.map((item) => path.resolve(item)))).sort()) {
      releases.push(acquireExclusiveFileLock(filePath, options));
    }
  } catch (error) {
    for (const release of releases.reverse()) { try { release(); } catch (_) {} }
    throw error;
  }
  return () => {
    const warnings = [];
    let firstError = null;
    for (const release of releases.reverse()) {
      try {
        const result = release();
        if (result && result.warning) warnings.push(result.warning);
      } catch (error) { if (!firstError) firstError = error; }
    }
    if (firstError) throw firstError;
    return warnings.length ? { warnings } : undefined;
  };
}

module.exports = { acquireExclusiveFileLock, acquireExclusiveFileLocks };
