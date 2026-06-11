const fs = require("fs");
const path = require("path");

const releaseService = require("./releaseService");
const runtimePointerService = require("./runtimePointerService");
const staticReleaseSyncService = require("./staticReleaseSyncService");
const teachingCalendarService = require("./teachingCalendarService");
const termReadinessService = require("./termReadinessService");
const termRegistryService = require("./termRegistryService");
const termReleaseIndexService = require("./termReleaseIndexService");
const { safeLog } = require("../utils/safeLogger");
const {
  ensureDir,
  readFileBufferIfExists,
  readJsonFile,
  restoreFileBuffer,
} = require("../utils/jsonFileStore");

const REPAIR_TERM = "2025-2026-2";
const REPAIR_SOURCE_RELEASE = "2026-06-05T12-39-28";
const REPAIR_CONFIG = Object.freeze({
  term: REPAIR_TERM,
  semesterText: "2025-2026学年第二学期",
  termStartDate: "2026-03-09",
  weekStart: "monday",
  totalWeeks: 19,
});
const CURRENT_SNAPSHOT_PATH = path.join(termRegistryService.STORAGE_DIR, "snapshots", "current.json");
const CURRENT_SNAPSHOT_GZ_PATH = path.join(termRegistryService.STORAGE_DIR, "snapshots", "current.json.gz");

function nowIso() {
  return new Date().toISOString();
}

function generateRepairReleaseVersion(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-calendar-repair`;
}

function normalizeOptions(options = {}) {
  return {
    term: String(options.term || REPAIR_TERM).trim(),
    sourceReleaseVersion: String(options.sourceReleaseVersion || REPAIR_SOURCE_RELEASE).trim(),
    dryRun: options.dryRun !== false,
    activateAfterBuild: options.activateAfterBuild !== false,
    syncOpenResty: options.syncOpenResty !== false,
    releaseVersion: options.releaseVersion ? releaseService.normalizeVersion(options.releaseVersion) : "",
    now: options.now instanceof Date ? options.now : new Date(),
    job: options.job || null,
    hooks: options.hooks || {},
  };
}

function progress(job, value, message, data) {
  if (job && typeof job.progress === "function") {
    job.progress(value, message, data || {});
  }
}

function assertRepairTarget(term) {
  if (term !== REPAIR_TERM) {
    const error = new Error("SEMESTER_REPAIR_UNSUPPORTED_TERM");
    error.code = "SEMESTER_REPAIR_UNSUPPORTED_TERM";
    error.expectedTerm = REPAIR_TERM;
    error.term = term;
    throw error;
  }
}

function backupState() {
  return [
    termRegistryService.REGISTRY_PATH,
    termReleaseIndexService.TERM_INDEX_PATH,
    releaseService.ACTIVE_RELEASE_PATH,
    runtimePointerService.ACTIVE_RUNTIME_PATH,
    CURRENT_SNAPSHOT_PATH,
    CURRENT_SNAPSHOT_GZ_PATH,
  ].map((filePath) => ({
    filePath,
    buffer: readFileBufferIfExists(filePath),
  }));
}

function restoreState(state) {
  (state || []).slice().reverse().forEach((item) => {
    restoreFileBuffer(item.filePath, item.buffer);
  });
  termRegistryService.clearCache();
  termReleaseIndexService.clearCache();
  releaseService.clearDerivedCache();
  runtimePointerService.clearCache();
  teachingCalendarService.clearCache();
}

function readRequiredTermCalendar(term) {
  const filePath = teachingCalendarService.getTermCalendarPath(term);
  if (!fs.existsSync(filePath)) {
    const error = new Error("TEACHING_CALENDAR_FILE_MISSING");
    error.code = "TEACHING_CALENDAR_FILE_MISSING";
    error.filePath = filePath;
    throw error;
  }
  if (!readJsonFile(filePath, null)) {
    const error = new Error("TEACHING_CALENDAR_FILE_INVALID");
    error.code = "TEACHING_CALENDAR_FILE_INVALID";
    error.filePath = filePath;
    throw error;
  }
  return teachingCalendarService.readTermCalendar(term);
}

function readState(options) {
  const registry = termRegistryService.readRegistry();
  const termRecord = termRegistryService.getTerm(options.term);
  const activeRelease = releaseService.getActiveReleaseInfo();
  const termIndex = termReleaseIndexService.readIndex();
  const termRelease = termReleaseIndexService.getTermRelease(options.term);
  const runtimePointer = runtimePointerService.readActivePointer();
  const snapshot = releaseService.getActiveSnapshotData();
  const calendar = readRequiredTermCalendar(options.term);
  return {
    registry,
    termRecord,
    activeRelease,
    activeReleaseVersion: activeRelease && (activeRelease.releaseVersion || activeRelease.version) || "",
    termIndex,
    termRelease,
    runtimePointer,
    snapshot,
    calendar,
  };
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function parseDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    return null;
  }
  return date;
}

function formatDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function validateCalendarShape(calendar) {
  const errors = [];
  if (!calendar) {
    errors.push("TEACHING_CALENDAR_REQUIRED");
  }
  if (calendar && calendar.term !== REPAIR_TERM) {
    errors.push("TEACHING_CALENDAR_TERM_MISMATCH");
  }
  if (calendar && calendar.termStartDate !== REPAIR_CONFIG.termStartDate) {
    errors.push("TEACHING_CALENDAR_START_MISMATCH");
  }
  if (calendar && calendar.weekStart !== REPAIR_CONFIG.weekStart) {
    errors.push("TEACHING_CALENDAR_WEEK_START_MISMATCH");
  }
  if (calendar && Number(calendar.totalWeeks || calendar.termConfig && calendar.termConfig.totalWeeks) !== REPAIR_CONFIG.totalWeeks) {
    errors.push("TEACHING_CALENDAR_TOTAL_WEEKS_MISMATCH");
  }
  const weeks = calendar && Array.isArray(calendar.weeks) ? calendar.weeks : [];
  if (weeks.length !== REPAIR_CONFIG.totalWeeks) {
    errors.push("TEACHING_CALENDAR_WEEKS_LENGTH_MISMATCH");
  }
  const start = parseDate(REPAIR_CONFIG.termStartDate);
  weeks.forEach((week, index) => {
    const weekNo = index + 1;
    if (Number(week && week.weekNo) !== weekNo) {
      errors.push(`TEACHING_CALENDAR_WEEK_NO_${weekNo}`);
    }
    if (start) {
      const expectedStart = formatDate(addDays(start, (weekNo - 1) * 7));
      const expectedEnd = formatDate(addDays(start, (weekNo - 1) * 7 + 6));
      if (week.startDate !== expectedStart || week.endDate !== expectedEnd) {
        errors.push(`TEACHING_CALENDAR_WEEK_RANGE_${weekNo}`);
      }
    }
  });
  [
    [1, "2026-03-09", "2026-03-15"],
    [14, "2026-06-08", "2026-06-14"],
    [19, "2026-07-13", "2026-07-19"],
  ].forEach(([weekNo, startDate, endDate]) => {
    const week = weeks[weekNo - 1] || {};
    if (week.startDate !== startDate || week.endDate !== endDate) {
      errors.push(`TEACHING_CALENDAR_ANCHOR_WEEK_${weekNo}`);
    }
  });
  if (errors.length) {
    const error = new Error(`TEACHING_CALENDAR_INVALID: ${errors.join("; ")}`);
    error.code = "TEACHING_CALENDAR_INVALID";
    error.errors = Array.from(new Set(errors));
    throw error;
  }
  return true;
}

function isAlreadyHealthy(state, options) {
  const readiness = termReadinessService.buildTermReadiness(options.term, options.sourceReleaseVersion, {
    autoRepairRuntimePointer: false,
    now: options.now,
  });
  const record = state.termRecord || {};
  const version = record.releaseVersion || "";
  if (!version || version === options.sourceReleaseVersion || version === REPAIR_SOURCE_RELEASE) {
    return { healthy: false, readiness };
  }
  const nextReadiness = termReadinessService.buildTermReadiness(options.term, version, {
    autoRepairRuntimePointer: false,
    now: options.now,
  });
  const calendarSummary = nextReadiness.calendarSummary || {};
  return {
    healthy: Boolean(
      nextReadiness.ready &&
      record.termStartDate === REPAIR_CONFIG.termStartDate &&
      record.weekStart === REPAIR_CONFIG.weekStart &&
      Number(record.totalWeeks) === REPAIR_CONFIG.totalWeeks &&
      Number(calendarSummary.calendarWeeks) === REPAIR_CONFIG.totalWeeks
    ),
    readiness: nextReadiness.ready ? nextReadiness : readiness,
  };
}

function buildDryRunPlan(state, options, newReleaseVersion) {
  const record = state.termRecord || {};
  const activeVersion = state.activeReleaseVersion || "";
  return {
    term: options.term,
    sourceReleaseVersion: options.sourceReleaseVersion,
    oldReleaseVersion: activeVersion || record.releaseVersion || "",
    newReleaseVersion,
    changes: {
      registry: {
        currentTotalWeeks: Number(record.totalWeeks || 0) || 0,
        nextTotalWeeks: REPAIR_CONFIG.totalWeeks,
        termStartDate: REPAIR_CONFIG.termStartDate,
        weekStart: REPAIR_CONFIG.weekStart,
      },
      release: {
        generateCalendarJson: true,
        updateManifestCalendarMetadata: true,
        preserveOldRelease: true,
        recrawlSchoolSystem: false,
        affectsUserLocalSchedule: false,
        affectsXlsImports: false,
      },
      files: {
        localRelease: true,
        publicRelease: true,
        runtimePointer: options.activateAfterBuild,
        openRestyRuntime: options.syncOpenResty,
      },
    },
    confirmLines: [
      `当前学期: ${options.term}`,
      `旧 Release Version: ${activeVersion || record.releaseVersion || "-"}`,
      `新 Release Version: ${newReleaseVersion}`,
      `registry 当前 ${record.totalWeeks || "-"} 周，将修正为 ${REPAIR_CONFIG.totalWeeks} 周`,
      "将生成 calendar.json",
      "将更新 manifest calendar 元数据",
      "将保留旧 Release 用于回滚",
      "不重新采集课表",
      "不影响用户本地课表和 XLS 导入",
    ],
  };
}

function normalizeSnapshotForRepair(snapshot, releaseVersion) {
  if (!snapshot || typeof snapshot !== "object") {
    const error = new Error("CURRENT_SNAPSHOT_REQUIRED");
    error.code = "CURRENT_SNAPSHOT_REQUIRED";
    throw error;
  }
  const term = snapshot.term || snapshot.semester || snapshot.termConfig && snapshot.termConfig.term || "";
  if (term !== REPAIR_TERM) {
    const error = new Error("CURRENT_SNAPSHOT_TERM_MISMATCH");
    error.code = "CURRENT_SNAPSHOT_TERM_MISMATCH";
    error.expectedTerm = REPAIR_TERM;
    error.actualTerm = term;
    throw error;
  }
  return Object.assign({}, snapshot, {
    version: releaseVersion,
    releaseVersion,
    term: REPAIR_TERM,
    semester: REPAIR_TERM,
    semesterText: REPAIR_CONFIG.semesterText,
    termStartDate: REPAIR_CONFIG.termStartDate,
    weekStart: REPAIR_CONFIG.weekStart,
    totalWeeks: REPAIR_CONFIG.totalWeeks,
    updatedAt: nowIso(),
    termConfig: Object.assign({}, snapshot.termConfig || {}, REPAIR_CONFIG, {
      releaseVersion,
      status: "ready",
      dataAvailable: true,
      updatedAt: nowIso(),
      source: "calendar-repair",
    }),
  });
}

function updateRegistryForRepair(releaseVersion, options = {}) {
  const registry = termRegistryService.readRegistry() || { schemaVersion: 1, activeTerm: "", terms: [] };
  const terms = Array.isArray(registry.terms) ? registry.terms.slice() : [];
  const index = terms.findIndex((item) => item.term === REPAIR_TERM);
  if (index < 0) {
    const error = new Error("TERM_NOT_FOUND");
    error.code = "TERM_NOT_FOUND";
    throw error;
  }
  terms[index] = termRegistryService.normalizeTermRecord(Object.assign({}, terms[index], REPAIR_CONFIG, {
    releaseVersion,
    status: "current",
    dataAvailable: true,
    publishedAt: options.publishedAt || nowIso(),
    updatedAt: nowIso(),
    source: "calendar-repair",
  }));
  const next = Object.assign({}, registry, {
    activeTerm: REPAIR_TERM,
    updatedAt: nowIso(),
    terms: terms.map((item, itemIndex) => {
      if (itemIndex === index) return terms[index];
      if (item.status === "current") {
        return termRegistryService.normalizeTermRecord(Object.assign({}, item, {
          status: "archived",
          updatedAt: nowIso(),
        }));
      }
      return item;
    }),
  });
  return termRegistryService.writeRegistry(next, { backup: false });
}

function validateBuiltRelease(version, files, options = {}) {
  const manifest = readJsonFile(files.manifestPath, null);
  const publicManifest = readJsonFile(path.join(files.publicReleaseDir, "manifest.json"), null);
  const localCalendar = readJsonFile(teachingCalendarService.getReleaseCalendarPath(version, false, {
    releaseDir: files.releaseDir,
  }), null);
  const publicCalendar = readJsonFile(teachingCalendarService.getReleaseCalendarPath(version, true, {
    publicReleaseDir: files.publicReleaseDir,
  }), null);
  const errors = [];
  if (!manifest) errors.push("MANIFEST_MISSING");
  if (!publicManifest) errors.push("PUBLIC_MANIFEST_MISSING");
  if (manifest && manifest.term !== REPAIR_TERM) errors.push("MANIFEST_TERM_MISMATCH");
  if (manifest && manifest.releaseVersion !== version) errors.push("MANIFEST_RELEASE_VERSION_MISMATCH");
  const config = manifest && manifest.termConfig || {};
  ["term", "semesterText", "termStartDate", "weekStart", "totalWeeks", "releaseVersion"].forEach((key) => {
    if (config[key] === undefined || config[key] === null || config[key] === "") {
      errors.push(`MANIFEST_TERM_CONFIG_${key.toUpperCase()}_MISSING`);
    }
  });
  if (config.termStartDate !== REPAIR_CONFIG.termStartDate) errors.push("MANIFEST_TERM_START_MISMATCH");
  if (config.weekStart !== REPAIR_CONFIG.weekStart) errors.push("MANIFEST_WEEK_START_MISMATCH");
  if (Number(config.totalWeeks) !== REPAIR_CONFIG.totalWeeks) errors.push("MANIFEST_TOTAL_WEEKS_MISMATCH");
  if (!localCalendar || !publicCalendar) errors.push("CALENDAR_JSON_MISSING");
  if (localCalendar && publicCalendar && JSON.stringify(localCalendar) !== JSON.stringify(publicCalendar)) {
    errors.push("LOCAL_PUBLIC_CALENDAR_MISMATCH");
  }
  if (localCalendar) {
    try {
      validateCalendarShape(localCalendar);
    } catch (error) {
      errors.push.apply(errors, error.errors || [error.code || error.message]);
    }
  }
  const calendarHash = localCalendar ? teachingCalendarService.getCalendarHash(localCalendar) : "";
  if (manifest && manifest.calendarUrl !== `/static/releases/${version}/calendar.json`) errors.push("MANIFEST_CALENDAR_URL_MISMATCH");
  if (manifest && manifest.calendarHash !== calendarHash) errors.push("MANIFEST_CALENDAR_HASH_MISMATCH");
  if (manifest && Number(manifest.calendarCount || 0) !== REPAIR_CONFIG.totalWeeks) errors.push("MANIFEST_CALENDAR_COUNT_MISMATCH");
  if (manifest && !manifest.calendarUpdatedAt) errors.push("MANIFEST_CALENDAR_UPDATED_AT_MISSING");
  const status = releaseService.getReleasePackStatus(version, { files });
  if (!status.healthy) errors.push.apply(errors, (status.missing || []).concat(status.hashErrors || []));
  const quick = releaseService.getReleasePackQuickHealth(version);
  if (!options.allowQuickInactive && quick && quick.manifestExists && quick.version === version && !quick.healthy) {
    errors.push("QUICK_HEALTH_FAILED");
  }
  if (errors.length) {
    const error = new Error(`REPAIRED_RELEASE_INVALID: ${Array.from(new Set(errors)).join("; ")}`);
    error.code = "REPAIRED_RELEASE_INVALID";
    error.errors = Array.from(new Set(errors));
    error.status = status;
    throw error;
  }
  return { manifest, publicManifest, calendar: localCalendar, status };
}

function cleanupFinalRelease(version) {
  const files = releaseService.getReleaseFiles(version);
  [
    [files.releaseDir, releaseService.RELEASES_DIR],
    [files.publicReleaseDir, releaseService.PUBLIC_RELEASES_DIR],
  ].forEach(([dirPath, baseDir]) => {
    try {
      const resolved = path.resolve(dirPath);
      const relative = path.relative(path.resolve(baseDir), resolved);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        fs.rmSync(resolved, { recursive: true, force: true });
      }
    } catch (error) {
      safeLog("semester-repair-cleanup-final-failed", { dirPath, error: error.message });
    }
  });
}

function getOpenRestyRuntimeDir(env = process.env) {
  if (env.OPENRESTY_STATIC_RUNTIME_DIR) {
    return path.resolve(env.OPENRESTY_STATIC_RUNTIME_DIR);
  }
  return "";
}

function syncOpenRestyRuntime(options = {}) {
  const runtimeDir = getOpenRestyRuntimeDir(options.env || process.env);
  if (!runtimeDir) {
    return {
      success: true,
      status: "warn",
      configured: false,
      message: "OPENRESTY_STATIC_RUNTIME_DIR is not configured",
    };
  }
  const source = runtimePointerService.ACTIVE_RUNTIME_PATH;
  const target = path.join(runtimeDir, "active.json");
  if (!fs.existsSync(source)) {
    const error = new Error("RUNTIME_POINTER_SOURCE_MISSING");
    error.code = "RUNTIME_POINTER_SOURCE_MISSING";
    throw error;
  }
  ensureDir(runtimeDir);
  const tempPath = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.copyFileSync(source, tempPath);
  try {
    if (process.platform === "win32" && fs.existsSync(target)) {
      try { fs.unlinkSync(target); } catch (error) {}
    }
    fs.renameSync(tempPath, target);
  } catch (error) {
    fs.copyFileSync(source, target);
    try { fs.unlinkSync(tempPath); } catch (cleanupError) {}
  }
  return {
    success: true,
    status: "synced",
    configured: true,
    source,
    target,
  };
}

async function repairCurrentTermRelease(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  assertRepairTarget(options.term);
  progress(options.job, 5, "校验当前状态", { term: options.term });
  const initialState = readState(options);
  if (!initialState.termRecord) {
    const error = new Error("TERM_NOT_FOUND");
    error.code = "TERM_NOT_FOUND";
    throw error;
  }
  const alreadyHealthy = isAlreadyHealthy(initialState, options);
  if (alreadyHealthy.healthy) {
    return {
      success: true,
      alreadyHealthy: true,
      term: options.term,
      releaseVersion: initialState.termRecord.releaseVersion,
      readiness: alreadyHealthy.readiness,
    };
  }
  if (options.sourceReleaseVersion && initialState.activeReleaseVersion && initialState.activeReleaseVersion !== options.sourceReleaseVersion) {
    const recordVersion = initialState.termRecord.releaseVersion || "";
    if (recordVersion !== options.sourceReleaseVersion) {
      const error = new Error("SOURCE_RELEASE_VERSION_MISMATCH");
      error.code = "SOURCE_RELEASE_VERSION_MISMATCH";
      error.expected = options.sourceReleaseVersion;
      error.actual = initialState.activeReleaseVersion || recordVersion;
      throw error;
    }
  }
  validateCalendarShape(initialState.calendar);
  const newReleaseVersion = releaseService.normalizeVersion(options.releaseVersion || generateRepairReleaseVersion(options.now));
  const plan = buildDryRunPlan(initialState, options, newReleaseVersion);
  if (options.dryRun) {
    return {
      success: true,
      dryRun: true,
      term: options.term,
      sourceReleaseVersion: options.sourceReleaseVersion,
      newReleaseVersion,
      plan,
      readiness: alreadyHealthy.readiness,
    };
  }

  if (fs.existsSync(releaseService.getReleaseFiles(newReleaseVersion).releaseDir) ||
      fs.existsSync(releaseService.getReleaseFiles(newReleaseVersion).publicReleaseDir)) {
    const error = new Error("REPAIR_RELEASE_VERSION_EXISTS");
    error.code = "REPAIR_RELEASE_VERSION_EXISTS";
    error.releaseVersion = newReleaseVersion;
    throw error;
  }

  progress(options.job, 14, "备份运行数据", { term: options.term });
  const backup = backupState();
  const oldReleaseVersion = initialState.activeReleaseVersion || initialState.termRecord.releaseVersion || "";
  let built = null;
  let staticSync = null;
  let runtimePointer = null;
  let openRestyRuntime = null;

  try {
    progress(options.job, 22, "修复学期配置", { totalWeeks: REPAIR_CONFIG.totalWeeks });
    teachingCalendarService.clearCache();
    const repairedCalendar = readRequiredTermCalendar(options.term);
    validateCalendarShape(repairedCalendar);

    const repairSnapshot = normalizeSnapshotForRepair(initialState.snapshot, newReleaseVersion);
    progress(options.job, 32, "构建新Release", { releaseVersion: newReleaseVersion });
    if (typeof options.hooks.beforeBuild === "function") {
      await options.hooks.beforeBuild({ options, repairSnapshot, newReleaseVersion });
    }
    built = await releaseService.writeReleaseSnapshotAsync(repairSnapshot, {
      job: options.job,
      beforePromote: async (context) => {
        progress(options.job, 56, "校验教学周历", { releaseVersion: newReleaseVersion });
        validateBuiltRelease(newReleaseVersion, context.files, { allowQuickInactive: true });
        if (typeof options.hooks.beforePromote === "function") {
          await options.hooks.beforePromote(context);
        }
      },
    });

    progress(options.job, 66, "发布静态文件", { releaseVersion: newReleaseVersion });
    if (typeof options.hooks.afterBuild === "function") {
      await options.hooks.afterBuild({ built, options });
    }
    validateBuiltRelease(newReleaseVersion, releaseService.getReleaseFiles(newReleaseVersion), { allowQuickInactive: true });
    if (options.syncOpenResty) {
      if (typeof options.hooks.beforeStaticSync === "function") {
        await options.hooks.beforeStaticSync({ releaseVersion: newReleaseVersion, built, options });
      }
      staticSync = await staticReleaseSyncService.syncIfEnabled(newReleaseVersion, { job: options.job });
    }

    if (options.activateAfterBuild) {
      progress(options.job, 74, "切换当前Release", { releaseVersion: newReleaseVersion });
      if (typeof options.hooks.beforeRegistryWrite === "function") {
        await options.hooks.beforeRegistryWrite({ releaseVersion: newReleaseVersion });
      }
      updateRegistryForRepair(newReleaseVersion);
      termReleaseIndexService.activateTerm(options.term, newReleaseVersion);
      const activated = releaseService.activateReleaseVersion(newReleaseVersion);
      progress(options.job, 84, "重建Runtime Pointer", { releaseVersion: newReleaseVersion });
      if (typeof options.hooks.beforeRuntimePointer === "function") {
        await options.hooks.beforeRuntimePointer({ releaseVersion: newReleaseVersion });
      }
      runtimePointer = runtimePointerService.ensureActivePointer({
        term: options.term,
        releaseVersion: newReleaseVersion,
        force: true,
      });
      if (options.syncOpenResty) {
        progress(options.job, 90, "同步OpenResty", { releaseVersion: newReleaseVersion });
        openRestyRuntime = syncOpenRestyRuntime();
      }
      built.activated = activated;
    }

    progress(options.job, 94, "最终Readiness检查", { releaseVersion: newReleaseVersion });
    const finalReadiness = termReadinessService.buildTermReadiness(options.term, newReleaseVersion, {
      autoRepairRuntimePointer: false,
      now: options.now,
    });
    if (!finalReadiness.ready) {
      const nonOpenRestyFailures = (finalReadiness.checks || [])
        .filter((item) => item.status === "fail" && item.key !== "openresty-static-root")
        .map((item) => item.key);
      if (nonOpenRestyFailures.length) {
        const error = new Error(`FINAL_READINESS_FAILED: ${nonOpenRestyFailures.join("; ")}`);
        error.code = "FINAL_READINESS_FAILED";
        error.readiness = finalReadiness;
        throw error;
      }
    }

    return {
      success: true,
      dryRun: false,
      alreadyHealthy: false,
      term: options.term,
      oldReleaseVersion,
      newReleaseVersion,
      releaseVersion: newReleaseVersion,
      plan,
      built: {
        releaseDir: built.releaseDir,
        publicReleaseDir: built.publicReleaseDir,
        manifest: {
          term: built.manifest.term,
          releaseVersion: built.manifest.releaseVersion,
          termConfig: built.manifest.termConfig,
          calendarUrl: built.manifest.calendarUrl,
          calendarHash: built.manifest.calendarHash,
          calendarCount: built.manifest.calendarCount,
          calendarUpdatedAt: built.manifest.calendarUpdatedAt,
        },
      },
      staticSync,
      runtimePointer,
      openRestyRuntime,
      readiness: finalReadiness,
      rollbackTarget: oldReleaseVersion,
    };
  } catch (error) {
    restoreState(backup);
    cleanupFinalRelease(newReleaseVersion);
    error.rollbackApplied = true;
    error.rollbackTarget = oldReleaseVersion;
    throw error;
  }
}

module.exports = {
  REPAIR_CONFIG,
  REPAIR_SOURCE_RELEASE,
  REPAIR_TERM,
  backupState,
  buildDryRunPlan,
  generateRepairReleaseVersion,
  repairCurrentTermRelease,
  restoreState,
  syncOpenRestyRuntime,
  validateBuiltRelease,
  validateCalendarShape,
};
