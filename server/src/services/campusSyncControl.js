const fs = require("fs");
const path = require("path");
const circuit = require("./campusSyncCircuitBreaker");

function opsDir() {
  return path.resolve(process.env.CAMPUS_SYNC_OPS_DIR || path.join(__dirname, "../../storage/ops/campus-sync"));
}

function controlPath() {
  return path.join(opsDir(), "control.json");
}

let loaded = false;
let paused = false;
let pausedAt = null;
let pausedBy = "";
let storageStatus = "ok";

function readControl() {
  try {
    const raw = fs.readFileSync(controlPath(), "utf8");
    const parsed = JSON.parse(raw);
    paused = parsed.paused === true;
    pausedAt = parsed.pausedAt || null;
    pausedBy = String(parsed.pausedBy || "");
    if (parsed.circuit) circuit.loadState(parsed.circuit);
    storageStatus = "ok";
  } catch (error) {
    if (!error || error.code === "ENOENT") {
      storageStatus = "ok";
    } else {
      storageStatus = "invalid";
      paused = true;
    }
  }
  loaded = true;
}

function ensureLoaded() {
  if (!loaded) readControl();
}

function writeControl() {
  const dir = opsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const payload = {
    paused,
    pausedAt,
    pausedBy,
    circuit: circuit.exportState(),
    updatedAt: new Date().toISOString(),
  };
  const temp = `${controlPath()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload), { mode: 0o600 });
  fs.renameSync(temp, controlPath());
  try { fs.chmodSync(controlPath(), 0o600); } catch (error) {}
}

function isPaused() {
  ensureLoaded();
  return paused === true;
}

function pause(actor) {
  ensureLoaded();
  paused = true;
  pausedAt = new Date().toISOString();
  pausedBy = String(actor || "admin").slice(0, 64);
  writeControl();
  return snapshot();
}

function resume() {
  ensureLoaded();
  paused = false;
  pausedAt = null;
  pausedBy = "";
  writeControl();
  return snapshot();
}

function persistCircuit() {
  ensureLoaded();
  try {
    writeControl();
  } catch (error) {
    // Control persistence must not break the sync API.
  }
}

function snapshot() {
  ensureLoaded();
  return {
    paused,
    pausedAt,
    pausedBy: paused ? "admin" : "",
    storageStatus,
  };
}

function reload() {
  loaded = false;
  readControl();
  return snapshot();
}

function resetForTests() {
  paused = false;
  pausedAt = null;
  pausedBy = "";
  loaded = true;
  try {
    writeControl();
  } catch (error) {
    loaded = true;
  }
}

module.exports = {
  isPaused,
  pause,
  persistCircuit,
  reload,
  resetForTests,
  resume,
  snapshot,
};
