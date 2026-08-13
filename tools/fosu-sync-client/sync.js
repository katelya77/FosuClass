/**
 * 本地同步核心脚本：负责诊断网络、复用或注入登录状态、抓取教务数据并同步上传至 VPS 后端。
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");
const {
  loadSyncClientEnv,
  prepareDirectNetworkEnvironment,
  withDirectBrowserArgs,
} = require("./syncEnv");
const {
  printDiagnosisSummary,
  probeCampusNetwork,
} = require("./networkProbe");
const envInfo = loadSyncClientEnv();
const envPath = envInfo.envPath;
const directNetworkEnv = prepareDirectNetworkEnvironment(process.env, { axios });
const {
  ALL_SCOPES,
  applyPlanToParams,
  buildSyncPlan,
  getRecommendedOperations,
  parseCliArgs,
  printablePlan,
} = require("../../shared/syncPlan");
const syncCacheStore = require("../../shared/syncCacheStore");
const { isFreshNetworkSidecar } = require("../../shared/syncProvenance");

console.log(`[env] .env path: ${envPath}`);
console.log(`[env] FOSU_API_BASE: ${process.env.FOSU_API_BASE || "https://class.katelya.eu.org"}`);

console.log(`[env] PREFERRED_SEMESTER: ${process.env.PREFERRED_SEMESTER || "未配置"}`);
console.log(`[env] SYNC_GRADE_RANGE: ${process.env.SYNC_GRADE_RANGE || "未配置"}`);
console.log(`[env] SYNC_GRADES (专业同步使用): ${process.env.SYNC_GRADES || "未配置"}`);
console.log(`[env] SYNC_CLASS_GRADES (班级课表同步使用): ${process.env.SYNC_CLASS_GRADES || "未配置"}`);
console.log(`[env] SYNC_UPLOAD_CHUNK_SIZE: ${process.env.SYNC_UPLOAD_CHUNK_SIZE || "50"}`);
console.log(`[env] SYNC_SKIP_NO_SCHEDULE_CACHE: ${process.env.SYNC_SKIP_NO_SCHEDULE_CACHE || "true"}`);
console.log(`[env] SYNC_RECHECK_NO_SCHEDULE: ${process.env.SYNC_RECHECK_NO_SCHEDULE || "false"}`);
console.log(`[env] ADMIN_API_TOKEN: ${process.env.ADMIN_API_TOKEN ? "present" : "missing"}`);

const parser = require("../../server/src/utils/parser");
const normalizer = require("../../server/src/utils/scheduleNormalizer");
const courseIdentity = require("../../server/src/utils/courseNormalizer");
const releaseService = require("../../server/src/services/releaseService");
const termRegistryService = require("../../server/src/services/termRegistryService");
const stagingUploader = require("./upload");
const {
  isInvalidTeacherName,
} = require("../../server/src/shared/resourceCountContract");
const {
  buildSidecarMeta,
  calculateFingerprint,
  readSidecarHash,
} = require("../../server/src/utils/stagingFingerprint");

const INITIAL_DETECTED_PROXIES = directNetworkEnv.detectedProxyNames.map((name) => [name, "[redacted]"]);
if (directNetworkEnv.detectedProxyNames.length > 0) {
  console.warn(`检测到代理环境变量: ${directNetworkEnv.detectedProxyNames.join(", ")}`);
  if (directNetworkEnv.disableProxy) {
    console.warn("当前同步进程已清理代理变量，校园教务、Oracle 与 CloudBase 默认直连。");
  }
}

const FOSU_BASE_URL = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
const FOSU_API_BASE = process.env.FOSU_API_BASE || "https://class.katelya.eu.org";

let cachedProjectRoot = null;

function resolveProjectPath() {
  if (cachedProjectRoot) return cachedProjectRoot;

  const startDir = process.cwd();
  let currentDir = startDir;

  while (true) {
    const serverPath = path.join(currentDir, "server");
    const miniprogramPath = path.join(currentDir, "miniprogram");

    // 检查是否同时存在这两个目录
    if (fs.existsSync(serverPath) && fs.statSync(serverPath).isDirectory() &&
        fs.existsSync(miniprogramPath) && fs.statSync(miniprogramPath).isDirectory()) {
      cachedProjectRoot = currentDir;
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  // Fallback to static mapping using __dirname
  const fallbackPath = path.resolve(__dirname, "../..");
  cachedProjectRoot = fallbackPath;
  return fallbackPath;
}

const PROJECT_ROOT = resolveProjectPath();

global.SYNC_STAGE_TIMINGS = global.SYNC_STAGE_TIMINGS || {};

function beginSyncStage(stage) {
  return { stage, startedAt: new Date().toISOString(), startedMs: Date.now() };
}

function finishSyncStage(token, patch = {}) {
  const finishedAt = new Date().toISOString();
  global.SYNC_STAGE_TIMINGS[token.stage] = Object.assign({
    stage: token.stage,
    startedAt: token.startedAt,
    finishedAt,
    durationMs: Date.now() - token.startedMs,
  }, patch || {});
}

async function withSyncStage(stage, fn) {
  const token = beginSyncStage(stage);
  try {
    const result = await fn();
    finishSyncStage(token, { status: "success" });
    return result;
  } catch (error) {
    finishSyncStage(token, { status: "failed", code: error.code || "", message: error.message });
    throw error;
  }
}

function measureSyncStage(stage, fn) {
  const token = beginSyncStage(stage);
  try {
    const result = fn();
    finishSyncStage(token, { status: "success" });
    return result;
  } catch (error) {
    finishSyncStage(token, { status: "failed", code: error.code || "", message: error.message });
    throw error;
  }
}

function resolveInputFilePath(fileArg) {
  if (!fileArg) {
    return {
      resolved: null,
      tried: []
    };
  }

  // 1. 如果已经是绝对路径，直接返回
  if (path.isAbsolute(fileArg)) {
    return {
      resolved: fileArg,
      tried: [fileArg]
    };
  }

  const cwd = process.cwd();
  const projectRoot = resolveProjectPath();
  const tried = [];

  // 规范化路径
  const normalizedFile = path.normalize(fileArg).replace(/\\/g, "/");

  // 2. 如果用户传入的相对路径以 tools/fosu-sync-client/ 开头
  if (normalizedFile.startsWith("tools/fosu-sync-client/")) {
    // 优先按 projectRoot 拼接：projectRoot/tools/fosu-sync-client/...
    const pRootJoined = path.resolve(projectRoot, fileArg);
    tried.push(pRootJoined);
    if (fs.existsSync(pRootJoined)) {
      return { resolved: pRootJoined, tried };
    }

    // 尝试去除 tools/fosu-sync-client/ 前缀后相对 cwd 拼接 (如果 cwd 是 tools/fosu-sync-client)
    const relativePart = normalizedFile.substring("tools/fosu-sync-client/".length);
    const pCwdStripped = path.resolve(cwd, relativePart);
    tried.push(pCwdStripped);
    if (fs.existsSync(pCwdStripped)) {
      return { resolved: pCwdStripped, tried };
    }
  } else {
    // 3. 否则，依次尝试以下路径：
    // - 当前 cwd/fileArg (包括 staging/xxx.json 或 ./staging/xxx.json)
    const pCwd = path.resolve(cwd, fileArg);
    tried.push(pCwd);
    if (fs.existsSync(pCwd)) {
      return { resolved: pCwd, tried };
    }

    // - projectRoot/fileArg (如果是在项目根目录运行，例如 ./staging/xxx.json)
    if (projectRoot) {
      const pRoot = path.resolve(projectRoot, fileArg);
      tried.push(pRoot);
      if (fs.existsSync(pRoot)) {
        return { resolved: pRoot, tried };
      }

      // - projectRoot/tools/fosu-sync-client/fileArg (在 tools/fosu-sync-client 下的相对路径，但在 projectRoot 中运行)
      const pClient = path.resolve(projectRoot, "tools/fosu-sync-client", fileArg);
      tried.push(pClient);
      if (fs.existsSync(pClient)) {
        return { resolved: pClient, tried };
      }
    }
  }

  // 均未找到
  return {
    resolved: null,
    tried
  };
}

function resolveOutputFilePath(outputArg) {
  if (!outputArg) return null;
  if (path.isAbsolute(outputArg)) return outputArg;

  const cwd = process.cwd();
  const projectRoot = resolveProjectPath();
  const normalizedFile = path.normalize(outputArg).replace(/\\/g, "/");

  if (normalizedFile.startsWith("tools/fosu-sync-client/")) {
    return path.resolve(projectRoot, outputArg);
  }

  // 如果处于项目根目录下，则优先拼接在 projectRoot 下，以保持 local-campus 默认输出建议统一到 projectRoot/staging/{term}-full.json
  if (projectRoot) {
    return path.resolve(projectRoot, outputArg);
  }
  return path.resolve(cwd, outputArg);
}

function getSidecarMetaPath(outputPath) {
  return String(outputPath || "").replace(/\.json$/i, ".meta.json");
}

function printLocalCampusPathSummary(params, outputPath) {
  console.log("📁 本机采集路径:");
  console.log(`   项目根目录: ${resolveProjectPath()}`);
  console.log(`   sync-client 目录: ${__dirname}`);
  console.log(`   output 绝对路径: ${outputPath}`);
  console.log(`   是否上传 VPS: ${params.upload || params["upload-vps"] ? "是" : "否，本命令仅生成本地 staging"}`);
}

// 延迟辅助函数
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "";
const FOSU_SYNC_AUTH_MODE = process.env.FOSU_SYNC_AUTH_MODE || "playwright-manual";
const SESSION_PATH = path.join(__dirname, ".session", "session.json");

function getEnvFlag(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  return String(value).toLowerCase() === "true";
}

function getActiveSyncPlan() {
  return global.SYNC_PLAN || null;
}

function printSyncPlan(plan) {
  if (!plan) return;
  console.log("\n================ [Resolved Sync Plan] ================");
  console.log(JSON.stringify(printablePlan(plan), null, 2));
  if (plan.deprecated) {
    console.warn(`[deprecated] ${plan.action} is mapped to ${plan.deprecatedTarget}. Use the new command name in runbooks.`);
  }
  if (plan.schedulePolicy === "network-only" && plan.dynamicScopes.length) {
    console.log(`[policy] Dynamic schedules are network-only; progress=${plan.progressPolicy}, no-schedule=${plan.negativeCachePolicy}, derived resources=${plan.allowDerived ? "enabled" : "disabled"}.`);
  }
  console.log("======================================================\n");
}

function isPlanNetworkOnly() {
  const plan = getActiveSyncPlan();
  return Boolean(plan && plan.schedulePolicy === "network-only" && plan.dynamicScopes.length > 0);
}

function findTermByRunId(runId) {
  const id = String(runId || "").trim();
  if (!id) return "";
  const root = path.join(__dirname, ".cache");
  if (!fs.existsSync(root)) return "";
  const terms = fs.readdirSync(root).filter((name) => fs.statSync(path.join(root, name)).isDirectory());
  for (const term of terms) {
    const progressDir = path.join(root, term, "progress");
    if (!fs.existsSync(progressDir)) continue;
    const files = fs.readdirSync(progressDir);
    if (files.some((file) => file.includes(id))) return term;
  }
  return "";
}

function buildScopeSourceReport(scope, overrides = {}) {
  const plan = getActiveSyncPlan();
  const source = plan && plan.sourceRequirements && plan.sourceRequirements[scope] || {};
  return Object.assign({
    scope,
    sourceMode: source.mode || "derived-current-run",
    endpointFamily: source.endpointFamily || "",
    requested: 0,
    succeeded: 0,
    failed: 0,
    derived: 0,
    cacheHits: 0,
    startedAt: "",
    finishedAt: "",
    hash: "",
  }, overrides);
}

function recordScopeSource(scope, report) {
  global.SCOPE_SOURCE_REPORTS = Object.assign({}, global.SCOPE_SOURCE_REPORTS || {}, {
    [scope]: buildScopeSourceReport(scope, report),
  });
}

async function postAdminJson(pathname, body, label) {
  const url = `${FOSU_API_BASE}${pathname}`;
  const response = await axios.post(url, body || {}, {
    headers: ADMIN_API_TOKEN ? { "x-admin-token": ADMIN_API_TOKEN } : {},
    proxy: false,
    timeout: parseInt(process.env.SYNC_ADMIN_POST_TIMEOUT_MS || "30000", 10),
  });
  const data = response.data || {};
  if (data.job && data.job.id) {
    return waitAdminJob(data.job.id, label || pathname);
  }
  return data;
}

function getTermStartDate(term) {
  if (process.env.PREFERRED_TERM_START_DATE) return process.env.PREFERRED_TERM_START_DATE;
  return "";
}

function validateTermId(term) {
  const value = String(term || "").trim();
  const match = value.match(/^(\d{4})-(\d{4})-([12])$/);
  return Boolean(match && Number(match[2]) === Number(match[1]) + 1);
}

function generateSemesterText(term) {
  const parts = String(term || "").split("-");
  if (parts.length !== 3) return term || "";
  return `${parts[0]}-${parts[1]}学年${parts[2] === "1" ? "第一" : "第二"}学期`;
}

function normalizeTermConfigRecord(record, source) {
  const item = record && typeof record === "object" ? record : {};
  const term = String(item.term || item.semester || "").trim();
  if (!validateTermId(term)) return null;
  const rawTotalWeeks = item.totalWeeks || item.weeks || item.weekCount;
  const totalWeeks = rawTotalWeeks == null || rawTotalWeeks === "" ? null : Number(rawTotalWeeks);
  return {
    term,
    semesterText: item.semesterText || item.termText || generateSemesterText(term),
    termStartDate: String(item.termStartDate || item.startDate || item.termStart || "").trim(),
    totalWeeks: Number.isInteger(totalWeeks) && totalWeeks >= 1 && totalWeeks <= 30 ? totalWeeks : null,
    weekStart: item.weekStart || "monday",
    source: source || item.source || "unknown",
    releaseVersion: item.releaseVersion || item.version || "",
  };
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    return null;
  }
}

function getRelayTermConfigFromEnv() {
  const raw = process.env.FOSU_RELAY_TERM_CONFIG || "";
  if (!raw) return null;
  try {
    return normalizeTermConfigRecord(JSON.parse(raw), "relay-term-config");
  } catch (error) {
    return null;
  }
}

function getLocalRegistryTermConfig(term) {
  const projectRoot = resolveProjectPath();
  const candidates = [
    path.join(projectRoot, "server", "storage", "term-registry.json"),
    process.env.FOSU_STORAGE_DIR ? path.join(process.env.FOSU_STORAGE_DIR, "term-registry.json") : "",
  ].filter(Boolean);
  for (const filePath of candidates) {
    const registry = readJsonSafe(filePath);
    const terms = registry && Array.isArray(registry.terms) ? registry.terms : [];
    const matched = terms.find((item) => item && item.term === term);
    const config = normalizeTermConfigRecord(matched, "local-term-registry");
    if (config && config.termStartDate) return config;
  }
  return null;
}

function getBundledTermRegistryConfig(term) {
  try {
    const config = termRegistryService.getTerm(term);
    return normalizeTermConfigRecord(config, "term-registry");
  } catch (error) {
    return null;
  }
}

async function getRemoteRegistryTermConfig(term) {
  try {
    const response = await axios.get(`${FOSU_API_BASE}/api/fosu/terms`, {
      timeout: 8000,
      validateStatus: (status) => status >= 200 && status < 500,
    });
    const data = response.data || {};
    const terms = data.terms || data.availableTerms || data.data && data.data.availableTerms || [];
    const matched = Array.isArray(terms) ? terms.find((item) => item && item.term === term) : null;
    return normalizeTermConfigRecord(matched, "remote-term-registry");
  } catch (error) {
    return null;
  }
}

async function resolveTermConfig(activeSemester, cliParams = {}) {
  const explicit = cliParams["term-start-date"] || cliParams.termStartDate || cliParams.start || cliParams.startDate || "";
  const explicitTotalWeeksRaw = cliParams["total-weeks"] || cliParams.totalWeeks || process.env.TOTAL_WEEKS || "";
  const explicitTotalWeeks = explicitTotalWeeksRaw === "" ? null : Number(explicitTotalWeeksRaw);
  const explicitWeekStart = cliParams.weekStart || cliParams["week-start"] || "";
  const overrideTermConfig = Boolean(cliParams["override-term-config"] || cliParams.overrideTermConfig);
  const cliConfig = normalizeTermConfigRecord({
    term: activeSemester,
    semesterText: cliParams.semesterText,
    termStartDate: explicit,
    totalWeeks: explicitTotalWeeks,
    weekStart: explicitWeekStart || "monday",
  }, "cli");

  if (cliConfig && explicit && String(cliParams.syncProfile || cliParams.profile || "") === "new-term") {
    return cliConfig;
  }

  const registryConfigs = [];
  const bundledRegistryConfig = getBundledTermRegistryConfig(activeSemester);
  if (bundledRegistryConfig && bundledRegistryConfig.termStartDate) registryConfigs.push(bundledRegistryConfig);
  const relayTermConfig = normalizeTermConfigRecord(global.RELAY_TERM_CONFIG, "relay-term-config") || getRelayTermConfigFromEnv();
  if (relayTermConfig && relayTermConfig.term === activeSemester && relayTermConfig.termStartDate) {
    registryConfigs.push(relayTermConfig);
  }
  const localRegistryConfig = getLocalRegistryTermConfig(activeSemester);
  if (localRegistryConfig && localRegistryConfig.termStartDate) {
    registryConfigs.push(localRegistryConfig);
  }
  const remoteRegistryConfig = await getRemoteRegistryTermConfig(activeSemester);
  if (remoteRegistryConfig && remoteRegistryConfig.termStartDate) {
    registryConfigs.push(remoteRegistryConfig);
  }

  const registryConfig = registryConfigs.find((item) => item && item.term === activeSemester && item.termStartDate);
  if (registryConfig) {
    if (cliConfig && explicit && overrideTermConfig) {
      if (!cliConfig.totalWeeks && registryConfig.totalWeeks) cliConfig.totalWeeks = registryConfig.totalWeeks;
      cliConfig.overrideTermConfig = true;
      cliConfig.overriddenRegistryConfig = registryConfig;
      cliConfig.source = "cli-override-term-config";
      return cliConfig;
    }
    if (cliConfig && explicit && (
      cliConfig.termStartDate !== registryConfig.termStartDate ||
      (cliConfig.totalWeeks && cliConfig.totalWeeks !== registryConfig.totalWeeks) ||
      (explicitWeekStart && cliConfig.weekStart !== registryConfig.weekStart)
    )) {
      console.warn(`[term-config] 警告：CLI 学期配置与 Term Registry 不一致，默认采用 Registry。若确认覆盖，请显式传入 --override-term-config。CLI start=${cliConfig.termStartDate || "-"}, weeks=${cliConfig.totalWeeks || "-"}；Registry start=${registryConfig.termStartDate}, weeks=${registryConfig.totalWeeks || "-"}`);
    }
    return registryConfig;
  }

  if (cliConfig && explicit) {
    return cliConfig;
  }
  const fallback = getTermStartDate(activeSemester);
  if (fallback) {
    return normalizeTermConfigRecord({
      term: activeSemester,
      termStartDate: fallback,
      totalWeeks: explicitTotalWeeks,
      weekStart: explicitWeekStart || "monday",
    }, "env");
  }
  return normalizeTermConfigRecord({
    term: activeSemester,
    termStartDate: "",
    totalWeeks: explicitTotalWeeks,
    weekStart: explicitWeekStart || "monday",
  }, "");
}

async function assertTermConfigBeforeCrawl(activeSemester, cliParams = {}) {
  if (!validateTermId(activeSemester)) {
    throw new Error(`Invalid term id: ${activeSemester}. Expected YYYY-YYYY-1 or YYYY-YYYY-2.`);
  }
  const config = await resolveTermConfig(activeSemester, cliParams);
  if (!config.termStartDate) {
    throw new Error([
      `Missing termStartDate for ${activeSemester}.`,
      "Pass it explicitly before crawling, for example:",
      `npm run sync:local-campus -- --term=${activeSemester} --term-start-date=2026-09-07 --total-weeks=20 --fresh`,
    ].join("\n"));
  }
  if (!Number.isInteger(config.totalWeeks) || config.totalWeeks < 1 || config.totalWeeks > 30) {
    throw new Error(`Missing totalWeeks for ${activeSemester}. Use Term Registry or pass --total-weeks=N for new terms; silent default 20 is disabled.`);
  }
  return Object.assign({}, config, {
    semesterText: cliParams.semesterText || config.semesterText || generateSemesterText(activeSemester),
  });
}

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn(`⚠️ 读取 JSON 文件失败，将按空数组处理: ${filePath} (${error.message})`);
    return [];
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function getMajorIdentityKey(major, semester) {
  return [
    semester,
    major.collegeCode || "",
    major.grade || "",
    major.code || major.majorCode || "",
  ].join("::");
}

function getLegacyMajorProgressKey(major) {
  return `${major.grade}_${major.code || major.majorCode || ""}`;
}

function hasCompletedMajor(progress, major, semester) {
  const completed = progress && Array.isArray(progress.completed) ? progress.completed : [];
  return completed.includes(getMajorIdentityKey(major, semester)) || completed.includes(getLegacyMajorProgressKey(major));
}

function markCompletedMajor(progress, major, semester) {
  const key = getMajorIdentityKey(major, semester);
  if (!Array.isArray(progress.completed)) {
    progress.completed = [];
  }
  if (!progress.completed.includes(key)) {
    progress.completed.push(key);
  }
}

function upsertNoScheduleMajor(records, item) {
  const key = getMajorIdentityKey({
    collegeCode: item.collegeCode,
    grade: item.grade,
    code: item.majorCode,
  }, item.semester);
  const index = records.findIndex((record) => getMajorIdentityKey({
    collegeCode: record.collegeCode,
    grade: record.grade,
    code: record.majorCode,
  }, record.semester) === key);
  if (index >= 0) {
    records[index] = item;
  } else {
    records.push(item);
  }
  return records;
}

function removeNoScheduleMajor(records, major, semester) {
  const key = getMajorIdentityKey(major, semester);
  return records.filter((record) => getMajorIdentityKey({
    collegeCode: record.collegeCode,
    grade: record.grade,
    code: record.majorCode,
  }, record.semester) !== key);
}

function getNoScheduleCacheTtlMs() {
  const rawHours = Number(process.env.SYNC_NO_SCHEDULE_CACHE_TTL_HOURS || 168);
  if (!Number.isFinite(rawHours) || rawHours <= 0) return 0;
  return rawHours * 3600000;
}

function getNewestGrade(majors) {
  const grades = (majors || [])
    .map((major) => Number(String(major && major.grade || "").replace(/\D/g, "")))
    .filter((grade) => Number.isFinite(grade) && grade > 0);
  if (!grades.length) return "";
  return String(Math.max(...grades));
}

function canReuseNoScheduleCache(record, major, newestGrade) {
  if (!record) return false;
  if (newestGrade && String(major && major.grade || "") === String(newestGrade)) {
    return false;
  }
  const ttlMs = getNoScheduleCacheTtlMs();
  if (!ttlMs) return false;
  const checkedAt = Date.parse(record.checkedAt || record.updatedAt || "");
  if (!checkedAt) return false;
  return Date.now() - checkedAt <= ttlMs;
}

function upsertClassNameCandidateRecord(records, item) {
  const key = getMajorIdentityKey({
    collegeCode: item.collegeCode,
    grade: item.grade,
    code: item.majorCode,
  }, item.semester);
  const index = records.findIndex((record) => getMajorIdentityKey({
    collegeCode: record.collegeCode,
    grade: record.grade,
    code: record.majorCode,
  }, record.semester) === key);
  if (index >= 0) {
    records[index] = item;
  } else {
    records.push(item);
  }
  return records;
}

async function waitBetweenClassSyncRequests(isFiltered) {
  const configuredDelay = Number(process.env.SYNC_CLASS_REQUEST_DELAY_MS || 0);
  if (Number.isFinite(configuredDelay) && configuredDelay >= 0 && process.env.SYNC_CLASS_REQUEST_DELAY_MS !== undefined) {
    console.log(`      ⏳ 按 CLI/env 配置等待 ${configuredDelay}ms...`);
    await sleep(configuredDelay);
    return;
  }
  const delayMin = isFiltered ? 800 : 1500;
  const delayMax = isFiltered ? 1500 : 3000;
  const delay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
  console.log(`      ⏳ 随机等待 ${delay}ms...`);
  await sleep(delay);
}

function getClassCrawlConcurrency() {
  const raw = process.env.SYNC_CLASS_MAX_CONCURRENCY || process.env.SYNC_CLASS_CONCURRENCY || "1";
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    console.warn(`⚠️ SYNC_CLASS_MAX_CONCURRENCY=${raw} 无效，已回退为 1。`);
    return 1;
  }
  if (parsed > 8) {
    console.warn(`⚠️ SYNC_CLASS_MAX_CONCURRENCY=${parsed} 过高，已限制为 8 以保护教务系统。`);
    return 8;
  }
  return parsed;
}

function formatElapsedMs(ms) {
  const value = Number(ms || 0);
  if (value < 1000) return `${value}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m${String(rest).padStart(2, "0")}s`;
}

/**
 * 兼容 HTTP/HTTPS 的 Playwright 导航辅助函数
 */
async function gotoPage(page, relativePath, options = { waitUntil: "networkidle" }) {
  // 确保相对路径以 / 开头
  const cleanPath = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  const httpUrl = `${FOSU_BASE_URL.replace(/^https:/i, "http:")}${cleanPath}`;
  const httpsUrl = `${FOSU_BASE_URL}${cleanPath}`;
  
  try {
    await page.goto(httpUrl, options);
  } catch (err) {
    try {
      await page.goto(httpsUrl, options);
    } catch (httpsErr) {
      throw new Error(`导航到 ${cleanPath} 彻底失败 (HTTP: ${err.message}, HTTPS: ${httpsErr.message})`);
    }
  }
}

/**
 * 将 manual-cookie 字符串解析为 Playwright 的 Cookie 对象数组
 */
function parseCookieString(cookieStr, domain) {
  if (!cookieStr) return [];
  const domainHost = new URL(domain).hostname;
  return cookieStr
    .split(";")
    .map((pair) => {
      const parts = pair.split("=");
      if (parts.length >= 2) {
        return {
          name: parts[0].trim(),
          value: parts.slice(1).join("=").trim(),
          domain: domainHost,
          path: "/",
        };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * 向 VPS 发送 POST 请求（管理员 Token 认证）
 */
function getRetryDelay(attempt) {
  const base = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

async function uploadToVps(endpoint, data, options = {}) {
  if (getEnvFlag("SYNC_LOCAL_STAGING_ONLY", false)) {
    console.log(`ℹ️ 本机 Staging 模式：跳过 VPS 写入 ${endpoint}`);
    return { success: true, skipped: true, endpoint };
  }

  if (!ADMIN_API_TOKEN) {
    console.error("❌ 本地未配置 ADMIN_API_TOKEN！无法向 VPS 写入数据。");
    throw new Error("Missing ADMIN_API_TOKEN");
  }

  const url = `${FOSU_API_BASE}${endpoint}`;
  console.log(`📤 正在上传数据到 VPS: ${url} ...`);

  const maxRetries = options.maxRetries === undefined ? 4 : options.maxRetries;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(url, data, {
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": ADMIN_API_TOKEN,
        },
        proxy: false,
        timeout: parseInt(process.env.SYNC_UPLOAD_TIMEOUT_MS || "120000", 10),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      console.log(`✅ VPS 响应: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error) {
      const retryable = shouldRetryError(error);
      console.error(`❌ 上传失败 (${attempt}/${maxRetries}): ${error.message}`);
      if (error.response) {
        console.error(`   VPS 错误状态码: ${error.response.status}`);
        console.error(`   VPS 错误详情: ${JSON.stringify(error.response.data)}`);
      }
      if (!retryable || attempt >= maxRetries) {
        throw error;
      }
      const delay = getRetryDelay(attempt);
      console.warn(`   ⏳ 网络抖动可重试，${delay}ms 后继续...`);
      await sleep(delay);
    }
  }
}

async function fetchVpsSyncStatus() {
  const url = `${FOSU_API_BASE}/api/admin/sync/status`;
  console.log(`🔎 正在读取 VPS 同步状态: ${url} ...`);

  const response = await axios.get(url, {
    headers: ADMIN_API_TOKEN ? { "x-admin-token": ADMIN_API_TOKEN } : {},
    proxy: false, // 显式禁用代理
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  return response.data;
}

function generateSnapshotVersion() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}-${mi}-${ss}`;
}

function normalizeScheduleEntryCourses(entry, fallbackContext = {}) {
  const context = Object.assign({}, fallbackContext, {
    semester: entry.semester || fallbackContext.semester,
    className: entry.className || fallbackContext.className,
    sourceType: entry.sourceType || fallbackContext.sourceType || "class",
    audienceType: entry.audienceType || fallbackContext.audienceType || "student",
  });
  const courses = normalizer.normalizeCourseList(entry.courses || [], context);
  return Object.assign({}, entry, { courses });
}

function parsePositiveLimit(value) {
  const number = parseInt(value || "", 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function isUsableResourceName(value) {
  const text = String(value || "").trim();
  return Boolean(text) &&
    !["待补充", "暂无", "无", "未知", "多个地点", "多个教师", "见通知", "多个教师/见通知"].includes(text);
}

function limitMapEntries(map, limit) {
  const entries = Array.from(map.entries()).sort(([left], [right]) => left.localeCompare(right, "zh-CN", { numeric: true }));
  return limit > 0 ? entries.slice(0, limit) : entries;
}

function pushGroupedCourse(map, key, course) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(course);
}

function buildDirectTeacherQualityReport(collected, targets, resources) {
  const teacherSchedules = resources && resources.teacherSchedules || [];
  const invalidNames = teacherSchedules
    .map((item) => teacherNameOf(item))
    .filter((name) => isInvalidTeacherName(name));
  const invalidSamples = Array.from(new Set(invalidNames)).slice(0, 12);
  const usedCollegeDiscovery = collected && collected.source === "college-select";
  const invalid = usedCollegeDiscovery && invalidNames.length > 0;
  return {
    sourceMode: "network-direct",
    endpointFamily: "teacher-schedule",
    requested: targets.length,
    succeeded: teacherSchedules.length,
    failed: 0,
    targetDiscoveryMode: collected && collected.source || "unknown",
    discoveredTeacherTargets: collected && collected.source === "teacher-select" ? targets.length : null,
    requestGroupCount: targets.length,
    scheduleDocumentCount: teacherSchedules.length,
    invalidTeacherNameCount: invalidNames.length,
    invalidTeacherNameSamples: invalidSamples,
    coverageStatus: invalid ? "invalid" : "unknown",
    publishable: !invalid,
    pageHasTeacherSelect: Boolean(collected && collected.dom && collected.dom.teachers && collected.dom.teachers.length),
    pageTeacherOptionCount: collected && collected.dom && collected.dom.teachers ? collected.dom.teachers.length : 0,
    pageCollegeOptionCount: collected && collected.dom && collected.dom.colleges ? collected.dom.colleges.length : 0,
    note: invalid
      ? "100网教师页未发现教师下拉目标，当前按学院请求得到的教师名称疑似被班级名或课程名污染。"
      : "",
  };
}

function buildSnapshotResources(classSchedules, options = {}) {
  const includeTeachers = options.includeTeachers !== undefined
    ? options.includeTeachers
    : getEnvFlag("SYNC_RESOURCES_TEACHERS", false);
  const includeClassrooms = options.includeClassrooms !== undefined
    ? options.includeClassrooms
    : getEnvFlag("SYNC_RESOURCES_CLASSROOMS", false);
  const includeCourses = options.includeCourses !== undefined
    ? options.includeCourses
    : getEnvFlag("SYNC_RESOURCES_COURSES", false);
  const limit = parsePositiveLimit(process.env.SYNC_RESOURCE_LIMIT);
  const teacherMap = new Map();
  const classroomMap = new Map();
  const courseMap = new Map();

  (classSchedules || []).forEach((schedule) => {
    (schedule.courses || []).forEach((course) => {
      const baseCourse = Object.assign({}, course, {
        semester: course.semester || schedule.semester,
        classId: course.classId || schedule.classId || "",
        className: course.className || schedule.className || "",
        collegeCode: course.collegeCode || schedule.collegeCode || "",
        collegeName: course.collegeName || schedule.collegeName || "",
        grade: course.grade || schedule.grade || "",
        majorCode: course.majorCode || schedule.majorCode || "",
        majorName: course.majorName || schedule.majorName || "",
      });
      const courseName = baseCourse.canonicalCourseName || baseCourse.displayCourseName || baseCourse.courseName;
      const teacherName = baseCourse.canonicalTeacherName || baseCourse.displayTeacherName || baseCourse.teacherName;
      const classroom = baseCourse.canonicalClassroom || baseCourse.displayClassroom || baseCourse.classroom;

      if (includeTeachers && isUsableResourceName(teacherName) && !isInvalidTeacherName(teacherName) && !baseCourse.isTeacherFieldActuallyCourseName && !courseIdentity.isCourseLike(teacherName)) {
        pushGroupedCourse(teacherMap, teacherName, baseCourse);
      }
      if (includeClassrooms && isUsableResourceName(classroom)) {
        pushGroupedCourse(classroomMap, classroom, baseCourse);
      }
      if (includeCourses && isUsableResourceName(courseName) && !courseIdentity.isVenueLike(courseName)) {
        pushGroupedCourse(courseMap, courseName, baseCourse);
      }
    });
  });

  const teacherEntries = limitMapEntries(teacherMap, limit);
  const classroomEntries = limitMapEntries(classroomMap, limit);
  const courseEntries = limitMapEntries(courseMap, limit);

  return {
    teachers: teacherEntries.map(([teacherName, courses]) => ({ teacherName, courseCount: courses.length })),
    classrooms: classroomEntries.map(([roomName, courses]) => ({ roomName, courseCount: courses.length })),
    courses: courseEntries.map(([courseName, courses]) => ({ courseName, courseCount: courses.length })),
    teacherSchedules: teacherEntries.map(([teacherName, courses]) => ({ teacherName, courses })),
    classroomSchedules: classroomEntries.map(([roomName, courses]) => ({ roomName, courses })),
    courseSchedules: courseEntries.map(([courseName, courses]) => ({ courseName, courses })),
  };
}

function emptySnapshotResources() {
  return {
    teachers: [],
    classrooms: [],
    courses: [],
    teacherSchedules: [],
    classroomSchedules: [],
    courseSchedules: [],
  };
}

function normalizeSnapshotResources(resources) {
  const source = Object.assign(emptySnapshotResources(), resources || {});
  return {
    teachers: source.teachers || [],
    classrooms: source.classrooms || [],
    courses: source.courses || [],
    teacherSchedules: (source.teacherSchedules || []).map((item) => normalizeScheduleEntryCourses(item, {
      sourceType: "teacher",
      audienceType: "teacher",
    })),
    classroomSchedules: (source.classroomSchedules || []).map((item) => normalizeScheduleEntryCourses(item, {
      sourceType: "classroom",
      audienceType: "classroom",
    })),
    courseSchedules: (source.courseSchedules || []).map((item) => normalizeScheduleEntryCourses(item, {
      sourceType: "course",
      audienceType: "course",
    })),
  };
}

function collectSnapshotCourses(snapshot) {
  const result = [];
  (snapshot.classSchedules || []).forEach((schedule) => {
    (schedule.courses || []).forEach((course) => result.push({ scheduleType: "class", scheduleName: schedule.className, course }));
  });
  const resources = snapshot.resources || {};
  [
    ["teacher", resources.teacherSchedules || [], "teacherName"],
    ["classroom", resources.classroomSchedules || [], "roomName"],
    ["course", resources.courseSchedules || [], "courseName"],
  ].forEach(([scheduleType, schedules, nameKey]) => {
    schedules.forEach((schedule) => {
      (schedule.courses || []).forEach((course) => result.push({
        scheduleType,
        scheduleName: schedule[nameKey],
        course,
      }));
    });
  });
  return result;
}

function buildNormalizeReport(snapshot) {
  const entries = collectSnapshotCourses(snapshot);
  const reasons = {};
  const samples = [];
  let normalizedCourseCount = 0;
  let venueCourseNameCount = 0;
  let teacherFieldCourseNameCount = 0;
  let physicalEducationLikeCount = 0;

  entries.forEach((entry) => {
    const course = entry.course || {};
    const reason = course.normalizationReason || "normal";
    reasons[reason] = (reasons[reason] || 0) + 1;
    const changed =
      reason !== "normal" ||
      (course.rawCourseName && course.canonicalCourseName && course.rawCourseName !== course.canonicalCourseName) ||
      (course.rawClassroom && course.canonicalClassroom && course.rawClassroom !== course.canonicalClassroom) ||
      (course.rawTeacherName && course.canonicalTeacherName && course.rawTeacherName !== course.canonicalTeacherName);

    if (changed) {
      normalizedCourseCount++;
      if (samples.length < 30) {
        samples.push({
          scheduleType: entry.scheduleType,
          scheduleName: entry.scheduleName,
          rawCourseName: course.rawCourseName || course.courseName,
          rawTeacherName: course.rawTeacherName || course.teacherName,
          rawClassroom: course.rawClassroom || course.classroom,
          canonicalCourseName: course.canonicalCourseName,
          canonicalClassroom: course.canonicalClassroom,
          canonicalTeacherName: course.canonicalTeacherName,
          normalizationReason: reason,
        });
      }
    }
    if (course.isVenueCandidate) {
      venueCourseNameCount++;
    }
    if (course.isTeacherFieldActuallyCourseName) {
      teacherFieldCourseNameCount++;
    }
    if (course.isPhysicalEducationLike) {
      physicalEducationLikeCount++;
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    snapshotVersion: snapshot.version,
    semester: snapshot.semester,
    totalCourseCount: entries.length,
    normalizedCourseCount,
    venueCourseNameCount,
    teacherFieldCourseNameCount,
    physicalEducationLikeCount,
    reasons,
    samples,
  };
}

function writeSnapshotDebugFiles(debugDir, snapshot, compressedBuffer) {
  const snapshotJson = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(path.join(debugDir, "snapshot-latest.json"), snapshotJson, "utf-8");
  fs.writeFileSync(path.join(debugDir, "snapshot-latest.json.gz"), compressedBuffer);
  
  const cliParams = global.CLI_PARAMS || {};
  if (cliParams.output) {
    const outputPath = resolveOutputFilePath(cliParams.output);
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, snapshotJson, "utf-8");
    console.log(`💾 已按 output 参数导出数据至: ${outputPath}`);
  }

  const normalizeReport = buildNormalizeReport(snapshot);
  fs.writeFileSync(path.join(debugDir, "normalize-report-latest.json"), JSON.stringify(normalizeReport, null, 2), "utf-8");
  console.log(`💾 规范化报告已保存至 .debug/normalize-report-latest.json，修正课程 ${normalizeReport.normalizedCourseCount}/${normalizeReport.totalCourseCount} 条`);
  return normalizeReport;
}

function buildSnapshot(catalog, majors, allClassSchedules, resourceSchedules, options = {}) {
  const version = generateSnapshotVersion();
  const activeSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const activePlan = getActiveSyncPlan();
  const noScheduleCachePath = activePlan && activePlan.term
    ? syncCacheStore.negativePath(__dirname, activePlan.term, "class-schedule", activePlan.runId)
    : path.join(__dirname, ".debug", "no-schedule-majors.json");
  const noScheduleMajors = readJsonArray(noScheduleCachePath);
  const md5 = (str) => crypto.createHash("md5").update(str).digest("hex");
  const updatedSchedules = (allClassSchedules || []).map((item) => {
    const classId = item.classId || md5(`${item.semester}_${item.collegeCode}_${item.grade}_${item.majorCode}_${item.className}`);
    const withClassId = Object.assign({}, item, { classId });
    return normalizeScheduleEntryCourses(withClassId, {
      semester: item.semester || activeSemester,
      classId,
      className: item.className,
      sourceType: "class",
      audienceType: "student",
    });
  });

  // 读取本地已有的 resources 缓存用于合并
  const syncPlan = activePlan;
  const allowOldResourceFallback = Boolean(syncPlan && syncPlan.mergeOldData);
  let oldResources = { teachers: [], classrooms: [], courses: [], teacherSchedules: [], classroomSchedules: [], courseSchedules: [] };
  const oldResourcesPath = path.join(__dirname, ".debug", "resources-latest.json");
  if (allowOldResourceFallback && fs.existsSync(oldResourcesPath)) {
    try {
      oldResources = JSON.parse(fs.readFileSync(oldResourcesPath, "utf-8"));
    } catch (e) {}
  }

  const includeScopes = global.CLI_PARAMS?.includeScopes || ALL_SCOPES;
  const resourceIncludeOptions = options.resources || {};
  const derivedResources = buildSnapshotResources(updatedSchedules, resourceIncludeOptions);
  const generatedResources = resourceSchedules || derivedResources;
  
  const resources = normalizeSnapshotResources({
    teachers: resourceIncludeOptions.includeTeachers ? (generatedResources.teachers || []) : (oldResources.teachers || []),
    classrooms: resourceIncludeOptions.includeClassrooms ? (generatedResources.classrooms || []) : (oldResources.classrooms || []),
    courses: resourceIncludeOptions.includeCourses ? (generatedResources.courses || []) : (oldResources.courses || []),
    teacherSchedules: resourceIncludeOptions.includeTeacherSchedules ? (generatedResources.teacherSchedules || []) : (oldResources.teacherSchedules || []),
    classroomSchedules: resourceIncludeOptions.includeClassroomSchedules ? (generatedResources.classroomSchedules || []) : (oldResources.classroomSchedules || []),
    courseSchedules: resourceIncludeOptions.includeCourseSchedules ? (generatedResources.courseSchedules || []) : (oldResources.courseSchedules || []),
  });
  
  const collegeCount = (catalog.colleges || []).length;
  const majorCount = (majors || []).length;
  const classScheduleCount = updatedSchedules.length;
  const adminClassCount = updatedSchedules.filter(
    (item) => item.displayType === "class-schedule" && !item.isAggregated
  ).length;
  const majorAggregateCount = classScheduleCount - adminClassCount;
  const noScheduleMajorCount = noScheduleMajors.length;
  const teacherScheduleCount = resources.teacherSchedules.length;
  const classroomScheduleCount = resources.classroomSchedules.length;
  const courseScheduleCount = resources.courseSchedules.length;

  const timeTableSections = [
    { section: 1, start: "08:00", end: "08:40" },
    { section: 2, start: "08:45", end: "09:25" },
    { section: 3, start: "09:40", end: "10:20" },
    { section: 4, start: "10:25", end: "11:05" },
    { section: 5, start: "11:10", end: "11:50" },
    { section: 6, start: "13:30", end: "14:10" },
    { section: 7, start: "14:15", end: "14:55" },
    { section: 8, start: "15:10", end: "15:50" },
    { section: 9, start: "15:55", end: "16:35" },
    { section: 10, start: "16:40", end: "17:20" },
    { section: 11, start: "18:30", end: "19:10" },
    { section: 12, start: "19:15", end: "19:55" },
    { section: 13, start: "20:05", end: "20:45" },
    { section: 14, start: "20:50", end: "21:30" }
  ];

  const cliParams = global.CLI_PARAMS || {};
  const generatedCommand = global.GENERATED_COMMAND || `node sync.js local-campus ${process.argv.slice(2).join(" ")}`;
  const termConfig = global.TERM_CONFIG;
  if (!termConfig || !termConfig.termStartDate) {
    throw new Error("TERM_CONFIG_NOT_RESOLVED");
  }
  const termStartDate = termConfig.termStartDate;
  let teachingCalendar = null;
  try {
    const termSource = require("../../shared/termConfig").loadTermConfig(activeSemester);
    if (termSource.teachingCalendar) {
      teachingCalendar = Object.assign({}, termSource.teachingCalendar, {
        term: activeSemester,
        semesterText: termSource.semesterText,
        termStartDate: termSource.termStartDate,
        totalWeeks: termSource.totalWeeks,
        weekStart: termSource.weekStart,
        termConfig: {
          term: activeSemester,
          semesterText: termSource.semesterText,
          termStartDate: termSource.termStartDate,
          totalWeeks: termSource.totalWeeks,
          weekStart: termSource.weekStart,
        },
      });
    }
  } catch (error) {}
  const cacheUsage = global.CLASS_SCHEDULE_CACHE_USAGE || {};
  const crawlStats = global.SYNC_CRAWL_STATS || {};
  const scopeSources = Object.assign({}, global.SCOPE_SOURCE_REPORTS || {});
  const diagnostics = [];
  const coverageQuality = {};
  if (scopeSources.teacherSchedules && scopeSources.teacherSchedules.coverageStatus === "invalid") {
    const teacherQuality = {
      code: "ENTITY_NAME_CONTAMINATED",
      severity: "error",
      resource: "teacher",
      message: "教师名称疑似被班级名或课程名污染，当前 direct teacher crawler 暂不具备全校覆盖能力。",
      targetDiscoveryMode: scopeSources.teacherSchedules.targetDiscoveryMode || "unknown",
      discoveredTeacherTargets: scopeSources.teacherSchedules.discoveredTeacherTargets == null ? null : scopeSources.teacherSchedules.discoveredTeacherTargets,
      requestGroupCount: Number(scopeSources.teacherSchedules.requestGroupCount || 0),
      scheduleDocumentCount: Number(scopeSources.teacherSchedules.scheduleDocumentCount || teacherScheduleCount || 0),
      invalidTeacherNameCount: Number(scopeSources.teacherSchedules.invalidTeacherNameCount || 0),
      invalidTeacherNameSamples: scopeSources.teacherSchedules.invalidTeacherNameSamples || [],
      coverageStatus: "invalid",
      publishable: false,
    };
    diagnostics.push(teacherQuality);
    coverageQuality.teacher = {
      coverageStatus: "invalid",
      publishable: false,
      targetDiscoveryMode: teacherQuality.targetDiscoveryMode,
      discoveredTeacherTargets: null,
      requestGroupCount: teacherQuality.requestGroupCount,
      scheduleDocumentCount: teacherQuality.scheduleDocumentCount,
      invalidTeacherNameCount: teacherQuality.invalidTeacherNameCount,
      invalidTeacherNameSamples: teacherQuality.invalidTeacherNameSamples,
    };
  }
  const metaWarnings = [];
  if (cacheUsage.warning) {
    metaWarnings.push(cacheUsage.warning);
  }
  const counts = {
    classScheduleCount,
    adminClassCount,
    majorAggregateCount,
    teacherScheduleCount,
    classroomScheduleCount,
    courseScheduleCount,
    classroomCount: resources.classrooms.length,
    teacherCount: resources.teachers.length,
    courseCount: resources.courses.length,
    collegeCount,
    majorCount,
    gradeCount: (catalog.grades || []).length,
    noScheduleMajorCount,
  };
  const cohortAvailability = require("../../shared/cohortAvailability").assessCohortAvailability({
    term: semester,
    catalog: Object.assign({}, catalog, {
      adminClasses: updatedSchedules.map((item) => ({
        id: item.classId,
        classId: item.classId,
        name: item.className,
        className: item.className,
        grade: item.grade,
      })),
    }),
    classSchedules: updatedSchedules,
  });

  // 拼接 scopeSummary 文本
  const summaryParts = [];
  if (includeScopes.includes("classSchedules")) summaryParts.push("行政班课表");
  if (includeScopes.includes("teachers")) summaryParts.push("教师列表");
  if (includeScopes.includes("teacherSchedules")) summaryParts.push("教师课表");
  if (includeScopes.includes("classrooms")) summaryParts.push("教室列表");
  if (includeScopes.includes("classroomSchedules")) summaryParts.push("教室课表");
  if (includeScopes.includes("courses")) summaryParts.push("课程列表");
  if (includeScopes.includes("courseSchedules")) summaryParts.push("课程课表");
  const scopeSummary = "更新: " + summaryParts.join(", ") + "; 保留其他历史数据";

  return {
    schemaVersion: "1.0",
    releaseVersion: cliParams.version || version,
    term: activeSemester,
    termConfig: Object.assign({}, termConfig, {
      releaseVersion: cliParams.version || version,
    }),
    termStartDate,
    teachingCalendar,
    generatedAt: new Date().toISOString(),
    version,
    semester: activeSemester,
    updatedAt: new Date().toISOString(),
    releaseNote: cliParams.note || "全校课表数据已更新",
    source: "local-sync-client",
    disclaimer: "本工具为个人开发，非学校官方服务。课程数据由开发者整理维护及用户反馈修正，仅供参考，具体安排请以任课教师通知及正式通知为准。",
    
    // 注入 meta
    meta: {
      term: activeSemester,
      termConfig,
      startDate: termStartDate,
      includeScopes,
      classScope: cliParams.classScope || cliParams["class-scope"] || process.env.SYNC_CLASS_SCOPE || "",
      grades: cliParams.grades || process.env.SYNC_CLASS_GRADES || "",
      forceRefresh: Boolean(cliParams.forceRefresh || cliParams["force-refresh"]),
      ignoreProgress: Boolean(cliParams.ignoreProgress || cliParams["ignore-progress"]),
      ignoreNoScheduleCache: Boolean(cliParams.ignoreNoScheduleCache || cliParams["ignore-no-schedule-cache"]),
      crawlMode: crawlStats.crawlMode || cliParams.crawlMode || "incremental",
      usedProgressCache: Boolean(crawlStats.usedProgressCache),
      usedNoScheduleCache: Boolean(crawlStats.usedNoScheduleCache),
      usedClassScheduleCache: Boolean(crawlStats.usedClassScheduleCache || cacheUsage.usedClassScheduleCache || cacheUsage.used),
      resumedFromRunProgress: Boolean(crawlStats.resumedFromRunProgress),
      progressCacheRunId: crawlStats.progressCacheRunId || "",
      actualNetworkRequestCount: Number(crawlStats.actualNetworkRequestCount || 0),
      skippedByProgressCount: Number(crawlStats.skippedByProgressCount || 0),
      skippedByNoScheduleCount: Number(crawlStats.skippedByNoScheduleCount || 0),
      partial: Number(crawlStats.failedTargetCount || 0) > 0,
      failedTargetCount: Number(crawlStats.failedTargetCount || 0),
      failedTargets: crawlStats.failedTargets || [],
      freshRunId: crawlStats.freshRunId || "",
      resourceSource: cliParams.resourceSource || cliParams["resource-source"] || "derived",
      syncPlan: syncPlan ? printablePlan(syncPlan) : null,
      scopeSources,
      diagnostics,
      coverage: coverageQuality,
      scopeSummary,
      generatedCommand,
      generatedAt: new Date().toISOString(),
      counts,
      cacheUsage: {
        usedClassScheduleCache: Boolean(cacheUsage.usedClassScheduleCache || cacheUsage.used),
        cacheSource: cacheUsage.cacheSource || cacheUsage.source || null,
        cacheWarning: cacheUsage.cacheWarning || cacheUsage.warning || null,
      },
      stageTimings: global.SYNC_STAGE_TIMINGS || {},
      warnings: metaWarnings,
      cohortAvailability: {
        releasedGrades: cohortAvailability.releasedGrades,
        pendingGrades: cohortAvailability.pendingGrades,
        byGrade: cohortAvailability.byGrade,
      },
      cacheSource: cacheUsage.cacheSource || cacheUsage.source || null,
      cacheWarning: cacheUsage.cacheWarning || cacheUsage.warning || null,
    },

    catalog: {
      semesters: catalog.semesters || [],
      colleges: catalog.colleges || [],
      grades: catalog.grades || [],
      weeks: catalog.weeks || [],
      sections: catalog.sections || []
    },
    majors: majors || [],
    classSchedules: updatedSchedules,
    resources,
    scopeSources,
    diagnostics,
    timeTable: {
      sections: timeTableSections
    },
    coverage: Object.assign({
      collegeCount,
      majorCount,
      classScheduleCount,
      adminClassCount,
      majorAggregateCount,
      noScheduleMajorCount,
      teacherScheduleCount,
      classroomScheduleCount,
      courseScheduleCount,
    }, coverageQuality),
    cohortAvailability: {
      releasedGrades: cohortAvailability.releasedGrades,
      pendingGrades: cohortAvailability.pendingGrades,
      byGrade: cohortAvailability.byGrade,
    },
  };
}


async function uploadSnapshot(buffer) {
  const url = `${FOSU_API_BASE}/api/admin/release/upload`;
  console.log(`📤 正在上传快照 (体积: ${(buffer.length / 1024 / 1024).toFixed(2)} MB) to: ${url}...`);
  const maxRetries = 4;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(url, buffer, {
        headers: {
          "Content-Type": "application/octet-stream",
          "x-admin-token": ADMIN_API_TOKEN
        },
        proxy: false,
        timeout: parseInt(process.env.SYNC_UPLOAD_TIMEOUT_MS || "120000", 10),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      console.log(`✅ 快照上传 VPS 成功: ${JSON.stringify(response.data)}`);
      if (response.data && response.data.job && response.data.job.id) {
        return await waitAdminJob(response.data.job.id, "release upload");
      }
      return response.data;
    } catch (error) {
      console.error(`❌ 快照上传 VPS 失败 (${attempt}/${maxRetries}): ${error.message}`);
      if (error.response) {
        console.error(`   VPS 错误状态码: ${error.response.status}`);
        console.error(`   VPS 错误详情: ${JSON.stringify(error.response.data)}`);
      }
      if (!shouldRetryError(error) || attempt >= maxRetries) {
        throw error;
      }
      const delay = getRetryDelay(attempt);
      console.warn(`   ⏳ 快照上传将在 ${delay}ms 后重试...`);
      await sleep(delay);
    }
  }
}

async function activateSnapshot(version) {
  const url = `${FOSU_API_BASE}/api/admin/release/activate`;
  console.log(`🔔 正在请求激活快照 (版本: ${version}) to: ${url}...`);
  try {
    const response = await axios.post(url, { version }, {
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": ADMIN_API_TOKEN
      },
      proxy: false, // 显式禁用代理
    });
    if (response.data && response.data.job && response.data.job.id) {
      return await waitAdminJob(response.data.job.id, "release activation");
    }
    return response.data;
  } catch (error) {
    console.error(`❌ 快照激活失败: ${error.message}`);
    if (error.response) {
      console.error(`   VPS 错误状态码: ${error.response.status}`);
      console.error(`   VPS 错误详情: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

async function waitAdminJob(jobId, label) {
  const url = `${FOSU_API_BASE}/api/admin/jobs/${encodeURIComponent(jobId)}`;
  console.log(`⏳ ${label || "admin job"} 已进入后台任务: ${jobId}`);
  for (let attempt = 1; attempt <= 240; attempt += 1) {
    const response = await axios.get(url, {
      headers: {
        "x-admin-token": ADMIN_API_TOKEN
      },
      proxy: false,
    });
    const job = response.data && response.data.job;
    if (job && (job.status === "success" || job.status === "failed")) {
      if (job.status === "failed") {
        throw new Error(`${label || "admin job"} failed: ${job.error && job.error.message || "unknown error"}`);
      }
      return Object.assign({ success: true, job }, job.result || {});
    }
    await sleep(1000);
  }
  throw new Error(`${label || "admin job"} timed out: ${jobId}`);
}

async function verifyEndpoints() {
  const bootstrapUrl = `${FOSU_API_BASE}/api/fosu/bootstrap`;
  const statusUrl = `${FOSU_API_BASE}/api/admin/sync/status`;
  const releaseStatusUrl = `${FOSU_API_BASE}/api/admin/release/status`;
  
  console.log(`🔎 正在验证 bootstrap 接口: ${bootstrapUrl}...`);
  const bRes = await axios.get(bootstrapUrl, { proxy: false });
  console.log(`   成功: ${bRes.data.success}, 数据源: ${bRes.data.dataSource}, 班级数: ${bRes.data.counts?.classScheduleCount}`);
  
  console.log(`🔎 正在验证管理员状态接口: ${statusUrl}...`);
  const sRes = await axios.get(statusUrl, {
    headers: ADMIN_API_TOKEN ? { "x-admin-token": ADMIN_API_TOKEN } : {},
    proxy: false
  });
  console.log(`   快照版本: ${sRes.data.snapshotVersion}, 快照更新时间: ${sRes.data.snapshotUpdatedAt}`);

  console.log(`🔎 正在验证 release 状态接口: ${releaseStatusUrl}...`);
  const rRes = await axios.get(releaseStatusUrl, {
    headers: ADMIN_API_TOKEN ? { "x-admin-token": ADMIN_API_TOKEN } : {},
    proxy: false
  });
  console.log(`   Active release: ${rRes.data.activeReleaseVersion}, updatedAt: ${rRes.data.activeReleaseUpdatedAt}`);
  
  return {
    bootstrap: bRes.data,
    status: sRes.data,
    releaseStatus: rRes.data
  };
}

function printReleaseSummary(snapshot, uploadResponse, activateResponse, verifyResponse) {
  const coverage = snapshot.coverage || {};
  const dryRun = Boolean(uploadResponse && uploadResponse.dryRun);
  console.log("\n================ [sync:release 发布摘要] ================");
  console.log(`- semester: ${snapshot.semester}`);
  console.log(`- collegesCount: ${coverage.collegeCount || coverage.collegesCount || 0}`);
  console.log(`- majorsCount: ${coverage.majorCount || coverage.majorsCount || 0}`);
  console.log(`- classScheduleCount: ${coverage.classScheduleCount || 0}`);
  console.log(`- teacherScheduleCount: ${coverage.teacherScheduleCount || 0}`);
  console.log(`- classroomScheduleCount: ${coverage.classroomScheduleCount || 0}`);
  console.log(`- courseScheduleCount: ${coverage.courseScheduleCount || 0}`);
  console.log(`- snapshotVersion: ${snapshot.version}`);
  console.log(`- updatedAt: ${snapshot.updatedAt}`);
  console.log(`- upload batches: ${dryRun ? 0 : (uploadResponse ? 1 : 0)}`);
  console.log(`- failed batches: 0`);
  console.log(`- activeReleaseVersion: ${dryRun ? "(dry-run, not activated)" : (activateResponse?.version || verifyResponse?.releaseStatus?.activeReleaseVersion || "")}`);
  console.log("=======================================================\n");
}

function validateLocalReleaseSnapshot(snapshot) {
  const validation = releaseService.validateReleaseSnapshot(snapshot);
  if (!validation.valid) {
    console.error("❌ 本地 release 校验失败：");
    validation.errors.slice(0, 20).forEach((error) => console.error(`   - ${error}`));
    if (validation.errors.length > 20) {
      console.error(`   ... 还有 ${validation.errors.length - 20} 个错误`);
    }
    throw new Error("Release validation failed");
  }
  console.log(`✅ 本地 release 校验通过：classScheduleCount=${validation.counts.classScheduleCount}`);
  return validation;
}

function getUploadChunkSize() {
  const parsed = parseInt(process.env.SYNC_UPLOAD_CHUNK_SIZE || "50", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  console.warn(`⚠️ SYNC_UPLOAD_CHUNK_SIZE=${process.env.SYNC_UPLOAD_CHUNK_SIZE} 无效，已回退为 50。`);
  return 50;
}

/**
 * 格式化当前时间为 YYYYMMDD-HHmmss 格式
 * @returns {string} 格式化后的时间戳
 */
function getFormattedTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = now.getFullYear();
  const MM = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `${yyyy}${MM}${dd}-${hh}${mm}${ss}`;
}

/**
 * 判断 Axios 错误是否可以重试
 * @param {Error} error Axios 错误对象
 * @returns {boolean} 是否可以重试
 */
function shouldRetryError(error) {
  if (!error) return false;

  // 校验 HTTP 状态码
  if (error.response) {
    const status = error.response.status;
    // 502, 503, 504 属于可重试的服务器错误
    if ([502, 503, 504].includes(status)) {
      return true;
    }
    // 400, 401, 403 属于客户端错误，不重试
    if ([400, 401, 403].includes(status)) {
      return false;
    }
  }

  const errCode = error.code || "";
  const errMessage = error.message || "";

  // 常见网络和超时错误代码
  const retryCodes = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"];
  if (retryCodes.includes(errCode)) {
    return true;
  }

  // 常见网络挂起及 SSL/TLS 握手错误信息
  const retryMessages = [
    "socket hang up",
    "timeout",
    "Client network socket disconnected before secure TLS connection was established",
    "disconnected before secure TLS connection"
  ];

  if (retryMessages.some((msg) => errMessage.includes(msg))) {
    return true;
  }

  return false;
}

/**
 * 带重试机制的单块上传函数
 * @param {string} endpoint 接口地址
 * @param {Array} chunk 课表数据分块
 * @param {number} chunkNumber 当前分块序号
 * @param {number} totalChunks 分块总数
 */
async function uploadWithRetry(endpoint, chunk, chunkNumber, totalChunks) {
  const maxRetries = 5;
  const retryDelays = [2000, 5000, 10000, 20000, 30000];

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await uploadToVps(endpoint, chunk, { maxRetries: 1 });
      if (!Array.isArray(chunk) && Array.isArray(chunk && chunk.items)) {
        chunk.length = chunk.items.length;
      }
      console.log(`   ✅ [chunk ${chunkNumber}/${totalChunks}] 上传成功 (共 ${chunk.length} 条)`);
      return result;
    } catch (error) {
      const isRetryable = shouldRetryError(error);
      const attemptStr = `[chunk ${chunkNumber}/${totalChunks}] 第 ${attempt} 次尝试失败.`;

      if (attempt <= maxRetries && isRetryable) {
        const delay = retryDelays[attempt - 1] || 30000;
        console.warn(`   ⚠️ ${attemptStr} 错误可重试: ${error.message}。将在 ${delay / 1000}s 后进行第 ${attempt + 1} 次尝试...`);
        await sleep(delay);
      } else {
        console.error(`   ❌ ${attemptStr} 发生不可重试错误或重试次数超限。错误: ${error.message}`);
        throw error;
      }
    }
  }
}

/**
 * 读取断点续传进度
 * @param {string} sourceFilePath 数据源文件路径
 * @returns {Object} 进度对象
 */
function readUploadProgress(sourceFilePath) {
  const progressPath = path.join(__dirname, ".debug", "class-upload-progress.json");
  const forceRestart = getEnvFlag("SYNC_UPLOAD_FORCE_RESTART", false);

  if (forceRestart) {
    console.log("ℹ️ SYNC_UPLOAD_FORCE_RESTART=true，忽略已存在的上传进度，将从头开始重新上传。");
    return { uploadedChunkIndexes: [] };
  }

  if (fs.existsSync(progressPath)) {
    try {
      const progress = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
      // 只有源文件路径一致时进度才有效
      if (progress.sourceFile === sourceFilePath) {
        console.log(`ℹ️ 恢复上次上传进度，已成功上传批次: ${progress.uploadedChunkIndexes.join(", ")}`);
        return progress;
      } else {
        console.log(`ℹ️ 进度文件中的源文件不匹配 (${progress.sourceFile} vs ${sourceFilePath})，重新开始。`);
      }
    } catch (e) {
      console.warn("⚠️ 读取上传进度文件失败，将重新上传。");
    }
  }
  return { uploadedChunkIndexes: [] };
}

/**
 * 写入断点续传进度
 * @param {string} sourceFilePath 数据源文件路径
 * @param {string} semester 当前学期
 * @param {number} total 数据总条数
 * @param {number} chunkSize 分块大小
 * @param {Array<number>} uploadedChunkIndexes 已成功的分块序号列表
 */
function writeUploadProgress(sourceFilePath, semester, total, chunkSize, uploadedChunkIndexes) {
  const progressPath = path.join(__dirname, ".debug", "class-upload-progress.json");
  const progress = {
    sourceFile: sourceFilePath,
    semester,
    total,
    chunkSize,
    uploadedChunkIndexes,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), "utf-8");
}

/**
 * 将完整的班级课表数据存盘
 * @param {Array} allClassSchedules 整理好的班级课表
 * @param {string} semester 学期
 * @returns {Object} 包含所保存的文件路径
 */
function saveFullClassSchedules(allClassSchedules, semester) {
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const payload = {
    success: true,
    type: "class-schedules",
    semester: semester,
    generatedAt: new Date().toISOString(),
    itemCount: allClassSchedules.length,
    items: allClassSchedules
  };

  const latestPath = path.join(debugDir, "class-schedules-latest.json");
  const timestampPath = path.join(debugDir, `class-schedules-${getFormattedTimestamp()}.json`);

  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2), "utf-8");
  fs.writeFileSync(timestampPath, JSON.stringify(payload, null, 2), "utf-8");

  try {
    const plan = getActiveSyncPlan();
    const runId = plan && plan.runId || `class-${Date.now()}`;
    const cacheResult = syncCacheStore.writeScheduleLatest(__dirname, semester, "classSchedules", allClassSchedules, {
      runId,
      command: global.GENERATED_COMMAND || process.argv.join(" "),
      sourceMode: "network-direct",
      endpointFamily: "class-schedule",
      acquisition: "network",
      fresh: Boolean(plan ? plan.schedulePolicy === "network-only" : true),
      requested: global.SYNC_CRAWL_STATS && global.SYNC_CRAWL_STATS.requestedTargetCount || allClassSchedules.length,
      succeeded: global.SYNC_CRAWL_STATS && global.SYNC_CRAWL_STATS.succeededTargetCount || allClassSchedules.length,
      failed: global.SYNC_CRAWL_STATS && global.SYNC_CRAWL_STATS.failedTargetCount || 0,
    });
    recordScopeSource("classSchedules", {
      sourceMode: "network-direct",
      endpointFamily: "class-schedule",
      requested: cacheResult.metadata.requested,
      succeeded: cacheResult.metadata.succeeded,
      failed: cacheResult.metadata.failed,
      cacheHits: 0,
      startedAt: cacheResult.metadata.crawledAt,
      finishedAt: cacheResult.metadata.crawledAt,
      hash: cacheResult.metadata.hash,
    });
    console.log(`Cache saved: ${cacheResult.latestPath}`);
  } catch (error) {
    console.warn(`Failed to write term cache for classSchedules: ${error.message}`);
  }

  console.log(`💾 完整课表数据已保存至:\n  - ${latestPath}\n  - ${timestampPath}`);
  return { latestPath, timestampPath };
}

/**
 * 分块上传班级课表
 * @param {Array} classSchedules 课表数组
 * @param {string} debugDir 调试目录
 * @param {string} sourceFilePath 数据源路径，用于断点进度校验
 * @param {string} semester 关联学期
 * @returns {Object} VPS 同步状态
 */
async function uploadClassSchedulesInChunks(classSchedules, debugDir, sourceFilePath, semester) {
  const chunkSize = getUploadChunkSize();
  const totalChunks = Math.ceil(classSchedules.length / chunkSize);

  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  // 获取并恢复上次上传的断点进度
  const progress = readUploadProgress(sourceFilePath);
  const uploadedChunkIndexes = progress.uploadedChunkIndexes || [];

  console.log(`📦 开始分块上传班级课表: ${classSchedules.length} 条，每批 ${chunkSize} 条，共 ${totalChunks} 批。`);

  for (let index = 0; index < totalChunks; index++) {
    const chunkNumber = index + 1;
    if (uploadedChunkIndexes.includes(chunkNumber)) {
      console.log(`⏭️ [chunk ${chunkNumber}/${totalChunks}] 该分块已上传过，自动跳过。`);
      continue;
    }

    const start = index * chunkSize;
    const chunk = classSchedules.slice(start, start + chunkSize);

    try {
      await uploadWithRetry("/api/admin/sync/class-schedules?mode=merge", chunk, chunkNumber, totalChunks);

      // 更新并记录当前上传成功的进度
      uploadedChunkIndexes.push(chunkNumber);
      writeUploadProgress(sourceFilePath, semester, classSchedules.length, chunkSize, uploadedChunkIndexes);
    } catch (error) {
      // 写入失败的分块文件以供后续诊断
      const failedPath = path.join(debugDir, `failed-class-schedules-chunk-${chunkNumber}.json`);
      fs.writeFileSync(failedPath, JSON.stringify(chunk, null, 2), "utf-8");
      console.error(`❌ [chunk ${chunkNumber}/${totalChunks}] 历经多次重试上传失败，失败批次已保存: ${failedPath}`);
      console.error(`⚠️ 完整课表数据已保存至 .debug/class-schedules-latest.json，可稍后执行 upload-only 继续上传。`);
      throw error;
    }
  }

  // 上传全部成功，删除进度文件
  try {
    const progressPath = path.join(debugDir, "class-upload-progress.json");
    if (fs.existsSync(progressPath)) {
      fs.unlinkSync(progressPath);
      console.log("🎉 所有分块已上传成功，已清除断点续传进度。");
    }
  } catch (e) {}

  const status = await fetchVpsSyncStatus();
  console.log("\n🔍 === [VPS 同步状态验证] ===");
  console.log(`- classScheduleCount: ${status.classScheduleCount ?? "未获取"}`);
  console.log(`- classSchedulesUpdatedAt: ${status.classSchedulesUpdatedAt ?? "未获取"}`);
  console.log(`- storageMounted: ${status.storageMounted ?? "未获取"}`);
  console.log(`- storagePath: ${status.storagePath ?? "未获取"}`);
  console.log("==============================\n");

  return status;
}

/**
 * 从本地文件中尝试读取课表缓存
 * @returns {Object} 包含 items (数组) 和 filePath (绝对路径)
 */
function readClassSchedulesFromFile() {
  const debugDir = path.join(__dirname, ".debug");
  const candidates = [];

  // 1. 优先读取环境变量指定的路径
  if (process.env.SYNC_CLASS_UPLOAD_FILE) {
    candidates.push(path.resolve(process.env.SYNC_CLASS_UPLOAD_FILE));
  }

  // 2. 依次读取可能存在的文件
  const preferredTerm = String((global.CLI_PARAMS || {}).term || process.env.PREFERRED_SEMESTER || "").trim();
  if (preferredTerm) {
    candidates.push(syncCacheStore.scheduleLatestPath(__dirname, preferredTerm, "classSchedules"));
  }
  const activePlan = getActiveSyncPlan();
  const allowLegacyFallback = !activePlan || activePlan.mergeOldData || activePlan.profile === "upload-staging";
  if (allowLegacyFallback) {
    candidates.push(path.join(debugDir, "class-schedules-latest.json"));
    candidates.push(path.join(debugDir, "last-class-schedules.json"));
    candidates.push(path.join(debugDir, "last-class-schedules-upload.json"));
  }

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      try {
        console.log(`📖 正在从本地文件读取课表数据: ${filePath}`);
        const content = fs.readFileSync(filePath, "utf-8");
        const json = JSON.parse(content);

        let items = null;
        if (Array.isArray(json)) {
          items = json;
        } else if (json && Array.isArray(json.items)) {
          items = json.items;
        } else if (json && Array.isArray(json.data)) {
          items = json.data;
        } else if (json && Array.isArray(json.classSchedules)) {
          items = json.classSchedules;
        }

        if (items && items.length > 0) {
          console.log(`✅ 成功提取出 ${items.length} 条课表数据。`);
          return { items, filePath };
        }
      } catch (err) {
        console.warn(`⚠️ 读取文件失败，尝试下一个路径: ${filePath} (${err.message})`);
      }
    }
  }

  // 都没读到则抛出详细错误
  const errorMessage = [
    "❌ 未找到任何有效的完整课表缓存文件！",
    "已检查的路径列表如下："
  ];
  candidates.forEach((c) => errorMessage.push(`  - ${c}`));

  // 检查是否仅存在分块失败的文件
  if (fs.existsSync(debugDir)) {
    const files = fs.readdirSync(debugDir);
    const failedChunks = files.filter((f) => f.startsWith("failed-class-schedules-chunk-"));
    if (failedChunks.length > 0) {
      errorMessage.push(`当前目录下仅发现分块失败文件: ${failedChunks.join(", ")}，这些文件不是完整数据。`);
    }
  }

  throw new Error(errorMessage.join("\n"));
}

function tryReadClassSchedulesFromFile() {
  try {
    return readClassSchedulesFromFile();
  } catch (error) {
    return { items: [], filePath: null, error };
  }
}

function readClassScheduleCacheForSemester(semester) {
  const cache = tryReadClassSchedulesFromFile();
  const items = Array.isArray(cache.items) ? cache.items : [];
  if (items.length === 0) {
    return cache;
  }

  const matchedItems = items.filter((item) => {
    const itemSemester = item && (item.semester || item.term || item.xnxqh);
    return !itemSemester || !semester || itemSemester === semester;
  });

  if (matchedItems.length === 0) {
    return {
      items: [],
      filePath: cache.filePath,
      error: new Error(`历史 classSchedules 缓存存在，但没有匹配学期 ${semester} 的课表记录。`),
    };
  }

  if (matchedItems.length !== items.length) {
    console.log(`ℹ️ 历史课表缓存按学期 ${semester} 过滤: ${items.length} -> ${matchedItems.length} 条。`);
  }
  return { items: matchedItems, filePath: cache.filePath };
}

function getClassScheduleIdentity(item) {
  if (!item || typeof item !== "object") {
    return "";
  }
  return item.classId || [
    item.semester || item.term || "",
    item.collegeCode || "",
    item.grade || "",
    item.majorCode || item.code || "",
    item.className || item.name || "",
  ].join("::");
}

function mergeClassSchedules(existing, incoming) {
  const merged = new Map();
  (existing || []).forEach((item) => {
    const key = getClassScheduleIdentity(item);
    if (key) {
      merged.set(key, item);
    }
  });
  (incoming || []).forEach((item) => {
    const key = getClassScheduleIdentity(item);
    if (key) {
      merged.set(key, item);
    }
  });
  return Array.from(merged.values());
}

/**
 * 打印 PowerShell 的执行命令建议
 */
function printPowerShellCommands() {
  console.log("\n💡 Windows PowerShell 常用命令指南：");
  console.log("--------------------------------------------------");
  console.log("👉 只抓取不上传 (Crawl Only):");
  console.log('   $env:SYNC_CLASS_SCOPE="all"');
  console.log('   $env:SYNC_CLASS_GRADES="2025,2024,2023,2022"');
  console.log('   $env:SYNC_CLASS_MAX_CONCURRENCY="5"');
  console.log('   $env:SYNC_CLASS_REQUEST_DELAY_MS="900"');
  console.log('   $env:SYNC_CLASS_CRAWL_ONLY="true"');
  console.log("   npm run sync:class");
  console.log("");
  console.log("👉 只上传本地缓存 (Upload Only):");
  console.log('   $env:SYNC_CLASS_CRAWL_ONLY=""');
  console.log('   $env:SYNC_CLASS_UPLOAD_ONLY="true"');
  console.log('   $env:SYNC_UPLOAD_CHUNK_SIZE="50"');
  console.log("   npm run sync:upload-cache");
  console.log("");
  console.log("👉 强制重新上传本地缓存 (Force Restart Upload):");
  console.log('   $env:SYNC_UPLOAD_FORCE_RESTART="true"');
  console.log('   $env:SYNC_CLASS_UPLOAD_ONLY="true"');
  console.log('   $env:SYNC_UPLOAD_CHUNK_SIZE="50"');
  console.log("   npm run sync:class");
  console.log("--------------------------------------------------\n");
}

/**
 * 处理仅上传逻辑 (UPLOAD_ONLY 模式入口)
 */
async function handleUploadOnly() {
  const debugDir = path.join(__dirname, ".debug");
  try {
    const { items, filePath } = readClassSchedulesFromFile();
    const semester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
    console.log(`🚀 开始在 upload-only 模式下上传数据，数据源：${filePath}，共计 ${items.length} 条。`);

    await uploadClassSchedulesInChunks(items, debugDir, filePath, semester);
    console.log(`✅ 本地缓存数据上传同步成功！`);
  } catch (error) {
    console.error(`❌ 执行 upload-only 模式失败: \n${error.message}`);
    printPowerShellCommands();
    error.code = error.code || "UPLOAD_ONLY_FAILED";
    throw error;
  }
}

/**
 * 处理离线发布逻辑 (OFFLINE RELEASE 模式入口)
 */
async function handleOfflineRelease() {
  const zlib = require("zlib");
  console.log("🚀 开始在 offline-release 模式下发布快照...");
  
  const catalogPath = path.join(__dirname, "last-catalog.json");
  const majorsPath = path.join(__dirname, "last-majors.json");
  const schedPath = path.join(__dirname, ".debug", "class-schedules-latest.json");
  
  if (!fs.existsSync(catalogPath) || !fs.existsSync(majorsPath) || !fs.existsSync(schedPath)) {
    throw new Error("离线模式下，必须存在 last-catalog.json, last-majors.json 和 .debug/class-schedules-latest.json 缓存文件！");
  }
  
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const majors = JSON.parse(fs.readFileSync(majorsPath, "utf-8"));
  const schedJson = JSON.parse(fs.readFileSync(schedPath, "utf-8"));
  const allClassSchedules = Array.isArray(schedJson) ? schedJson : (schedJson.items || []);
  
  if (!allClassSchedules || allClassSchedules.length === 0) {
    throw new Error("本地课表缓存文件中的班级课表数量为 0");
  }

  console.log(`📖 成功从本地加载基础配置与课表缓存 (共计 ${allClassSchedules.length} 条课表)`);

  const includeReleaseResources = getEnvFlag("SYNC_RELEASE_INCLUDE_RESOURCES", true);
  const snapshot = buildSnapshot(catalog, majors, allClassSchedules, null, {
    resources: {
      includeTeachers: includeReleaseResources,
      includeClassrooms: includeReleaseResources,
      includeCourses: includeReleaseResources,
    },
  });
  const snapshotJson = JSON.stringify(snapshot, null, 2);
  const snapshotBuffer = Buffer.from(snapshotJson, "utf-8");
  const compressedBuffer = zlib.gzipSync(snapshotBuffer);

  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  const normalizeReport = writeSnapshotDebugFiles(debugDir, snapshot, compressedBuffer);
  console.log(`\n💾 本地快照已生成并压缩：.debug/snapshot-latest.json 和 .debug/snapshot-latest.json.gz (体积: ${(compressedBuffer.length / 1024).toFixed(2)} KB)`);
  validateLocalReleaseSnapshot(snapshot);

  if (getEnvFlag("SYNC_RELEASE_DRY_RUN", false)) {
    printReleaseSummary(snapshot, { dryRun: true }, { version: snapshot.version }, null);
    fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify({
      success: true,
      dryRun: true,
      version: snapshot.version,
      semester: snapshot.semester,
      updatedAt: snapshot.updatedAt,
      coverage: snapshot.coverage,
      normalizeReport,
      uploadSize: compressedBuffer.length,
    }, null, 2), "utf-8");
    console.log("ℹ️ SYNC_RELEASE_DRY_RUN=true，已完成本地 release 构建与校验，未上传或激活 VPS。");
    return;
  }

  const uploadRes = await uploadSnapshot(compressedBuffer);
  const activateRes = await activateSnapshot(snapshot.version);
  console.log(`✅ 快照激活成功! 响应: ${JSON.stringify(activateRes)}`);
  
  const verifyRes = await verifyEndpoints();
  printReleaseSummary(snapshot, uploadRes, activateRes, verifyRes);
  const report = {
    success: true,
    version: snapshot.version,
    semester: snapshot.semester,
    updatedAt: snapshot.updatedAt,
    coverage: snapshot.coverage,
    normalizeReport,
    uploadSize: compressedBuffer.length,
    serverStatus: verifyRes,
  };
  fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
  console.log(`💾 总结报告已保存至 .debug/sync-report-latest.json`);
  console.log("\n🎉 [Release] 离线暴力快照发布完成！");
}

async function handleLocalStagingUpload(params) {
  const fileArg = params.file || params.input || "";
  const { resolved: filePath, tried } = resolveInputFilePath(fileArg);

  if (!filePath || !fs.existsSync(filePath)) {
    const errorMsg = [
      "Staging JSON 文件不存在。",
      `Received file arg: ${fileArg}`,
      `Current working directory (cwd): ${process.cwd()}`,
      `Detected project root: ${resolveProjectPath()}`,
      "Tried candidate paths:",
      ...tried.map(p => `  - ${p}`)
    ].join("\n");
    throw new Error(errorMsg);
  }

  if (!ADMIN_API_TOKEN) {
    throw new Error("缺少 ADMIN_API_TOKEN，无法上传到后台 Staging 区");
  }

  console.log(`Staging JSON resolved path: ${filePath}`);
  console.log("sync:upload-staging/local-upload will not access 100.fosu.edu.cn. It only uploads the explicit file.");
  const sidecarPath = getSidecarMetaPath(filePath);
  const sidecar = fs.existsSync(sidecarPath) ? JSON.parse(fs.readFileSync(sidecarPath, "utf-8")) : null;
  if (sidecar) {
    console.log(JSON.stringify({
      term: sidecar.term || params.term || "",
      generatedAt: sidecar.generatedAt || sidecar.updatedAt || "",
      canonicalHash: sidecar.canonicalHash || "",
      itemCount: sidecar.counts && (sidecar.counts.classSchedules || sidecar.counts.classScheduleCount) || sidecar.itemCount || 0,
      crawlMode: sidecar.crawlMode || "",
      actualNetworkRequestCount: sidecar.actualNetworkRequestCount || 0,
      usedClassScheduleCache: Boolean(sidecar.usedClassScheduleCache),
    }, null, 2));
    const freshNetwork = isFreshNetworkSidecar(sidecar, {
      currentRunId: (getActiveSyncPlan() || {}).runId,
      snapshotMeta: params._snapshot && params._snapshot.meta || {},
    });
    if (!freshNetwork && !(params["allow-cache-source"] || params.allowCacheSource)) {
      throw new Error("UPLOAD_STAGING_REQUIRES_FRESH_NETWORK_META: pass --allow-cache-source only when intentionally uploading cache/imported data.");
    }
  } else if (!(params["allow-cache-source"] || params.allowCacheSource)) {
    throw new Error(`Missing staging sidecar metadata: ${sidecarPath}. Pass --allow-cache-source only for explicit cache/import workflows.`);
  }
  console.log("local-upload uses gzip + chunk upload and only writes pending-review Staging; publishing is a separate step unless the selected Sync Plan asks for it.");
  return stagingUploader.uploadStagingFile({
    filePath,
    server: params.server || FOSU_API_BASE,
    token: ADMIN_API_TOKEN,
    authMode: "admin",
    params,
    term: params.term || process.env.PREFERRED_SEMESTER || "",
    note: params.note || "",
    source: "local-upload-cli",
  });
}

function writeLocalStagingDebugFailure(params, catalog, majors, error) {
  const term = params.term || process.env.PREFERRED_SEMESTER || catalog?.semesters?.[0]?.value || "term";
  const debugPayload = {
    success: false,
    type: "local-campus-staging-debug",
    generatedAt: new Date().toISOString(),
    error: error && (error.stack || error.message) || String(error),
    meta: {
      term,
      startDate: params.start || process.env.SYNC_TERM_START_DATE || "",
      includeScopes: global.CLI_PARAMS?.includeScopes || ALL_SCOPES,
      classScope: params.classScope || params["class-scope"] || process.env.SYNC_CLASS_SCOPE || "",
      grades: params.grades || process.env.SYNC_CLASS_GRADES || "",
      forceRefresh: Boolean(params.forceRefresh || params["force-refresh"]),
      ignoreProgress: Boolean(params.ignoreProgress || params["ignore-progress"]),
      ignoreNoScheduleCache: Boolean(params.ignoreNoScheduleCache || params["ignore-no-schedule-cache"]),
      generatedCommand: global.GENERATED_COMMAND || process.argv.join(" "),
      counts: {
        collegeCount: catalog?.colleges?.length || 0,
        majorCount: majors?.length || 0,
        classScheduleCount: 0,
      },
      cacheUsage: global.CLASS_SCHEDULE_CACHE_USAGE || null,
      warnings: ["未生成正式 Staging JSON，请按 error 字段处理后重新运行。"],
    },
  };
  const output = resolveOutputFilePath(params.debugOutput || path.join("staging", `debug-${term}.json`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(debugPayload, null, 2), "utf-8");
  console.error(`🧪 已生成 debug JSON，不会作为正式 Staging 发布: ${output}`);
  return output;
}

function readTermCatalogCache(term) {
  const root = syncCacheStore.ensureTermCache(__dirname, term);
  const catalog = syncCacheStore.readJson(path.join(root, "catalog", "catalog.json"), null);
  const majors = syncCacheStore.readJson(path.join(root, "catalog", "majors.json"), null);
  const catalogMeta = syncCacheStore.readJson(path.join(root, "catalog", "metadata.json"), null);
  const majorsMeta = syncCacheStore.readJson(path.join(root, "catalog", "majors.metadata.json"), null);
  if (!catalog || !Array.isArray(catalog.colleges) || !Array.isArray(catalog.grades) || !Array.isArray(catalog.semesters)) {
    return null;
  }
  if (!Array.isArray(majors) || majors.length === 0) {
    return null;
  }
  if (catalogMeta && catalogMeta.term && catalogMeta.term !== term) return null;
  if (majorsMeta && majorsMeta.term && majorsMeta.term !== term) return null;
  return { catalog, majors, catalogMeta, majorsMeta };
}

async function resolveCatalogForPlan(page, params) {
  const plan = getActiveSyncPlan();
  const term = params.term || process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  if (plan && (plan.catalogPolicy === "reuse-validated" || plan.catalogPolicy === "cache-only")) {
    const cached = readTermCatalogCache(term);
    if (cached) {
      console.log(`[catalog] Reusing validated term cache: ${term}`);
      return cached;
    }
    if (plan.catalogPolicy === "cache-only") {
      throw new Error(`CATALOG_CACHE_MISSING: ${term}`);
    }
  }
  const catalog = await syncCatalog(page);
  const majors = await syncMajors(page, catalog);
  return { catalog, majors };
}

async function handleLocalCampusStaging(page, params) {
  console.log("\n================ [本机校园网采集 Staging] ================");
  process.env.SYNC_LOCAL_STAGING_ONLY = "true";
  process.env.SYNC_CLASS_CRAWL_ONLY = "true";

  const includeScopes = global.CLI_PARAMS?.includeScopes || ALL_SCOPES;

  const syncCollegeCodes = process.env.SYNC_CLASS_COLLEGE_CODES ? process.env.SYNC_CLASS_COLLEGE_CODES.split(",").map(c => c.trim()).filter(Boolean) : null;
  const syncGrades = process.env.SYNC_CLASS_GRADES ? process.env.SYNC_CLASS_GRADES.split(",").map(g => g.trim()).filter(Boolean) : null;
  const syncMajorCodes = process.env.SYNC_CLASS_MAJOR_CODES ? process.env.SYNC_CLASS_MAJOR_CODES.split(",").map(m => m.trim()).filter(Boolean) : null;
  const isFiltered = !!(syncCollegeCodes || syncGrades || syncMajorCodes);

  if (!isFiltered && includeScopes.includes("classSchedules")) {
    if (!process.env.SYNC_CLASS_SCOPE) {
      process.env.SYNC_CLASS_SCOPE = "all";
    }
  }

  const { catalog, majors } = await withSyncStage("directory-fetch", () => resolveCatalogForPlan(page, params));
  
  let allClassSchedules = [];
  if (includeScopes.includes("classSchedules")) {
    try {
      allClassSchedules = await withSyncStage("schedule-fetch", () => syncClassSchedules(page, catalog, majors));
    } catch (error) {
      const debugPath = writeLocalStagingDebugFailure(params, catalog, majors, error);
      throw new Error(`${error.message} 已生成 debug JSON: ${debugPath}`);
    }
    if (!allClassSchedules || allClassSchedules.length === 0) {
      const error = new Error("本机校园网采集结果为空，未生成正式 Staging JSON");
      const debugPath = writeLocalStagingDebugFailure(params, catalog, majors, error);
      throw new Error(`${error.message}。已生成 debug JSON: ${debugPath}`);
    }
  } else {
    console.log("ℹ️ 同步范围不包含行政班课表 (classSchedules)。从本地加载已有缓存以保护学生课表。");
    const cache = readClassScheduleCacheForSemester(process.env.PREFERRED_SEMESTER || params.term || catalog.semesters?.[0]?.value);
    allClassSchedules = cache.items || [];
    if (!allClassSchedules.length) {
      const error = cache.error || new Error("只更新公共资源时未找到可合并的历史 classSchedules，禁止生成会清空学生课表的 Staging。");
      const debugPath = writeLocalStagingDebugFailure(params, catalog, majors, error);
      throw new Error(`${error.message} 已生成 debug JSON: ${debugPath}`);
    }
    global.CLASS_SCHEDULE_CACHE_USAGE = {
      usedClassScheduleCache: true,
      cacheSource: cache.filePath,
      cacheWarning: "同步范围不包含 classSchedules，已合并历史行政班课表缓存以防止发布后清空学生课表。",
    };
  }

  const resourceIncludeOptions = buildResourceIncludeOptionsFromScopes(includeScopes);
  const resourceTypesForScopes = getResourceTypesFromIncludeScopes(includeScopes);
  const resourceSchedules = resourceTypesForScopes.length
    ? await withSyncStage("resource-build", () => buildResourcesForClassSchedules(allClassSchedules, resourceTypesForScopes, {
        page,
        semester: process.env.PREFERRED_SEMESTER || params.term || catalog.semesters?.[0]?.value,
      }))
    : null;
  const snapshot = measureSyncStage("normalize", () => buildSnapshot(catalog, majors, allClassSchedules, resourceSchedules, {
    resources: resourceIncludeOptions,
  }));
  if (includeScopes.includes("classSchedules") && (!snapshot.classSchedules || snapshot.classSchedules.length === 0)) {
    const error = new Error("includeScopes 包含 classSchedules，但最终快照 classSchedules 为 0，已禁止生成正式 Staging。");
    const debugPath = writeLocalStagingDebugFailure(params, catalog, majors, error);
    throw new Error(`${error.message} 已生成 debug JSON: ${debugPath}`);
  }
  validateLocalReleaseSnapshot(snapshot);

  const defaultOutput = path.join("staging", `${snapshot.semester || params.term || "term"}-full.json`);
  const output = resolveOutputFilePath(params.output || defaultOutput);
  printLocalCampusPathSummary(params, output);
  const sidecarPath = getSidecarMetaPath(output);
  const previousHash = readSidecarHash(sidecarPath);
  const fingerprint = measureSyncStage("hash", () => calculateFingerprint(snapshot));
  snapshot.canonicalHash = fingerprint.canonicalHash;
  snapshot.meta = Object.assign({}, snapshot.meta || {}, {
    canonicalHash: fingerprint.canonicalHash,
    previousHash,
    changed: previousHash ? previousHash !== fingerprint.canonicalHash : true,
    stageTimings: global.SYNC_STAGE_TIMINGS || {},
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(snapshot, null, 2), "utf-8");
  const rawSizeBytes = fs.statSync(output).size;
  const sidecarMeta = measureSyncStage("staging-meta", () => buildSidecarMeta(snapshot, {
    fingerprint,
    previousHash,
    rawSizeBytes,
  }));
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecarMeta, null, 2), "utf-8");
  console.log(`💾 Staging JSON 已生成: ${output}`);
  console.log(`🧾 Staging meta 已生成: ${sidecarPath}`);
  console.log(`📦 最终 staging 文件大小: ${(rawSizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`🔐 canonicalHash: ${fingerprint.canonicalHash}`);
  if (sidecarMeta.changed) {
    console.log("✅ 数据指纹已更新，可上传 staging。");
  } else {
    const meta = snapshot.meta || {};
    const cacheUsed = Boolean(meta.usedProgressCache || meta.usedNoScheduleCache || meta.usedClassScheduleCache);
    console.log("✅ 数据没有变化，本地文件与上次 sidecar 指纹一致。");
    console.log(`ℹ️ 本次真实网络请求专业数: ${meta.actualNetworkRequestCount || 0}`);
    console.log(`ℹ️ 本次缓存使用: progress=${meta.usedProgressCache ? "是" : "否"}, no-schedule=${meta.usedNoScheduleCache ? "是" : "否"}, classSchedules=${meta.usedClassScheduleCache ? "是" : "否"}`);
    if (cacheUsed) {
      console.log("⚠️ 本次结果可能受本地缓存影响；如需重新验证教务网实时数据，请执行 --fresh。");
    }
  }
  console.log(`📊 行政班课表: ${snapshot.coverage.classScheduleCount || 0}, 教师课表: ${snapshot.coverage.teacherScheduleCount || 0}, 教室课表: ${snapshot.coverage.classroomScheduleCount || 0}, 课程课表: ${snapshot.coverage.courseScheduleCount || 0}`);
  console.log("ℹ️ 当前命令不会上传、不会发布；下一步运行 sync:local-upload 上传到 VPS Staging。");
  return snapshot;
}

async function ensurePlannedTermIfNeeded(plan) {
  if (!plan || plan.profile !== "new-term") return null;
  if (!plan.termValid) throw new Error(`INVALID_TERM_FORMAT: ${plan.term}`);
  if (!plan.termConfig.termStartDate || !plan.termConfig.totalWeeks) {
    throw new Error("NEW_TERM_REQUIRES_EXPLICIT_CONFIG: pass --term-start-date=YYYY-MM-DD and --total-weeks=N.");
  }
  if (!ADMIN_API_TOKEN) {
    console.warn("[new-term] ADMIN_API_TOKEN missing; planned term creation skipped.");
    return null;
  }
  try {
    return await postAdminJson("/api/admin/terms", {
      term: plan.term,
      semesterText: plan.term,
      termStartDate: plan.termConfig.termStartDate,
      totalWeeks: plan.termConfig.totalWeeks,
      weekStart: plan.termConfig.weekStart || "monday",
      status: "planned",
      source: "sync-new-term",
    }, "create planned term");
  } catch (error) {
    const status = error.response && error.response.status;
    const code = error.response && error.response.data && error.response.data.code;
    if (status === 409 || code === "TERM_ALREADY_EXISTS") {
      console.log(`[new-term] Planned term already exists: ${plan.term}`);
      return null;
    }
    throw error;
  }
}

async function runClientProbeForRelease(result) {
  const version = result && (result.releaseVersion || result.version) || "";
  const term = result && (result.term || result.semester) || "";
  const probe = { term, releaseVersion: version, checkedAt: new Date().toISOString(), checks: [] };
  const urls = [
    ["/static/runtime/active.json", "runtime pointer"],
    [version ? `/static/releases/${encodeURIComponent(version)}/manifest.json` : "", "manifest"],
    [version ? `/static/releases/${encodeURIComponent(version)}/index/class.json` : "", "class index"],
    [version ? `/static/releases/${encodeURIComponent(version)}/index/teacher.json` : "", "teacher index"],
    [version ? `/static/releases/${encodeURIComponent(version)}/index/classroom.json` : "", "classroom index"],
    [version ? `/static/releases/${encodeURIComponent(version)}/index/course.json` : "", "course index"],
    [version ? `/static/releases/${encodeURIComponent(version)}/calendar.json` : "", "calendar"],
    [version ? `/static/releases/${encodeURIComponent(version)}/bootstrap.json` : "", "bootstrap"],
    [version ? `/static/releases/${encodeURIComponent(version)}/empty-room/index.json` : "", "empty-room"],
  ].filter(([url]) => Boolean(url));
  for (const [pathname, label] of urls) {
    try {
      const response = await axios.get(`${FOSU_API_BASE}${pathname}`, { proxy: false, timeout: 15000 });
      const payload = response.data || {};
      const actualVersion = payload.releaseVersion || payload.version || payload.activeReleaseVersion || "";
      const actualTerm = payload.term || payload.activeTerm || payload.semester || payload.termConfig && payload.termConfig.term || "";
      const versionMatches = label === "runtime pointer" || label === "manifest" || label === "calendar" || label === "bootstrap"
        ? actualVersion === version
        : !actualVersion || actualVersion === version;
      const termMatches = !actualTerm || actualTerm === term;
      probe.checks.push({
        label,
        url: pathname,
        ok: response.status >= 200 && response.status < 300 && versionMatches && termMatches,
        status: response.status,
        term: actualTerm,
        releaseVersion: actualVersion,
        versionMatches,
        termMatches,
      });
    } catch (error) {
      probe.checks.push({ label, url: pathname, ok: false, status: error.response && error.response.status || 0, message: error.message });
    }
  }
  console.log("[client-probe]");
  console.log(JSON.stringify(probe, null, 2));
  if (!probe.checks.every((item) => item.ok)) throw new Error("CLIENT_PROBE_FAILED");
  return probe;
}

async function activateTermRelease(term, releaseVersion) {
  if (!term || !releaseVersion) throw new Error("TERM_ACTIVATION_TARGET_REQUIRED");
  return postAdminJson(`/api/admin/terms/${encodeURIComponent(term)}/activate`, {
    releaseVersion,
  }, "activate term release");
}

async function publishCurrentStaging(plan, snapshot) {
  if (!plan.buildRelease) return null;
  if (!ADMIN_API_TOKEN) throw new Error("ADMIN_API_TOKEN_REQUIRED_FOR_PUBLISH");
  let result = await postAdminJson("/api/admin/sync/staging/publish", {
    force: Boolean(plan.allowPartial || (global.CLI_PARAMS || {}).force),
    readyOnly: plan.profile === "new-term" && !plan.activate,
    releaseNote: (global.CLI_PARAMS || {}).note || snapshot.releaseNote || "",
  }, "staging publish");
  if (plan.activate && result.readyOnly === true) {
    const releaseVersion = result.releaseVersion || result.version || "";
    const termActivation = await activateTermRelease(plan.term, releaseVersion);
    result = Object.assign({}, result, {
      readyOnly: false,
      activeTerm: plan.term,
      activeReleaseVersion: releaseVersion,
      termActivation,
    });
  }
  if (plan.verifyClient && !result.readyOnly) await runClientProbeForRelease(result);
  return result;
}

async function handlePlannedSync(page, params) {
  const plan = getActiveSyncPlan();
  if (!plan) throw new Error("SYNC_PLAN_NOT_RESOLVED");
  if (!plan.termValid) throw new Error(`INVALID_TERM_FORMAT: ${plan.term}`);
  await ensurePlannedTermIfNeeded(plan);
  if (!params.output) params.output = path.join("staging", `${plan.term}-full.json`);
  if (["daily", "new-term", "crawl-daily"].includes(plan.profile)) {
    process.env.SYNC_CLASS_SCOPE = process.env.SYNC_CLASS_SCOPE || "all";
  }
  const stagingPath = resolveOutputFilePath(params.output);
  const stagingMetaPath = getSidecarMetaPath(stagingPath);
  let snapshot = null;
  if (params.resume && fs.existsSync(stagingPath) && fs.existsSync(stagingMetaPath)) {
    const existingMeta = JSON.parse(fs.readFileSync(stagingMetaPath, "utf-8"));
    if (existingMeta.freshRunId === plan.runId && existingMeta.partial !== true) {
      snapshot = JSON.parse(fs.readFileSync(stagingPath, "utf-8"));
      console.log(`[resume] Reusing completed staging from current run: ${plan.runId}`);
    }
  }
  if (!snapshot) snapshot = await handleLocalCampusStaging(page, params);
  if (!plan.upload) {
    syncCacheStore.writeJsonAtomic(syncCacheStore.reportPath(__dirname, plan.term, "crawl-report"), {
      success: true,
      profile: plan.profile,
      runId: plan.runId,
      term: plan.term,
      output: resolveOutputFilePath(params.output),
      uploaded: false,
      published: false,
      generatedAt: new Date().toISOString(),
    });
    return snapshot;
  }
  const uploadResult = await handleLocalStagingUpload(Object.assign({}, params, {
    file: params.output,
    _snapshot: snapshot,
  }));
  const publishResult = await publishCurrentStaging(plan, snapshot);
  const report = {
    success: true,
    profile: plan.profile,
    runId: plan.runId,
    term: plan.term,
    output: resolveOutputFilePath(params.output),
    uploaded: true,
    uploadResult,
    published: Boolean(publishResult),
    publishResult,
    generatedAt: new Date().toISOString(),
  };
  syncCacheStore.writeJsonAtomic(syncCacheStore.reportPath(__dirname, plan.term, "publish-report"), report);
  return report;
}

const RESOURCE_SYNC_CONFIGS = {
  teacher: {
    flag: "SYNC_RESOURCES_TEACHERS",
    schedulesKey: "teacherSchedules",
    indexKey: "teachers",
    endpointType: "teacher",
    label: "教师",
  },
  classroom: {
    flag: "SYNC_RESOURCES_CLASSROOMS",
    schedulesKey: "classroomSchedules",
    indexKey: "classrooms",
    endpointType: "classroom",
    label: "教室",
  },
  course: {
    flag: "SYNC_RESOURCES_COURSES",
    schedulesKey: "courseSchedules",
    indexKey: "courses",
    endpointType: "course",
    label: "课程",
  },
};

function normalizeResourceTypeList(types) {
  const list = Array.isArray(types) && types.length ? types : ["teacher", "classroom", "course"];
  return list.filter((type) => RESOURCE_SYNC_CONFIGS[type]);
}

function getResourceDelayConfig() {
  const requestDelay = parseInt(process.env.SYNC_RESOURCE_REQUEST_DELAY_MS || "", 10);
  const min = parseInt(process.env.SYNC_RESOURCE_DELAY_MIN_MS || process.env.SYNC_RESOURCE_REQUEST_DELAY_MS || "800", 10);
  const max = parseInt(process.env.SYNC_RESOURCE_DELAY_MAX_MS || process.env.SYNC_RESOURCE_REQUEST_DELAY_MS || "1500", 10);
  return {
    concurrency: parseInt(process.env.SYNC_RESOURCE_MAX_CONCURRENCY || process.env.SYNC_RESOURCE_CONCURRENCY || "1", 10) || 1,
    requestDelayMs: Number.isFinite(requestDelay) && requestDelay >= 0 ? requestDelay : null,
    minDelayMs: Number.isFinite(min) ? min : 800,
    maxDelayMs: Number.isFinite(max) ? max : 1500,
  };
}

function getResourceUploadChunkSize() {
  const value = parseInt(process.env.SYNC_RESOURCE_UPLOAD_CHUNK_SIZE || process.env.SYNC_UPLOAD_CHUNK_SIZE || "20", 10);
  return Number.isFinite(value) && value > 0 ? value : 20;
}

function getEffectiveResourceSourceMode() {
  const raw = String(process.env.SYNC_RESOURCE_SOURCE || global.CLI_PARAMS?.resourceSource || "derived").trim().toLowerCase();
  if (raw === "direct" || raw === "both" || raw === "derived") return raw;
  return "derived";
}

function shouldUseDirectTeacherResources(resourceTypes) {
  const types = normalizeResourceTypeList(resourceTypes);
  if (!types.includes("teacher")) return false;
  const mode = getEffectiveResourceSourceMode();
  return mode === "direct" || mode === "both" || getEnvFlag("SYNC_FORCE_RESOURCE_CRAWL", false);
}

function shouldUseDirectResource(type, resourceTypes) {
  const types = normalizeResourceTypeList(resourceTypes);
  if (!types.includes(type)) return false;
  const mode = getEffectiveResourceSourceMode();
  return mode === "direct" || mode === "both" || getEnvFlag("SYNC_FORCE_RESOURCE_CRAWL", false);
}

function teacherNameOf(item) {
  return String(item && (item.teacherName || item.name || item.displayName || item.rawName) || "").trim();
}

function getCourseMergeKey(course) {
  return [
    course.courseName || course.canonicalCourseName || "",
    course.weekday || course.dayOfWeek || "",
    course.startSection || "",
    course.endSection || "",
    course.startWeek || "",
    course.endWeek || "",
    Array.isArray(course.weeks) ? course.weeks.join(",") : "",
    course.classroom || course.canonicalClassroom || "",
    course.className || "",
  ].join("|");
}

function dedupeCourses(courses) {
  const seen = new Set();
  const result = [];
  (courses || []).forEach((course) => {
    const key = getCourseMergeKey(course || {});
    if (seen.has(key)) return;
    seen.add(key);
    result.push(course);
  });
  return result;
}

function buildTeacherResourcesFromSchedules(schedules) {
  const teacherSchedules = (schedules || [])
    .map((schedule) => {
      const teacherName = teacherNameOf(schedule);
      if (!teacherName) return null;
      const courses = dedupeCourses(schedule.courses || []);
      return Object.assign({}, schedule, {
        name: teacherName,
        teacherName,
        displayName: schedule.displayName || teacherName,
        source: schedule.source || "direct",
        courses,
      });
    })
    .filter(Boolean)
    .sort((left, right) => String(left.teacherName).localeCompare(String(right.teacherName), "zh-CN"));
  return {
    teachers: teacherSchedules.map((schedule) => ({
      name: schedule.teacherName,
      teacherName: schedule.teacherName,
      displayName: schedule.displayName || schedule.teacherName,
      collegeCode: schedule.collegeCode || "",
      collegeName: schedule.collegeName || schedule.college || "",
      title: schedule.title || schedule.teacherTitle || schedule.professionalTitle || "",
      professionalTitle: schedule.professionalTitle || schedule.title || "",
      source: schedule.source || "direct",
      courseCount: (schedule.courses || []).length,
      firstCourseName: (schedule.courses || [])[0]?.courseName || "",
    })),
    teacherSchedules,
  };
}

function mergeTeacherResourceSets(directResources, derivedResources, mode) {
  if (mode === "direct") {
    return buildTeacherResourcesFromSchedules((directResources && directResources.teacherSchedules) || []);
  }
  if (mode !== "both") {
    return buildTeacherResourcesFromSchedules((derivedResources && derivedResources.teacherSchedules) || []);
  }
  const merged = new Map();
  const addSchedules = (schedules, source) => {
    (schedules || []).forEach((schedule) => {
      const teacherName = teacherNameOf(schedule);
      if (!teacherName) return;
      const existing = merged.get(teacherName) || {
        name: teacherName,
        teacherName,
        displayName: schedule.displayName || teacherName,
        collegeCode: "",
        collegeName: "",
        title: "",
        professionalTitle: "",
        source: "",
        sources: [],
        courses: [],
      };
      existing.collegeCode = existing.collegeCode || schedule.collegeCode || "";
      existing.collegeName = existing.collegeName || schedule.collegeName || schedule.college || "";
      existing.title = existing.title || schedule.title || schedule.teacherTitle || schedule.professionalTitle || "";
      existing.professionalTitle = existing.professionalTitle || schedule.professionalTitle || schedule.title || "";
      if (!existing.sources.includes(source)) existing.sources.push(source);
      existing.courses = dedupeCourses(existing.courses.concat(schedule.courses || []));
      existing.source = existing.sources.length > 1 ? "merged" : source;
      merged.set(teacherName, existing);
    });
  };
  addSchedules((directResources && directResources.teacherSchedules) || [], "direct");
  addSchedules((derivedResources && derivedResources.teacherSchedules) || [], "derived");
  return buildTeacherResourcesFromSchedules(Array.from(merged.values()));
}

function mergeResourcesBySource(derivedResources, directResources, mode) {
  const teacherPart = mergeTeacherResourceSets(directResources, derivedResources, mode);
  return Object.assign({}, derivedResources || emptySnapshotResources(), {
    teachers: teacherPart.teachers,
    teacherSchedules: teacherPart.teacherSchedules,
  });
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const list = items || [];
  const workerCount = Math.max(1, Math.min(Number(concurrency || 1) || 1, list.length || 1));
  const results = new Array(list.length);
  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await iteratee(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function getDirectTeacherLimit() {
  return parsePositiveLimit(process.env.SYNC_DIRECT_TEACHER_LIMIT) || parsePositiveLimit(process.env.SYNC_RESOURCE_LIMIT);
}

function limitDirectTargets(targets) {
  const limit = getDirectTeacherLimit();
  return limit ? targets.slice(0, limit) : targets;
}

async function collectDirectTeacherTargets(page, derivedResources, semester) {
  await gotoPage(page, "/kbcx/kbxx_teacher", { waitUntil: "networkidle", timeout: 20000 });
  try {
    await selectSemester(page, semester);
  } catch (error) {
    console.warn(`[resources:teacher:direct] semester select fallback: ${error.message}`);
  }
  const html = await page.content();
  const debugDir = path.join(__dirname, ".debug");
  fs.writeFileSync(path.join(debugDir, "direct-teacher-page.html"), html, "utf-8");
  const dom = await page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const optionList = (select) => Array.from(select.options || [])
      .map((option) => ({
        code: clean(option.value),
        name: clean(option.textContent),
      }))
      .filter((option) => option.name && option.code && !/^请选择|^全部|^--/.test(option.name));
    const result = {
      teachers: [],
      colleges: [],
      titles: [],
      selects: [],
    };
    Array.from(document.querySelectorAll("select")).forEach((select) => {
      const marker = `${select.getAttribute("name") || ""} ${select.getAttribute("id") || ""}`.toLowerCase();
      const options = optionList(select);
      result.selects.push({ marker, optionCount: options.length });
      if (/skyx|college|yx/.test(marker)) {
        result.colleges.push(...options);
      } else if (/jszc|title|zc/.test(marker)) {
        result.titles.push(...options);
      } else if (/(^|[^a-z])(js|skjs|teacher|jzg|gh)([^a-z]|$)/.test(marker)) {
        result.teachers.push(...options);
      }
    });
    return result;
  });

  const teacherTargets = (dom.teachers || []).map((item) => ({
    type: "teacher",
    teacherCode: item.code,
    teacherName: item.name,
  }));
  if (teacherTargets.length) {
    return {
      targets: limitDirectTargets(teacherTargets),
      dom,
      source: "teacher-select",
    };
  }

  const collegeTargets = (dom.colleges || []).map((item) => ({
    type: "college",
    collegeCode: item.code,
    collegeName: item.name,
  }));
  if (collegeTargets.length) {
    return {
      targets: limitDirectTargets(collegeTargets),
      dom,
      source: "college-select",
    };
  }

  const derivedTargets = ((derivedResources && derivedResources.teacherSchedules) || [])
    .map((item) => teacherNameOf(item))
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index)
    .map((name) => ({
      type: "teacher-name",
      teacherName: name,
    }));
  if (derivedTargets.length) {
    return {
      targets: limitDirectTargets(derivedTargets),
      dom,
      source: "derived-teacher-names",
    };
  }

  return {
    targets: [{ type: "all" }],
    dom,
    source: "all-teachers",
  };
}

async function fetchDirectTeacherScheduleHtml(page, target, semester) {
  return page.evaluate(async (input) => {
    const body = new URLSearchParams({
      xnxqh: input.semester,
      skyx: input.target.collegeCode || "",
      jszc: input.target.titleCode || "",
      js: input.target.teacherCode || "",
      jsid: input.target.teacherCode || "",
      jzgid: input.target.teacherCode || "",
      gh: input.target.teacherCode || "",
      skjs: input.target.teacherCode || "",
      jsxm: input.target.teacherName || "",
      jsmc: input.target.teacherName || "",
      zc1: "",
      zc2: "",
      jc1: "",
      jc2: "",
    }).toString();
    const response = await fetch("/kbcx/kbxx_teacher_ifr", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      credentials: "include",
      body,
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    };
  }, { target, semester });
}

async function crawlDirectTeacherResources(page, derivedResources = {}, options = {}) {
  const semester = options.semester || process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
  const delayConfig = getResourceDelayConfig();
  const collected = await collectDirectTeacherTargets(page, derivedResources, semester);
  const targets = collected.targets || [];
  console.log(`[resources:teacher:direct] source=${collected.source}, targets=${targets.length}, concurrency=${delayConfig.concurrency}`);
  const samples = [];
  const errors = [];
  const grouped = new Map();

  await mapWithConcurrency(targets, delayConfig.concurrency, async (target, index) => {
    if (index > 0) {
      const delay = delayConfig.requestDelayMs !== null ? delayConfig.requestDelayMs : delayConfig.minDelayMs;
      if (delay > 0) await sleep(delay);
    }
    try {
      const response = await fetchDirectTeacherScheduleHtml(page, target, semester);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (samples.length < 5) {
        samples.push({
          target,
          responseLength: response.text.length,
          htmlPath: `direct-teacher-sample-${samples.length + 1}.html`,
        });
        fs.writeFileSync(path.join(debugDir, `direct-teacher-sample-${samples.length}.html`), response.text, "utf-8");
      }
      const parsed = parser.parseTeacherScheduleIfrHtml(response.text, {
        semester,
        teacherName: target.teacherName || "",
        collegeCode: target.collegeCode || "",
        collegeName: target.collegeName || "",
      });
      const courses = normalizer.normalizeCourseList(parsed.courses || [], {
        semester,
        sourceType: "teacher",
        audienceType: "teacher",
      });
      courses.forEach((course) => {
        const teacherName = teacherNameOf(course) || target.teacherName || "未知教师";
        if (!isUsableResourceName(teacherName) || courseIdentity.isCourseLike(teacherName)) return;
        const current = grouped.get(teacherName) || {
          teacherName,
          name: teacherName,
          displayName: teacherName,
          collegeCode: target.collegeCode || course.collegeCode || "",
          collegeName: target.collegeName || course.collegeName || "",
          title: target.title || "",
          source: "direct",
          courses: [],
        };
        current.courses.push(Object.assign({}, course, {
          teacherName,
          source: "direct",
          sourceType: "teacher",
          audienceType: "teacher",
        }));
        grouped.set(teacherName, current);
      });
    } catch (error) {
      errors.push({
        target,
        message: error.message,
      });
      console.warn(`[resources:teacher:direct] target failed (${target.teacherName || target.collegeName || target.type}): ${error.message}`);
    }
  });

  const teacherSchedules = Array.from(grouped.values()).map((item) => Object.assign({}, item, {
    courses: dedupeCourses(item.courses),
  }));
  const resources = buildTeacherResourcesFromSchedules(teacherSchedules);
  const quality = buildDirectTeacherQualityReport(collected, targets, resources);
  const report = {
    success: errors.length < targets.length,
    generatedAt: new Date().toISOString(),
    semester,
    source: collected.source,
    targetCount: targets.length,
    teacherScheduleCount: resources.teacherSchedules.length,
    courseCount: resources.teacherSchedules.reduce((sum, item) => sum + (item.courses || []).length, 0),
    dom: collected.dom,
    errors: errors.slice(0, 50),
    samples,
    quality,
  };
  if (quality.coverageStatus === "invalid") {
    console.warn(`[resources:teacher:direct] 数据质量不通过：targetDiscoveryMode=${quality.targetDiscoveryMode}, requestGroupCount=${quality.requestGroupCount}, scheduleDocumentCount=${quality.scheduleDocumentCount}, invalidTeacherNameCount=${quality.invalidTeacherNameCount}`);
  }
  fs.writeFileSync(path.join(debugDir, "direct-teacher-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
  fs.writeFileSync(path.join(debugDir, "direct-teacher-schedules-latest.json"), JSON.stringify(resources.teacherSchedules, null, 2), "utf-8");
  console.log(`[resources:teacher:direct] schedules=${report.teacherScheduleCount}, courses=${report.courseCount}, errors=${errors.length}`);
  return Object.assign({}, resources, {
    _diagnostics: {
      teacherSchedules: quality,
    },
  });
}

function getDirectResourceLimit() {
  return parsePositiveLimit(process.env.SYNC_DIRECT_RESOURCE_LIMIT) || parsePositiveLimit(process.env.SYNC_RESOURCE_LIMIT);
}

function limitDirectResourceTargets(targets) {
  const limit = getDirectResourceLimit();
  return limit ? targets.slice(0, limit) : targets;
}

function getGenericDirectResourceConfig(type) {
  if (type === "classroom") {
    return {
      pagePath: "/kbcx/kbxx_classroom",
      ifrPath: "/kbcx/kbxx_classroom_ifr",
      parse: parser.parseClassroomScheduleIfrHtml,
      targetKey: "roomName",
      schedulesKey: "classroomSchedules",
      indexKey: "classrooms",
      endpointFamily: "classroom-schedule",
      audienceType: "classroom",
      targetFromCourse: (course) => course.canonicalClassroom || course.displayClassroom || course.classroom || course.roomName || "",
    };
  }
  if (type === "course") {
    return {
      pagePath: "/kbcx/kbxx_kc",
      ifrPath: "/kbcx/kbxx_kc_ifr",
      parse: parser.parseCourseScheduleIfrHtml,
      targetKey: "courseName",
      schedulesKey: "courseSchedules",
      indexKey: "courses",
      endpointFamily: "course-schedule",
      audienceType: "course",
      targetFromCourse: (course) => course.canonicalCourseName || course.displayCourseName || course.courseName || "",
    };
  }
  return null;
}

async function collectGenericDirectResourceTargets(page, type, derivedResources, semester) {
  const config = getGenericDirectResourceConfig(type);
  await gotoPage(page, config.pagePath, { waitUntil: "networkidle", timeout: 20000 });
  try {
    await selectSemester(page, semester);
  } catch (error) {
    console.warn(`[resources:${type}:direct] semester select fallback: ${error.message}`);
  }
  const html = await page.content();
  const debugDir = path.join(__dirname, ".debug");
  fs.writeFileSync(path.join(debugDir, `direct-${type}-page.html`), html, "utf-8");
  const dom = await page.evaluate((resourceType) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const optionList = (select) => Array.from(select.options || [])
      .map((option) => ({ code: clean(option.value), name: clean(option.textContent) }))
      .filter((option) => option.name && option.code && !/^请选择|^全部|^--/.test(option.name));
    const result = { colleges: [], campuses: [], buildings: [], courses: [], selects: [] };
    Array.from(document.querySelectorAll("select")).forEach((select) => {
      const marker = `${select.getAttribute("name") || ""} ${select.getAttribute("id") || ""}`.toLowerCase();
      const options = optionList(select);
      result.selects.push({ marker, optionCount: options.length });
      if (/skyx|college|yx|kkyx/.test(marker)) result.colleges.push(...options);
      if (/xqid|campus|xq/.test(marker)) result.campuses.push(...options);
      if (/jzwid|building|jxl|jzw/.test(marker)) result.buildings.push(...options);
      if (resourceType === "course" && /kc|course|zzdkcsx/.test(marker)) result.courses.push(...options);
    });
    return result;
  }, type);

  if (type === "classroom") {
    const buildingTargets = (dom.buildings || []).map((item) => ({
      type: "building",
      buildingId: item.code,
      buildingName: item.name,
    }));
    if (buildingTargets.length) return { targets: limitDirectResourceTargets(buildingTargets), dom, source: "building-select" };
    const campusTargets = (dom.campuses || []).map((item) => ({
      type: "campus",
      campusId: item.code,
      campusName: item.name,
    }));
    if (campusTargets.length) return { targets: limitDirectResourceTargets(campusTargets), dom, source: "campus-select" };
  }

  if (type === "course") {
    const courseTargets = (dom.courses || []).map((item) => ({
      type: "course",
      courseCode: item.code,
      courseName: item.name,
    }));
    if (courseTargets.length) return { targets: limitDirectResourceTargets(courseTargets), dom, source: "course-select" };
  }

  const derivedTargets = ((derivedResources && derivedResources[config.schedulesKey]) || [])
    .map((schedule) => String(schedule && schedule[config.targetKey] || "").trim())
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index)
    .map((name) => ({
      type: `${type}-name`,
      name,
      roomName: type === "classroom" ? name : "",
      courseName: type === "course" ? name : "",
    }));
  if (derivedTargets.length) return { targets: limitDirectResourceTargets(derivedTargets), dom, source: "derived-names" };

  const collegeTargets = (dom.colleges || []).map((item) => ({
    type: "college",
    collegeCode: item.code,
    collegeName: item.name,
  }));
  if (collegeTargets.length) return { targets: limitDirectResourceTargets(collegeTargets), dom, source: "college-select" };

  return { targets: [{ type: "all" }], dom, source: "all" };
}

async function fetchGenericDirectScheduleHtml(page, type, target, semester) {
  const config = getGenericDirectResourceConfig(type);
  return page.evaluate(async (input) => {
    const bodyData = input.type === "classroom" ? {
      xnxqh: input.semester,
      skyx: input.target.collegeCode || "",
      xqid: input.target.campusId || "",
      jzwid: input.target.buildingId || "",
      jsid: input.target.roomId || "",
      jsmc: input.target.roomName || input.target.name || "",
      zc1: "",
      zc2: "",
      jc1: "",
      jc2: "",
    } : {
      xnxqh: input.semester,
      skyx: input.target.collegeCode || "",
      kkyx: input.target.openCollegeCode || input.target.collegeCode || "",
      zzdKcSX: input.target.courseAttr || "",
      kc: input.target.courseCode || input.target.courseName || input.target.name || "",
      kcmc: input.target.courseName || input.target.name || "",
      zc1: "",
      zc2: "",
      jc1: "",
      jc2: "",
    };
    const response = await fetch(input.ifrPath, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      credentials: "include",
      body: new URLSearchParams(bodyData).toString(),
    });
    return { ok: response.ok, status: response.status, text: await response.text() };
  }, { type, target, semester, ifrPath: config.ifrPath });
}

function buildGenericResourcesFromSchedules(type, schedules) {
  const config = getGenericDirectResourceConfig(type);
  const key = config.targetKey;
  const scheduleList = (schedules || []).map((item) => Object.assign({}, item, {
    courses: dedupeCourses(item.courses || []),
    source: "direct",
  })).filter((item) => isUsableResourceName(item[key]));
  return Object.assign(emptySnapshotResources(), {
    [config.schedulesKey]: scheduleList,
    [config.indexKey]: scheduleList.map((item) => ({
      [key]: item[key],
      name: item[key],
      courseCount: (item.courses || []).length,
      source: "direct",
    })),
  });
}

async function crawlGenericDirectResources(type, page, derivedResources = {}, options = {}) {
  const config = getGenericDirectResourceConfig(type);
  if (!config) throw new Error(`Unsupported direct resource type: ${type}`);
  const semester = options.semester || process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
  const delayConfig = getResourceDelayConfig();
  const collected = await collectGenericDirectResourceTargets(page, type, derivedResources, semester);
  const targets = collected.targets || [];
  console.log(`[resources:${type}:direct] source=${collected.source}, targets=${targets.length}, concurrency=${delayConfig.concurrency}`);
  const grouped = new Map();
  const errors = [];
  const samples = [];

  await mapWithConcurrency(targets, delayConfig.concurrency, async (target, index) => {
    if (index > 0) {
      const delay = delayConfig.requestDelayMs !== null ? delayConfig.requestDelayMs : delayConfig.minDelayMs;
      if (delay > 0) await sleep(delay);
    }
    try {
      const response = await fetchGenericDirectScheduleHtml(page, type, target, semester);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (samples.length < 5) {
        const sampleName = `direct-${type}-sample-${samples.length + 1}.html`;
        samples.push({ target, responseLength: response.text.length, htmlPath: sampleName });
        fs.writeFileSync(path.join(debugDir, sampleName), response.text, "utf-8");
      }
      const parsed = config.parse(response.text, {
        semester,
        collegeCode: target.collegeCode || "",
        collegeName: target.collegeName || "",
      });
      const courses = normalizer.normalizeCourseList(parsed.courses || [], {
        semester,
        sourceType: type,
        audienceType: config.audienceType,
      });
      courses.forEach((course) => {
        const name = config.targetFromCourse(course) || target.roomName || target.courseName || target.name || "";
        if (!isUsableResourceName(name)) return;
        const current = grouped.get(name) || { [config.targetKey]: name, name, source: "direct", courses: [] };
        current.courses.push(Object.assign({}, course, {
          source: "direct",
          sourceType: type,
          audienceType: config.audienceType,
        }));
        grouped.set(name, current);
      });
    } catch (error) {
      errors.push({ target, message: error.message });
      console.warn(`[resources:${type}:direct] target failed (${target.name || target.courseName || target.roomName || target.collegeName || target.type}): ${error.message}`);
    }
  });

  const resources = buildGenericResourcesFromSchedules(type, Array.from(grouped.values()));
  const report = {
    success: errors.length < targets.length,
    generatedAt: new Date().toISOString(),
    semester,
    source: collected.source,
    targetCount: targets.length,
    scheduleCount: resources[config.schedulesKey].length,
    courseCount: resources[config.schedulesKey].reduce((sum, item) => sum + (item.courses || []).length, 0),
    dom: collected.dom,
    errors: errors.slice(0, 50),
    samples,
  };
  fs.writeFileSync(path.join(debugDir, `direct-${type}-report-latest.json`), JSON.stringify(report, null, 2), "utf-8");
  fs.writeFileSync(path.join(debugDir, `direct-${type}-schedules-latest.json`), JSON.stringify(resources[config.schedulesKey], null, 2), "utf-8");
  console.log(`[resources:${type}:direct] schedules=${report.scheduleCount}, courses=${report.courseCount}, errors=${errors.length}`);
  return resources;
}

async function buildResourcesForClassSchedules(classSchedules, resourceTypes, options = {}) {
  const types = normalizeResourceTypeList(resourceTypes);
  const semester = options.semester || process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const includeOptions = {
    includeTeachers: types.includes("teacher"),
    includeClassrooms: types.includes("classroom"),
    includeCourses: types.includes("course"),
  };
  const normalizedClassSchedules = (classSchedules || []).map((item) => normalizeScheduleEntryCourses(item, {
    semester: item.semester || semester,
    sourceType: "class",
    audienceType: "student",
  }));
  const derivedResources = buildSnapshotResources(normalizedClassSchedules, includeOptions);
  const mode = getEffectiveResourceSourceMode();
  const directTypes = types.filter((type) => shouldUseDirectResource(type, types));
  if (directTypes.length === 0) {
    types.forEach((type) => {
      const config = RESOURCE_SYNC_CONFIGS[type];
      if (config) {
        recordScopeSource(config.schedulesKey, {
          sourceMode: "derived-current-run",
          endpointFamily: "class-schedule",
          requested: (derivedResources[config.schedulesKey] || []).length,
          succeeded: (derivedResources[config.schedulesKey] || []).length,
          derived: (derivedResources[config.schedulesKey] || []).length,
          hash: crypto.createHash("sha256").update(JSON.stringify(derivedResources[config.schedulesKey] || [])).digest("hex"),
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        });
      }
    });
    return derivedResources;
  }
  if (!options.page) {
    if (global.CLI_PARAMS && global.CLI_PARAMS.allowDerived) {
      console.warn(`[resources] resource-source=${mode} requested but no browser page is available; falling back to derived resources because --allow-derived is set.`);
      return derivedResources;
    }
    throw new Error(`RESOURCE_DIRECT_CRAWL_REQUIRED: ${directTypes.join(",")} requested but no browser page is available.`);
  }
  let result = Object.assign({}, derivedResources);
  for (const type of directTypes) {
    const config = RESOURCE_SYNC_CONFIGS[type];
    try {
      const directResources = type === "teacher"
        ? await crawlDirectTeacherResources(options.page, derivedResources, { semester })
        : await crawlGenericDirectResources(type, options.page, derivedResources, { semester });
      if (type === "teacher") {
        result = mergeResourcesBySource(result, directResources, getEnvFlag("SYNC_FORCE_RESOURCE_CRAWL", false) && mode === "derived" ? "both" : mode);
      } else {
        result = Object.assign({}, result, {
          [config.indexKey]: directResources[config.indexKey] || [],
          [config.schedulesKey]: directResources[config.schedulesKey] || [],
        });
      }
      syncCacheStore.writeScheduleLatest(__dirname, semester, config.schedulesKey, result[config.schedulesKey] || [], {
        runId: getActiveSyncPlan() && getActiveSyncPlan().runId || `resource-${Date.now()}`,
        command: global.GENERATED_COMMAND || process.argv.join(" "),
        sourceMode: "network-direct",
        endpointFamily: `${type}-schedule`,
        acquisition: "network",
        fresh: true,
      });
      recordScopeSource(config.schedulesKey, {
        sourceMode: "network-direct",
        endpointFamily: `${type}-schedule`,
        requested: (result[config.schedulesKey] || []).length,
        succeeded: (result[config.schedulesKey] || []).length,
        failed: 0,
        cacheHits: 0,
        hash: crypto.createHash("sha256").update(JSON.stringify(result[config.schedulesKey] || [])).digest("hex"),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
      const diagnostic = directResources && directResources._diagnostics && directResources._diagnostics[config.schedulesKey];
      if (diagnostic) {
        recordScopeSource(config.schedulesKey, diagnostic);
      }
    } catch (error) {
      if (global.CLI_PARAMS && global.CLI_PARAMS.allowDerived) {
        console.warn(`[resources:${type}] direct crawl failed; using derived-current-run because --allow-derived is set: ${error.message}`);
        recordScopeSource(config.schedulesKey, {
          sourceMode: "derived-current-run",
          endpointFamily: "class-schedule",
          requested: (derivedResources[config.schedulesKey] || []).length,
          succeeded: (derivedResources[config.schedulesKey] || []).length,
          derived: (derivedResources[config.schedulesKey] || []).length,
          hash: crypto.createHash("sha256").update(JSON.stringify(derivedResources[config.schedulesKey] || [])).digest("hex"),
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        });
        result[config.indexKey] = derivedResources[config.indexKey] || [];
        result[config.schedulesKey] = derivedResources[config.schedulesKey] || [];
      } else {
        throw error;
      }
    }
  }
  return result;
}

function buildResourceIncludeOptionsFromScopes(includeScopes) {
  const scopes = Array.isArray(includeScopes) ? includeScopes : [];
  return {
    includeTeachers: scopes.includes("teachers"),
    includeClassrooms: scopes.includes("classrooms"),
    includeCourses: scopes.includes("courses"),
    includeTeacherSchedules: scopes.includes("teacherSchedules"),
    includeClassroomSchedules: scopes.includes("classroomSchedules"),
    includeCourseSchedules: scopes.includes("courseSchedules"),
  };
}

function getResourceTypesFromIncludeScopes(includeScopes) {
  const scopes = Array.isArray(includeScopes) ? includeScopes : [];
  const types = [];
  if (scopes.includes("teachers") || scopes.includes("teacherSchedules")) {
    types.push("teacher");
  }
  if (scopes.includes("classrooms") || scopes.includes("classroomSchedules")) {
    types.push("classroom");
  }
  if (scopes.includes("courses") || scopes.includes("courseSchedules")) {
    types.push("course");
  }
  return types;
}

function getResourceTypesForAction(action) {
  if (action === "resources") return ["teacher", "classroom", "course"];
  const typeMap = {
    teachers: "teacher",
    classrooms: "classroom",
    courses: "course",
  };
  return typeMap[action] ? [typeMap[action]] : [];
}

function buildResourceUploadId(type) {
  return `${type}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

async function uploadResourceSchedules(resources, resourceTypes, semester) {
  const results = {};
  const chunkSize = getResourceUploadChunkSize();
  const delayConfig = getResourceDelayConfig();
  const requestDelayMs = delayConfig.requestDelayMs !== null
    ? delayConfig.requestDelayMs
    : Math.max(0, delayConfig.minDelayMs);
  for (const type of normalizeResourceTypeList(resourceTypes)) {
    const config = RESOURCE_SYNC_CONFIGS[type];
    const items = resources[config.schedulesKey] || [];
    const totalChunks = Math.max(1, Math.ceil(items.length / chunkSize));
    const uploadId = buildResourceUploadId(type);
    console.log(`[resources] uploading ${type}: ${items.length} items, ${chunkSize} per chunk, ${totalChunks} chunks`);

    let finalResult = null;
    for (let index = 0; index < totalChunks; index += 1) {
      const chunkNumber = index + 1;
      const chunk = items.slice(index * chunkSize, (index + 1) * chunkSize);
      const payload = {
        resourceType: type,
        semester,
        uploadId,
        chunkIndex: chunkNumber,
        totalChunks,
        chunkItemCount: chunk.length,
        items: chunk,
        generatedAt: new Date().toISOString(),
      };
      finalResult = await uploadWithRetry(`/api/admin/sync/resources?type=${config.endpointType}`, payload, chunkNumber, totalChunks);
      if (chunkNumber < totalChunks && requestDelayMs > 0) {
        await sleep(requestDelayMs);
      }
    }

    results[type] = Object.assign({
      resourceType: type,
      uploadId,
      chunkSize,
      totalChunks,
    }, finalResult || {});
  }
  return results;
}

async function handleResourcesSync(resourceTypes, options = {}) {
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const manifestPath = path.join(debugDir, "class-schedules-manifest.json");
  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();

  // 1. 读取并校验清单文件是否存在
  if (!fs.existsSync(manifestPath)) {
    console.error("❌ 没有找到班级课表抓取清单，sync:resources 只能基于本地班级课表缓存派生资源。请先运行 npm run sync:class 或 npm run sync:fresh。");
    throw new Error("Missing class-schedules-manifest.json");
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    console.error(`❌ 读取或解析班级课表抓取清单失败: ${err.message}`);
    throw err;
  }

  // 2. 校验 semester 是否与当前配置一致
  if (manifest.semester !== preferredSemester) {
    const allowStale = getEnvFlag("SYNC_RESOURCES_ALLOW_STALE", false);
    if (!allowStale) {
      console.error(`❌ 班级课表抓取清单的学期 [${manifest.semester}] 与当前配置的 Preferred Semester [${preferredSemester}] 不一致！`);
      console.error("💡 提示: 已阻止执行以防止派生错误数据。如果您确实需要，请设置环境变量: $env:SYNC_RESOURCES_ALLOW_STALE=\"true\"。");
      throw new Error("Semester mismatch in manifest");
    } else {
      console.warn(`⚠️ 警告: 班级课表学期 [${manifest.semester}] 与配置的 [${preferredSemester}] 不一致，但已设置 SYNC_RESOURCES_ALLOW_STALE=true，将继续执行。`);
    }
  }

  // 3. 校验 crawledAt 是否过期
  const crawledTime = new Date(manifest.crawledAt).getTime();
  const nowTime = Date.now();
  const diffHours = (nowTime - crawledTime) / (1000 * 60 * 60);

  if (diffHours > 24) {
    console.warn(`⚠️ 强警告: 本地班级课表缓存生成时间 [${manifest.crawledAt}] 距今已超过 ${diffHours.toFixed(1)} 小时，本地班级课表缓存可能不是最新数据。`);
  }

  const requireFresh = getEnvFlag("SYNC_RESOURCES_REQUIRE_FRESH", false);
  if (requireFresh && diffHours > 6) {
    console.error(`❌ 本地班级课表缓存已过期！生成时间距今已超过 6 小时 (${diffHours.toFixed(1)} 小时)，且设置了 SYNC_RESOURCES_REQUIRE_FRESH=true。`);
    throw new Error("Class schedules cache is stale (exceeded 6 hours)");
  }

  const { items, filePath } = readClassSchedulesFromFile();

  let fileMtime = "未知";
  try {
    const stat = fs.statSync(filePath);
    fileMtime = stat.mtime.toISOString();
  } catch (e) {}

  console.log("\n=================== [sync:resources 开始派生资源] ===================");
  console.log(`- 当前读取的 class-schedules-latest.json 路径: ${filePath}`);
  console.log(`- 该文件实际修改时间 (mtime): ${fileMtime}`);
  console.log(`- 抓取清单学期 (manifest semester): ${manifest.semester}`);
  console.log(`- 抓取清单生成时间 (manifest crawledAt): ${manifest.crawledAt}`);
  console.log(`- 抓取清单班级课表数量 (classScheduleCount): ${manifest.classScheduleCount || items.length}`);
  console.log(`- resourceSource: ${getEffectiveResourceSourceMode()}${shouldUseDirectTeacherResources(resourceTypes) ? " (teacher direct crawl enabled)" : " (derived from class schedules)"}`);
  console.log(shouldUseDirectTeacherResources(resourceTypes)
    ? "- 说明：教师资源会访问教务 100 网直抓 teacher endpoint，教室/课程仍基于班级课表缓存派生。"
    : "- 说明：此命令不会访问教务 100 网，只会基于刚才抓取的班级课表缓存派生教师/教室/课程维度。");
  console.log("===================================================================\n");
  const types = normalizeResourceTypeList(resourceTypes);
  const includeOptions = {
    includeTeachers: types.includes("teacher"),
    includeClassrooms: types.includes("classroom"),
    includeCourses: types.includes("course"),
  };
  const semester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const resources = await buildResourcesForClassSchedules(items, types, {
    page: options.page,
    semester,
  });
  const resourcesPath = path.join(debugDir, "resources-latest.json");
  fs.writeFileSync(resourcesPath, JSON.stringify(resources, null, 2), "utf-8");

  const uploadResults = await uploadResourceSchedules(resources, types, semester);
  types.forEach((type) => {
    const config = RESOURCE_SYNC_CONFIGS[type];
    fs.writeFileSync(
      path.join(debugDir, `${type}-schedules-latest.json`),
      JSON.stringify({
        resourceType: type,
        semester,
        items: resources[config.schedulesKey] || [],
      }, null, 2),
      "utf-8"
    );
  });

  const report = {
    success: true,
    generatedAt: new Date().toISOString(),
    sourceFile: filePath,
    resourceTypes: types,
    resourceRequestPolicy: getResourceDelayConfig(),
    flags: {
      SYNC_RESOURCES_TEACHERS: includeOptions.includeTeachers,
      SYNC_RESOURCES_CLASSROOMS: includeOptions.includeClassrooms,
      SYNC_RESOURCES_COURSES: includeOptions.includeCourses,
      SYNC_RESOURCE_LIMIT: parsePositiveLimit(process.env.SYNC_RESOURCE_LIMIT),
      SYNC_RESOURCE_SOURCE: getEffectiveResourceSourceMode(),
      SYNC_FORCE_RESOURCE_CRAWL: getEnvFlag("SYNC_FORCE_RESOURCE_CRAWL", false),
    },
    counts: {
      teachers: resources.teachers.length,
      classrooms: resources.classrooms.length,
      courses: resources.courses.length,
      teacherSchedules: resources.teacherSchedules.length,
      classroomSchedules: resources.classroomSchedules.length,
      courseSchedules: resources.courseSchedules.length,
    },
    uploadResults,
  };
  fs.writeFileSync(path.join(debugDir, "resources-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
  console.log(`💾 资源维度数据已生成: ${resourcesPath}`);
  console.log(`📊 resources counts: ${JSON.stringify(report.counts)}`);

  // 生成并写入 resources-manifest.json
  let resourcesChecksum = "";
  try {
    const fileContent = fs.readFileSync(resourcesPath, "utf-8");
    resourcesChecksum = crypto.createHash("md5").update(fileContent).digest("hex");
  } catch (e) {}

  const resourcesManifest = {
    semester,
    generatedAt: report.generatedAt,
    source: path.basename(filePath),
    teacherScheduleCount: resources.teacherSchedules.length,
    classroomScheduleCount: resources.classroomSchedules.length,
    courseScheduleCount: resources.courseSchedules.length,
    checksum: resourcesChecksum
  };
  const resourcesManifestPath = path.join(debugDir, "resources-manifest.json");
  fs.writeFileSync(resourcesManifestPath, JSON.stringify(resourcesManifest, null, 2), "utf-8");
  console.log(`💾 资源维度清单已保存至: ${resourcesManifestPath}`);

  return resources;
}

/**
 * 初始化已登录的 Playwright 上下文
 */
async function initBrowserContext() {
  const launchArgs = withDirectBrowserArgs([
    "--disable-blink-features=AutomationControlled",
    "--ignore-certificate-errors",
    "--disable-web-security",
    "--allow-running-insecure-content"
  ]);

  let browser;
  // 优先尝试系统边缘浏览器，其次是 Chrome，最后回退内置 Chromium
  const channels = ["msedge", "chrome", null];
  for (const channel of channels) {
    try {
      const config = {
        headless: false, // 设为 false 以确保与系统通道的最大兼容性，并且能够直观展示同步过程
        args: launchArgs,
      };
      if (channel) {
        config.channel = channel;
        console.log(`尝试使用系统浏览器通道: ${channel} ...`);
      } else {
        console.log("使用内置 Chromium 浏览器 ...");
      }
      browser = await chromium.launch(config);
      break; // 成功启动则退出循环
    } catch (e) {
      console.warn(`⚠️ 浏览器通道 ${channel || "内置"} 启动失败: ${e.message}`);
      if (channel === null) {
        console.error("\n💡 提示: 如果您想使用内置 Chromium 浏览器，请先运行以下命令安装：");
        console.error("   npx playwright install chromium");
      }
    }
  }

  if (!browser) {
    console.error("❌ 无法启动任何浏览器！请检查 Playwright 安装是否完整。");
    const error = new Error("无法启动任何浏览器");
    error.code = "PLAYWRIGHT_LAUNCH_FAILED";
    throw error;
  }

  let context;

  if (FOSU_SYNC_AUTH_MODE === "playwright-manual") {
    if (!fs.existsSync(SESSION_PATH)) {
      console.error("❌ 本地未找到 session.json 登录会话文件！");
      console.error(getExpiredSessionTip());
      await browser.close();
      const error = new Error("session 已过期，请执行 npm run sync:login 后重试");
      error.code = "SESSION_EXPIRED";
      throw error;
    }
    context = await browser.newContext({
      storageState: SESSION_PATH,
      ignoreHTTPSErrors: true,
    });
  } else if (FOSU_SYNC_AUTH_MODE === "manual-cookie") {
    if (!process.env.FOSU_MANUAL_COOKIE) {
      console.error("❌ 选择了 manual-cookie 模式，但未配置本地会话凭据。");
      await browser.close();
      const error = new Error("manual-cookie 模式缺少本地会话配置");
      error.code = "SESSION_EXPIRED";
      throw error;
    }
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    // 注入浏览器会话凭据
    const cookies = parseCookieString(process.env.FOSU_MANUAL_COOKIE, FOSU_BASE_URL);
    await context.addCookies(cookies);
    console.log(`已从本地配置注入 ${cookies.length} 个会话凭据项至浏览器上下文。`);
  } else {
    console.error(`❌ 未知的登录模式: ${FOSU_SYNC_AUTH_MODE}`);
    await browser.close();
    const error = new Error(`未知的登录模式: ${FOSU_SYNC_AUTH_MODE}`);
    error.code = "UNKNOWN_AUTH_MODE";
    throw error;
  }

  return { browser, context };
}

/**
 * 获取会话过期的自适应友好提示语
 */
function getExpiredSessionTip() {
  const invocationCwd = path.resolve(process.env.INIT_CWD || process.cwd());
  const isProjectRoot = invocationCwd === PROJECT_ROOT;
  const rootPackageJson = path.join(PROJECT_ROOT, "package.json");
  const hasRootLoginScript = (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync(rootPackageJson, "utf-8"));
      return Boolean(pkg.scripts && pkg.scripts["sync:login"]);
    } catch (error) {
      return false;
    }
  })();
  const lines = [
    "session 已过期，请执行 npm run sync:login 后重试。"
  ];
  if (!isProjectRoot) {
    lines.push("你可能不在项目根目录，请先 cd 到 FosuClass 根目录。");
  }
  if (!hasRootLoginScript) {
    lines.push("当前根目录 package.json 未检测到 sync:login script，请补充后再重试。");
  }
  return lines.join("\n");
}

/**
 * 校验登录态是否仍然有效
 */
async function checkSession(page) {
  console.log("🔒 正在校验会话有效性...");
  try {
    await gotoPage(page, "/framework/xsMain.jsp", { waitUntil: "networkidle" });
  } catch (error) {
    console.error(`❌ 导航至教务页失败，可能未连内网或握手彻底失败: ${error.message}`);
    console.error(getExpiredSessionTip());
    return false;
  }
  
  const currentUrl = page.url();
  if (currentUrl.includes("authserver.fosu.edu.cn") || currentUrl.includes("login")) {
    console.error("❌ 会话已过期或无效！被重定向到了登录页面。");
    console.error(getExpiredSessionTip());
    return false;
  }
  
  const content = await page.content();
  if (content.includes("统一身份认证") || content.includes("密码登录")) {
    console.error("❌ 会话已过期！页面包含登录标识。");
    console.error(getExpiredSessionTip());
    return false;
  }
  
  console.log("🎉 会话有效，教务系统主页加载正常。");
  return true;
}

/**
 * 自动推断合理的当前学期
 */
function inferPreferredSemester() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 1 && month <= 8) {
    return `${year - 1}-${year}-2`;
  } else {
    return `${year}-${year}-1`;
  }
}

/**
 * 强制在页面选择指定学期并等待联动
 */
async function selectSemester(page, preferredSemester) {
  if (!preferredSemester) {
    return null;
  }
  
  console.log(`配置学期：${preferredSemester}`);

  // 在页面中寻找匹配的 select 和 option
  const selectResult = await page.evaluate((prefSem) => {
    const selects = Array.from(document.querySelectorAll("select"));
    for (let sIdx = 0; sIdx < selects.length; sIdx++) {
      const sel = selects[sIdx];
      const name = sel.getAttribute("name") || "";
      const id = sel.getAttribute("id") || "";
      
      for (let oIdx = 0; oIdx < sel.options.length; oIdx++) {
        const opt = sel.options[oIdx];
        const val = opt.value || "";
        const txt = opt.textContent || "";
        
        if (val.includes(prefSem) || txt.includes(prefSem)) {
          return {
            selectIndex: sIdx,
            selectName: name,
            selectId: id,
            optionValue: val,
            optionText: txt.trim()
          };
        }
      }
    }
    return null;
  }, preferredSemester);

  if (!selectResult) {
    // 打印教务系统的可选学期，以供调试
    const allSemOptions = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const debugInfo = [];
      selects.forEach((sel) => {
        const name = sel.getAttribute("name") || sel.getAttribute("id") || "unnamed";
        if (/xnxq/i.test(name)) {
          const opts = Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent.trim() }));
          debugInfo.push({ name, opts });
        }
      });
      return debugInfo;
    });
    
    console.error(`❌ 无法在教务系统中匹配到目标学期: ${preferredSemester}`);
    if (allSemOptions.length > 0) {
      console.error("教务系统中学期下拉框的可选值如下：");
      allSemOptions.forEach(sel => {
        sel.opts.forEach(opt => {
          console.error(`  - 值: ${opt.value}, 文本: ${opt.text}`);
        });
      });
    }
    throw new Error(`未找到匹配的学期: ${preferredSemester}`);
  }

  // 构造选择器
  let selector = "";
  if (selectResult.selectName) {
    selector = `select[name="${selectResult.selectName}"]`;
  } else if (selectResult.selectId) {
    selector = `select[id="${selectResult.selectId}"]`;
  } else {
    selector = `select:nth-of-type(${selectResult.selectIndex + 1})`;
  }

  console.log(`页面匹配学期：${selectResult.optionText}`);
  
  // 选择选项并等待
  await page.selectOption(selector, selectResult.optionValue);
  await page.waitForTimeout(1500); // 必须等待页面联动更新

  // 验证最终使用学期是否是要求的学期
  const finalValue = await page.$eval(selector, el => el.value);
  if (!finalValue.includes(preferredSemester)) {
    throw new Error(`选择学期后校验失败：最终选中的值 ${finalValue} 与期望值 ${preferredSemester} 不匹配！`);
  }

  console.log(`最终使用学期：${preferredSemester}`);
  return {
    value: selectResult.optionValue,
    label: selectResult.optionText
  };
}

/**
 * 提取学院名称的安全拼音/英文 Slug，供样本文件名使用
 */
function getCollegeSlug(collegeName) {
  const map = {
    "人文": "human",
    "传": "college",
    "动物": "animal",
    "动科": "animal",
    "生命": "life",
    "商": "business",
    "法": "law",
    "医": "medical",
    "工": "engineering",
    "理": "science",
    "材料": "materials",
    "电信": "telecom",
    "机电": "mechatronic",
    "计算机": "computer",
    "数学": "math",
    "物理": "physics",
    "化学": "chemistry",
    "环境": "env",
    "土木": "civil",
    "食品": "food",
    "设计": "design",
    "艺术": "art",
    "体育": "sports",
    "马克思": "marx",
    "国际": "intl",
    "继教": "continue"
  };
  
  let slug = "college";
  for (const [key, val] of Object.entries(map)) {
    if (collegeName.includes(key)) {
      slug = val;
      break;
    }
  }
  return slug;
}

let savedSampleCount = 0;

/**
 * 保存原始专业联动响应样本
 */
function saveMajorResponseSample(rawText, meta, parsedCount, emptyNameCount) {
  if (savedSampleCount >= 3) return;
  savedSampleCount++;

  const sampleDir = path.join(__dirname, ".debug", "major-response-samples");
  if (!fs.existsSync(sampleDir)) {
    fs.mkdirSync(sampleDir, { recursive: true });
  }

  const slug = getCollegeSlug(meta.collegeName);
  const safeName = `${meta.collegeCode}-${meta.grade}-${slug}-college`;
  const rawPath = path.join(sampleDir, `${safeName}.raw.txt`);
  const metaPath = path.join(sampleDir, `${safeName}.meta.json`);

  // 脱敏原始响应体：移除敏感 SessionID 或 Cookie 等
  let sanitizedRaw = rawText;
  sanitizedRaw = sanitizedRaw.replace(/JSESSIONID=[a-zA-Z0-9.\-_]+/gi, "JSESSIONID=REDACTED");
  sanitizedRaw = sanitizedRaw.replace(/cookie/gi, "REDACTED");

  fs.writeFileSync(rawPath, sanitizedRaw, "utf-8");

  const metaData = {
    collegeCode: meta.collegeCode,
    collegeName: meta.collegeName,
    grade: meta.grade,
    semester: meta.semester,
    requestUrl: meta.requestUrl,
    method: meta.method || "GET",
    status: meta.status || 200,
    contentType: meta.contentType || (rawText.trim().startsWith("<") ? "text/html" : "application/json"),
    rawLength: rawText.length,
    parsedCount,
    emptyNameCount
  };

  fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2), "utf-8");
  console.log(`💾 已保存原始响应样本及元数据至: ${rawPath}`);
}

/**
 * 从不同格式的专业联动响应中解析出专业列表
 */
function parseMajorOptionsFromResponse(raw, meta) {
  if (!raw) return [];
  const { collegeCode = "", collegeName = "", grade = "", semester = "", requestUrl = "" } = meta || {};
  const rawStr = String(raw).trim();
  const items = [];

  const formatItem = (codeVal, nameVal) => {
    const code = typeof codeVal === "string" ? codeVal.trim() : (codeVal ? String(codeVal).trim() : "");
    const name = typeof nameVal === "string" ? nameVal.trim() : (nameVal ? String(nameVal).trim() : "");
    if (!code && !name) return null;

    return {
      code,
      name,
      majorCode: code,
      majorName: name,
      rawLabel: name,
      collegeCode,
      collegeName,
      grade,
      semester
    };
  };

  // 1. 尝试 JSON 数组格式
  try {
    let parsed = null;
    if (rawStr.startsWith("[") || rawStr.startsWith("{")) {
      parsed = JSON.parse(rawStr);
    } else {
      // 提取中括号包裹的疑似 JSON 数组
      const jsonRegex = /\[\s*\{[\s\S]*\}\s*\]/;
      const match = rawStr.match(jsonRegex);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (e) {
          // 尝试宽容解析或 eval 提取
          try {
            parsed = eval(`(${match[0]})`);
          } catch (evalErr) {
            // ignore
          }
        }
      }
    }

    if (parsed) {
      const list = Array.isArray(parsed)
        ? parsed
        : (parsed.rows || parsed.data || parsed.list || parsed.majors || parsed.items) || [];
      if (Array.isArray(list)) {
        for (const item of list) {
          if (!item) continue;
          const codeVal = item.majorCode || item.code || item.value || item.id || item.dm || item.DM || item.zyh || item.ZYH || item.bh || item.BH;
          const nameVal = item.majorName || item.name || item.label || item.text || item.mc || item.MC || item.zymc || item.ZYMC || item.dmmc || item.DMMC || item.title;
          const formatted = formatItem(codeVal, nameVal);
          if (formatted) items.push(formatted);
        }
      }
    }
  } catch (jsonErr) {
    // ignore
  }

  // 2. 如果没有解析出 JSON，尝试 HTML Cheerio 解析
  if (items.length === 0) {
    try {
      const $ = cheerio.load(rawStr, { decodeEntities: false });
      $("option").each((_, el) => {
        const val = $(el).val() || $(el).attr("value") || "";
        const text = $(el).text().trim();
        // 跳过空值和请选择占位符
        if (val) {
          const formatted = formatItem(val, text);
          if (formatted) items.push(formatted);
        }
      });
    } catch (htmlErr) {
      // ignore
    }
  }

  // 3. 正则兜底解析 HTML option 格式
  if (items.length === 0) {
    const optionRegex = /<option\s+[^>]*value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
    let match;
    while ((match = optionRegex.exec(rawStr)) !== null) {
      const val = match[1];
      const text = match[2].replace(/<[^>]+>/g, "").trim();
      if (val) {
        const formatted = formatItem(val, text);
        if (formatted) items.push(formatted);
      }
    }
  }

  return items;
}

/**
 * 规范化单个专业数据项，识别需要丢弃的数据
 */
function normalizeMajorItem(item) {
  const majorCodeRaw = item.majorCode || item.code || item.value;
  const majorNameRaw = item.majorName || item.name || item.rawLabel || item.text || item.label;

  const majorName = typeof majorNameRaw === "string" ? majorNameRaw.trim() : (majorNameRaw ? String(majorNameRaw).trim() : "");
  let majorCode = typeof majorCodeRaw === "string" ? majorCodeRaw.trim() : (majorCodeRaw ? String(majorCodeRaw).trim() : "");

  if (!majorCode && !majorName) {
    return { status: "drop_empty", item };
  }
  if (!majorName) {
    return { status: "drop_empty", item };
  }

  const placeholders = ["请选择", "全部", "全部专业", "--请选择--", "请选择专业"];
  if (placeholders.includes(majorName)) {
    return { status: "drop_placeholder", item };
  }

  let generated = false;
  if (!majorCode) {
    majorCode = crypto.createHash("md5").update(majorName).digest("hex").substring(0, 8);
    generated = true;
  }

  return {
    status: "keep",
    generated,
    normalized: {
      code: majorCode,
      name: majorName,
      majorCode,
      majorName,
      collegeCode: item.collegeCode,
      grade: item.grade
    }
  };
}

/**
 * 批量清洗专业 Payload
 */
function cleanMajorsPayload(rawItems) {
  const cleaned = [];
  const droppedEmpty = [];
  const droppedPlaceholder = [];
  let generatedCount = 0;

  for (const item of rawItems) {
    const res = normalizeMajorItem(item);
    if (res.status === "keep") {
      cleaned.push(res.normalized);
      if (res.generated) {
        generatedCount++;
      }
    } else if (res.status === "drop_empty") {
      droppedEmpty.push(res.item);
    } else if (res.status === "drop_placeholder") {
      droppedPlaceholder.push(res.item);
    }
  }

  return {
    cleaned,
    droppedEmpty,
    droppedPlaceholder,
    generatedCount
  };
}

/**
 * 1. 同步 Catalog 基础选项数据
 */
async function syncCatalog(page) {
  console.log("\n=== [步骤 1] 开始抓取 Catalog ===");
  
  // 1. 访问行政班级课表页面获取基础 catalog
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });
  let html = await page.content();
  let $ = cheerio.load(html);

  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const semResult = await selectSemester(page, preferredSemester);

  // 重新获取选择学期后的页面内容
  html = await page.content();
  $ = cheerio.load(html);

  // 解析所有可选学期
  const semesters = [];
  $("select[name='xnxqh'] option").each((_, el) => {
    const val = $(el).attr("value");
    const text = $(el).text().trim();
    if (val) semesters.push({ value: val, label: text });
  });

  const matchedOption = semesters.find(s => s.value === semResult.value) || semResult;
  const reorderedSemesters = [
    matchedOption,
    ...semesters.filter(s => s.value !== matchedOption.value)
  ];

  // 使用 Map 管理学院列表，方便根据 code 去重
  const collegeMap = new Map();
  
  function addCollegesFromSelect(selectHtml) {
    const $select = cheerio.load(selectHtml);
    $select("select[name='skyx'] option").each((_, el) => {
      const val = $select(el).attr("value");
      const text = $select(el).text().trim();
      if (val && !text.includes("请选择") && !text.includes("全部")) {
        const cleanName = text.replace(/^\[[a-zA-Z0-9_-]+\]/, "").trim();
        if (!collegeMap.has(val)) {
          collegeMap.set(val, { code: val, name: cleanName, rawLabel: text });
        }
      }
    });
  }

  // 提取班级课表页面的学院
  addCollegesFromSelect(html);

  // 解析年级
  const grades = [];
  $("select[name='sknj'] option").each((_, el) => {
    const val = $(el).attr("value");
    const text = $(el).text().trim();
    if (val && /^\d{4}$/.test(val) && !text.includes("选择")) {
      grades.push(val);
    }
  });

  // 2. 依次访问教师课表、教室课表和课程课表以补充学院选项
  const extraPages = [
    { name: "教师课表", path: "/kbcx/kbxx_teacher" },
    { name: "教室课表", path: "/kbcx/kbxx_classroom" },
    { name: "课程课表", path: "/kbcx/kbxx_kc" }
  ];

  for (const item of extraPages) {
    try {
      console.log(`   正在访问 ${item.name} (${item.path}) 补充院系选项...`);
      await gotoPage(page, item.path, { waitUntil: "networkidle" });
      const pageHtml = await page.content();
      addCollegesFromSelect(pageHtml);
    } catch (e) {
      console.warn(`   ⚠️ 补充访问 ${item.name} 失败: ${e.message} (将忽略并继续)`);
    }
  }

  const colleges = Array.from(collegeMap.values());

  // 默认周次
  const weeks = Array.from({ length: 20 }, (_, i) => ({
    value: String(i + 1),
    label: `第${i + 1}周`,
  }));

  const catalogPayload = {
    colleges,
    semesters: reorderedSemesters,
    grades,
    weeks,
    sections: [],
  };

  console.log(`📊 抓取完毕: 学院 ${colleges.length} 个, 学期 ${reorderedSemesters.length} 个, 年级 ${grades.length} 个`);
  
  // 上传至 VPS
  await uploadToVps("/api/admin/sync/catalog", catalogPayload);
  
  // 本地保存一份
  fs.writeFileSync(path.join(__dirname, "last-catalog.json"), JSON.stringify(catalogPayload, null, 2), "utf-8");
  const catalogTerm = process.env.PREFERRED_SEMESTER || (catalogPayload.semesters && catalogPayload.semesters[0] && catalogPayload.semesters[0].value) || inferPreferredSemester();
  const catalogCacheDir = path.join(syncCacheStore.ensureTermCache(__dirname, catalogTerm), "catalog");
  syncCacheStore.writeJsonAtomic(path.join(catalogCacheDir, "catalog.json"), catalogPayload);
  syncCacheStore.writeJsonAtomic(path.join(catalogCacheDir, "metadata.json"), syncCacheStore.buildMetadata({
    term: catalogTerm,
    scope: "catalog",
    sourceMode: "network-direct",
    endpointFamily: "catalog",
    acquisition: "network",
    command: global.GENERATED_COMMAND || process.argv.join(" "),
    runId: getActiveSyncPlan() && getActiveSyncPlan().runId || "",
    itemCount: (catalogPayload.colleges || []).length,
    items: catalogPayload,
  }));
  console.log("💾 Catalog 临时数据已保存至本地 last-catalog.json");
  return catalogPayload;
}

/**
 * 2. 同步 Majors 专业映射数据
 */
/**
 * 动态年级过滤函数
 * @param {string} semester 学期，形如 "2025-2026-2" 或 "2025-2026学年第二学期"
 * @param {Object} options 过滤参数
 */
function getActiveGradesBySemester(semester, options = {}) {
  const { originalGrades = [], activeGradeCount = 5 } = options;
  const gradeRangeEnv = process.env.SYNC_GRADE_RANGE || 'active';
  const syncGradesEnv = process.env.SYNC_GRADES;
  const confirmFullSync = process.env.CONFIRM_FULL_SYNC === 'true';

  const match = semester.match(/^(\d{4})/);
  if (!match) {
    throw new Error(`无法从学期标识 "${semester}" 中提取学年起始年份，请检查学期格式。`);
  }
  const startYear = parseInt(match[1], 10);

  let targetGrades = [];

  if (gradeRangeEnv === 'active') {
    // 默认本科保守保留 activeGradeCount 个年级；sync:class 会传入 4，majors 仍保留 5。
    for (let i = activeGradeCount - 1; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  } else if (gradeRangeEnv === 'recent4') {
    // 只同步最近 4 个年级
    for (let i = 3; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  } else if (gradeRangeEnv === 'custom') {
    if (!syncGradesEnv) {
      throw new Error("检测到 SYNC_GRADE_RANGE=custom，但未设置 SYNC_GRADES 环境变量。");
    }
    targetGrades = syncGradesEnv.split(',').map(g => g.trim()).filter(Boolean);
  } else if (gradeRangeEnv === 'all') {
    if (!confirmFullSync) {
      console.error("❌ 检测到 SYNC_GRADE_RANGE=all，但未设置 CONFIRM_FULL_SYNC=true。为避免同步过多历史年级，已中止。");
      const error = new Error("SYNC_GRADE_RANGE=all requires CONFIRM_FULL_SYNC=true");
      error.code = "CONFIRM_FULL_SYNC_REQUIRED";
      throw error;
    }
    return originalGrades;
  } else {
    // 默认 active
    for (let i = activeGradeCount - 1; i >= 0; i--) {
      targetGrades.push(String(startYear - i));
    }
  }

  // 过滤出在教务系统原始年级中匹配的部分
  const matchedGrades = originalGrades.filter(g => targetGrades.includes(g));
  if (syncGradesEnv && matchedGrades.length === 0) {
    const requested = targetGrades.join(",");
    const error = new Error(`当前源站未发现 ${requested} 级课表`);
    error.code = "SOURCE_GRADE_NOT_FOUND";
    throw error;
  }
  return matchedGrades;
}

/**
 * 2. 同步 Majors 专业映射数据
 */
async function syncMajors(page, catalog) {
  console.log("\n=== [步骤 2] 开始抓取 Majors 专业联动 ===");
  if (!catalog) {
    if (fs.existsSync(path.join(__dirname, "last-catalog.json"))) {
      catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "last-catalog.json"), "utf-8"));
    } else {
      console.error("❌ 找不到 Catalog 数据，请先运行 sync:catalog");
      return;
    }
  }

  const { colleges, grades } = catalog;
  // 打开页面以确保联动操作可用
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });

  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const semResult = await selectSemester(page, preferredSemester);
  const activeSemester = preferredSemester;

  const startYear = parseInt(activeSemester.match(/^(\d{4})/)?.[1] || "2025", 10);
  const gradeRangeEnv = process.env.SYNC_GRADE_RANGE || 'active';

  // 过滤年级
  let filteredGrades = [];
  try {
    filteredGrades = getActiveGradesBySemester(activeSemester, { originalGrades: grades });
  } catch (err) {
    console.error(`❌ 年级过滤失败: ${err.message}`);
    err.code = err.code || "GRADE_FILTER_FAILED";
    throw err;
  }

  console.log(`当前学期：${activeSemester}`);
  console.log(`学年起始年份：${startYear}`);
  console.log(`年级过滤模式：${gradeRangeEnv}`);
  console.log(`本次同步年级：${filteredGrades.join(", ")}`);
  console.log(`原始年级数量：${grades.length}`);
  console.log(`过滤后年级数量：${filteredGrades.length}`);
  console.log(`本次联动请求数：${colleges.length} × ${filteredGrades.length} = ${colleges.length * filteredGrades.length}`);

  const allMajors = [];

  let count = 0;
  for (const college of colleges) {
    for (const grade of filteredGrades) {
      count++;
      console.log(`   [${count}/${colleges.length * filteredGrades.length}] 抓取中: ${college.name} - ${grade}级 ...`);
      
      let responseText = "";
      let success = false;
      let dropdownHtml = "";
      
      // 1. 优先使用 evaluate fetch
      try {
        responseText = await page.evaluate(async (params) => {
          const res = await fetch(`/kbcx/getZyByAjax?skyx=${params.collegeCode}&sknj=${params.grade}`);
          return res.text();
        }, { collegeCode: college.code, grade });
        success = true;
      } catch (ajaxErr) {
        console.warn(`      ⚠️  Ajax 抓取专业失败 (${ajaxErr.message})，尝试使用 DOM 联动 Fallback...`);
      }

      let majors = [];
      if (success && responseText) {
        try {
          majors = parseMajorOptionsFromResponse(responseText, {
            collegeCode: college.code,
            collegeName: college.name,
            grade,
            semester: activeSemester,
            requestUrl: `/kbcx/getZyByAjax?skyx=${college.code}&sknj=${grade}`
          });
        } catch (e) {
          console.warn(`      ⚠️  Ajax 响应解析失败: ${e.message}，将尝试 DOM Fallback...`);
          success = false;
        }
      }

      // 2. 如果 evaluate fetch 失败，采用页面级 DOM 操作联动
      if (!success || majors.length === 0) {
        try {
          // 选择学院
          await page.selectOption("select[name='skyx']", college.code);
          // 选择年级
          await page.selectOption("select[name='sknj']", grade);
          // 等待 DOM 反应
          await page.waitForTimeout(800);
          
          // 获取专业下拉框的 HTML 内容，然后用我们的通用 parser 解析
          dropdownHtml = await page.evaluate(() => {
            const sel = document.querySelector("select[name='skzy']");
            return sel ? sel.outerHTML : "";
          });

          if (dropdownHtml) {
            majors = parseMajorOptionsFromResponse(dropdownHtml, {
              collegeCode: college.code,
              collegeName: college.name,
              grade,
              semester: activeSemester,
              requestUrl: "DOM_SELECT_skzy"
            });
          }
        } catch (domErr) {
          console.error(`      ❌ DOM 联动 Fallback 也彻底失败: ${domErr.message}`);
        }
      }

      if (majors.length > 0) {
        const rawCount = majors.length;
        const emptyNameCount = majors.filter(m => !String(m.name || m.majorName || m.rawLabel || "").trim()).length;
        const validCount = rawCount - emptyNameCount;
        
        console.log(`      原始选项数：${rawCount}`);
        console.log(`      有效专业数：${validCount}`);
        console.log(`      空名称数：${emptyNameCount}`);

        if (emptyNameCount === rawCount) {
          console.warn(`      ⚠️ 严重警告：本次联动只解析到专业 code，没有解析到专业名称，请检查 parser 或 raw response 样本。`);
        }

        if (savedSampleCount < 3) {
          saveMajorResponseSample(
            responseText || dropdownHtml,
            {
              collegeCode: college.code,
              collegeName: college.name,
              grade,
              semester: activeSemester,
              requestUrl: responseText ? `/kbcx/getZyByAjax?skyx=${college.code}&sknj=${grade}` : "DOM_SELECT_skzy",
              method: responseText ? "GET" : "DOM_INTERACTION",
              status: 200,
              contentType: responseText ? (responseText.trim().startsWith("<") ? "text/html" : "application/json") : "text/html"
            },
            rawCount,
            emptyNameCount
          );
        }

        allMajors.push(...majors);
      } else {
        console.log(`      没有专业数据。`);
      }

      await sleep(300); // 适度延时保护教务系统
    }
  }

  console.log(`📊 专业联动抓取完毕，共整理出 ${allMajors.length} 个原始专业数据。`);
  
  // 1. 进行数据清洗
  const { cleaned, droppedEmpty, droppedPlaceholder, generatedCount } = cleanMajorsPayload(allMajors);
  const sampleDroppedItems = [...droppedEmpty, ...droppedPlaceholder].slice(0, 10);

  console.log("\n🧹 === [专业清洗数据统计] ===");
  console.log(`- rawMajorsCount: ${allMajors.length}`);
  console.log(`- cleanedMajorsCount: ${cleaned.length}`);
  console.log(`- droppedEmptyNameCount: ${droppedEmpty.length}`);
  console.log(`- droppedPlaceholderCount: ${droppedPlaceholder.length}`);
  console.log(`- generatedMajorCodeCount: ${generatedCount}`);
  console.log(`- sampleDroppedItems (前 10 条):`, JSON.stringify(sampleDroppedItems, null, 2));
  console.log("=============================\n");

  if (cleaned.length === 0) {
    console.error(`❌ 没有有效专业数据，已停止上传。`);
    console.error(`请检查：`);
    console.error(`1. 当前学期是否正确。`);
    console.error(`2. major-response-samples 中的 raw 响应格式。`);
    console.error(`3. parseMajorOptionsFromResponse 是否正确解析 option text / JSON name 字段。`);
    throw new Error("没有有效专业数据，已停止上传。");
  }

  // 2. 保存调试文件
  const debugDir = path.join(__dirname, ".debug");
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  fs.writeFileSync(path.join(debugDir, "last-majors-raw.json"), JSON.stringify(allMajors, null, 2), "utf-8");
  const debugUploadPath = path.join(debugDir, "last-majors-upload.json");
  fs.writeFileSync(debugUploadPath, JSON.stringify(cleaned, null, 2), "utf-8");
  
  // 3. 统计上传摘要数据
  const payloadStr = JSON.stringify(cleaned);
  const payloadSizeKB = (payloadStr.length / 1024).toFixed(2);
  
  const collegeCodes = new Set(cleaned.map(m => m.collegeCode));
  const majorGrades = new Set(cleaned.map(m => m.grade));
  
  // 统计每个学院的专业数以找出最大值
  const collegeMajorCounts = {};
  cleaned.forEach(m => {
    collegeMajorCounts[m.collegeCode] = (collegeMajorCounts[m.collegeCode] || 0) + 1;
  });
  const largestCollegeMajorCount = Math.max(...Object.values(collegeMajorCounts), 0);
  
  const hasEmptyCollegeCode = cleaned.some(m => !m.collegeCode);
  const hasEmptyMajorCode = cleaned.some(m => !m.code);
  
  // 重复 key 校验
  const seenKeys = new Set();
  let hasDuplicateKey = false;
  for (const m of cleaned) {
    const key = `${m.collegeCode}_${m.grade}_${m.code}`;
    if (seenKeys.has(key)) {
      hasDuplicateKey = true;
      break;
    }
    seenKeys.add(key);
  }
  
  console.log("\n📦 === [上传摘要] ===");
  console.log(`- collegesCount: ${collegeCodes.size}`);
  console.log(`- gradesCount: ${majorGrades.size}`);
  console.log(`- majorsCount: ${cleaned.length}`);
  console.log(`- payloadSizeKB: ${payloadSizeKB} KB`);
  console.log(`- semester: ${activeSemester}`);
  console.log(`- gradeRange: ${gradeRangeEnv}`);
  console.log(`- largestCollegeMajorCount: ${largestCollegeMajorCount}`);
  console.log(`- 是否存在空 collegeCode: ${hasEmptyCollegeCode ? "⚠️ 是" : "否"}`);
  console.log(`- 是否存在空 majorCode: ${hasEmptyMajorCode ? "⚠️ 是" : "否"}`);
  console.log(`- 是否存在重复 key: ${hasDuplicateKey ? "⚠️ 是" : "否"}`);
  console.log("=====================\n");

  // 4. 上传至 VPS 并做详细的错误捕捉
  try {
    await uploadToVps("/api/admin/sync/majors", cleaned);
  } catch (err) {
    console.error(`❌ Majors 数据同步至 VPS 失败！`);
    if (err.response) {
      console.error(`- status: ${err.response.status}`);
      console.error(`- response body: ${JSON.stringify(err.response.data)}`);
    } else {
      console.error(`- error message: ${err.message}`);
    }
    console.error(`- request payload size: ${payloadSizeKB} KB`);
    console.error(`- 本地调试文件路径: ${debugUploadPath}`);
    throw err;
  }
  
  fs.writeFileSync(path.join(__dirname, "last-majors.json"), JSON.stringify(cleaned, null, 2), "utf-8");
  const majorsTerm = process.env.PREFERRED_SEMESTER || (catalog && catalog.semesters && catalog.semesters[0] && catalog.semesters[0].value) || inferPreferredSemester();
  const majorsCacheDir = path.join(syncCacheStore.ensureTermCache(__dirname, majorsTerm), "catalog");
  syncCacheStore.writeJsonAtomic(path.join(majorsCacheDir, "majors.json"), cleaned);
  syncCacheStore.writeJsonAtomic(path.join(majorsCacheDir, "majors.metadata.json"), syncCacheStore.buildMetadata({
    term: majorsTerm,
    scope: "majors",
    sourceMode: "network-direct",
    endpointFamily: "major-catalog",
    acquisition: "network",
    command: global.GENERATED_COMMAND || process.argv.join(" "),
    runId: getActiveSyncPlan() && getActiveSyncPlan().runId || "",
    itemCount: cleaned.length,
    items: cleaned,
  }));
  console.log("💾 Majors 临时数据已保存至本地 last-majors.json");
  return cleaned;
}

/**
 * 3. 同步 Class Schedules 班级课表
 */
/**
 * 获取当前登录学生的班级名称
 */
async function getCurrentStudentClass(page) {
  console.log("🔍 正在定位当前登录学生的班级信息...");
  try {
    await gotoPage(page, "/xskb/xskb_list.do", { waitUntil: "networkidle" });
    const htmlText = await page.content();
    const $ = cheerio.load(htmlText);
    
    const bodyText = $("body").text();
    let className = "";
    
    // 匹配类似 "班级：[123456] 动物医学2023级1班" 或 "行政班级：动物医学221"
    const match = bodyText.match(/(?:行政)?班级[：:]\s*(?:\[\d+\])?\s*([^\s[\]#]+)/i);
    if (match) {
      className = match[1].trim();
      console.log(`🎉 成功识别当前登录学生班级: ${className}`);
      return className;
    }

    // 备选 DOM 遍历
    $("td, th, span, div").each((_, el) => {
      const text = $(el).text().trim();
      if (text.includes("班级：") || text.includes("行政班级：") || text.includes("班级:")) {
        const m = text.match(/(?:行政)?班级[：:]\s*(?:\[\d+\])?\s*([^\s[\]#]+)/i);
        if (m) {
          className = m[1].trim();
        }
      }
    });

    if (className) {
      console.log(`🎉 从页面 DOM 匹配当前登录学生班级: ${className}`);
      return className;
    }
    
    console.warn("⚠️ 个人课表页面中未提取到明确班级文本。");
    return "";
  } catch (error) {
    console.error(`⚠️ 抓取当前学生班级出错: ${error.message}`);
    return "";
  }
}

/**
 * 3. 同步 Class Schedules 班级课表
 */
async function syncClassSchedules(page, catalog, majors) {
  console.log("\n=== [步骤 3] 开始抓取班级课表 Class Schedules ===");
  if (!catalog) {
    if (fs.existsSync(path.join(__dirname, "last-catalog.json"))) {
      catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "last-catalog.json"), "utf-8"));
    } else {
      console.error("❌ 找不到 Catalog 数据，请先运行 sync:catalog");
      return;
    }
  }

  if (!majors) {
    if (fs.existsSync(path.join(__dirname, "last-majors.json"))) {
      majors = JSON.parse(fs.readFileSync(path.join(__dirname, "last-majors.json"), "utf-8"));
    } else {
      console.error("❌ 找不到 Majors 数据，请先运行 sync:majors");
      return;
    }
  }

  const debugDir = path.join(__dirname, ".debug");
  const rawPagesDir = path.join(debugDir, "raw-pages");
  if (!fs.existsSync(rawPagesDir)) {
    fs.mkdirSync(rawPagesDir, { recursive: true });
  }

  // 默认使用最新学期
  const relayTermConfig = global.RELAY_TERM_CONFIG || {};
  const activeSemester = String((global.CLI_PARAMS || {}).term || (global.CLI_PARAMS || {}).semester || process.env.PREFERRED_SEMESTER || relayTermConfig.term || "").trim();
  if (!activeSemester) {
    throw new Error("Missing target term. Pass --term=YYYY-YYYY-1 or set PREFERRED_SEMESTER before crawling class schedules.");
  }
  global.TERM_CONFIG = global.TERM_CONFIG || await assertTermConfigBeforeCrawl(activeSemester, global.CLI_PARAMS || {});
  console.log(`📅 抓取学期: ${activeSemester}`);

  const cliParams = global.CLI_PARAMS || {};
  const forceRefresh = Boolean(cliParams.forceRefresh || cliParams["force-refresh"] || cliParams.fresh);
  const ignoreProgress = forceRefresh || Boolean(cliParams.ignoreProgress || cliParams["ignore-progress"]);
  const ignoreNoScheduleCache = forceRefresh || Boolean(cliParams.ignoreNoScheduleCache || cliParams["ignore-no-schedule-cache"]);
  const clearProgress = Boolean(cliParams.clearProgress || cliParams["clear-progress"]);
  const clearNoScheduleCache = Boolean(cliParams.clearNoScheduleCache || cliParams["clear-no-schedule-cache"]);
  const crawlMode = cliParams.crawlMode || (forceRefresh ? "full-fresh" : (cliParams.recheckNoSchedule || cliParams["recheck-no-schedule"] ? "revalidate" : "incremental"));
  if (crawlMode === "full-fresh") {
    console.log("🧭 本次为 full-fresh 模式：忽略 progress、no-schedule cache 和历史 classSchedules 缓存。");
  } else if (crawlMode === "revalidate") {
    console.log("🧭 本次为 revalidate 模式：重新校验无排课专业，不按 no-schedule cache 跳过。");
  } else {
    console.log("🧭 本次为 incremental 模式：允许使用本地进度与 no-schedule cache。");
  }

  const syncPlan = getActiveSyncPlan();
  const runId = syncPlan && syncPlan.runId || cliParams.freshRunId || cliParams["fresh-run-id"] || `class-${Date.now()}`;
  const PROGRESS_PATH = isPlanNetworkOnly()
    ? syncCacheStore.progressPath(__dirname, activeSemester, "class", runId)
    : path.join(debugDir, "sync-progress.json");
  const PROGRESS_CLASS_SCHEDULES_PATH = PROGRESS_PATH.replace(/\.json$/i, ".classSchedules.json");
  if ((clearProgress || forceRefresh) && fs.existsSync(PROGRESS_PATH)) {
    fs.unlinkSync(PROGRESS_PATH);
    console.log(`🧹 已清理本地同步进度文件: ${PROGRESS_PATH}`);
  }

  if ((clearProgress || forceRefresh) && fs.existsSync(PROGRESS_CLASS_SCHEDULES_PATH)) {
    fs.unlinkSync(PROGRESS_CLASS_SCHEDULES_PATH);
  }

  let progress = { completed: [] };
  if (!ignoreProgress && fs.existsSync(PROGRESS_PATH)) {
    try {
      progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
      console.log(`ℹ️ 加载到本地同步进度，已完成 ${progress.completed.length} 个专业。`);
    } catch (e) {
      console.warn("⚠️ 读取断点进度失败，将全新抓取");
    }
  } else if (ignoreProgress) {
    console.log("ℹ️ 已忽略本地同步进度缓存，本轮会重新判断目标专业。");
  }

  // 定位当前学生班级
  const currentStudentClass = await getCurrentStudentClass(page);
  if (currentStudentClass) {
    console.log(`ℹ️ 当前登录学生班级仅用于诊断参考: ${currentStudentClass}`);
  }

  const collegeNameByCode = new Map((catalog.colleges || []).map((college) => [String(college.code), college.name]));
  const noScheduleCacheRunId = syncPlan && syncPlan.negativeCachePolicy === "use" ? "" : runId;
  const noScheduleCachePath = isPlanNetworkOnly()
    ? syncCacheStore.negativePath(__dirname, activeSemester, "class-schedule", noScheduleCacheRunId)
    : path.join(debugDir, "no-schedule-majors.json");
  const classNameCandidatesPath = path.join(debugDir, "class-name-candidates.json");
  let noScheduleMajors = readJsonArray(noScheduleCachePath);
  if ((clearNoScheduleCache || forceRefresh) && noScheduleMajors.length > 0) {
    const before = noScheduleMajors.length;
    noScheduleMajors = noScheduleMajors.filter((item) => item && item.semester !== activeSemester);
    writeJsonFile(noScheduleCachePath, noScheduleMajors);
    console.log(`🧹 已清理本学期无排课缓存: ${before - noScheduleMajors.length} 条 (${activeSemester})。`);
  }
  let classNameCandidateRecords = readJsonArray(classNameCandidatesPath);
  const skipNoScheduleCache = getEnvFlag("SYNC_SKIP_NO_SCHEDULE_CACHE", true) && !ignoreNoScheduleCache;
  const recheckNoSchedule = getEnvFlag("SYNC_RECHECK_NO_SCHEDULE", false);
  const cachedNoScheduleKeys = new Set(
    skipNoScheduleCache && !recheckNoSchedule ? noScheduleMajors
      .filter((item) => item && item.semester === activeSemester)
      .map((item) => getMajorIdentityKey({
        collegeCode: item.collegeCode,
        grade: item.grade,
        code: item.majorCode,
      }, item.semester)) : []
  );
  const cachedNoScheduleByKey = new Map(
    skipNoScheduleCache && !recheckNoSchedule ? noScheduleMajors
      .filter((item) => item && item.semester === activeSemester)
      .map((item) => [getMajorIdentityKey({
        collegeCode: item.collegeCode,
        grade: item.grade,
        code: item.majorCode,
      }, item.semester), item]) : []
  );

  // 解析环境变量过滤条件
  const syncCollegeCodes = process.env.SYNC_CLASS_COLLEGE_CODES ? process.env.SYNC_CLASS_COLLEGE_CODES.split(",").map(c => c.trim()).filter(Boolean) : null;
  const syncGrades = process.env.SYNC_CLASS_GRADES ? process.env.SYNC_CLASS_GRADES.split(",").map(g => g.trim()).filter(Boolean) : null;
  const syncMajorCodes = process.env.SYNC_CLASS_MAJOR_CODES ? process.env.SYNC_CLASS_MAJOR_CODES.split(",").map(m => m.trim()).filter(Boolean) : null;
  const isFiltered = !!(syncCollegeCodes || syncGrades || syncMajorCodes);

  const includeScopes = global.CLI_PARAMS?.includeScopes || ALL_SCOPES;
  const syncClassScope = global.CLI_PARAMS?.classScope || process.env.SYNC_CLASS_SCOPE || "";

  // 拦截防误爬空跑：如果勾选了行政班课表且不是精准过滤，且未设 all
  if (includeScopes.includes("classSchedules")) {
    if (!isFiltered && syncClassScope !== "all") {
      const errMsg = `❌ 运行终止：当前 includeScopes 包含行政班课表，但未设置 SYNC_CLASS_SCOPE=all 或 --class-scope=all，且没有精准过滤条件。请使用后台同步中心生成的完整命令。`;
      console.error(errMsg);
      throw new Error(errMsg);
    }
  }

  if (isFiltered) {
    console.log("ℹ️ 课表同步已启用环境变量限制过滤：");
    if (syncCollegeCodes) console.log(`   - 学院限制: ${syncCollegeCodes.join(", ")}`);
    if (syncGrades) console.log(`   - 年级限制: ${syncGrades.join(", ")}`);
    if (syncMajorCodes) console.log(`   - 专业代码限制: ${syncMajorCodes.join(", ")}`);
  } else {
    console.log("ℹ️ 课表同步未设置环境变量限制。默认仅同步当前学年起最近 5 个在校活跃年级，并启用限速。");
  }

  if (skipNoScheduleCache && !recheckNoSchedule) {
    console.log(`ℹ️ 已启用无排课缓存跳过策略，本学期缓存命中候选 ${cachedNoScheduleKeys.size} 个。`);
  } else if (recheckNoSchedule) {
    console.log("ℹ️ SYNC_RECHECK_NO_SCHEDULE=true，将重新检查此前确认无排课的专业。");
  }


  const isFiveYearMajor = (name) => {
    const n = name || "";
    return n.includes("动物医学") || n.includes("建筑学") || n.includes("临床医学") || n.includes("医学");
  };

  // 筛选出目标专业
  const targetMajors = majors.filter(major => {
    // 1. 如果指定了 collegeCodes 限制且当前 major 不在其中，过滤掉
    if (syncCollegeCodes && !syncCollegeCodes.includes(major.collegeCode)) {
      return false;
    }
    // 2. 如果指定了 grades 限制且当前 major 不在其中，过滤掉
    if (syncGrades && !syncGrades.includes(major.grade)) {
      const includeFiveYear = getEnvFlag("SYNC_INCLUDE_FIVE_YEAR", true);
      const isFiveYear = isFiveYearMajor(major.name || major.majorName);
      if (includeFiveYear && isFiveYear && major.grade === "2021") {
        // 允许抓取五年制专业的2021级
      } else {
        return false;
      }
    }
    // 3. 如果指定了 majorCodes 限制且当前 major 不在其中，过滤掉
    if (syncMajorCodes && !syncMajorCodes.includes(major.code)) {
      return false;
    }

    // 4. 如果没有指定任何精准过滤限制
    if (!isFiltered) {
      if (syncClassScope !== "all") {
        return false;
      }

      let activeGrades = [];
      try {
        activeGrades = getActiveGradesBySemester(activeSemester, { originalGrades: catalog.grades, activeGradeCount: 5 });
      } catch (e) {
        // 兜底：如果报错，则默认只同步最近 5 个年级
        const currentYear = new Date().getFullYear();
        for (let i = 4; i >= 0; i--) {
          activeGrades.push(String(currentYear - i));
        }
      }
      if (!activeGrades.includes(major.grade)) {
        return false;
      }
    }

    return true;
  });

  if (!isFiltered && syncClassScope !== "all") {
    console.log("⚠️ 未检测到精准同步环境变量限制 (SYNC_CLASS_COLLEGE_CODES 等)，且未显式设置 SYNC_CLASS_SCOPE=all。跳过全校同步。");
  }

  console.log(`🎯 匹配的目标专业总计: ${targetMajors.length} 个。`);

  const newestTargetGrade = getNewestGrade(targetMajors);
  const effectiveTargetMajors = targetMajors.filter((major) => {
    if (!skipNoScheduleCache || recheckNoSchedule) {
      return true;
    }
    const key = getMajorIdentityKey(major, activeSemester);
    const cachedNoSchedule = cachedNoScheduleByKey.get(key);
    if (cachedNoScheduleKeys.has(key) && canReuseNoScheduleCache(cachedNoSchedule, major, newestTargetGrade)) {
      console.log(`   跳过已确认无排课专业: ${major.grade}级 - ${major.name} (${major.code})`);
      return false;
    }
    return true;
  });

  if (effectiveTargetMajors.length !== targetMajors.length) {
    console.log(`⏭️ 已按无排课缓存跳过 ${targetMajors.length - effectiveTargetMajors.length} 个专业，本轮实际待判断 ${effectiveTargetMajors.length} 个。`);
  }

  // 剔除已完成部分
  const pendingMajors = effectiveTargetMajors.filter(major => !hasCompletedMajor(progress, major, activeSemester));
  const completedProgressCount = effectiveTargetMajors.length - pendingMajors.length;
  const skipNoScheduleCount = targetMajors.length - effectiveTargetMajors.length;
  let cachedClassSchedules = [];
  const crawlStats = {
    crawlMode,
    usedProgressCache: !ignoreProgress && completedProgressCount > 0,
    usedNoScheduleCache: skipNoScheduleCache && !recheckNoSchedule && skipNoScheduleCount > 0,
    usedClassScheduleCache: false,
    actualNetworkRequestCount: 0,
    skippedByProgressCount: completedProgressCount,
    skippedByNoScheduleCount: skipNoScheduleCount,
    freshRunId: runId,
    requestedTargetCount: pendingMajors.length,
    succeededTargetCount: 0,
    failedTargetCount: 0,
    failedTargets: [],
  };
  global.SYNC_CRAWL_STATS = crawlStats;
  global.CLASS_SCHEDULE_CACHE_USAGE = {
    usedClassScheduleCache: false,
    cacheSource: null,
    cacheWarning: null,
  };

  if (!forceRefresh && (completedProgressCount > 0 || pendingMajors.length === 0)) {
    let cache = null;
    if (completedProgressCount > 0 && fs.existsSync(PROGRESS_CLASS_SCHEDULES_PATH)) {
      try {
        const progressPayload = JSON.parse(fs.readFileSync(PROGRESS_CLASS_SCHEDULES_PATH, "utf-8"));
        const progressItems = Array.isArray(progressPayload.items) ? progressPayload.items : [];
        cache = { items: progressItems, filePath: PROGRESS_CLASS_SCHEDULES_PATH };
      } catch (error) {
        cache = { items: [], filePath: PROGRESS_CLASS_SCHEDULES_PATH, error };
      }
    }
    if ((!cache || !cache.items || cache.items.length === 0) && completedProgressCount > 0) {
      const detail = cache && cache.error ? ` (${cache.error.message})` : "";
      throw new Error(`Progress cache exists but partial classSchedules are missing for ${completedProgressCount} completed target(s)${detail}. Use --clear-progress to restart safely.`);
    }
    if (!cache || !cache.items || cache.items.length === 0) {
      cache = readClassScheduleCacheForSemester(activeSemester);
    }
    if (cache.items && cache.items.length > 0) {
      cachedClassSchedules = cache.items;
      const isCurrentRunProgress = cache.filePath === PROGRESS_CLASS_SCHEDULES_PATH;
      crawlStats.usedClassScheduleCache = !isCurrentRunProgress;
      crawlStats.resumedFromRunProgress = isCurrentRunProgress;
      crawlStats.progressCacheRunId = isCurrentRunProgress ? runId : "";
      global.SYNC_CRAWL_STATS = crawlStats;
      global.CLASS_SCHEDULE_CACHE_USAGE = {
        usedClassScheduleCache: !isCurrentRunProgress,
        cacheSource: cache.filePath,
        cacheWarning: `本轮有 ${completedProgressCount} 个专业被 progress 跳过，已从历史 classSchedules 缓存恢复 ${cachedClassSchedules.length} 条课表。`,
      };
      console.log(`♻️ 已从历史缓存恢复 ${cachedClassSchedules.length} 条 classSchedules: ${cache.filePath}`);
    } else if (completedProgressCount > 0) {
      const detail = cache.error ? ` (${cache.error.message})` : "";
      throw new Error(`本地进度缓存与结果缓存不一致：${completedProgressCount} 个专业将被 progress 跳过，但没有可用于构建 Staging 的历史 classSchedules${detail}。请使用 --force-refresh 或 --clear-progress 重新抓取。`);
    }
  }

  console.log(`🔄 本轮待同步专业: ${pendingMajors.length} 个。`);

  if (pendingMajors.length === 0) {
    if (cachedClassSchedules.length > 0) {
      console.log("ℹ️ 本轮没有待抓取专业，直接使用历史 classSchedules 缓存构建 Staging。");
      return cachedClassSchedules;
    }

    if (completedProgressCount > 0 && skipNoScheduleCount > 0) {
      throw new Error("本地进度缓存与结果缓存不一致：所有专业都被 progress/no-schedule cache 跳过，但没有可用于构建 Staging 的历史 classSchedules。请使用 --force-refresh 或 --clear-progress 重新抓取。");
    }

    throw new Error("本轮待同步专业为 0，且没有可用于构建 Staging 的历史 classSchedules。请使用 --force-refresh 重新抓取，或检查 --grades/--college-codes/--major-codes 过滤条件。");
  }

  // 打开行政班级课表页面以确保 Ajax 环境可用
  await gotoPage(page, "/kbcx/kbxx_xzb", { waitUntil: "networkidle" });

  let totalCoursesFetched = 0;
  let totalDedupledCount = 0;
  let totalGroupedCount = 0;
  let newNoScheduleCount = 0;

  let allClassSchedules = cachedClassSchedules.slice();
  const classCrawlConcurrency = getClassCrawlConcurrency();
  console.log(`⚙️ 班级课表抓取并发: ${classCrawlConcurrency}，待抓取 ${pendingMajors.length} 个专业。`);
  if (classCrawlConcurrency > 1) {
    console.log("ℹ️ 将按批次并发发起教务网请求；本地进度在每个批次结束后落盘，失败专业仍可 resume。");
  }

  async function crawlMajorClassSchedule(major, sequence) {
    const startedAt = Date.now();
    console.log(`   [${sequence}/${pendingMajors.length}] 正在抓取: ${major.grade}级 - ${major.name} 专业课表 ...`);

    // 页面内 POST 请求课表 HTML
    const htmlText = await page.evaluate(async (params) => {
        const formBody = new URLSearchParams({
          xnxqh: params.semester,
          skyx: params.collegeCode,
          sknj: params.grade,
          skzy: params.majorCode,
          zc1: "",
          zc2: "",
          jc1: "",
          jc2: "",
        }).toString();

        const res = await fetch("/kbcx/kbxx_xzb_ifr", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formBody,
        });
        return res.text();
      }, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        grade: major.grade,
        majorCode: major.code,
      });

    // 保存 raw HTML 到本地，便于调试且不提交到 git
    const rawHtmlPath = path.join(rawPagesDir, `class_${major.grade}_${major.code}.html`);
    fs.writeFileSync(rawHtmlPath, htmlText, "utf-8");

    const candidateResult = parser.extractClassNameCandidates(htmlText, {
      semester: activeSemester,
      collegeCode: major.collegeCode,
      grade: major.grade,
      majorCode: major.code,
      majorName: major.name,
    });
    const candidateRecord = {
      semester: activeSemester,
      collegeCode: major.collegeCode,
      collegeName: collegeNameByCode.get(String(major.collegeCode)) || major.collegeName || "",
      grade: major.grade,
      majorCode: major.code,
      majorName: major.name,
      rawHtmlPath,
      classNames: candidateResult.classNames || [],
      candidates: (candidateResult.candidates || []).slice(0, 80),
      checkedAt: new Date().toISOString(),
    };

    // 解析课表 HTML
    const parsed = parser.parseClassScheduleIfrHtml(htmlText, {
      semester: activeSemester,
      collegeCode: major.collegeCode,
      grade: major.grade,
      majorCode: major.code,
      majorName: major.name,
    });

    // 规范化课表
    const courses = normalizer.normalizeCourseList(parsed.courses || [], {
      semester: activeSemester,
      sourceType: "class",
      audienceType: "student",
    });

    let dedupedDiff = 0;
    let groupedCoursesNum = 0;
    if (courses.length > 0) {
      const seenKeys = new Set();
      const uniqueCourses = courses.filter(c => {
        const key = [
          c.courseName || "",
          c.weekday || "",
          c.startSection || "",
          c.endSection || "",
          c.startWeek || "",
          c.endWeek || "",
          c.teacherName || "",
          c.classroom || "",
        ].join("_");
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });
      dedupedDiff = courses.length - uniqueCourses.length;

      const groupMap = {};
      uniqueCourses.forEach(c => {
        const key = [
          c.courseName || "",
          c.weekday || "",
          c.startSection || "",
          c.endSection || "",
          c.startWeek || "",
          c.endWeek || "",
        ].join("_");
        groupMap[key] = (groupMap[key] || 0) + 1;
      });
      Object.keys(groupMap).forEach(key => {
        if (groupMap[key] > 1) {
          groupedCoursesNum++;
        }
      });
    }

    let noScheduleRecord = null;
    let classes = [];
    if (courses.length === 0) {
      noScheduleRecord = {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        collegeName: collegeNameByCode.get(String(major.collegeCode)) || major.collegeName || "",
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name,
        checkedAt: new Date().toISOString(),
      };
    } else {
      // 按可靠行政班名分组；无法识别行政班时降级为专业聚合课表，不丢弃课程。
      classes = normalizer.buildClassScheduleEntries(courses, {
        semester: activeSemester,
        collegeCode: major.collegeCode,
        collegeName: collegeNameByCode.get(String(major.collegeCode)) || major.collegeName || "",
        grade: major.grade,
        majorCode: major.code,
        majorName: major.name,
      });
    }

    return {
      major,
      sequence,
      candidateRecord,
      courses,
      dedupedDiff,
      groupedCoursesNum,
      noScheduleRecord,
      classes,
      elapsedMs: Date.now() - startedAt,
    };
  }

  for (let batchStart = 0; batchStart < pendingMajors.length; batchStart += classCrawlConcurrency) {
    const batch = pendingMajors.slice(batchStart, batchStart + classCrawlConcurrency);
    const batchNumber = Math.floor(batchStart / classCrawlConcurrency) + 1;
    const totalBatches = Math.ceil(pendingMajors.length / classCrawlConcurrency);
    const batchStartedAt = Date.now();
    crawlStats.actualNetworkRequestCount += batch.length;
    global.SYNC_CRAWL_STATS = crawlStats;

    const batchResults = await Promise.all(batch.map((major, offset) => {
      const sequence = batchStart + offset + 1;
      return crawlMajorClassSchedule(major, sequence)
        .then((value) => ({ ok: true, value }))
        .catch((error) => ({ ok: false, major, sequence, error }));
    }));

    let candidateChanged = false;
    let noScheduleChanged = false;
    let progressChanged = false;
    let successCount = 0;

    for (const item of batchResults) {
      if (!item.ok) {
        console.error(`      ⚠️  [${item.sequence}/${pendingMajors.length}] 抓取失败: ${item.error.message}`);
        continue;
      }

      const result = item.value;
      const major = result.major;
      const candidateNames = result.candidateRecord.classNames || [];
      classNameCandidateRecords = upsertClassNameCandidateRecord(classNameCandidateRecords, result.candidateRecord);
      candidateChanged = true;
      console.log(`      [${result.sequence}/${pendingMajors.length}] 班级文本候选: ${candidateNames.join(", ") || "未发现"} (${formatElapsedMs(result.elapsedMs)})`);

      totalCoursesFetched += result.courses.length;
      totalDedupledCount += result.dedupedDiff;
      totalGroupedCount += result.groupedCoursesNum;

      if (result.noScheduleRecord) {
        newNoScheduleCount++;
        noScheduleMajors = upsertNoScheduleMajor(noScheduleMajors, result.noScheduleRecord);
        noScheduleChanged = true;
        console.log(`      [${result.sequence}/${pendingMajors.length}] 没有排课数据，已记录到 ${noScheduleCachePath}`);
      } else {
        const beforeNoScheduleCount = noScheduleMajors.length;
        noScheduleMajors = removeNoScheduleMajor(noScheduleMajors, major, activeSemester);
        if (noScheduleMajors.length !== beforeNoScheduleCount) {
          noScheduleChanged = true;
          console.log(`      [${result.sequence}/${pendingMajors.length}] 此前无排课缓存已失效，本次抓到课程并已移除缓存记录。`);
        }

        if (result.classes.length > 0) {
          const aggregateCount = result.classes.filter((classItem) => classItem.isAggregated).length;
          const classCount = result.classes.length - aggregateCount;
          console.log(`      [${result.sequence}/${pendingMajors.length}] 整理课表条目: 行政班 ${classCount} 个，专业聚合 ${aggregateCount} 个 (${result.classes.map(c => c.className).join(", ")})`);
          allClassSchedules = mergeClassSchedules(allClassSchedules, result.classes);
        }
      }

      markCompletedMajor(progress, major, activeSemester);
      progressChanged = true;
      successCount++;
    }

    if (candidateChanged) {
      writeJsonFile(classNameCandidatesPath, classNameCandidateRecords);
    }
    if (noScheduleChanged) {
      writeJsonFile(noScheduleCachePath, noScheduleMajors);
    }
    if (progressChanged) {
      writeJsonFile(PROGRESS_PATH, progress);
      writeJsonFile(PROGRESS_CLASS_SCHEDULES_PATH, {
        term: activeSemester,
        runId,
        updatedAt: new Date().toISOString(),
        completedCount: progress.completed.length,
        items: allClassSchedules,
      });
      crawlStats.succeededTargetCount += successCount;
      global.SYNC_CRAWL_STATS = crawlStats;
    }

    console.log(`   ✅ 批次 ${batchNumber}/${totalBatches} 完成: 成功 ${successCount}, 失败 ${batch.length - successCount}, 累计课表 ${allClassSchedules.length}, 用时 ${formatElapsedMs(Date.now() - batchStartedAt)}。`);

    // 批次间限流：并发请求只在批内发生，批间仍保留延迟保护教务系统。
    if (batchStart + classCrawlConcurrency < pendingMajors.length) {
      await waitBetweenClassSyncRequests(isFiltered);
    }
  }

  console.log(`📊 班级课表抓取完毕，共整理出 ${allClassSchedules.length} 个行政班级的课表。`);

  const unfinishedTargets = effectiveTargetMajors.filter((major) => !hasCompletedMajor(progress, major, activeSemester));
  if (unfinishedTargets.length > 0) {
    crawlStats.failedTargetCount = Math.max(crawlStats.failedTargetCount || 0, unfinishedTargets.length);
    crawlStats.failedTargets = unfinishedTargets.map((major) => ({
      collegeCode: major.collegeCode,
      grade: major.grade,
      majorCode: major.code,
      majorName: major.name,
    }));
    global.SYNC_CRAWL_STATS = crawlStats;
    if (!((global.CLI_PARAMS || {}).allowPartial || (global.CLI_PARAMS || {})["allow-partial"])) {
      throw new Error(`CLASS_SCHEDULE_PARTIAL_FAILURE: ${unfinishedTargets.length} target(s) did not finish. Use --allow-partial only for diagnostic snapshots.`);
    }
  }

  if (allClassSchedules.length > 0) {
    // 无论后续上传成功与否，强制在上传前保存完整全量文件
    const { latestPath } = saveFullClassSchedules(allClassSchedules, activeSemester);

    // 写入 manifest：.debug/class-schedules-manifest.json
    const manifestPath = path.join(debugDir, "class-schedules-manifest.json");
    let checksum = "";
    try {
      const fileContent = fs.readFileSync(latestPath, "utf-8");
      checksum = crypto.createHash("md5").update(fileContent).digest("hex");
    } catch (e) {
      console.warn(`⚠️ 计算 class-schedules-latest.json 的 checksum 失败: ${e.message}`);
    }

    let syncClientVersion = "1.0.0";
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));
      syncClientVersion = pkg.version || "1.0.0";
    } catch (e) {}

    const adminClassCount = allClassSchedules.filter(
      (item) => item.displayType === "class-schedule" && !item.isAggregated
    ).length;
    const majorAggregateCount = allClassSchedules.length - adminClassCount;

    const manifestData = {
      semester: activeSemester,
      grades: syncGrades || (catalog.grades || []),
      crawledAt: new Date().toISOString(),
      source: "100.fosu.edu.cn",
      classScheduleCount: allClassSchedules.length,
      adminClassCount,
      majorAggregateCount,
      checksum,
      syncClientVersion
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), "utf-8");
    console.log(`💾 班级课表抓取清单已保存至: ${manifestPath}`);

    // 如果设置了 crawl-only 模式，则仅抓取并保存本地，不执行上传
    if (getEnvFlag("SYNC_CLASS_CRAWL_ONLY", false)) {
      console.log(`\n🎉 [Crawl Only] 抓取完成！`);
      console.log(`📁 完整课表数据已保存至: ${latestPath}`);
      console.log(`📊 共抓取班级课表数量 (itemCount): ${allClassSchedules.length} 条`);
      printPowerShellCommands();
      return allClassSchedules;
    }

    try {
      // 传入最新保存的文件路径，作为断点续传进度的 sourceFilePath
      await uploadClassSchedulesInChunks(allClassSchedules, debugDir, latestPath, activeSemester);
      console.log(`✅ 本轮抓取的班级课表数据同步完成！`);
    } catch (uploadError) {
      console.error(`❌ 同步至 VPS 失败：${uploadError.message}`);
      console.error(`⚠️ 完整课表数据已保存至 .debug/class-schedules-latest.json，可稍后执行 upload-only 继续上传。`);
      printPowerShellCommands();
      throw uploadError;
    }
  } else {
    console.log("ℹ️ 本轮没有新抓取到任何班级课表，无需上传。");
  }

  const finalAggregateCount = allClassSchedules.filter((item) => item.isAggregated).length;
  const finalClassCount = allClassSchedules.length - finalAggregateCount;
  const finalTotalSkipCount = skipNoScheduleCount + newNoScheduleCount;

  console.log("\n================ [同步任务总结报告] ================");
  console.log(`- 行政班数量: ${finalClassCount} 个`);
  console.log(`- 专业共享课表数量: ${finalAggregateCount} 个`);
  console.log(`- 课程总数: ${totalCoursesFetched} 门`);
  console.log(`- 重复课程去重数量: ${totalDedupledCount} 门`);
  console.log(`- 分组课程数量: ${totalGroupedCount} 组`);
  console.log(`- 跳过无课表专业数量: ${finalTotalSkipCount} 个 (其中缓存跳过 ${skipNoScheduleCount}，本次新确认 ${newNoScheduleCount})`);
  console.log(`- 真实请求教务网专业数: ${crawlStats.actualNetworkRequestCount}`);
  console.log(`- 使用 progress: ${crawlStats.usedProgressCache ? "是" : "否"}，使用 no-schedule cache: ${crawlStats.usedNoScheduleCache ? "是" : "否"}，合并旧课表: ${crawlStats.usedClassScheduleCache ? "是" : "否"}`);
  console.log("==================================================\n");

  // 如果全部都已同步完成，重置进度文件
  const allEffectiveTargetsDone = effectiveTargetMajors.every((major) => hasCompletedMajor(progress, major, activeSemester));
  if (allEffectiveTargetsDone) {
    try {
      fs.unlinkSync(PROGRESS_PATH);
      if (fs.existsSync(PROGRESS_CLASS_SCHEDULES_PATH)) {
        fs.unlinkSync(PROGRESS_CLASS_SCHEDULES_PATH);
      }
      console.log("🎉 所有目标专业已同步完成，进度已重置。");
    } catch (e) {}
  }

  return allClassSchedules;
}

/**
 * 预检同步环境与代理状态
 */
function runPreflight() {
  console.log("\n================ [Preflight 预检环境配置] ================");
  console.log(`- .env path: ${envPath}`);
  console.log(`- FOSU_API_BASE: ${process.env.FOSU_API_BASE || "https://class.katelya.eu.org"}`);
  console.log(`- PREFERRED_SEMESTER: ${process.env.PREFERRED_SEMESTER || "未配置"}`);
  
  const syncClassGrades = process.env.SYNC_CLASS_GRADES || "未配置";
  const syncGrades = process.env.SYNC_GRADES || "未配置";
  console.log(`- SYNC_CLASS_GRADES (班级课表同步使用): ${syncClassGrades}`);
  console.log(`- SYNC_GRADES (专业同步使用): ${syncGrades}`);
  
  const tokenExists = Boolean(process.env.ADMIN_API_TOKEN);
  console.log(`- ADMIN_API_TOKEN: ${tokenExists ? "已配置" : "❌ 未配置！(可能会导致 VPS 校验失败)"}`);

  if (INITIAL_DETECTED_PROXIES.length > 0) {
    console.warn(`⚠️ 检测到代理环境变量:`);
    INITIAL_DETECTED_PROXIES.forEach(([name]) => {
      console.warn(`   - ${name}=[redacted]`);
    });
  } else {
    console.log("- 代理环境变量: 未检测到");
  }

  const disableProxy = directNetworkEnv.disableProxy;
  console.log(`- SYNC_DISABLE_PROXY: ${disableProxy}`);
  if (disableProxy) {
    console.log("ℹ️ 已启用强制禁用代理配置。所有上传阶段将强制不使用代理。");
  }
  console.log("========================================================\n");
}

/**
 * 输出最终同步任务总结报告
 */
function printFinalSyncSummary(catalog, majors, allClassSchedules, resources, verifyRes) {
  const preferredSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
  const classScheduleCount = allClassSchedules ? allClassSchedules.length : 0;
  const adminClassCount = allClassSchedules ? allClassSchedules.filter(
    (item) => item.displayType === "class-schedule" && !item.isAggregated
  ).length : 0;
  const majorAggregateCount = classScheduleCount - adminClassCount;

  const teacherScheduleCount = (resources && resources.teacherSchedules) ? resources.teacherSchedules.length : 0;
  const classroomScheduleCount = (resources && resources.classroomSchedules) ? resources.classroomSchedules.length : 0;
  const courseScheduleCount = (resources && resources.courseSchedules) ? resources.courseSchedules.length : 0;

  const snapshotVersion = verifyRes?.status?.snapshotVersion || verifyRes?.releaseStatus?.activeReleaseVersion || "未知";
  const bootstrapDataSource = verifyRes?.bootstrap?.dataSource || "未知";
  const isActivated = verifyRes?.bootstrap?.success ? "已成功发布并激活" : "❌ 未确认激活成功";
  const clientDataVersion = verifyRes?.bootstrap?.version || verifyRes?.status?.snapshotVersion || "未知";

  console.log("\n=================== [一键同步任务总结报告] ===================");
  console.log(`- 当前学期 (preferredSemester): ${preferredSemester}`);
  console.log(`- catalog 学院数量: ${catalog && catalog.colleges ? catalog.colleges.length : 0} 个`);
  console.log(`- majors 专业数量: ${majors ? majors.length : 0} 个`);
  console.log(`- classScheduleCount (班级课表数): ${classScheduleCount} 条`);
  console.log(`- adminClassCount (行政班数量): ${adminClassCount} 个`);
  console.log(`- majorAggregateCount (专业共享数量): ${majorAggregateCount} 个`);
  console.log(`- teacherScheduleCount (教师课表数): ${teacherScheduleCount} 条`);
  console.log(`- classroomScheduleCount (教室课表数): ${classroomScheduleCount} 条`);
  console.log(`- courseScheduleCount (课程课表数): ${courseScheduleCount} 条`);
  console.log(`- snapshotVersion (线上快照版本): ${snapshotVersion}`);
  console.log(`- bootstrap dataSource (最终数据源): ${bootstrapDataSource}`);
  console.log(`- 发布状态: ${isActivated}`);
  console.log(`- 小程序应看到的数据版本 (clientDataVersion): ${clientDataVersion}`);
  console.log("============================================================\n");
}

/**
 * 处理一键完整同步 (sync:fresh)
 */
async function handleFreshSync(page) {
  console.log("\n================ [开始执行一键完整同步 (sync:fresh)] ================");

  // 1. 同步 catalog 并上传 VPS
  const catalog = await syncCatalog(page);

  // 2. 同步 majors 并上传 VPS
  const majors = await syncMajors(page, catalog);

  // 3. 同步 class 课表并上传 VPS
  delete process.env.SYNC_CLASS_CRAWL_ONLY; 
  const allClassSchedules = await syncClassSchedules(page, catalog, majors);
  if (!allClassSchedules || allClassSchedules.length === 0) {
    throw new Error("一键完整同步抓取班级课表结果为空，同步中断！");
  }

  // 4. 派生资源维度数据并上传 VPS
  console.log("\n[sync:fresh] 正在基于新抓取的班级课表派生资源维度...");
  const resources = await handleResourcesSync(["teacher", "classroom", "course"], { page });

  // 5. 离线发布与激活
  console.log("\n[sync:fresh] 正在以离线发布模式 (SYNC_RELEASE_OFFLINE=true) 生成发布并激活线上快照...");
  process.env.SYNC_RELEASE_OFFLINE = "true";
  await handleOfflineRelease();

  // 6. 校验线上接口
  console.log("\n[sync:fresh] 同步动作已完成，开始校验线上端点...");
  let verifyRes = null;
  try {
    verifyRes = await verifyEndpoints();
  } catch (err) {
    console.error(`⚠️ 校验线上接口出现异常: ${err.message}`);
  }

  // 7. 打印报告
  printFinalSyncSummary(catalog, majors, allClassSchedules, resources, verifyRes);
}

/**
 * 处理一键快速同步 (sync:quick)
 */
async function handleQuickSync(page) {
  console.log("\n================ [开始执行一键快速同步 (sync:quick)] ================");

  // 1. 从历史缓存中加载 catalog 和 majors
  const catalogPath = path.join(__dirname, "last-catalog.json");
  const majorsPath = path.join(__dirname, "last-majors.json");
  if (!fs.existsSync(catalogPath) || !fs.existsSync(majorsPath)) {
    throw new Error("没有找到本地 catalog 或 majors 历史缓存！请先运行一次 npm run sync:fresh。");
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const majors = JSON.parse(fs.readFileSync(majorsPath, "utf-8"));

  // 2. 重新抓取班级课表并上传 VPS
  delete process.env.SYNC_CLASS_CRAWL_ONLY;
  const allClassSchedules = await syncClassSchedules(page, catalog, majors);
  if (!allClassSchedules || allClassSchedules.length === 0) {
    throw new Error("快速同步抓取班级课表结果为空，同步中断！");
  }

  // 3. 派生资源维度数据并上传 VPS
  console.log("\n[sync:quick] 正在基于新抓取的班级课表派生资源维度...");
  const resources = await handleResourcesSync(["teacher", "classroom", "course"], { page });

  // 4. 离线发布与激活
  console.log("\n[sync:quick] 正在以离线发布模式 (SYNC_RELEASE_OFFLINE=true) 生成发布并激活线上快照...");
  process.env.SYNC_RELEASE_OFFLINE = "true";
  await handleOfflineRelease();

  // 5. 校验线上接口
  console.log("\n[sync:quick] 同步动作已完成，开始校验线上端点...");
  let verifyRes = null;
  try {
    verifyRes = await verifyEndpoints();
  } catch (err) {
    console.error(`⚠️ 校验线上接口出现异常: ${err.message}`);
  }

  // 6. 打印报告
  printFinalSyncSummary(catalog, majors, allClassSchedules, resources, verifyRes);
}

/**
 * 主程序入口
 */
async function main() {
  const args = process.argv.slice(2);
  let action = "all";
  const params = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const match = arg.match(/^--([^=]+)=(.*)$/);
      if (match) {
        params[match[1]] = match[2];
      } else {
        const flagMatch = arg.match(/^--([^=]+)$/);
        if (flagMatch) {
          params[flagMatch[1]] = true;
        }
      }
    } else if (!arg.startsWith("-")) {
      action = arg;
    }
  }

  // 还原真实执行指令
  const parsed = parseCliArgs(args);
  const inputParams = Object.assign({}, params, parsed.params || {});
  if (inputParams.grade && !inputParams.grades) inputParams.grades = inputParams.grade;
  if (inputParams.full === true || inputParams.full === "true") {
    inputParams["catalog-policy"] = inputParams["catalog-policy"] || "network-only";
    inputParams["schedule-policy"] = inputParams["schedule-policy"] || "network-only";
    inputParams["progress-policy"] = inputParams["progress-policy"] || "ignore";
    inputParams["negative-cache-policy"] = inputParams["negative-cache-policy"] || "revalidate";
    inputParams["force-refresh"] = true;
  }
  if (inputParams.incremental === true || inputParams.incremental === "true") {
    inputParams["catalog-policy"] = inputParams["catalog-policy"] || "reuse-validated";
    inputParams["schedule-policy"] = inputParams["schedule-policy"] || "network-only";
    inputParams["progress-policy"] = inputParams["progress-policy"] || "resume";
    inputParams["negative-cache-policy"] = inputParams["negative-cache-policy"] || "use";
  }
  const syncPlan = buildSyncPlan(parsed.action || action, inputParams, process.env);
  Object.assign(params, inputParams, applyPlanToParams(syncPlan, inputParams));
  action = parsed.action || action;
  if (action === "resume" && !params.term) {
    const resumeTerm = findTermByRunId(params["run-id"] || params.runId);
    if (resumeTerm) {
      params.term = resumeTerm;
      syncPlan.term = resumeTerm;
      syncPlan.termValid = true;
    }
  }
  global.SYNC_PLAN = syncPlan;
  printSyncPlan(syncPlan);

  global.GENERATED_COMMAND = `node sync.js ${action} ${args.join(" ")}`;
  params.fresh = Boolean(params.fresh || params["fresh"]);
  params.recheckNoSchedule = Boolean(params["recheck-no-schedule"] || params.recheckNoSchedule);
  params.forceResourceCrawl = Boolean(params["force-resource-crawl"] || params.forceResourceCrawl);
  params.resourceSource = params["resource-source"] || params.resourceSource || "derived";
  params.forceRefresh = Boolean(params["force-refresh"] || params.forceRefresh || params.fresh);
  params.ignoreProgress = Boolean(params["ignore-progress"] || params.ignoreProgress || params.forceRefresh);
  params.ignoreNoScheduleCache = Boolean(params["ignore-no-schedule-cache"] || params.ignoreNoScheduleCache || params.forceRefresh);
  params.clearProgress = Boolean(params["clear-progress"] || params.clearProgress);
  params.clearNoScheduleCache = Boolean(params["clear-no-schedule-cache"] || params.clearNoScheduleCache);
  params.classScope = params["class-scope"] || params.classScope || "";
  params.crawlMode = params["crawl-mode"] || params.crawlMode || (
    params.fresh ? "full-fresh" : (params.forceResourceCrawl ? "resource-fresh" : (params.recheckNoSchedule ? "revalidate" : "incremental"))
  );
  params.freshRunId = params["fresh-run-id"] || params.freshRunId || (params.fresh ? `fresh-${Date.now()}-${crypto.randomBytes(4).toString("hex")}` : "");
  if (params.crawlMode === "full-fresh") {
    console.log("🧭 本次为 full-fresh 模式");
  }

  // 将 CLI 参数映射到环境变量
  if (params.term) {
    process.env.PREFERRED_SEMESTER = params.term;
  }
  if (params.start) {
    process.env.SYNC_TERM_START_DATE = params.start;
  }
  if (params["term-start-date"]) {
    process.env.SYNC_TERM_START_DATE = params["term-start-date"];
  }
  if (params.include) {
    process.env.SYNC_INCLUDE_SCOPES = params.include;
  }
  if (params["class-scope"]) {
    process.env.SYNC_CLASS_SCOPE = params["class-scope"];
  }
  if (params.grades) {
    process.env.SYNC_CLASS_GRADES = params.grades;
    process.env.SYNC_GRADES = params.grades;
    if (!process.env.SYNC_GRADE_RANGE) {
      process.env.SYNC_GRADE_RANGE = "custom";
    }
  }
  if (params["college-codes"]) {
    process.env.SYNC_CLASS_COLLEGE_CODES = params["college-codes"];
  }
  if (params["major-codes"]) {
    process.env.SYNC_CLASS_MAJOR_CODES = params["major-codes"];
  }
  if (params.concurrency) {
    process.env.SYNC_RESOURCE_MAX_CONCURRENCY = params.concurrency;
    process.env.SYNC_CLASS_MAX_CONCURRENCY = params.concurrency;
  }
  if (params["delay-ms"]) {
    process.env.SYNC_RESOURCE_REQUEST_DELAY_MS = params["delay-ms"];
    process.env.SYNC_CLASS_REQUEST_DELAY_MS = params["delay-ms"];
  }
  if (params.forceRefresh || params.ignoreNoScheduleCache) {
    process.env.SYNC_SKIP_NO_SCHEDULE_CACHE = "false";
  }
  if (params.recheckNoSchedule) {
    process.env.SYNC_RECHECK_NO_SCHEDULE = "true";
  }
  if (params.forceResourceCrawl) {
    process.env.SYNC_FORCE_RESOURCE_CRAWL = "true";
  }
  if (params.resourceSource) {
    process.env.SYNC_RESOURCE_SOURCE = params.resourceSource;
  }
  if (params["crawl-only"]) {
    process.env.SYNC_CLASS_CRAWL_ONLY = "true";
  }
  if (params["upload-only"]) {
    process.env.SYNC_CLASS_UPLOAD_ONLY = "true";
  }
  if (params.verbose) {
    process.env.SYNC_VERBOSE = "true";
  }

  const includeStr = params.include || process.env.SYNC_INCLUDE_SCOPES || "";
  const includeScopes = includeStr ? includeStr.split(",").map(x => x.trim()).filter(Boolean) : ALL_SCOPES;
  params.includeScopes = includeScopes;
  
  global.CLI_PARAMS = params;
  const requiresTermConfigBeforeCrawl = [
    "fresh", "quick", "local-campus", "class", "release", "all",
    "daily", "daily:classes", "daily:teachers", "daily:classrooms", "daily:courses",
    "scopes", "new-term", "crawl:daily", "crawl:scopes", "resume",
  ].includes(action);
  if (requiresTermConfigBeforeCrawl) {
    const activeSemester = process.env.PREFERRED_SEMESTER || inferPreferredSemester();
    global.TERM_CONFIG = await assertTermConfigBeforeCrawl(activeSemester, params);
    console.log("[term-config] resolved");
    console.log(`- term: ${global.TERM_CONFIG.term}`);
    console.log(`- semesterText: ${global.TERM_CONFIG.semesterText}`);
    console.log(`- termStartDate: ${global.TERM_CONFIG.termStartDate}`);
    console.log(`- totalWeeks: ${global.TERM_CONFIG.totalWeeks}`);
    console.log(`- source: ${global.TERM_CONFIG.source}`);
  }

  if (params["dry-run"] || params["dry_run"]) {
    process.env.SYNC_RELEASE_DRY_RUN = "true";
  }
  if (params.publish === "false" || params.publish === false) {
    process.env.SYNC_RELEASE_DRY_RUN = "true";
  }

  // 如果是一键同步任务，则强制执行环境预检
  if (requiresTermConfigBeforeCrawl) {
    runPreflight();
  }

  // 1. 拦截并处理 upload-only 模式，免去网络诊断和浏览器初始化
  const uploadOnlyMode = getEnvFlag("SYNC_CLASS_UPLOAD_ONLY", false);
  if (uploadOnlyMode || action === "upload-cache") {
    console.log("ℹ️ 将直接执行本地课表缓存上传，不重新打开浏览器抓取。");
    await handleUploadOnly();
    return;
  }

  if (action === "local-upload" || action === "upload-staging") {
    await handleLocalStagingUpload(params);
    return;
  }

  if (action === "resume" && !params["run-id"] && !params.runId) {
    throw new Error("SYNC_RESUME_REQUIRES_RUN_ID");
  }

  // 1.5. 拦截并处理离线 release 模式
  const offlineMode = getEnvFlag("SYNC_RELEASE_OFFLINE", false);
  if (action === "release" && offlineMode) {
    await handleOfflineRelease();
    return;
  }

  const resourceActionTypes = getResourceTypesForAction(action);
  if (resourceActionTypes.length && !shouldUseDirectTeacherResources(resourceActionTypes)) {
    await handleResourcesSync(resourceActionTypes);
    return;
  }

  // 2. 网络连接检测
  if (process.env.FOSU_SKIP_CAMPUS_NETWORK_CHECK === "1") {
    console.log("ℹ️ Publisher 已完成校园网检查，本次抓取跳过重复 diagnose。");
  } else {
    const network = await probeCampusNetwork({ env: process.env });
    printDiagnosisSummary(network);
    if (network.readiness === "blocked") {
      if (action === "release") {
        console.warn("⚠️ 本地网络未通过校园网/VPN诊断！无法在线抓取数据。");
        console.log("💡 提示: 检测到当前非校园网环境，你可以使用离线模式直接打包本地已抓取的缓存发布快照：");
        console.log("   PowerShell 命令: $env:SYNC_RELEASE_OFFLINE=\"true\"; npm run sync:release");
      } else {
        console.error("❌ 本地网络未通过校园网/VPN诊断，中止同步任务！");
        printPowerShellCommands();
      }
      const error = new Error((network.blockers || []).join("; ") || "CAMPUS_NETWORK_BLOCKED");
      error.code = "CAMPUS_NETWORK_BLOCKED";
      throw error;
    }
  }

  // 3. 初始化 Playwright 并启动
  let browser = null;
  let context = null;
  let page = null;
  ({ browser, context } = await initBrowserContext());
  page = await context.newPage();

  try {
    // 4. 校验 Session 状态
    const isSessionOk = await checkSession(page);
    if (!isSessionOk) {
      const error = new Error("session 已过期，请执行 npm run sync:login 后重试");
      error.code = "SESSION_EXPIRED";
      throw error;
    }

    if (action === "check-session") {
      console.log("SESSION_VALID");
      return;
    }

    let catalog, majors;

    if (action === "catalog") {
      await syncCatalog(page);
    } else if (action === "majors") {
      await syncMajors(page);
    } else if (action === "class") {
      await syncClassSchedules(page);
    } else if (action === "fresh") {
      await handleFreshSync(page);
    } else if (action === "quick") {
      await handleQuickSync(page);
    } else if (action === "local-campus") {
      await handleLocalCampusStaging(page, params);
    } else if ([
      "daily",
      "daily:classes",
      "daily:teachers",
      "daily:classrooms",
      "daily:courses",
      "scopes",
      "new-term",
      "crawl:daily",
      "crawl:scopes",
      "resume",
    ].includes(action)) {
      await handlePlannedSync(page, params);
    } else if (resourceActionTypes.length) {
      await handleResourcesSync(resourceActionTypes, { page });
    } else if (action === "release") {
      // 暴力快照发布默认环境变量配置
      if (!process.env.SYNC_CLASS_GRADES) {
        process.env.SYNC_CLASS_GRADES = "2025,2024,2023,2022";
      }
      if (process.env.SYNC_INCLUDE_FIVE_YEAR === undefined) {
        process.env.SYNC_INCLUDE_FIVE_YEAR = "true";
      }
      if (process.env.SYNC_SKIP_NO_SCHEDULE_CACHE === undefined) {
        process.env.SYNC_SKIP_NO_SCHEDULE_CACHE = "true";
      }
      if (process.env.SYNC_RECHECK_NO_SCHEDULE === undefined) {
        process.env.SYNC_RECHECK_NO_SCHEDULE = "false";
      }
      if (process.env.SYNC_CLASS_SCOPE === undefined) {
        process.env.SYNC_CLASS_SCOPE = "all";
      }

      catalog = await syncCatalog(page);
      majors = await syncMajors(page, catalog);
      process.env.SYNC_CLASS_CRAWL_ONLY = "true";
      const allClassSchedules = await syncClassSchedules(page, catalog, majors);
      if (!allClassSchedules || allClassSchedules.length === 0) {
        throw new Error("没有抓取到任何班级课表，快照发布中断");
      }
      const includeReleaseResources = getEnvFlag("SYNC_RELEASE_INCLUDE_RESOURCES", true);
      const releaseResourceTypes = includeReleaseResources ? ["teacher", "classroom", "course"] : [];
      const releaseResources = includeReleaseResources
        ? await buildResourcesForClassSchedules(allClassSchedules, releaseResourceTypes, {
            page,
            semester: process.env.PREFERRED_SEMESTER || inferPreferredSemester(),
          })
        : null;
      const snapshot = buildSnapshot(catalog, majors, allClassSchedules, releaseResources, {
        resources: {
          includeTeachers: includeReleaseResources,
          includeClassrooms: includeReleaseResources,
          includeCourses: includeReleaseResources,
          includeTeacherSchedules: includeReleaseResources,
          includeClassroomSchedules: includeReleaseResources,
          includeCourseSchedules: includeReleaseResources,
        },
      });
      const zlib = require("zlib");
      const snapshotJson = JSON.stringify(snapshot, null, 2);
      const snapshotBuffer = Buffer.from(snapshotJson, "utf-8");
      const compressedBuffer = zlib.gzipSync(snapshotBuffer);
      const debugDir = path.join(__dirname, ".debug");
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const normalizeReport = writeSnapshotDebugFiles(debugDir, snapshot, compressedBuffer);
      console.log(`\n💾 本地快照已生成并压缩：.debug/snapshot-latest.json 和 .debug/snapshot-latest.json.gz (体积: ${(compressedBuffer.length / 1024).toFixed(2)} KB)`);
      validateLocalReleaseSnapshot(snapshot);
      if (getEnvFlag("SYNC_RELEASE_DRY_RUN", false)) {
        printReleaseSummary(snapshot, { dryRun: true }, { version: snapshot.version }, null);
        const report = {
          success: true,
          dryRun: true,
          version: snapshot.version,
          semester: snapshot.semester,
          updatedAt: snapshot.updatedAt,
          coverage: snapshot.coverage,
          normalizeReport,
          uploadSize: compressedBuffer.length,
        };
        fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
        console.log("ℹ️ SYNC_RELEASE_DRY_RUN=true，已完成本地 release 构建与校验，未上传或激活 VPS。");
        return;
      }
      const uploadRes = await uploadSnapshot(compressedBuffer);
      const activateRes = await activateSnapshot(snapshot.version);
      console.log(`✅ 快照激活成功! 响应: ${JSON.stringify(activateRes)}`);
      const verifyRes = await verifyEndpoints();
      printReleaseSummary(snapshot, uploadRes, activateRes, verifyRes);
      const report = {
        success: true,
        version: snapshot.version,
        semester: snapshot.semester,
        updatedAt: snapshot.updatedAt,
        coverage: snapshot.coverage,
        normalizeReport,
        uploadSize: compressedBuffer.length,
        serverStatus: verifyRes,
      };
      fs.writeFileSync(path.join(debugDir, "sync-report-latest.json"), JSON.stringify(report, null, 2), "utf-8");
      console.log(`💾 总结报告已保存至 .debug/sync-report-latest.json`);
      console.log("\n🎉 [Release] 全校课表暴力快照发布成功！");
    } else if (action === "all") {
      catalog = await syncCatalog(page);
      majors = await syncMajors(page, catalog);
      await syncClassSchedules(page, catalog, majors);
      console.log("\n🎉 [同步大成功] 本地所有数据已全量同步至 VPS！");
    } else {
      console.error(`❌ 未知的同步参数: ${action}`);
      console.log("支持的参数: catalog | majors | class | resources | local-campus | local-upload | release | fresh | quick | all");
      const error = new Error(`UNKNOWN_SYNC_ACTION: ${action}`);
      error.code = "UNKNOWN_SYNC_ACTION";
      throw error;
    }

  } catch (error) {
    console.error(`❌ 执行同步时发生致命异常: ${error.message}`);
    console.error(error.stack);
    printPowerShellCommands();
    process.exitCode = 1;
    throw error;
  } finally {
    if (browser && typeof browser.close === "function") {
      await browser.close();
      console.log("浏览器已安全关闭。同步任务结束。");
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.exitCode = 1;
    if (!error || !error.__syncLogged) {
      console.error(JSON.stringify({
        success: false,
        code: error && error.code || "SYNC_FATAL",
        message: error && error.message || "unknown sync error",
      }, null, 2));
    }
  });
} else {
  module.exports = {
    selectSemester,
    getCollegeSlug,
    saveMajorResponseSample,
    parseMajorOptionsFromResponse,
    cleanMajorsPayload,
    normalizeMajorItem,
    resolveInputFilePath,
    resolveOutputFilePath,
    resolveProjectPath,
    getEffectiveResourceSourceMode,
    shouldUseDirectTeacherResources,
    buildResourcesForClassSchedules,
    crawlDirectTeacherResources,
    mergeResourcesBySource,
    getResourceTypesFromIncludeScopes,
    resolveTermConfig,
    assertTermConfigBeforeCrawl,
  };
}
