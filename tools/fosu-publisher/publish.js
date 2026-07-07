#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const axios = require("axios");

const {
  calculateFingerprintFromFile,
  summarizeStagingData,
} = require("../../server/src/utils/stagingFingerprint");
const {
  buildResourceCountContract,
  compareResourceCountContracts,
  flattenLegacyCounts,
} = require("../../server/src/shared/resourceCountContract");
const { uploadStagingFile } = require("../fosu-sync-client/upload");
const {
  DEFAULT_OUTPUT_ROOT,
  downloadReleaseFromOracle,
  extractActiveRelease,
  fetchOracleActivePointer,
} = require("../cloudbase/oracle-release-source");
const {
  buildCloudbasePointer,
  fileMeta,
  listLocalReleaseVersions,
  verifyLocalReleasePack,
  writeJson,
} = require("../cloudbase/release-pack-utils");
const { syncActiveRelease } = require("../cloudbase/sync-active-release");
const cloudbaseConfig = require("../../miniprogram/config/cloudbase");
const { runCommand: runProcessCommand } = require("../shared/processRunner");
const { getPublisherAdminToken } = require("./admin-token-utils");
const {
  probeCampusNetwork,
} = require("../fosu-sync-client/networkProbe");
const {
  loadSyncClientEnv,
  prepareDirectNetworkEnvironment,
} = require("../fosu-sync-client/syncEnv");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SYNC_CLIENT_DIR = path.join(PROJECT_ROOT, "tools", "fosu-sync-client");
loadSyncClientEnv({ env: process.env });
prepareDirectNetworkEnvironment(process.env, { axios });
const RUNS_ROOT = path.join(PROJECT_ROOT, ".local", "publisher-runs");
const LOCK_PATH = path.join(RUNS_ROOT, "publisher.lock");
const LATEST_PATH = path.join(RUNS_ROOT, "latest.json");
const DEFAULT_ORACLE_BASE_URL = process.env.FOSU_API_BASE || process.env.ORACLE_API_BASE_URL || "https://class.katelya.eu.org";
const DEFAULT_CLOUDBASE_BASE_URL = cloudbaseConfig.CLOUDBASE_HOSTING_BASE_URL;
const DEFAULT_ENV_ID = cloudbaseConfig.ENV_ID || "cloud1-d3g17rpe7566d3d5c";
const STALE_LOCK_MS = Number(process.env.FOSU_PUBLISHER_STALE_LOCK_MS || 6 * 60 * 60 * 1000);

const STAGES = [
  ["acquiring-lock", "acquiring publisher lock"],
  ["local-preflight", "running local publisher preflight"],
  ["resolving-term", "resolving term"],
  ["checking-campus-network", "checking campus network"],
  ["checking-session", "checking education session"],
  ["crawling", "crawling school schedules"],
  ["building-staging", "building staging snapshot"],
  ["validating-local", "validating local staging"],
  ["calculating-diff", "writing diff report"],
  ["checking-fingerprint", "checking canonicalHash"],
  ["uploading-oracle", "uploading Oracle staging"],
  ["waiting-staging-finalize", "waiting Oracle staging finalize"],
  ["publishing-release", "publishing Oracle release"],
  ["waiting-release-job", "waiting Oracle release job"],
  ["verifying-oracle-only", "running Oracle-only smoke"],
  ["cloudbase-preflight-and-mirror", "running CloudBase preflight and mirror"],
  ["verifying-cloudbase-and-dual-source", "running CloudBase and dual-source smoke"],
  ["completed", "completed"],
];
const STAGE_INDEX = new Map(STAGES.map(([name], index) => [name, index]));
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "partial-success", "no-change"]);

function parseArgs(argv) {
  const args = {};
  (argv || []).forEach((item) => {
    if (!item.startsWith("--")) return;
    const body = item.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      args[body.slice(0, eq)] = body.slice(eq + 1);
    } else {
      args[body] = true;
    }
  });
  if (args.grade && !args.grades) args.grades = args.grade;
  return args;
}

function normalizeRequestedMode(args = {}) {
  if (args.mode === "resume") return "resume";
  if (args.full === true || args.full === "true" || args.mode === "full") return "full";
  if (args.incremental === true || args.incremental === "true") return "routine";
  const requestedMode = String(args.mode || "routine").trim();
  return requestedMode === "export-cloudbase" ? "export-cloudbase" : requestedMode;
}

function nowIso() {
  return new Date().toISOString();
}

function safeRunId(mode) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = crypto.randomBytes(3).toString("hex");
  return `pub-${mode}-${stamp}-${random}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function assertInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(base, target);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  if (process.platform === "win32" && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (error) {}
  }
  fs.renameSync(tempPath, filePath);
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function redact(value) {
  const blockedKey = /token|ticket|cookie|secret|authorization|password|api[-_]?key|session/i;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.keys(value).reduce((acc, key) => {
      acc[key] = blockedKey.test(key) ? "[redacted]" : redact(value[key]);
      return acc;
    }, {});
  }
  if (typeof value === "string") {
    return value
      .replace(/([?&]?(?:token|ticket|cookie|secret|authorization|password|api[-_]?key)[^=]*=)[^&\s]+/gi, "$1[redacted]")
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
      .replace(/([\\/])\.session([\\/])[^"'`\s]+/gi, "$1[redacted-session]$2[redacted]")
      .replace(/session\.json/gi, "[redacted-session-file]");
  }
  return value;
}

function processIsAlive(pid) {
  const numeric = Number(pid || 0);
  if (!numeric) return false;
  try {
    process.kill(numeric, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function runCommand(command, args, options = {}) {
  if (process.env.FOSU_PUBLISHER_MOCK === "1") {
    return { status: 0, stdout: "", stderr: "", mocked: true };
  }
  const result = runProcessCommand(command, args || [], {
    cwd: options.cwd || PROJECT_ROOT,
    env: Object.assign({}, process.env, options.env || {}),
    encoding: options.encoding || "utf8",
    inherit: options.inherit !== false,
    timeoutMs: options.timeoutMs || 0,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
    code: options.code || "COMMAND_FAILED",
  });
  return result;
}

function runNodeScript(scriptPath, args = [], options = {}) {
  const absoluteScript = path.isAbsolute(scriptPath) ? scriptPath : path.join(PROJECT_ROOT, scriptPath);
  return runCommand(process.execPath, [absoluteScript].concat(args || []), options);
}

function errorDiagnostics(error) {
  const diagnostics = error && error.diagnostics || {};
  return {
    status: error && Object.prototype.hasOwnProperty.call(error, "status") ? error.status : diagnostics.status,
    signal: error && error.signal || diagnostics.signal || null,
    invocation: diagnostics.invocation || "",
    executable: diagnostics.executable || "",
    safeArgs: diagnostics.safeArgs || [],
    stdoutTail: diagnostics.stdoutTail || "",
    stderrTail: diagnostics.stderrTail || "",
    processFailureCode: error && error.processFailureCode || diagnostics.processFailureCode || "",
  };
}

function axiosHeaders() {
  const token = getPublisherAdminToken().token;
  return token ? { "x-admin-token": token, Authorization: `Bearer ${token}` } : {};
}

async function getJson(url, options = {}) {
  return withHttpRetry(options.label || "get-json", async () => {
    const response = await axios.get(url, {
      headers: Object.assign({ Accept: "application/json" }, options.headers || {}),
      timeout: options.timeoutMs || 30000,
      proxy: false,
    });
    return response.data;
  }, options);
}

async function postJson(url, body, options = {}) {
  return withHttpRetry(options.label || "post-json", async () => {
    const response = await axios.post(url, body || {}, {
      headers: Object.assign({ "Content-Type": "application/json" }, options.headers || {}),
      timeout: options.timeoutMs || 60000,
      proxy: false,
    });
    return response.data;
  }, options);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHttpError(error) {
  const code = error && error.code;
  const status = error && error.response && error.response.status;
  if (["ECONNABORTED", "ETIMEDOUT", "ECONNRESET", "EPIPE", "EAI_AGAIN"].includes(code)) return true;
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

async function withHttpRetry(label, operation, options = {}) {
  const attempts = Math.max(1, Number(options.retries || 3));
  const baseDelayMs = Math.max(0, Number(options.retryDelayMs || 750));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableHttpError(error)) {
        throw error;
      }
      const status = error && error.response && error.response.status;
      const detail = status ? `status=${status}` : `code=${error && error.code || "UNKNOWN"}`;
      console.warn(`[publisher] ${label} transient failure (${detail}); retrying ${attempt + 1}/${attempts}`);
      await sleep(baseDelayMs * attempt);
    }
  }
  throw lastError;
}

function safeRelativePath(value) {
  const text = String(value || "");
  if (!text) return "";
  const normalized = path.resolve(text);
  const rel = path.relative(PROJECT_ROOT, normalized);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel.replace(/\\/g, "/");
  return path.basename(text);
}

function sanitizeReceiptForUpload(receipt) {
  const clean = redact(JSON.parse(JSON.stringify(receipt || {})));
  function scrubPaths(value) {
    if (Array.isArray(value)) return value.map(scrubPaths);
    if (value && typeof value === "object") {
      Object.keys(value).forEach((key) => {
        if (/path|dir|root/i.test(key) && typeof value[key] === "string") {
          value[key] = safeRelativePath(value[key]);
        } else {
          value[key] = scrubPaths(value[key]);
        }
      });
    }
    return value;
  }
  return scrubPaths(clean);
}

async function uploadPublisherReceipt(args, receipt) {
  if (process.env.FOSU_PUBLISHER_MOCK === "1") {
    return { success: true, skipped: true, reason: "mock" };
  }
  const baseUrl = String(args["oracle-base-url"] || DEFAULT_ORACLE_BASE_URL).replace(/\/+$/g, "");
  return postJson(`${baseUrl}/api/admin/publisher/receipt`, sanitizeReceiptForUpload(receipt), {
    headers: axiosHeaders(),
    timeoutMs: 30000,
  });
}

async function waitAdminJob(baseUrl, jobId, label, run) {
  const url = `${baseUrl.replace(/\/+$/g, "")}/api/admin/jobs/${encodeURIComponent(jobId)}`;
  const successStates = new Set(["success", "succeeded", "completed"]);
  const failureStates = new Set(["failed", "cancelled", "canceled", "timeout", "timed-out"]);
  for (let attempt = 1; attempt <= 240; attempt += 1) {
    const data = await getJson(url, { headers: axiosHeaders(), timeoutMs: 30000 });
    const job = data && data.job;
    run.event("job-poll", { label, jobId, attempt, status: job && job.status });
    const status = String(job && job.status || "").toLowerCase();
    if (job && (successStates.has(status) || failureStates.has(status))) {
      if (failureStates.has(status)) {
        const jobError = job.error || {};
        const blockerSummary = Array.isArray(jobError.blockerDetails) && jobError.blockerDetails.length
          ? ` (${jobError.blockerDetails.map((item) => item.code || item.message || "BLOCKER").slice(0, 5).join(", ")})`
          : "";
        const error = new Error(`${label || "admin job"} failed: ${jobError.message || "unknown error"}${blockerSummary}`);
        error.code = "ADMIN_JOB_FAILED";
        error.job = job;
        error.jobError = jobError;
        error.blockers = jobError.blockers || [];
        error.warnings = jobError.warnings || [];
        error.blockerDetails = jobError.blockerDetails || [];
        error.blockerCodes = jobError.blockerCodes || [];
        error.warningDetails = jobError.warningDetails || [];
        error.safetyReport = jobError.safetyReport || null;
        error.safety = jobError.safety || null;
        throw error;
      }
      return Object.assign({ success: true, job }, job.result || {});
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const error = new Error(`${label || "admin job"} timed out: ${jobId}`);
  error.code = "ADMIN_JOB_TIMEOUT";
  throw error;
}

function stageDuration(timings, stage) {
  const item = timings && timings[stage];
  return item && Number.isFinite(Number(item.durationMs)) ? Number(item.durationMs) : null;
}

function sumStageDurations(timings, stages) {
  let total = 0;
  let hasValue = false;
  (stages || []).forEach((stage) => {
    const value = stageDuration(timings, stage);
    if (value != null) {
      total += value;
      hasValue = true;
    }
  });
  return hasValue ? total : null;
}

function buildPerformanceSummary(stageTimings = {}) {
  return {
    sessionCheckMs: stageDuration(stageTimings, "checking-session"),
    directoryAndScheduleFetchMs: stageDuration(stageTimings, "crawling"),
    normalizeAndStagingBuildMs: sumStageDurations(stageTimings, ["building-staging", "validating-local"]),
    hashAndDiffMs: sumStageDurations(stageTimings, ["calculating-diff", "checking-fingerprint"]),
    gzipAndUploadMs: stageDuration(stageTimings, "uploading-oracle"),
    serverValidationMs: stageDuration(stageTimings, "waiting-staging-finalize"),
    releaseMs: sumStageDurations(stageTimings, ["publishing-release", "waiting-release-job"]),
    oracleVerifyMs: stageDuration(stageTimings, "verifying-oracle-only"),
    cloudbaseMirrorMs: stageDuration(stageTimings, "cloudbase-preflight-and-mirror"),
    dualSourceVerifyMs: stageDuration(stageTimings, "verifying-cloudbase-and-dual-source"),
    totalKnownMs: sumStageDurations(stageTimings, Object.keys(stageTimings || {})),
  };
}

class PublisherRun {
  constructor(options) {
    this.mode = options.mode || "routine";
    this.args = options.args || {};
    this.runId = options.runId || safeRunId(this.mode);
    this.runDir = path.join(RUNS_ROOT, this.runId);
    this.statePath = path.join(this.runDir, "state.json");
    this.eventsPath = path.join(this.runDir, "events.jsonl");
    this.receiptPath = path.join(this.runDir, "receipt.json");
    this.errorPath = path.join(this.runDir, "error.json");
    this.stagingMetaPath = path.join(this.runDir, "staging-meta.json");
    this.diffReportPath = path.join(this.runDir, "diff-report.json");
    this.cloudbaseReceiptPath = path.join(this.runDir, "cloudbase-receipt.json");
    this.state = readJsonSafe(this.statePath, {
      schemaVersion: 1,
      runId: this.runId,
      mode: this.mode,
      originalMode: this.mode === "resume" ? "" : this.mode,
      originalArgs: redact(this.args),
      status: "running",
      currentStage: "",
      completedStages: [],
      retryCount: 0,
      startedAt: nowIso(),
      updatedAt: nowIso(),
      term: "",
      termConfig: null,
      stagingPath: "",
      stagingMetaPath: this.stagingMetaPath,
      diffReportPath: this.diffReportPath,
      canonicalHash: "",
      previousCanonicalHash: "",
      uploadId: "",
      uploadResult: null,
      publishJobId: "",
      publishResult: null,
      oracleReleaseVersion: "",
      oracleVerification: null,
      cloudbaseRelation: null,
      cloudbaseReceipt: null,
      manualPackage: null,
      stageTimings: {},
      paths: {
        state: this.statePath,
        events: this.eventsPath,
        receipt: this.receiptPath,
        error: this.errorPath,
        stagingMeta: this.stagingMetaPath,
        diffReport: this.diffReportPath,
        cloudbaseReceipt: this.cloudbaseReceiptPath,
      },
      summary: {},
    });
    this.stageStartedAt = {};
    if (this.mode === "resume") {
      this.originalMode = this.state.originalMode && this.state.originalMode !== "resume"
        ? this.state.originalMode
        : "routine";
      this.originalArgs = Object.assign({}, this.state.originalArgs || {}, this.args || {});
    } else {
      this.originalMode = this.mode;
      this.originalArgs = Object.assign({}, this.args || {});
      this.state.originalMode = this.originalMode;
      this.state.originalArgs = redact(this.originalArgs);
    }
    ensureDir(this.runDir);
  }

  event(type, payload) {
    fs.appendFileSync(this.eventsPath, JSON.stringify(redact(Object.assign({
      ts: nowIso(),
      type,
    }, payload || {}))) + os.EOL, "utf8");
  }

  save(extra) {
    this.state = Object.assign({}, this.state, extra || {}, { updatedAt: nowIso() });
    writeJsonAtomic(this.statePath, redact(this.state));
    writeJsonAtomic(LATEST_PATH, { runId: this.runId, runDir: this.runDir, updatedAt: nowIso() });
  }

  startStage(stage) {
    const index = STAGE_INDEX.get(stage);
    const label = STAGES[index] && STAGES[index][1] || stage;
    this.stageStartedAt[stage] = { ms: Date.now(), at: nowIso() };
    console.log(`[${index + 1}/${STAGES.length}] ${label}`);
    this.event("stage-start", { stage, index: index + 1, label, startedAt: this.stageStartedAt[stage].at });
    this.save({ currentStage: stage, currentStageStartedAt: this.stageStartedAt[stage].at });
  }

  completeStage(stage, summary) {
    const completed = new Set(this.state.completedStages || []);
    completed.add(stage);
    const started = this.stageStartedAt[stage] || {};
    const finishedAt = nowIso();
    const durationMs = started.ms ? Date.now() - started.ms : null;
    const label = STAGES[STAGE_INDEX.get(stage)] && STAGES[STAGE_INDEX.get(stage)][1] || stage;
    const stageTimings = Object.assign({}, this.state.stageTimings || {});
    stageTimings[stage] = { stage, label, startedAt: started.at || "", finishedAt, durationMs };
    this.event("stage-complete", { stage, durationMs, summary: summary || null });
    this.save({
      completedStages: Array.from(completed),
      summary: Object.assign({}, this.state.summary || {}, summary || {}),
      stageTimings,
    });
  }

  stage(stage, fn) {
    return Promise.resolve().then(async () => {
      if (this.shouldSkip(stage)) {
        this.event("stage-skip", { stage, reason: "resume" });
        return this.state.summary && this.state.summary[stage];
      }
      this.startStage(stage);
      const result = await fn();
      this.completeStage(stage, { [stage]: result || { success: true } });
      return result;
    });
  }

  shouldSkip(stage) {
    if (this.mode !== "resume") return false;
    if (stage === "acquiring-lock") return false;
    return (this.state.completedStages || []).includes(stage);
  }

  fail(error) {
    const currentStage = this.state.currentStage;
    if (currentStage && !(this.state.stageTimings || {})[currentStage]) {
      const started = this.stageStartedAt[currentStage] || {};
      const label = STAGES[STAGE_INDEX.get(currentStage)] && STAGES[STAGE_INDEX.get(currentStage)][1] || currentStage;
      const stageTimings = Object.assign({}, this.state.stageTimings || {});
      stageTimings[currentStage] = {
        stage: currentStage,
        label,
        startedAt: started.at || "",
        finishedAt: nowIso(),
        durationMs: started.ms ? Date.now() - started.ms : null,
        status: "failed",
      };
      this.save({ stageTimings });
    }
    const payload = redact({
      success: false,
      runId: this.runId,
      mode: this.mode,
      code: error.code || "PUBLISHER_FAILED",
      message: error.message,
      stack: error.stack,
      failedAt: nowIso(),
      currentStage: this.state.currentStage,
      stageTimings: this.state.stageTimings || {},
      performanceSummary: buildPerformanceSummary(this.state.stageTimings || {}),
      status: errorDiagnostics(error).status,
      signal: errorDiagnostics(error).signal,
      invocation: errorDiagnostics(error).invocation,
      executable: errorDiagnostics(error).executable,
      safeArgs: errorDiagnostics(error).safeArgs,
      stdoutTail: errorDiagnostics(error).stdoutTail,
      stderrTail: errorDiagnostics(error).stderrTail,
      processFailureCode: errorDiagnostics(error).processFailureCode,
      blockers: error.blockers || [],
      warnings: error.warnings || [],
      blockerDetails: error.blockerDetails || [],
      blockerCodes: error.blockerCodes || [],
      warningDetails: error.warningDetails || [],
      safetyReport: error.safetyReport || null,
      jobError: error.jobError || null,
    });
    writeJsonAtomic(this.errorPath, payload);
    this.save({ status: "failed", error: payload });
    this.event("run-failed", payload);
  }

  receipt(payload) {
    const receipt = redact(Object.assign({
      success: payload && payload.success === true,
      runId: this.runId,
      mode: this.mode,
      completedAt: nowIso(),
      receiptPaths: {
        state: this.statePath,
        events: this.eventsPath,
        receipt: this.receiptPath,
        error: this.errorPath,
        stagingMeta: this.stagingMetaPath,
        diffReport: this.diffReportPath,
        cloudbaseReceipt: this.cloudbaseReceiptPath,
      },
      stageTimings: this.state.stageTimings || {},
      performanceSummary: buildPerformanceSummary(this.state.stageTimings || {}),
    }, payload || {}));
    writeJsonAtomic(this.receiptPath, receipt);
    const terminalStatus = receipt.status || (receipt.success ? "completed" : "partial-success");
    this.save({ status: terminalStatus, receipt });
    try {
      receipt.artifactCleanup = cleanupPublisherRunArtifacts({ currentRunId: this.runId });
      writeJsonAtomic(this.receiptPath, receipt);
      this.save({ receipt });
    } catch (error) {
      this.event("artifact-cleanup-failed", { code: error.code || "", message: error.message });
    }
    return receipt;
  }
}

function getProcessCommandLine(pid, deps = {}) {
  const numeric = Number(pid || 0);
  if (!numeric) return "";
  const spawn = deps.spawnSync || spawnSync;
  try {
    if (process.platform === "win32") {
      const script = [
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${numeric}" -ErrorAction SilentlyContinue`,
        "if ($p) { $p.CommandLine }",
      ].join("; ");
      const result = spawn("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ], { encoding: "utf8", timeout: 5000, windowsHide: true });
      return result.status === 0 ? String(result.stdout || "").trim() : "";
    }
    const result = spawn("ps", ["-p", String(numeric), "-o", "command="], {
      encoding: "utf8",
      timeout: 5000,
    });
    return result.status === 0 ? String(result.stdout || "").trim() : "";
  } catch (error) {
    return "";
  }
}

function isPublisherCommandLine(commandLine) {
  const text = String(commandLine || "").replace(/\\/g, "/").toLowerCase();
  return text.includes("tools/fosu-publisher/publish.js") || text.includes("fosu-publisher/publish.js");
}

function readRunState(runId) {
  return runId ? readJsonSafe(path.join(RUNS_ROOT, runId, "state.json"), null) : null;
}

function isTerminalRunState(state) {
  return Boolean(state && TERMINAL_RUN_STATUSES.has(String(state.status || "")));
}

function inspectPublisherLock(deps = {}) {
  const existing = readJsonSafe(LOCK_PATH, null);
  if (!existing) {
    return {
      locked: false,
      lockPath: LOCK_PATH,
      canUnlock: false,
      reason: "missing",
    };
  }
  const state = readRunState(existing.runId);
  const alive = processIsAlive(existing.pid);
  const commandLine = alive ? (deps.commandLine || getProcessCommandLine(existing.pid, deps)) : "";
  const isPublisherProcess = alive && isPublisherCommandLine(commandLine);
  const terminal = isTerminalRunState(state);
  const ageMs = Date.now() - (Date.parse(existing.createdAt || "") || 0);
  let canUnlock = false;
  let reason = "active-publisher";
  if (terminal) {
    canUnlock = true;
    reason = "terminal-state";
  } else if (!alive) {
    canUnlock = true;
    reason = "pid-dead";
  } else if (!isPublisherProcess) {
    canUnlock = true;
    reason = "pid-reuse";
  }
  return {
    locked: true,
    lockPath: LOCK_PATH,
    lock: existing,
    runId: existing.runId || "",
    pid: existing.pid || 0,
    startedAt: existing.createdAt || "",
    currentStage: state && state.currentStage || "",
    status: state && state.status || "",
    statePath: existing.runId ? path.join(RUNS_ROOT, existing.runId, "state.json") : "",
    ageMs,
    alive,
    isPublisherProcess,
    commandLineKnown: Boolean(commandLine),
    terminal,
    canUnlock,
    reason,
  };
}

function removePublisherLock(reason, deps = {}) {
  const inspect = inspectPublisherLock(deps);
  if (!inspect.locked) return Object.assign({}, inspect, { removed: false });
  try { fs.unlinkSync(LOCK_PATH); } catch (error) {}
  return Object.assign({}, inspect, { removed: true, removedReason: reason || inspect.reason });
}

function reconcilePublisherLock(options = {}) {
  const inspect = inspectPublisherLock(options.deps || {});
  if (!inspect.locked) return Object.assign({}, inspect, { removed: false });
  if (!inspect.canUnlock && !options.force) return Object.assign({}, inspect, { removed: false });
  if (options.dryRun) return Object.assign({}, inspect, { removed: false, dryRun: true });
  return removePublisherLock(inspect.reason, options.deps || {});
}

function formatLockStatus(status) {
  if (!status.locked) {
    return [
      "Publisher lock: not locked",
      `state.json: ${status.statePath || "n/a"}`,
      "safeUnlock: false",
    ];
  }
  return [
    `Publisher lock: ${status.isPublisherProcess ? "running" : "stale-or-reusable"}`,
    `runId: ${status.runId || ""}`,
    `PID: ${status.pid || ""}`,
    `startedAt: ${status.startedAt || ""}`,
    `currentStage: ${status.currentStage || ""}`,
    `status: ${status.status || ""}`,
    `state.json: ${status.statePath || ""}`,
    `safeUnlock: ${status.canUnlock ? "true" : "false"}`,
    `reason: ${status.reason || ""}`,
  ];
}

function acquireLock(run, deps = {}) {
  ensureDir(RUNS_ROOT);
  const lockStatus = inspectPublisherLock(deps);
  if (lockStatus.locked) {
    if (!lockStatus.canUnlock && lockStatus.isPublisherProcess) {
      const error = new Error([
        "已有同步正在运行",
        `runId: ${lockStatus.runId || ""}`,
        `PID: ${lockStatus.pid || ""}`,
        `当前阶段: ${lockStatus.currentStage || ""}`,
        `开始时间: ${lockStatus.startedAt || ""}`,
        "查看命令: npm run publisher:status",
      ].join(os.EOL));
      error.code = "PUBLISHER_LOCKED";
      error.lock = redact(lockStatus);
      throw error;
    }
    const removed = reconcilePublisherLock({ deps });
    run.event("stale-lock-removed", {
      runId: lockStatus.runId,
      pid: lockStatus.pid,
      reason: lockStatus.reason,
      alive: lockStatus.alive,
      status: lockStatus.status,
      removed: removed.removed,
    });
  }
  const payload = {
    runId: run.runId,
    pid: process.pid,
    createdAt: nowIso(),
    cwd: PROJECT_ROOT,
  };
  try {
    const fd = fs.openSync(LOCK_PATH, "wx");
    fs.writeFileSync(fd, JSON.stringify(payload, null, 2), "utf8");
    fs.closeSync(fd);
  } catch (error) {
    const locked = new Error(`publisher is already running: ${LOCK_PATH}`);
    locked.code = "PUBLISHER_LOCKED";
    locked.originalError = error;
    throw locked;
  }
}

function releaseLock(run) {
  const existing = readJsonSafe(LOCK_PATH, null);
  if (existing && existing.runId === run.runId) {
    try { fs.unlinkSync(LOCK_PATH); } catch (error) {}
  }
}

function cleanupPublisherRunArtifacts(options = {}) {
  const keepLatest = Math.max(1, Number(options.keepLatest || process.env.FOSU_PUBLISHER_KEEP_RUNS || 2) || 2);
  if (!fs.existsSync(RUNS_ROOT)) return { removed: [], kept: [], keepLatest };
  const latest = readJsonSafe(LATEST_PATH, {});
  const keepRunIds = new Set([options.currentRunId, latest.runId].filter(Boolean));
  const entries = fs.readdirSync(RUNS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runDir = path.join(RUNS_ROOT, entry.name);
      const state = readJsonSafe(path.join(runDir, "state.json"), null);
      return {
        runId: entry.name,
        runDir,
        state,
        terminal: isTerminalRunState(state),
        updatedAt: state && state.updatedAt || "",
        mtimeMs: fs.statSync(runDir).mtimeMs,
      };
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || "") || left.mtimeMs || 0;
      const rightTime = Date.parse(right.updatedAt || "") || right.mtimeMs || 0;
      return rightTime - leftTime;
    });
  entries.slice(0, keepLatest).forEach((item) => keepRunIds.add(item.runId));
  const removed = [];
  const kept = [];
  entries.forEach((item) => {
    if (keepRunIds.has(item.runId) || !item.terminal) {
      kept.push(item.runId);
      return;
    }
    if (!assertInside(RUNS_ROOT, item.runDir)) return;
    fs.rmSync(item.runDir, { recursive: true, force: true });
    removed.push(item.runId);
  });
  return { removed, kept, keepLatest };
}

async function resolveTerm(args) {
  const explicit = String(args.term || args.semester || process.env.PREFERRED_SEMESTER || "").trim();
  if (explicit) return { term: explicit, source: "cli-or-env" };
  const source = await fetchOracleActivePointer({ oracleBaseUrl: args["oracle-base-url"] || DEFAULT_ORACLE_BASE_URL });
  const active = extractActiveRelease(source);
  return { term: active.term, source: source.source, activeReleaseVersion: active.releaseVersion };
}

function requireSession() {
  if (process.env.FOSU_PUBLISHER_MOCK === "1") {
    return { sessionFile: "mock-session", size: 1, mtime: nowIso(), mocked: true };
  }
  const sessionPath = path.join(PROJECT_ROOT, "tools", "fosu-sync-client", ".session", "session.json");
  const stat = fs.existsSync(sessionPath) ? fs.statSync(sessionPath) : null;
  if (!stat || stat.size < 20) {
    const error = new Error("session 已过期，请执行 npm run sync:login 后重试");
    error.code = "SESSION_EXPIRED";
    throw error;
  }
  return { sessionFile: "present", size: stat.size, mtime: stat.mtime.toISOString() };
}

function verifyEducationSession() {
  const local = requireSession();
  if (process.env.FOSU_PUBLISHER_MOCK === "1") return local;
  runNodeScript(path.join(SYNC_CLIENT_DIR, "verify-session.js"), [], {
    code: "SESSION_EXPIRED",
    timeoutMs: Number(process.env.FOSU_SESSION_VERIFY_TIMEOUT_MS || 45000),
  });
  return Object.assign({}, local, { verified: true });
}

async function checkCampusNetworkForPublisher(run) {
  if (process.env.FOSU_PUBLISHER_MOCK === "1") {
    const readiness = process.env.FOSU_PUBLISHER_MOCK_CAMPUS_READINESS || "ready";
    if (readiness === "blocked") {
      const error = new Error("mock campus network blocked");
      error.code = "CAMPUS_NETWORK_BLOCKED";
      throw error;
    }
    const warnings = readiness === "ready-with-warning" ? ["mock campus warning"] : [];
    warnings.forEach((warning) => {
      if (run) run.event("campus-network-warning", { warning });
    });
    return { success: true, readiness, mocked: true, warnings, blockers: [] };
  }
  const result = await probeCampusNetwork({ env: process.env });
  if (result.readiness === "blocked") {
    const error = new Error((result.blockers || []).join("; ") || "Campus network is blocked.");
    error.code = "CAMPUS_NETWORK_BLOCKED";
    error.networkReadiness = result;
    throw error;
  }
  if (result.readiness === "ready-with-warning") {
    (result.warnings || []).forEach((warning) => {
      console.warn(`[campus-network] WARN ${warning}`);
      if (run) run.event("campus-network-warning", { warning });
    });
    console.warn("网络检查存在警告，将继续验证教务登录态。");
  }
  return result;
}

async function runLocalPreflight(args) {
  if (process.env.FOSU_PUBLISHER_MOCK === "1") {
    return { success: true, mocked: true, cloudbaseChecked: false };
  }
  const checks = [];
  const nodeVersion = runCommand("node", ["--version"], { inherit: false, code: "NODE_CHECK_FAILED" }).stdout.trim();
  checks.push({ name: "node", ok: true, version: nodeVersion });
  const npmVersion = runCommand("npm", ["--version"], { inherit: false, code: "NPM_CHECK_FAILED" }).stdout.trim();
  checks.push({ name: "npm", ok: true, version: npmVersion });
  const packageLock = path.join(PROJECT_ROOT, "package-lock.json");
  const nodeModules = path.join(PROJECT_ROOT, "node_modules");
  checks.push({ name: "dependencies", ok: fs.existsSync(nodeModules) || fs.existsSync(packageLock), nodeModules: fs.existsSync(nodeModules), packageLock: fs.existsSync(packageLock) });
  const adminToken = getPublisherAdminToken();
  if (!adminToken.token) {
    const error = new Error("ADMIN_API_TOKEN is required for Oracle staging upload and receipt sync. Run npm run publisher:token:setup.");
    error.code = "ADMIN_API_TOKEN_REQUIRED";
    throw error;
  }
  if (adminToken.terminalRefreshRecommended) {
    checks.push({
      name: "admin-api-token",
      ok: true,
      source: adminToken.source,
      warning: "请关闭并重新打开 PowerShell，或设置当前进程环境变量。",
    });
  } else {
    checks.push({ name: "admin-api-token", ok: true, source: adminToken.source || "process" });
  }
  const gitStatus = runCommand("git", ["status", "--porcelain"], { inherit: false, code: "GIT_STATUS_FAILED" }).stdout;
  if (args["require-clean-git"] && gitStatus.trim()) {
    const error = new Error("Git working tree is not clean.");
    error.code = "GIT_WORKTREE_DIRTY";
    throw error;
  }
  checks.push({ name: "git", ok: true, clean: !gitStatus.trim() });
  const stat = fs.statSync(PROJECT_ROOT);
  checks.push({ name: "project-root", ok: stat.isDirectory() });
  ensureDir(RUNS_ROOT);
  const probePath = path.join(RUNS_ROOT, `.preflight-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(probePath, "ok", "utf8");
  fs.unlinkSync(probePath);
  checks.push({ name: "runs-root-writable", ok: true });
  const oracleBaseUrl = args["oracle-base-url"] || DEFAULT_ORACLE_BASE_URL;
  const health = await getJson(`${oracleBaseUrl.replace(/\/+$/g, "")}/api/health`, { timeoutMs: 15000 })
    .catch((error) => ({ success: false, code: error.code || "ORACLE_HEALTH_FAILED", message: error.message }));
  if (health && health.success === false) {
    const error = new Error(`Oracle API health check failed: ${health.code || health.message || "unknown"}`);
    error.code = "ORACLE_API_UNAVAILABLE";
    error.health = health;
    throw error;
  }
  checks.push({ name: "oracle-api", ok: true });
  return {
    success: true,
    cloudbaseChecked: false,
    checks,
  };
}

function buildCrawlArgs(mode, args, run, term) {
  const output = path.join(run.runDir, "staging.json");
  const action = "crawl:daily";
  const catalogPolicy = mode === "full" ? "network-only" : "reuse-validated";
  const negativeCachePolicy = mode === "full" ? "revalidate" : "ignore";
  const progressPolicy = mode === "full" || args["no-resume"] ? "ignore" : "resume";
  const base = [
    action,
    `--term=${term}`,
    `--output=${output}`,
    `--catalog-policy=${catalogPolicy}`,
    "--schedule-policy=network-only",
    `--progress-policy=${progressPolicy}`,
    `--negative-cache-policy=${negativeCachePolicy}`,
    "--allow-derived",
    "--class-scope=all",
  ];
  const grades = args.grades || args.grade;
  if (grades) base.push(`--grades=${grades}`);
  if (args.concurrency) base.push(`--concurrency=${args.concurrency}`);
  if (args["delay-ms"]) base.push(`--delay-ms=${args["delay-ms"]}`);
  if (args.include) base.push(`--include=${args.include}`);
  if (args["college-codes"]) base.push(`--college-codes=${args["college-codes"]}`);
  if (args["major-codes"]) base.push(`--major-codes=${args["major-codes"]}`);
  if (mode === "full") {
    if (args["term-start-date"]) base.push(`--term-start-date=${args["term-start-date"]}`);
    if (args["total-weeks"]) base.push(`--total-weeks=${args["total-weeks"]}`);
    base.push("--force-refresh", "--clear-progress", "--recheck-no-schedule");
  }
  if (args["verify-direct-resources"]) base.push("--verify-direct-resources");
  return { output, script: path.join(SYNC_CLIENT_DIR, "sync.js"), args: base };
}

function privacyScanText(text) {
  const findings = [];
  [
    ["password", /password|passwd|pwd/i],
    ["authorization", /authorization|bearer\s+[a-z0-9._~+/=-]{8,}/i],
    ["cookie", /cookie|set-cookie|JSESSIONID/i],
    ["api-key", /api[-_]?key|secret(?:id|key)?|access[-_]?token/i],
    ["student-id", /(?:student(?:id|number)|student[-_ ]?no|学号)["'\s:：=]+[0-9]{6,20}/i],
    ["id-card", /\b\d{17}[\dXx]\b/],
  ].forEach(([rule, pattern]) => {
    if (pattern.test(text)) findings.push({ rule });
  });
  return findings;
}

function validateStaging(stagingPath, expectedTerm) {
  const raw = fs.readFileSync(stagingPath, "utf8");
  const data = JSON.parse(raw);
  const fingerprint = calculateFingerprintFromFile(stagingPath);
  const summary = summarizeStagingData(data);
  const contract = buildResourceCountContract(data);
  const counts = flattenLegacyCounts(contract);
  const classSchedules = Array.isArray(data.classSchedules) ? data.classSchedules : [];
  const courseEvents = classSchedules.reduce((total, item) => {
    const events = Array.isArray(item && item.courses) ? item.courses : [];
    return total + events.length;
  }, 0);
  const normalizedCounts = Object.assign({}, counts, {
    classSchedules: counts.classScheduleCount,
    teacherSchedules: counts.teacherScheduleCount,
    classroomSchedules: counts.classroomScheduleCount,
    courseSchedules: counts.courseScheduleCount,
    courseEvents,
  });
  const includeScopes = data.meta && data.meta.includeScopes || [];
  const sourceModes = {
    teacher: contract.teacher.sourceMode,
    classroom: contract.classroom.sourceMode,
    course: contract.course.sourceMode,
  };
  const errors = [];
  if ((data.term || data.semester) !== expectedTerm) errors.push(`term mismatch: ${data.term || data.semester} != ${expectedTerm}`);
  if (!data.termConfig || !data.termConfig.termStartDate || !data.termConfig.totalWeeks) errors.push("termConfig incomplete");
  if (!summary.classSchedules) errors.push("classSchedules is empty");
  if (!summary.teacherSchedules || !summary.classroomSchedules || !summary.courseSchedules) errors.push("four scheduleDocuments are required");
  if (!counts.collegeCount || !counts.majorCount) errors.push("catalog entity counts are empty");
  if (sourceModes.teacher !== "derived-current-run" || sourceModes.classroom !== "derived-current-run" || sourceModes.course !== "derived-current-run") {
    errors.push(`sourceMode mismatch: ${JSON.stringify(sourceModes)}`);
  }
  const blockingDiagnostics = (contract.diagnostics || []).filter((item) => item && item.severity === "error");
  if (blockingDiagnostics.length) {
    errors.push(`resource diagnostics failed: ${blockingDiagnostics.map((item) => item.code || item.resource || "unknown").join(",")}`);
  }
  if (!fingerprint.canonicalHash) errors.push("canonicalHash missing");
  if (Number(data.meta && data.meta.actualNetworkRequestCount || 0) <= 0) errors.push("actual network request count is zero");
  if (data.meta && data.meta.usedClassScheduleCache) errors.push("classSchedules used old cache");
  if (summary.teacherSchedules > 0 && summary.teacherSchedules < 500) errors.push(`teacher schedules too low: ${summary.teacherSchedules}`);
  if (data.partial === true || data.meta && data.meta.partial === true) errors.push("partial staging is blocked");
  const privacyFindings = privacyScanText(raw);
  if (privacyFindings.length) errors.push(`privacy scan failed: ${privacyFindings.map((item) => item.rule).join(",")}`);
  if (errors.length) {
    const error = new Error(`Local staging validation failed: ${errors.join("; ")}`);
    error.code = "LOCAL_STAGING_VALIDATION_FAILED";
    error.validation = { errors, summary, counts, sourceModes, includeScopes, privacyFindings };
    throw error;
  }
  return {
    success: true,
    stagingPath,
    sidecarPath: String(stagingPath).replace(/\.json$/i, ".meta.json"),
    term: expectedTerm,
    canonicalHash: fingerprint.canonicalHash,
    rawSizeBytes: fingerprint.rawSizeBytes,
    summary,
    counts: normalizedCounts,
    resourceCounts: contract,
    sourceModes,
    diagnostics: contract.diagnostics || [],
    includeScopes,
    actualNetworkRequestCount: Number(data.meta && data.meta.actualNetworkRequestCount || 0),
    usedCache: {
      progress: Boolean(data.meta && data.meta.usedProgressCache),
      noSchedule: Boolean(data.meta && data.meta.usedNoScheduleCache),
      classSchedules: Boolean(data.meta && data.meta.usedClassScheduleCache),
    },
  };
}

async function checkFingerprint(baseUrl, canonicalHash) {
  if (process.env.FOSU_PUBLISHER_MOCK === "1") {
    return {
      success: true,
      sameAsActive: process.env.FOSU_PUBLISHER_MOCK_NO_CHANGE === "1",
      sameAsStaging: false,
      canonicalHash,
      activeCanonicalHash: process.env.FOSU_PUBLISHER_MOCK_NO_CHANGE === "1" ? canonicalHash : "mock-active-hash",
      activeRelease: {
        version: "mock-active-release",
        releaseVersion: "mock-active-release",
        canonicalHash: process.env.FOSU_PUBLISHER_MOCK_NO_CHANGE === "1" ? canonicalHash : "mock-active-hash",
        counts: { classSchedules: 3, teacherSchedules: 600, classroomSchedules: 3, courseSchedules: 3 },
      },
    };
  }
  const url = `${baseUrl.replace(/\/+$/g, "")}/api/admin/staging/fingerprint?canonicalHash=${encodeURIComponent(canonicalHash)}`;
  return getJson(url, { headers: axiosHeaders(), timeoutMs: 30000 });
}

function countDelta(oldValue, newValue) {
  const oldCount = Number(oldValue || 0);
  const newCount = Number(newValue || 0);
  const delta = newCount - oldCount;
  const rate = oldCount > 0 ? delta / oldCount : (newCount > 0 ? 1 : 0);
  return {
    oldCount,
    newCount,
    added: delta > 0 ? delta : 0,
    deleted: delta < 0 ? Math.abs(delta) : 0,
    changed: oldCount && newCount && oldCount !== newCount ? Math.abs(delta) : 0,
    delta,
    changeRate: Number((Math.abs(rate) * 100).toFixed(2)),
  };
}

function buildDiffReport(stagingMeta, fingerprintStatus, run) {
  const active = fingerprintStatus && fingerprintStatus.activeRelease || {};
  const oldCounts = active.counts || active.summary && active.summary.counts || {};
  const newCounts = stagingMeta.counts || {};
  const dimensions = {
    class: countDelta(oldCounts.classSchedules || oldCounts.classScheduleCount, newCounts.classSchedules),
    teacher: countDelta(oldCounts.teacherSchedules || oldCounts.teacherScheduleCount, newCounts.teacherSchedules),
    classroom: countDelta(oldCounts.classroomSchedules || oldCounts.classroomScheduleCount, newCounts.classroomSchedules),
    course: countDelta(oldCounts.courseSchedules || oldCounts.courseScheduleCount, newCounts.courseSchedules),
  };
  const eventDelta = countDelta(
    oldCounts.courseEvents || oldCounts.courseEventCount || oldCounts.classCourseEvents,
    newCounts.courseEvents || newCounts.classCourseEvents || newCounts.classSchedules
  );
  const riskReasons = [];
  if (!newCounts.classSchedules) riskReasons.push("classSchedules=0");
  if (stagingMeta.sourceModes && Object.values(stagingMeta.sourceModes).some((value) => value !== "derived-current-run")) riskReasons.push("sourceMode mismatch");
  if (Number(stagingMeta.actualNetworkRequestCount || 0) <= 0) riskReasons.push("actual network request count is zero");
  if (newCounts.teacherSchedules > 0 && newCounts.teacherSchedules < 500) riskReasons.push("teacher schedules unexpectedly low");
  Object.keys(dimensions).forEach((key) => {
    const item = dimensions[key];
    if (item.oldCount > 0 && item.newCount === 0) riskReasons.push(`${key} dimension dropped to zero`);
    if (item.delta < 0 && item.changeRate > 50) riskReasons.push(`${key} dimension dropped ${item.changeRate}%`);
  });
  const samples = Object.keys(dimensions)
    .filter((key) => dimensions[key].delta !== 0)
    .slice(0, 20)
    .map((key) => ({
      type: key,
      summary: `${key}: ${dimensions[key].oldCount} -> ${dimensions[key].newCount}`,
    }));
  return {
    schemaVersion: 1,
    generatedAt: nowIso(),
    runId: run.runId,
    oldCanonicalHash: fingerprintStatus && (fingerprintStatus.activeCanonicalHash || fingerprintStatus.activeRelease && fingerprintStatus.activeRelease.canonicalHash) || "",
    newCanonicalHash: stagingMeta.canonicalHash,
    oldRelease: active.releaseVersion || active.version || "",
    newStaging: path.basename(stagingMeta.stagingPath || ""),
    term: stagingMeta.term || "",
    dimensions,
    courseEvents: {
      added: eventDelta.added,
      deleted: eventDelta.deleted,
      modified: eventDelta.changed,
      changeRate: eventDelta.changeRate,
    },
    samples,
    riskReasons,
    requiresConfirmation: riskReasons.length > 0,
    safety: buildPreUploadSafety(stagingMeta, fingerprintStatus),
  };
}

function buildPreUploadSafety(stagingMeta, fingerprintStatus) {
  const activeResourceCounts = fingerprintStatus && (
    fingerprintStatus.activeResourceCounts ||
    fingerprintStatus.activeRelease && fingerprintStatus.activeRelease.resourceCounts ||
    fingerprintStatus.activeRelease && fingerprintStatus.activeRelease.packStatus && fingerprintStatus.activeRelease.packStatus.resourceCounts
  ) || null;
  const stagingResourceCounts = stagingMeta && stagingMeta.resourceCounts || null;
  const contractComparison = activeResourceCounts && stagingResourceCounts
    ? compareResourceCountContracts(activeResourceCounts, stagingResourceCounts)
    : { allowPublish: true, blockers: [], warnings: [], comparisons: [], skipped: true, reason: "active-resource-counts-unavailable" };
  const blockerDetails = contractComparison.blockers || [];
  const warningDetails = contractComparison.warnings || [];
  return {
    allowPublish: blockerDetails.length === 0,
    blockers: blockerDetails.map((item) => `${item.code || "STAGING_SAFETY_BLOCKER"}: ${item.message || "发布安全检查未通过"}`),
    warnings: warningDetails.map((item) => `${item.code || "STAGING_SAFETY_WARNING"}: ${item.message || item.reason || "发布安全检查警告"}`),
    blockerDetails,
    blockerCodes: Array.from(new Set(blockerDetails.map((item) => item.code || "").filter(Boolean))),
    warningDetails,
    activeResourceCounts,
    stagingResourceCounts,
    contractComparison,
  };
}

async function publishStaging(baseUrl, run, args) {
  if (process.env.FOSU_PUBLISHER_MOCK === "1") {
    if (process.env.FOSU_PUBLISHER_MOCK_ORACLE_PUBLISH_FAIL === "1") {
      const error = new Error("mock oracle publish failure");
      error.code = "MOCK_ORACLE_PUBLISH_FAILED";
      throw error;
    }
    return { success: true, releaseVersion: "mock-release", term: args.term || "2025-2026-2", activeReleaseVersion: "mock-release" };
  }
  const data = await postJson(`${baseUrl.replace(/\/+$/g, "")}/api/admin/sync/staging/publish`, {
    force: false,
    readyOnly: false,
    releaseNote: args.note || "Published by fosu-publisher",
  }, { headers: axiosHeaders(), timeoutMs: 60000 });
  if (data && data.job && data.job.id) {
    return waitAdminJob(baseUrl, data.job.id, "staging publish", run);
  }
  return data;
}

async function waitForStagingFinalize(baseUrl, uploadResult, run) {
  const jobId = uploadResult && uploadResult.job && uploadResult.job.id;
  if (!jobId) {
    return { success: true, uploadResult, skipped: true };
  }
  if (uploadResult.finalized) {
    return { success: true, uploadResult, skipped: true, alreadyFinalized: true };
  }
  const finalized = await waitAdminJob(baseUrl, jobId, "staging upload finalize", run);
  const nextUploadResult = Object.assign({}, uploadResult, {
    finalized: true,
    finalizeResult: finalized,
  });
  run.save({ uploadResult: nextUploadResult });
  return { success: true, uploadResult: nextUploadResult, finalizeResult: finalized };
}

function runOracleOnlySmoke(args) {
  if (process.env.FOSU_PUBLISHER_MOCK === "1") return { success: true, mode: "oracle-only", mocked: true };
  const cmdArgs = ["tools/cloudbase/live-smoke.js", "--oracle-only"];
  if (args["oracle-base-url"]) cmdArgs.push(`--oracle-base-url=${args["oracle-base-url"]}`);
  runCommand("node", cmdArgs, { code: "ORACLE_ONLY_SMOKE_FAILED" });
  return { success: true, mode: "oracle-only" };
}

function runDualSourceSmoke(args) {
  if (process.env.FOSU_PUBLISHER_MOCK === "1") return { success: true, mode: "dual-source-full", mocked: true };
  const cmdArgs = ["tools/cloudbase/live-smoke.js"];
  if (args["cloudbase-base-url"]) cmdArgs.push(`--cloudbase-base-url=${args["cloudbase-base-url"]}`);
  if (args["oracle-base-url"]) cmdArgs.push(`--oracle-base-url=${args["oracle-base-url"]}`);
  runCommand("node", cmdArgs, { code: "LIVE_SMOKE_FAILED" });
  return { success: true, mode: "dual-source-full" };
}

async function mirrorCloudbase(args) {
  if (process.env.FOSU_PUBLISHER_MOCK === "1") {
    if (process.env.FOSU_PUBLISHER_MOCK_CLOUDBASE_FAIL === "1") {
      const error = new Error("mock CloudBase mirror failure");
      error.code = "MOCK_CLOUDBASE_MIRROR_FAILED";
      throw error;
    }
    return { success: true, action: "mock-mirrored", releaseVersion: "mock-release" };
  }
  return syncActiveRelease({
    execute: true,
    dryRun: false,
    envId: args["env-id"] || DEFAULT_ENV_ID,
    hostingBaseUrl: args["hosting-base-url"] || DEFAULT_CLOUDBASE_BASE_URL,
    oracleBaseUrl: args["oracle-base-url"] || DEFAULT_ORACLE_BASE_URL,
    outputRoot: args["output-root"] || DEFAULT_OUTPUT_ROOT,
  });
}

async function cloudbasePreflightAndMirror(args) {
  if (process.env.FOSU_PUBLISHER_MOCK !== "1") {
    runCommand("npm", ["run", "cloudbase:preflight"], { code: "CLOUDBASE_PREFLIGHT_FAILED", timeoutMs: 360000 });
  }
  const mirror = await mirrorCloudbase(args);
  return {
    success: true,
    preflight: { success: true },
    mirror,
  };
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    fs.readdirSync(src, { withFileTypes: true }).forEach((entry) => {
      copyRecursive(path.join(src, entry.name), path.join(dest, entry.name));
    });
    return;
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function listFiles(dirPath) {
  const result = [];
  if (!fs.existsSync(dirPath)) return result;
  fs.readdirSync(dirPath, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(fullPath));
    if (entry.isFile()) result.push(fullPath);
  });
  return result;
}

function sha1File(filePath) {
  return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
}

async function exportCloudbaseManualPackage(args, releaseVersion) {
  const version = String(releaseVersion || args.release || "").trim();
  if (!version) {
    const error = new Error("--release=<releaseVersion> is required for export-cloudbase");
    error.code = "RELEASE_VERSION_REQUIRED";
    throw error;
  }
  let publicRoot = args["output-root"] || DEFAULT_OUTPUT_ROOT;
  let releaseDir = path.join(publicRoot, version);
  if (!fs.existsSync(path.join(releaseDir, "manifest.json")) && process.env.FOSU_PUBLISHER_MOCK !== "1") {
    const pulled = await downloadReleaseFromOracle({
      outputRoot: publicRoot,
      oracleBaseUrl: args["oracle-base-url"] || DEFAULT_ORACLE_BASE_URL,
      releaseVersion: version,
    });
    publicRoot = pulled.outputRoot;
    releaseDir = path.join(publicRoot, version);
  }
  if (!fs.existsSync(path.join(releaseDir, "manifest.json"))) {
    const error = new Error(`release pack not found: ${releaseDir}`);
    error.code = "RELEASE_PACK_NOT_FOUND";
    throw error;
  }
  const verification = verifyLocalReleasePack({ publicRoot, releaseVersion: version });
  const manifest = verification.manifest;
  const manualRoot = path.join(PROJECT_ROOT, "dist", "cloudbase-manual", version);
  fs.rmSync(manualRoot, { recursive: true, force: true });
  const releaseDest = path.join(manualRoot, "releases", version);
  copyRecursive(releaseDir, releaseDest);
  const pointer = buildCloudbasePointer(manifest, {
    releaseVersion: version,
    hostingBaseUrl: args["hosting-base-url"] || DEFAULT_CLOUDBASE_BASE_URL,
  });
  writeJson(path.join(manualRoot, "runtime", "active.json"), pointer);
  const files = listFiles(manualRoot).map((filePath) => ({
    path: path.relative(manualRoot, filePath).replace(/\\/g, "/"),
    size: fs.statSync(filePath).size,
    hash: sha1File(filePath),
  }));
  const manifestPath = path.join(releaseDest, "manifest.json");
  const pointerPath = path.join(manualRoot, "runtime", "active.json");
  const receipt = {
    success: true,
    releaseVersion: version,
    createdAt: nowIso(),
    fileCount: files.length,
    totalBytes: files.reduce((sum, item) => sum + item.size, 0),
    manifest: fileMeta(manifestPath),
    pointer: fileMeta(pointerPath),
    files,
  };
  writeJson(path.join(manualRoot, "receipt.json"), receipt);
  fs.writeFileSync(path.join(manualRoot, "VERIFY.txt"), [
    `releaseVersion=${version}`,
    `fileCount=${receipt.fileCount}`,
    `totalBytes=${receipt.totalBytes}`,
    `manifestHash=${receipt.manifest.hash}`,
    `manifestSize=${receipt.manifest.size}`,
    `pointerHash=${receipt.pointer.hash}`,
    `pointerSize=${receipt.pointer.size}`,
  ].join(os.EOL), "utf8");
  fs.writeFileSync(path.join(manualRoot, "README-CLOUDBASE-MANUAL-UPLOAD.txt"), [
    "CloudBase Hosting manual upload package",
    "",
    "1. Upload the releases/<releaseVersion>/ directory first.",
    `2. Remote release prefix: releases/${version}/`,
    `3. Verify releases/${version}/manifest.json hash and size after upload.`,
    "4. Upload runtime/active.json only after every release file is verified.",
    "5. Run CloudBase live smoke after the pointer is uploaded.",
    "6. If smoke fails, keep the old pointer and retry mirror-only after fixing CloudBase.",
  ].join(os.EOL), "utf8");
  const zipPath = path.join(PROJECT_ROOT, "dist", `FosuClass-CloudBase-${version}.zip`);
  try {
    if (process.platform === "win32") {
      runCommand("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        `Compress-Archive -Path '${manualRoot.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
      ], { inherit: false, code: "CLOUDBASE_MANUAL_ZIP_FAILED" });
    }
  } catch (error) {
    receipt.zipWarning = error.message;
  }
  receipt.manualRoot = manualRoot;
  receipt.zipPath = fs.existsSync(zipPath) ? zipPath : "";
  writeJson(path.join(manualRoot, "receipt.json"), receipt);
  return receipt;
}

function showToast(title, message) {
  try {
    if (process.platform !== "win32" || process.env.FOSU_PUBLISHER_MOCK === "1") return false;
    const script = [
      "$wshell = New-Object -ComObject Wscript.Shell",
      `$wshell.Popup('${String(message || "").replace(/'/g, "''")}', 8, '${String(title || "FosuClass").replace(/'/g, "''")}', 64) | Out-Null`,
    ].join("; ");
    spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "ignore" });
    return true;
  } catch (error) {
    return false;
  }
}

async function runMainPipeline(run, args) {
  args = run.mode === "resume" ? Object.assign({}, run.originalArgs || {}, args || {}) : (args || {});
  let lockAcquired = false;
  let termInfo = null;
  let stagingMeta = null;
  let uploadResult = null;
  let publishResult = null;
  let cloudbaseReceipt = null;
  let liveSmoke = null;
  try {
    await run.stage("acquiring-lock", async () => {
      acquireLock(run);
      lockAcquired = true;
      return { success: true, lockPath: LOCK_PATH };
    });

    if (run.mode === "export-cloudbase") {
      const exportReceipt = await run.stage("cloudbase-preflight-and-mirror", async () => exportCloudbaseManualPackage(args, args.release));
      await run.stage("completed", async () => ({ success: true, status: "manual-package-exported" }));
      const receipt = run.receipt({
        success: true,
        status: "success",
        mode: run.mode,
        runId: run.runId,
        term: args.term || "",
        cloudbaseStatus: "manual-package-exported",
        manualPackage: exportReceipt,
      });
      return receipt;
    }

    await run.stage("local-preflight", async () => runLocalPreflight(args));

    termInfo = await run.stage("resolving-term", async () => resolveTerm(args));
    const term = termInfo.term || (run.state.summary["resolving-term"] && run.state.summary["resolving-term"].term);
    run.save({ term, termConfig: termInfo.termConfig || null });

    if (run.mode === "mirror-only") {
      await run.stage("cloudbase-preflight-and-mirror", async () => {
        cloudbaseReceipt = await cloudbasePreflightAndMirror(args);
        writeJsonAtomic(run.cloudbaseReceiptPath, cloudbaseReceipt);
        run.save({ cloudbaseReceipt, cloudbaseRelation: cloudbaseReceipt.mirror && cloudbaseReceipt.mirror.relation || null });
        return cloudbaseReceipt;
      });
      liveSmoke = await run.stage("verifying-cloudbase-and-dual-source", async () => runDualSourceSmoke(args));
      await run.stage("completed", async () => ({ success: true }));
      return run.receipt({
        success: true,
        term,
        oracleStatus: "not-changed",
        cloudbaseStatus: "mirrored",
        cloudbaseReceipt,
        liveSmoke,
      });
    }

    if (run.mode === "export-cloudbase") {
      const exportReceipt = await exportCloudbaseManualPackage(args, args.release);
      await run.stage("completed", async () => exportReceipt);
      return run.receipt({
        success: true,
        term: exportReceipt.term || term || "",
        cloudbaseStatus: "manual-package-exported",
        manualPackage: exportReceipt,
      });
    }

    await run.stage("checking-campus-network", async () => {
      return checkCampusNetworkForPublisher(run);
    });

    await run.stage("checking-session", async () => verifyEducationSession());

    const effectiveMode = run.mode === "resume" ? run.originalMode : run.mode;
    const crawlPlan = buildCrawlArgs(effectiveMode === "full" ? "full" : "routine", args, run, term);
    await run.stage("crawling", async () => {
      runNodeScript(crawlPlan.script, crawlPlan.args, {
        code: "LOCAL_CRAWL_FAILED",
        env: {
          PREFERRED_SEMESTER: term,
          SYNC_CLASS_SCOPE: "all",
          SYNC_RESOURCE_SOURCE: "derived",
          FOSU_SKIP_CAMPUS_NETWORK_CHECK: "1",
        },
      });
      if (process.env.FOSU_PUBLISHER_MOCK !== "1" && !fs.existsSync(crawlPlan.output)) {
        const error = new Error(`Crawl output file was not generated: ${safeRelativePath(crawlPlan.output)}`);
        error.code = "CRAWL_OUTPUT_MISSING";
        throw error;
      }
      return { success: true, output: crawlPlan.output };
    });

    await run.stage("building-staging", async () => {
      if (process.env.FOSU_PUBLISHER_MOCK === "1") {
        writeJsonAtomic(crawlPlan.output, buildMockStaging(term));
      }
      run.save({ stagingPath: crawlPlan.output });
      return { success: true, stagingPath: crawlPlan.output };
    });

    stagingMeta = await run.stage("validating-local", async () => {
      const meta = validateStaging(crawlPlan.output, term);
      writeJsonAtomic(run.stagingMetaPath, meta);
      run.save({
        stagingPath: crawlPlan.output,
        stagingMetaPath: run.stagingMetaPath,
        canonicalHash: meta.canonicalHash,
        termConfig: meta.termConfig || null,
      });
      return meta;
    });

    let fingerprint = null;
    const diffReport = await run.stage("calculating-diff", async () => {
      fingerprint = await checkFingerprint(args["oracle-base-url"] || DEFAULT_ORACLE_BASE_URL, stagingMeta.canonicalHash);
      const report = buildDiffReport(stagingMeta, fingerprint, run);
      writeJsonAtomic(run.diffReportPath, report);
      run.save({
        diffReportPath: run.diffReportPath,
        previousCanonicalHash: report.oldCanonicalHash,
      });
      return report;
    });
    if (diffReport.requiresConfirmation) {
      const error = new Error(`Publisher requires confirmation: ${diffReport.riskReasons.join("; ")}`);
      error.code = "PUBLISHER_REQUIRES_CONFIRMATION";
      error.diffReportPath = run.diffReportPath;
      throw error;
    }
    if (diffReport.safety && diffReport.safety.allowPublish === false) {
      const codes = diffReport.safety.blockerCodes && diffReport.safety.blockerCodes.length
        ? diffReport.safety.blockerCodes.join(", ")
        : "STAGING_SAFETY_BLOCKED";
      const error = new Error(`Local publish safety check failed before upload: ${codes}`);
      error.code = "LOCAL_PUBLISH_SAFETY_BLOCKED";
      error.diffReportPath = run.diffReportPath;
      error.blockers = diffReport.safety.blockers || [];
      error.warnings = diffReport.safety.warnings || [];
      error.blockerDetails = diffReport.safety.blockerDetails || [];
      error.blockerCodes = diffReport.safety.blockerCodes || [];
      error.warningDetails = diffReport.safety.warningDetails || [];
      error.safetyReport = diffReport.safety;
      throw error;
    }

    fingerprint = await run.stage("checking-fingerprint", async () => {
      const check = fingerprint || await checkFingerprint(args["oracle-base-url"] || DEFAULT_ORACLE_BASE_URL, stagingMeta.canonicalHash);
      run.save({
        previousCanonicalHash: check.activeCanonicalHash || "",
        canonicalHash: stagingMeta.canonicalHash,
      });
      return Object.assign({ canonicalHash: stagingMeta.canonicalHash }, check);
    });
    if (fingerprint.sameAsActive) {
      let noChangeSmoke = null;
      let noChangeStatus = "no-change";
      let noChangeCloudbaseStatus = "same-and-healthy";
      try {
        noChangeSmoke = await run.stage("verifying-cloudbase-and-dual-source", async () => runDualSourceSmoke(args));
      } catch (smokeError) {
        run.event("no-change-dual-smoke-failed", { code: smokeError.code, message: smokeError.message });
        try {
          cloudbaseReceipt = await run.stage("cloudbase-preflight-and-mirror", async () => {
            const repaired = await cloudbasePreflightAndMirror(args);
            writeJsonAtomic(run.cloudbaseReceiptPath, repaired);
            run.save({ cloudbaseReceipt: repaired });
            return repaired;
          });
          noChangeSmoke = await run.stage("verifying-cloudbase-and-dual-source", async () => runDualSourceSmoke(args));
          noChangeStatus = "no-data-change-cloudbase-repaired";
          noChangeCloudbaseStatus = "repaired";
        } catch (repairError) {
          run.event("no-change-cloudbase-repair-failed", { code: repairError.code, message: repairError.message });
          noChangeStatus = "partial-success";
          noChangeCloudbaseStatus = "cloudbase-mirror-pending";
        }
      }
      await run.stage("completed", async () => ({ success: true, status: noChangeStatus }));
      showToast("Publisher", "No data change; dual-source health check completed.");
      return run.receipt({
        success: noChangeStatus !== "partial-success",
        status: noChangeStatus,
        overallStatus: noChangeStatus,
        skipped: true,
        term,
        canonicalHash: stagingMeta.canonicalHash,
        counts: stagingMeta.counts,
        oracleStatus: "no-change",
        cloudbaseStatus: noChangeCloudbaseStatus,
        cloudbaseReceipt,
        liveSmoke: noChangeSmoke,
        diffReportPath: run.diffReportPath,
      });
    }

    uploadResult = await run.stage("uploading-oracle", async () => {
      if (process.env.FOSU_PUBLISHER_MOCK_ORACLE_UPLOAD_FAIL === "1") {
        const error = new Error("mock oracle upload failure");
        error.code = "MOCK_ORACLE_UPLOAD_FAILED";
        throw error;
      }
      if (process.env.FOSU_PUBLISHER_MOCK === "1") {
        uploadResult = {
          success: true,
          uploadId: `mock-upload-${run.runId}`,
          stagingId: `mock-upload-${run.runId}`,
          canonicalHash: stagingMeta.canonicalHash,
          skipped: false,
        };
        run.save({ uploadId: uploadResult.uploadId, uploadResult });
        return uploadResult;
      }
      uploadResult = await uploadStagingFile({
        filePath: crawlPlan.output,
        server: args["oracle-base-url"] || DEFAULT_ORACLE_BASE_URL,
        token: getPublisherAdminToken().token,
        authMode: "admin",
        params: Object.assign({}, args, { gzip: true }),
        term,
        note: args.note || `publisher ${run.runId}`,
        source: "fosu-publisher",
      });
      run.save({ uploadId: uploadResult.uploadId || uploadResult.stagingId || "", uploadResult });
      return uploadResult;
    });

    const finalizeStatus = await run.stage("waiting-staging-finalize", async () => {
      return waitForStagingFinalize(args["oracle-base-url"] || DEFAULT_ORACLE_BASE_URL, uploadResult, run);
    });
    uploadResult = finalizeStatus && finalizeStatus.uploadResult || uploadResult || run.state.uploadResult || null;
    if (uploadResult && uploadResult.job && uploadResult.job.id && !uploadResult.finalized) {
      run.event("staging-finalize-reconcile", { jobId: uploadResult.job.id });
      const reconciled = await waitForStagingFinalize(args["oracle-base-url"] || DEFAULT_ORACLE_BASE_URL, uploadResult, run);
      uploadResult = reconciled.uploadResult || uploadResult;
    }

    await run.stage("publishing-release", async () => {
      publishResult = await publishStaging(args["oracle-base-url"] || DEFAULT_ORACLE_BASE_URL, run, args);
      run.save({
        publishJobId: publishResult.jobId || publishResult.job && publishResult.job.id || "",
        publishResult,
        oracleReleaseVersion: publishResult.releaseVersion || publishResult.activeReleaseVersion || publishResult.version || "",
      });
      return publishResult;
    });

    await run.stage("waiting-release-job", async () => ({ success: true, publishResult }));

    const oracleVerification = await run.stage("verifying-oracle-only", async () => runOracleOnlySmoke(args));
    run.save({ oracleVerification });

    try {
      await run.stage("cloudbase-preflight-and-mirror", async () => {
        cloudbaseReceipt = await cloudbasePreflightAndMirror(args);
        writeJsonAtomic(run.cloudbaseReceiptPath, cloudbaseReceipt);
        run.save({ cloudbaseReceipt, cloudbaseRelation: cloudbaseReceipt.mirror && cloudbaseReceipt.mirror.relation || null });
        return cloudbaseReceipt;
      });
      liveSmoke = await run.stage("verifying-cloudbase-and-dual-source", async () => runDualSourceSmoke(args));
      await run.stage("completed", async () => ({ success: true }));
      showToast("Publisher", "Oracle and CloudBase are both published and verified.");
      return run.receipt({
        success: true,
        overallStatus: "success",
        term,
        canonicalHash: stagingMeta.canonicalHash,
        counts: stagingMeta.counts,
        diffReportPath: run.diffReportPath,
        uploadResult,
        publishResult,
        oracleVerification,
        cloudbaseReceipt,
        liveSmoke,
        oracleStatus: "published",
        cloudbaseStatus: "mirrored",
        staticSourceHealth: "dual-source-ok",
      });
    } catch (cloudbaseError) {
      const releaseVersion = publishResult && (publishResult.releaseVersion || publishResult.activeReleaseVersion || publishResult.version);
      let manualPackage = null;
      if (releaseVersion) {
        try {
          manualPackage = await exportCloudbaseManualPackage(args, releaseVersion);
          run.save({ manualPackage });
        } catch (exportError) {
          run.event("manual-export-failed", { code: exportError.code, message: exportError.message });
        }
      }
      showToast("Publisher", "Oracle published; CloudBase mirror is pending.");
      return run.receipt({
        success: false,
        status: "partial-success",
        overallStatus: "partial-success",
        term,
        canonicalHash: stagingMeta.canonicalHash,
        counts: stagingMeta.counts,
        diffReportPath: run.diffReportPath,
        uploadResult,
        publishResult,
        oracleVerification,
        oracleStatus: "published",
        cloudbaseStatus: "cloudbase-mirror-pending",
        cloudbaseError: { code: cloudbaseError.code || "CLOUDBASE_MIRROR_FAILED", message: cloudbaseError.message },
        manualPackage,
      });
    }
  } catch (error) {
    run.fail(error);
    throw error;
  } finally {
    if (lockAcquired) releaseLock(run);
  }
}

function buildMockStaging(term) {
  const courses = [{ courseName: "Mock Course", teacherName: "Mock Teacher", classroom: "Mock Room", weekday: 1, startSection: 1, endSection: 2 }];
  const classSchedules = Array.from({ length: 3 }, (_, index) => ({
    classId: `class-${index + 1}`,
    className: `Mock Class ${index + 1}`,
    semester: term,
    displayType: "class-schedule",
    courses,
  }));
  const teacherSchedules = Array.from({ length: 600 }, (_, index) => ({ teacherName: `Teacher ${index + 1}`, courses }));
  const classroomSchedules = Array.from({ length: 3 }, (_, index) => ({ roomName: `Room ${index + 1}`, courses }));
  const courseSchedules = Array.from({ length: 3 }, (_, index) => ({ courseName: `Course ${index + 1}`, courses }));
  return {
    schemaVersion: 1,
    term,
    semester: term,
    termConfig: { term, termStartDate: "2026-03-09", totalWeeks: 20, weekStart: "monday" },
    catalog: { colleges: [{ code: "01", name: "Mock College" }], grades: ["2025"], majors: [{ code: "m1", name: "Mock Major" }] },
    majors: [{ code: "m1", name: "Mock Major" }],
    classSchedules,
    resources: {
      teachers: teacherSchedules.map((item) => ({ teacherName: item.teacherName })),
      classrooms: classroomSchedules.map((item) => ({ roomName: item.roomName })),
      courses: courseSchedules.map((item) => ({ courseName: item.courseName })),
      teacherSchedules,
      classroomSchedules,
      courseSchedules,
    },
    scopeSources: {
      teacherSchedules: { sourceMode: "derived-current-run" },
      classroomSchedules: { sourceMode: "derived-current-run" },
      courseSchedules: { sourceMode: "derived-current-run" },
    },
    meta: {
      includeScopes: ["classSchedules", "teacherSchedules", "classroomSchedules", "courseSchedules", "teachers", "classrooms", "courses"],
      actualNetworkRequestCount: 3,
      resourceSource: "derived-current-run",
      usedProgressCache: false,
      usedNoScheduleCache: false,
      usedClassScheduleCache: false,
      scopeSources: {
        teacherSchedules: { sourceMode: "derived-current-run" },
        classroomSchedules: { sourceMode: "derived-current-run" },
        courseSchedules: { sourceMode: "derived-current-run" },
      },
    },
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    console.log([
      "Usage:",
      "  npm run sync:publish",
      "  npm run sync:publish -- --incremental --term=2026-2027-1 --grade=2026 --concurrency=8 --resume",
      "  npm run sync:publish -- --full --term=2026-2027-1 --term-start-date=YYYY-MM-DD --total-weeks=20 --grade=2026",
      "  npm run sync:publish -- --mode=full --term=2026-2027-1 --term-start-date=YYYY-MM-DD --total-weeks=20",
      "  npm run sync:publish -- --mode=resume --run-id=<runId>",
      "  npm run sync:publish -- --mode=mirror-only",
      "  npm run sync:export-cloudbase -- --release=<releaseVersion>",
    ].join(os.EOL));
    return null;
  }
  const mode = normalizeRequestedMode(args);
  if (args.deprecated) {
    console.warn(`[deprecated] ${args.deprecated} is deprecated. Use npm run sync:publish instead.`);
  }
  if (mode === "full") {
    const missing = ["term", "term-start-date", "total-weeks"].filter((key) => !args[key] && !(key === "term" && args.semester));
    if (missing.length) {
      const error = new Error(`full mode requires explicit ${missing.map((key) => `--${key}`).join(", ")}`);
      error.code = "PUBLISHER_FULL_TERM_CONFIG_REQUIRED";
      throw error;
    }
  }
  let runId = args["run-id"] || args.runId;
  if (mode === "resume" && !runId) {
    const latest = readJsonSafe(LATEST_PATH, null);
    runId = latest && latest.runId;
    if (!runId) {
      const error = new Error("resume requires --run-id or an existing latest publisher run");
      error.code = "PUBLISHER_RESUME_RUN_REQUIRED";
      throw error;
    }
  }
  const run = new PublisherRun({ mode, args, runId });
  let receipt = null;
  try {
    receipt = await runMainPipeline(run, args);
  } catch (error) {
    const failureReceipt = run.receipt({
      success: false,
      status: "failed",
      overallStatus: "failed",
      code: error.code || "PUBLISHER_FAILED",
      message: error.message,
      currentStage: run.state.currentStage,
      term: run.state.term || args.term || "",
      canonicalHash: run.state.canonicalHash || "",
      diffReportPath: run.diffReportPath,
      oracleStatus: run.state.oracleReleaseVersion ? "published" : "not-published",
      cloudbaseStatus: run.state.oracleReleaseVersion ? "cloudbase-mirror-pending" : "not-run",
      blockers: error.blockers || [],
      warnings: error.warnings || [],
      blockerDetails: error.blockerDetails || [],
      blockerCodes: error.blockerCodes || [],
      warningDetails: error.warningDetails || [],
      safetyReport: error.safetyReport || null,
      jobError: error.jobError || null,
    });
    try {
      await uploadPublisherReceipt(args, failureReceipt);
    } catch (receiptError) {
      run.event("publisher-receipt-upload-failed", { code: receiptError.code, message: receiptError.message });
    }
    throw error;
  }
  try {
    const uploadedReceipt = await uploadPublisherReceipt(args, receipt);
    receipt.publisherReceiptUpload = uploadedReceipt;
    writeJsonAtomic(run.receiptPath, redact(receipt));
  } catch (receiptError) {
    receipt.publisherReceiptWarning = {
      code: receiptError.code || "PUBLISHER_RECEIPT_UPLOAD_FAILED",
      message: receiptError.message,
    };
    run.event("publisher-receipt-upload-failed", receipt.publisherReceiptWarning);
    writeJsonAtomic(run.receiptPath, redact(receipt));
  }
  console.log(JSON.stringify(redact({
    runId: receipt.runId,
    status: receipt.status || (receipt.success ? "success" : "failed"),
    term: receipt.term || "",
    canonicalHash: receipt.canonicalHash || "",
    oracleStatus: receipt.oracleStatus || "",
    cloudbaseStatus: receipt.cloudbaseStatus || "",
    receiptPaths: receipt.receiptPaths,
  }), null, 2));
  return receipt;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify(redact({
      success: false,
      code: error.code || "PUBLISHER_FAILED",
      message: error.message,
    }), null, 2));
    process.exit(1);
  });
}

module.exports = {
  STAGES,
  PublisherRun,
  acquireLock,
  buildPerformanceSummary,
  buildCrawlArgs,
  buildMockStaging,
  checkCampusNetworkForPublisher,
  exportCloudbaseManualPackage,
  formatLockStatus,
  getProcessCommandLine,
  inspectPublisherLock,
  isPublisherCommandLine,
  main,
  normalizeRequestedMode,
  parseArgs,
  processIsAlive,
  redact,
  reconcilePublisherLock,
  removePublisherLock,
  runDualSourceSmoke,
  runLocalPreflight,
  runOracleOnlySmoke,
  sanitizeReceiptForUpload,
  validateStaging,
};
