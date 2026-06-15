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

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const RUNS_ROOT = path.join(PROJECT_ROOT, ".local", "publisher-runs");
const LOCK_PATH = path.join(RUNS_ROOT, "publisher.lock");
const LATEST_PATH = path.join(RUNS_ROOT, "latest.json");
const DEFAULT_ORACLE_BASE_URL = process.env.FOSU_API_BASE || process.env.ORACLE_API_BASE_URL || "https://class.katelya.eu.org";
const DEFAULT_CLOUDBASE_BASE_URL = cloudbaseConfig.CLOUDBASE_HOSTING_BASE_URL;
const DEFAULT_ENV_ID = cloudbaseConfig.ENV_ID || "cloud1-d3g17rpe7566d3d5c";
const STALE_LOCK_MS = Number(process.env.FOSU_PUBLISHER_STALE_LOCK_MS || 6 * 60 * 60 * 1000);

const STAGES = [
  ["acquiring-lock", "正在检查运行锁"],
  ["preflight", "正在执行发布预检"],
  ["resolving-term", "正在解析学期"],
  ["checking-campus-network", "正在检查校园网"],
  ["checking-session", "正在检查教务登录状态"],
  ["crawling", "正在抓取全校课表"],
  ["building-staging", "正在生成单一 Staging"],
  ["validating-local", "正在校验本地 Staging"],
  ["checking-fingerprint", "正在检查 canonicalHash"],
  ["uploading-oracle", "正在上传 Oracle Staging"],
  ["waiting-staging-finalize", "正在等待 Oracle 合并校验"],
  ["publishing-release", "正在触发 Oracle Release"],
  ["waiting-release-job", "正在等待 Release 后台任务"],
  ["verifying-oracle", "正在验证 Oracle 静态发布"],
  ["mirroring-cloudbase", "正在镜像 CloudBase Hosting"],
  ["verifying-cloudbase", "正在验证 CloudBase 远端 hash/size"],
  ["live-smoke", "正在执行双源 live smoke"],
  ["completed", "发布完成"],
];

const STAGE_INDEX = new Map(STAGES.map(([name], index) => [name, index]));

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
  return args;
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
  const blockedKey = /token|ticket|cookie|secret|authorization|password|api[-_]?key/i;
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
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]");
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

function commandName(name) {
  if (process.platform !== "win32") return name;
  if (name === "npm") return "npm.cmd";
  if (name === "node") return "node.exe";
  return name;
}

function runCommand(command, args, options = {}) {
  if (process.env.FOSU_PUBLISHER_MOCK === "1") {
    return { status: 0, stdout: "", stderr: "", mocked: true };
  }
  const result = spawnSync(commandName(command), args || [], {
    cwd: options.cwd || PROJECT_ROOT,
    env: Object.assign({}, process.env, options.env || {}),
    encoding: options.encoding || "utf8",
    stdio: options.inherit === false ? "pipe" : "inherit",
    timeout: options.timeoutMs || 0,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const error = new Error(`${command} ${(args || []).join(" ")} failed with status ${result.status}`);
    error.code = options.code || "COMMAND_FAILED";
    error.status = result.status;
    error.stdout = result.stdout || "";
    error.stderr = result.stderr || "";
    error.originalError = result.error || null;
    throw error;
  }
  return result;
}

function axiosHeaders() {
  const token = process.env.ADMIN_API_TOKEN || process.env.ORACLE_ADMIN_TOKEN || "";
  return token ? { "x-admin-token": token, Authorization: `Bearer ${token}` } : {};
}

async function getJson(url, options = {}) {
  const response = await axios.get(url, {
    headers: Object.assign({ Accept: "application/json" }, options.headers || {}),
    timeout: options.timeoutMs || 30000,
    proxy: false,
  });
  return response.data;
}

async function postJson(url, body, options = {}) {
  const response = await axios.post(url, body || {}, {
    headers: Object.assign({ "Content-Type": "application/json" }, options.headers || {}),
    timeout: options.timeoutMs || 60000,
    proxy: false,
  });
  return response.data;
}

async function waitAdminJob(baseUrl, jobId, label, run) {
  const url = `${baseUrl.replace(/\/+$/g, "")}/api/admin/jobs/${encodeURIComponent(jobId)}`;
  for (let attempt = 1; attempt <= 240; attempt += 1) {
    const data = await getJson(url, { headers: axiosHeaders(), timeoutMs: 30000 });
    const job = data && data.job;
    run.event("job-poll", { label, jobId, attempt, status: job && job.status });
    if (job && (job.status === "success" || job.status === "failed")) {
      if (job.status === "failed") {
        const error = new Error(`${label || "admin job"} failed: ${job.error && job.error.message || "unknown error"}`);
        error.code = "ADMIN_JOB_FAILED";
        error.job = job;
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
    this.cloudbaseReceiptPath = path.join(this.runDir, "cloudbase-receipt.json");
    this.state = readJsonSafe(this.statePath, {
      schemaVersion: 1,
      runId: this.runId,
      mode: this.mode,
      status: "running",
      currentStage: "",
      completedStages: [],
      startedAt: nowIso(),
      updatedAt: nowIso(),
      paths: {},
      summary: {},
    });
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
    console.log(`[${index + 1}/${STAGES.length}] ${label}`);
    this.event("stage-start", { stage, index: index + 1, label });
    this.save({ currentStage: stage });
  }

  completeStage(stage, summary) {
    const completed = new Set(this.state.completedStages || []);
    completed.add(stage);
    this.event("stage-complete", { stage, summary: summary || null });
    this.save({
      completedStages: Array.from(completed),
      summary: Object.assign({}, this.state.summary || {}, summary || {}),
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
    const payload = redact({
      success: false,
      runId: this.runId,
      mode: this.mode,
      code: error.code || "PUBLISHER_FAILED",
      message: error.message,
      stack: error.stack,
      failedAt: nowIso(),
      currentStage: this.state.currentStage,
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
        cloudbaseReceipt: this.cloudbaseReceiptPath,
      },
    }, payload || {}));
    writeJsonAtomic(this.receiptPath, receipt);
    this.save({ status: receipt.success ? "completed" : (receipt.status || "partial-success"), receipt });
    return receipt;
  }
}

function acquireLock(run) {
  ensureDir(RUNS_ROOT);
  const existing = readJsonSafe(LOCK_PATH, null);
  if (existing) {
    const age = Date.now() - (Date.parse(existing.createdAt || "") || 0);
    const alive = processIsAlive(existing.pid);
    if (alive && age < STALE_LOCK_MS) {
      const error = new Error(`publisher is already running: ${existing.runId || existing.pid}`);
      error.code = "PUBLISHER_LOCKED";
      throw error;
    }
    run.event("stale-lock-removed", { existing, age, alive });
  }
  writeJsonAtomic(LOCK_PATH, {
    runId: run.runId,
    pid: process.pid,
    createdAt: nowIso(),
    cwd: PROJECT_ROOT,
  });
}

function releaseLock(run) {
  const existing = readJsonSafe(LOCK_PATH, null);
  if (existing && existing.runId === run.runId) {
    try { fs.unlinkSync(LOCK_PATH); } catch (error) {}
  }
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
    return { sessionPath: "mock-session", size: 1, mtime: nowIso(), mocked: true };
  }
  const sessionPath = path.join(PROJECT_ROOT, "tools", "fosu-sync-client", ".session", "session.json");
  const stat = fs.existsSync(sessionPath) ? fs.statSync(sessionPath) : null;
  if (!stat || stat.size < 20) {
    const error = new Error("教务登录状态不存在或已损坏，请先运行 npm run login。");
    error.code = "SESSION_REQUIRED_RUN_NPM_LOGIN";
    throw error;
  }
  return { sessionPath, size: stat.size, mtime: stat.mtime.toISOString() };
}

function buildCrawlArgs(mode, args, run, term) {
  const output = path.join(run.runDir, "staging.json");
  const action = "crawl:daily";
  const catalogPolicy = mode === "full" ? "network-only" : "reuse-validated";
  const negativeCachePolicy = mode === "full" ? "revalidate" : "ignore";
  const base = [
    "tools/fosu-sync-client/sync.js",
    action,
    `--term=${term}`,
    `--output=${output}`,
    `--catalog-policy=${catalogPolicy}`,
    "--schedule-policy=network-only",
    "--progress-policy=ignore",
    `--negative-cache-policy=${negativeCachePolicy}`,
    "--allow-derived",
    "--class-scope=all",
  ];
  if (mode === "full") {
    if (args["term-start-date"]) base.push(`--term-start-date=${args["term-start-date"]}`);
    if (args["total-weeks"]) base.push(`--total-weeks=${args["total-weeks"]}`);
    base.push("--force-refresh", "--clear-progress", "--recheck-no-schedule");
  }
  if (args["verify-direct-resources"]) base.push("--verify-direct-resources");
  return { output, args: base };
}

function privacyScanText(text) {
  const findings = [];
  [
    ["password", /password|passwd|pwd|密码/i],
    ["authorization", /authorization|bearer\s+[a-z0-9._~+/=-]{8,}/i],
    ["cookie", /cookie|set-cookie|JSESSIONID/i],
    ["api-key", /api[-_]?key|secret(?:id|key)?|access[-_]?token/i],
    ["student-id", /学号|student(?:id|number)|\b\d{10,16}\b/i],
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
    counts,
    sourceModes,
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
    };
  }
  const url = `${baseUrl.replace(/\/+$/g, "")}/api/admin/staging/fingerprint?canonicalHash=${encodeURIComponent(canonicalHash)}`;
  return getJson(url, { headers: axiosHeaders(), timeoutMs: 30000 });
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

function runLiveSmoke(args) {
  if (process.env.FOSU_PUBLISHER_MOCK === "1") return { success: true, mocked: true };
  const cmdArgs = ["tools/cloudbase/live-smoke.js"];
  if (args["cloudbase-base-url"]) cmdArgs.push(`--cloudbase-base-url=${args["cloudbase-base-url"]}`);
  if (args["oracle-base-url"]) cmdArgs.push(`--oracle-base-url=${args["oracle-base-url"]}`);
  runCommand("node", cmdArgs, { code: "LIVE_SMOKE_FAILED" });
  return { success: true };
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
  fs.writeFileSync(path.join(manualRoot, "人工上传说明.txt"), [
    "CloudBase Hosting 人工上传步骤",
    "",
    "1. 进入 CloudBase 控制台 -> 静态网站托管 -> 文件管理。",
    `2. 先上传目录：releases/${version}/`,
    `3. 验证文件可访问：releases/${version}/manifest.json`,
    "4. 最后覆盖：runtime/active.json",
    "5. 禁止先上传 pointer。",
    "6. 不需要在云存储或数据库中上传。",
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
      const exportReceipt = await run.stage("mirroring-cloudbase", async () => exportCloudbaseManualPackage(args, args.release));
      await run.stage("completed", async () => ({ success: true, status: "manual-package-exported" }));
      receipt = run.receipt({
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

    await run.stage("preflight", async () => {
      runCommand("npm", ["run", "cloudbase:preflight"], { code: "CLOUDBASE_PREFLIGHT_FAILED", timeoutMs: 360000 });
      return { success: true };
    });

    termInfo = await run.stage("resolving-term", async () => resolveTerm(args));
    const term = termInfo.term || (run.state.summary["resolving-term"] && run.state.summary["resolving-term"].term);

    if (run.mode === "mirror-only") {
      await run.stage("mirroring-cloudbase", async () => {
        cloudbaseReceipt = await mirrorCloudbase(args);
        writeJsonAtomic(run.cloudbaseReceiptPath, cloudbaseReceipt);
        return cloudbaseReceipt;
      });
      await run.stage("verifying-cloudbase", async () => ({ success: true, mirrored: true }));
      liveSmoke = await run.stage("live-smoke", async () => runLiveSmoke(args));
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
      runCommand("npm", ["--prefix", "tools/fosu-sync-client", "run", "diagnose"], { code: "CAMPUS_NETWORK_CHECK_FAILED" });
      return { success: true };
    });

    await run.stage("checking-session", async () => requireSession());

    const crawlPlan = buildCrawlArgs(run.mode === "full" ? "full" : "routine", args, run, term);
    await run.stage("crawling", async () => {
      runCommand("node", crawlPlan.args, {
        code: "LOCAL_CRAWL_FAILED",
        env: {
          PREFERRED_SEMESTER: term,
          SYNC_CLASS_SCOPE: "all",
          SYNC_RESOURCE_SOURCE: "derived",
        },
      });
      return { success: true, output: crawlPlan.output };
    });

    await run.stage("building-staging", async () => {
      if (process.env.FOSU_PUBLISHER_MOCK === "1") {
        writeJsonAtomic(crawlPlan.output, buildMockStaging(term));
      }
      return { success: true, stagingPath: crawlPlan.output };
    });

    stagingMeta = await run.stage("validating-local", async () => {
      const meta = validateStaging(crawlPlan.output, term);
      writeJsonAtomic(run.stagingMetaPath, meta);
      return meta;
    });

    const fingerprint = await run.stage("checking-fingerprint", async () => {
      const check = await checkFingerprint(args["oracle-base-url"] || DEFAULT_ORACLE_BASE_URL, stagingMeta.canonicalHash);
      return Object.assign({ canonicalHash: stagingMeta.canonicalHash }, check);
    });
    if (fingerprint.sameAsActive) {
      await run.stage("completed", async () => ({ success: true, status: "no-change" }));
      showToast("佛课小表同步", "数据无变化，已跳过上传和 CloudBase 镜像。");
      return run.receipt({
        success: true,
        status: "no-change",
        skipped: true,
        term,
        canonicalHash: stagingMeta.canonicalHash,
        counts: stagingMeta.counts,
        oracleStatus: "no-change",
        cloudbaseStatus: "not-run",
      });
    }

    await run.stage("uploading-oracle", async () => {
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
        return uploadResult;
      }
      uploadResult = await uploadStagingFile({
        filePath: crawlPlan.output,
        server: args["oracle-base-url"] || DEFAULT_ORACLE_BASE_URL,
        token: process.env.ADMIN_API_TOKEN || process.env.ORACLE_ADMIN_TOKEN || "",
        authMode: "admin",
        params: Object.assign({}, args, { gzip: true }),
        term,
        note: args.note || `publisher ${run.runId}`,
        source: "fosu-publisher",
      });
      return uploadResult;
    });

    await run.stage("waiting-staging-finalize", async () => ({ success: true, uploadResult }));

    await run.stage("publishing-release", async () => {
      publishResult = await publishStaging(args["oracle-base-url"] || DEFAULT_ORACLE_BASE_URL, run, args);
      return publishResult;
    });

    await run.stage("waiting-release-job", async () => ({ success: true, publishResult }));

    await run.stage("verifying-oracle", async () => runLiveSmoke(args));

    try {
      await run.stage("mirroring-cloudbase", async () => {
        cloudbaseReceipt = await mirrorCloudbase(args);
        writeJsonAtomic(run.cloudbaseReceiptPath, cloudbaseReceipt);
        return cloudbaseReceipt;
      });
      await run.stage("verifying-cloudbase", async () => ({ success: true, cloudbaseReceipt }));
      liveSmoke = await run.stage("live-smoke", async () => runLiveSmoke(args));
      await run.stage("completed", async () => ({ success: true }));
      showToast("佛课小表同步", "Oracle 和 CloudBase 双源发布完成。");
      return run.receipt({
        success: true,
        term,
        canonicalHash: stagingMeta.canonicalHash,
        counts: stagingMeta.counts,
        uploadResult,
        publishResult,
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
        } catch (exportError) {
          run.event("manual-export-failed", { code: exportError.code, message: exportError.message });
        }
      }
      showToast("佛课小表同步", "Oracle 已发布，CloudBase 镜像待重试。");
      return run.receipt({
        success: false,
        status: "partial-success",
        term,
        canonicalHash: stagingMeta.canonicalHash,
        counts: stagingMeta.counts,
        uploadResult,
        publishResult,
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
      "  npm run sync:publish -- --mode=full --term=2026-2027-1 --term-start-date=YYYY-MM-DD --total-weeks=20",
      "  npm run sync:publish -- --mode=resume --run-id=<runId>",
      "  npm run sync:publish -- --mode=mirror-only",
      "  npm run sync:export-cloudbase -- --release=<releaseVersion>",
    ].join(os.EOL));
    return null;
  }
  const requestedMode = String(args.mode || "routine").trim();
  const mode = requestedMode === "export-cloudbase" ? "export-cloudbase" : requestedMode;
  if (args.deprecated) {
    console.warn(`[deprecated] ${args.deprecated} 已收敛到 npm run sync:publish；请后续只使用 sync:publish。`);
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
  const receipt = await runMainPipeline(run, args);
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
  buildCrawlArgs,
  buildMockStaging,
  exportCloudbaseManualPackage,
  main,
  parseArgs,
  processIsAlive,
  redact,
  validateStaging,
};
