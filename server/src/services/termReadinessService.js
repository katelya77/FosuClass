const fs = require("fs");
const path = require("path");

const releaseService = require("./releaseService");
const runtimePointerService = require("./runtimePointerService");
const teachingCalendarService = require("./teachingCalendarService");
const termRegistryService = require("./termRegistryService");
const termReleaseIndexService = require("./termReleaseIndexService");
const { readJsonFile } = require("../utils/jsonFileStore");

function check(key, status, message, expected, actual, fixHint) {
  return {
    key,
    status,
    message,
    expected,
    actual,
    fixHint,
  };
}

function exists(filePath) {
  return Boolean(filePath && fs.existsSync(filePath));
}

function getOpenRestyRuntimePath() {
  if (process.env.OPENRESTY_STATIC_RUNTIME_DIR) {
    return path.resolve(process.env.OPENRESTY_STATIC_RUNTIME_DIR, "active.json");
  }
  return "";
}

function hashCalendar(calendar) {
  return teachingCalendarService.getCalendarHash(calendar);
}

function summarizeChecks(checks) {
  return {
    pass: checks.filter((item) => item.status === "pass").length,
    warn: checks.filter((item) => item.status === "warn").length,
    fail: checks.filter((item) => item.status === "fail").length,
  };
}

function parseDateOnly(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function formatDateOnly(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function calculateWeekInfo(now, record) {
  const start = parseDateOnly(record && record.termStartDate);
  const target = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const targetDate = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const totalWeeks = Number(record && record.totalWeeks || 0) || 0;
  if (!start || !totalWeeks) {
    return { weekNo: null, rawWeekNo: null, weekday: null, startDate: "", endDate: "", termPhase: "unknown" };
  }
  const diffDays = Math.floor((targetDate.getTime() - start.getTime()) / 86400000);
  const rawWeekNo = Math.floor(diffDays / 7) + 1;
  const weekNo = Math.max(1, Math.min(totalWeeks, rawWeekNo));
  const weekStart = new Date(start.getTime());
  weekStart.setDate(start.getDate() + (weekNo - 1) * 7);
  const weekEnd = new Date(weekStart.getTime());
  weekEnd.setDate(weekStart.getDate() + 6);
  let termPhase = "in-term";
  if (rawWeekNo <= 0) termPhase = "before-term";
  if (rawWeekNo > totalWeeks) termPhase = "after-term";
  const jsDay = targetDate.getDay();
  return {
    weekNo,
    rawWeekNo,
    weekday: jsDay === 0 ? 7 : jsDay,
    startDate: formatDateOnly(weekStart),
    endDate: formatDateOnly(weekEnd),
    termPhase,
  };
}

function buildTermReadiness(term, releaseVersion, options = {}) {
  const registry = termRegistryService.readRegistry();
  const record = termRegistryService.getTerm(term);
  const version = String(releaseVersion || record && record.releaseVersion || "").trim();
  const releaseIndex = termReleaseIndexService.readIndex();
  const termRelease = termReleaseIndexService.getTermRelease(term);
  const activeRelease = releaseService.getActiveReleaseInfo();
  const files = version ? releaseService.getReleaseFiles(version) : null;
  const manifestCheck = version ? termRegistryService.validateManifestForTerm(term, version) : { valid: false, errors: ["RELEASE_VERSION_REQUIRED"], manifest: null };
  const manifest = manifestCheck.manifest || null;
  const quickHealth = version ? releaseService.getReleasePackQuickHealth(version) : null;
  const staticManifest = version ? releaseService.readReleasePackStaticManifest(version, { term }) : null;
  const calendar = version ? teachingCalendarService.readReleaseCalendar(version) : (record ? teachingCalendarService.readTermCalendar(record.term) : null);
  const localCalendarPath = files ? teachingCalendarService.getReleaseCalendarPath(version, false) : "";
  const publicCalendarPath = files ? teachingCalendarService.getReleaseCalendarPath(version, true) : "";
  const manifestTerm = manifest && (manifest.term || manifest.semester || manifest.termConfig && manifest.termConfig.term) || "";
  const manifestTermMatches = Boolean(manifest && manifestTerm === term);
  const manifestTermConfig = manifest && manifest.termConfig && typeof manifest.termConfig === "object" ? manifest.termConfig : null;
  const manifestTermConfigErrors = [];
  if (!manifest) {
    manifestTermConfigErrors.push("RELEASE_MANIFEST_MISSING");
  } else if (!manifestTermConfig) {
    manifestTermConfigErrors.push("TERM_CONFIG_INCOMPLETE");
  } else {
    ["term", "semesterText", "termStartDate", "totalWeeks", "weekStart", "releaseVersion"].forEach((key) => {
      if (manifestTermConfig[key] === undefined || manifestTermConfig[key] === null || manifestTermConfig[key] === "") {
        manifestTermConfigErrors.push(`${key.toUpperCase()}_REQUIRED`);
      }
    });
    if (manifestTermConfig.term && manifestTermConfig.term !== term) {
      manifestTermConfigErrors.push("TERM_MISMATCH");
    }
    if (manifestTermConfig.releaseVersion && manifestTermConfig.releaseVersion !== version) {
      manifestTermConfigErrors.push("RELEASE_VERSION_MISMATCH");
    }
  }
  const manifestCalendarMetadataErrors = [];
  if (!manifest) {
    manifestCalendarMetadataErrors.push("RELEASE_MANIFEST_MISSING");
  } else {
    if (!manifest.calendarUrl) manifestCalendarMetadataErrors.push("CALENDAR_URL_REQUIRED");
    if (!manifest.calendarHash) manifestCalendarMetadataErrors.push("CALENDAR_HASH_REQUIRED");
    if (!manifest.calendarCount) manifestCalendarMetadataErrors.push("CALENDAR_COUNT_REQUIRED");
    if (!manifest.calendarUpdatedAt) manifestCalendarMetadataErrors.push("CALENDAR_UPDATED_AT_REQUIRED");
  }
  const runtimePointerBefore = runtimePointerService.readActivePointer();
  let runtimePointer = runtimePointerBefore;
  let runtimeRepair = null;

  if (options.autoRepairRuntimePointer !== false && record && record.status === "current" && version) {
    try {
      runtimePointer = runtimePointerService.ensureActivePointer({ term: record.term, releaseVersion: version });
      runtimeRepair = runtimePointerBefore ? "not-needed" : "rebuilt";
    } catch (error) {
      runtimeRepair = error.code || error.message;
    }
  }

  const checks = [];
  checks.push(check(
    "term-registry",
    registry && record ? "pass" : "fail",
    registry
      ? (record ? "term registry 已读取，目标学期存在。" : "term registry 已读取，但目标学期不存在。")
      : "term registry 不存在或不可读取。",
    `registry 中包含 ${term}`,
    registry ? { activeTerm: registry.activeTerm || "", termFound: Boolean(record) } : null,
    "确认 server/storage/term-registry.json 存在；必要时在后台创建学期或重新发布当前 release。"
  ));

  checks.push(check(
    "active-term-match",
    record && record.status === "current"
      ? (registry && registry.activeTerm === term ? "pass" : "fail")
      : "warn",
    record && record.status === "current"
      ? (registry && registry.activeTerm === term ? "当前学期与 registry.activeTerm 一致。" : "目标学期状态为 current，但 registry.activeTerm 不匹配。")
      : "目标学期尚未处于 current；激活前这是提示项，不阻断绑定检查。",
    record && record.status === "current" ? term : "current 学期才要求匹配",
    registry && registry.activeTerm || "",
    "如这是当前学期，请在后台执行激活；不要手工把未来学期写成 active。"
  ));

  checks.push(check(
    "release-version-match",
    record && version && record.releaseVersion === version ? "pass" : "fail",
    record && record.releaseVersion === version ? "学期记录 releaseVersion 与检查目标一致。" : "学期记录 releaseVersion 缺失或与检查目标不一致。",
    version || "非空 releaseVersion",
    record && record.releaseVersion || "",
    "在学期管理中填写 Release Version 后点击“绑定 Release”，或重新发布正确学期的数据。"
  ));

  checks.push(check(
    "term-index-release",
    termRelease && termRelease.activeReleaseVersion === version ? "pass" : (record && record.status === "current" ? "fail" : "warn"),
    termRelease && termRelease.activeReleaseVersion === version ? "term-index 指向同一 release。" : "term-index 未指向当前检查 release。",
    version || "非空 activeReleaseVersion",
    termRelease && termRelease.activeReleaseVersion || "",
    "运行“绑定 Release”或“激活为当前学期”，让 term-index 与 registry 对齐。"
  ));

  checks.push(check(
    "manifest-exists",
    manifest ? "pass" : "fail",
    manifest ? "release manifest 存在并可解析。" : "release manifest 缺失或不可解析。",
    files ? files.manifestPath : "server/storage/releases/<releaseVersion>/manifest.json",
    files ? { exists: exists(files.manifestPath), path: files.manifestPath } : null,
    "重新执行 release pack 构建；确认 releaseVersion 拼写与目录名一致。"
  ));

  checks.push(check(
    "manifest-term-match",
    manifestTermMatches ? "pass" : "fail",
    manifestTermMatches ? "manifest.term 与目标学期一致。" : "manifest.term 与目标学期不一致。",
    term,
    manifestTerm,
    "不要用其他学期的 release 激活当前学期；重新绑定正确 releaseVersion。"
  ));

  checks.push(check(
    "manifest-term-config",
    manifestTermConfigErrors.length === 0 && manifestCheck.valid ? "pass" : "fail",
    manifestTermConfigErrors.length === 0 && manifestCheck.valid
      ? "manifest.termConfig 完整，并与目标 release 一致。"
      : `manifest.termConfig 缺失或不完整：${manifestTermConfigErrors.concat(manifestCheck.errors || []).join("; ")}`,
    { termStartDate: "YYYY-MM-DD", totalWeeks: "number", weekStart: "monday|sunday", releaseVersion: version || "releaseVersion" },
    manifestTermConfig || null,
    "该 Release 创建于教学周历元数据功能上线前，请使用“修复并重建当前学期 Release”，不要仅重新绑定旧 Release。"
  ));

  checks.push(check(
    "snapshot-current-exists",
    record && record.status === "current"
      ? (activeRelease && activeRelease.releaseVersion === version ? "pass" : "fail")
      : "warn",
    activeRelease && activeRelease.releaseVersion === version
      ? "当前 active release 与目标 release 一致，snapshot/current 应可用于兼容读取。"
      : "当前 active release 不是本次检查目标；激活前这是提示项。",
    version,
    activeRelease && activeRelease.releaseVersion || "",
    "如果目标就是当前学期，请重新激活该 release 或检查 server/storage/releases/active.json。"
  ));

  checks.push(check(
    "runtime-active-pointer",
    runtimePointer && runtimePointer.activeTerm === term && runtimePointer.releaseVersion === version ? "pass" : (record && record.status === "current" ? "fail" : "warn"),
    runtimePointer && runtimePointer.activeTerm === term && runtimePointer.releaseVersion === version
      ? (runtimeRepair === "rebuilt" ? "public/runtime/active.json 缺失后已自动重建。" : "public/runtime/active.json 存在且指向目标 release。")
      : "public/runtime/active.json 缺失、损坏或指向错误 release。",
    { term, releaseVersion: version },
    runtimePointer ? { term: runtimePointer.activeTerm, releaseVersion: runtimePointer.releaseVersion, path: runtimePointerService.ACTIVE_RUNTIME_PATH } : null,
    "点击“重建 Runtime Pointer”，或运行发布/激活流程让服务端从 active release + registry 重写该文件。"
  ));

  checks.push(check(
    "static-runtime-file",
    exists(runtimePointerService.ACTIVE_RUNTIME_PATH) ? "pass" : (record && record.status === "current" ? "fail" : "warn"),
    exists(runtimePointerService.ACTIVE_RUNTIME_PATH) ? "/static/runtime/active.json 对应本地文件存在。" : "/static/runtime/active.json 对应本地文件不存在。",
    runtimePointerService.ACTIVE_RUNTIME_PATH,
    exists(runtimePointerService.ACTIVE_RUNTIME_PATH),
    "确认 server/storage/public/runtime/active.json 已生成；OpenResty 静态目录也要同步 runtime 子目录。"
  ));

  checks.push(check(
    "api-runtime-active-generatable",
    (() => {
      try {
        runtimePointerService.resolveActiveRuntimeManifest({ term, releaseVersion: version });
        return "pass";
      } catch (error) {
        return "fail";
      }
    })(),
    "服务端可从 registry + active release/manifest 生成 /api/fosu/runtime/active。",
    { term, releaseVersion: version },
    runtimeRepair || "ok",
    "检查 release manifest、term registry、term-index 是否一致；该 API 不依赖微信 session。"
  ));

  checks.push(check(
    "calendar-json-exists",
    exists(publicCalendarPath) || exists(localCalendarPath) ? "pass" : "fail",
    exists(publicCalendarPath) ? "public release calendar.json 存在。" : (exists(localCalendarPath) ? "本地 release calendar.json 存在，但 public 目录缺失。" : "release calendar.json 缺失。"),
    publicCalendarPath || "server/storage/public/releases/<releaseVersion>/calendar.json",
    { publicExists: exists(publicCalendarPath), localExists: exists(localCalendarPath) },
    "重新构建/发布 release；确认 teaching-calendar.json 可读且发布流程调用 writeReleaseCalendar。"
  ));

  checks.push(check(
    "manifest-calendar-metadata",
    manifestCalendarMetadataErrors.length === 0 ? "pass" : "fail",
    manifestCalendarMetadataErrors.length === 0 ? "manifest calendar 元数据完整。" : `manifest calendar 元数据缺失：${manifestCalendarMetadataErrors.join("; ")}`,
    {
      calendarUrl: `/static/releases/${version}/calendar.json`,
      calendarHash: "sha256(calendar.json)",
      calendarCount: record && record.totalWeeks || 0,
      calendarUpdatedAt: "ISO timestamp",
    },
    manifest ? {
      calendarUrl: manifest.calendarUrl || "",
      calendarHash: manifest.calendarHash || "",
      calendarCount: manifest.calendarCount || 0,
      calendarUpdatedAt: manifest.calendarUpdatedAt || "",
    } : null,
    "该 Release 创建于教学周历元数据功能上线前，请使用“修复并重建当前学期 Release”，不要仅重新绑定旧 Release。"
  ));

  const actualCalendarHash = calendar ? hashCalendar(calendar) : "";
  checks.push(check(
    "calendar-hash-match",
    manifest && calendar && manifest.calendarHash === actualCalendarHash ? "pass" : "fail",
    manifest && calendar && manifest.calendarHash === actualCalendarHash ? "calendarHash 与发布文件内容一致。" : "calendarHash 缺失或与 calendar.json 不一致。",
    manifest && manifest.calendarHash || "manifest.calendarHash",
    actualCalendarHash,
    "重新生成 release calendar.json 和 manifest；不要手工只改其中一个文件。"
  ));

  const calendarCount = calendar && Array.isArray(calendar.weeks) ? calendar.weeks.length : 0;
  checks.push(check(
    "calendar-count",
    record && manifest && calendarCount === Number(record.totalWeeks) && Number(manifest.calendarCount || 0) === Number(record.totalWeeks) ? "pass" : "fail",
    record && calendarCount === Number(record.totalWeeks) ? "教学周历周数与 term registry 一致。" : "教学周历周数与 term registry 不一致。",
    record ? `calendarCount == ${record.totalWeeks}` : "term registry totalWeeks",
    { manifestCalendarCount: manifest && manifest.calendarCount || 0, calendarCount },
    "维护 server/storage/terms/<term>/teaching-calendar.json，使 weeks 数量与 term registry.totalWeeks 一致；2025-2026-2 应为 19 周。"
  ));

  checks.push(check(
    "term-date-config",
    record && record.termStartDate && record.weekStart === "monday" && !(record.term === "2025-2026-2" && Number(record.totalWeeks) === 20) ? "pass" : "fail",
    record && record.term === "2025-2026-2" && Number(record.totalWeeks) === 20
      ? "检测到旧 totalWeeks=20 口径，请确认是否为旧配置。"
      : "当前学期日期配置检查。",
    record && record.term === "2025-2026-2"
      ? { termStartDate: "2026-03-09", weekStart: "monday", totalWeeks: 19 }
      : { termStartDate: "YYYY-MM-DD", weekStart: "monday", totalWeeks: "按学期配置" },
    record ? { termStartDate: record.termStartDate, weekStart: record.weekStart, totalWeeks: record.totalWeeks } : null,
    "幂等修复：更新 term registry 的 termStartDate/weekStart/totalWeeks，并同步维护 teaching-calendar.json 后重跑 readiness。"
  ));

  const currentWeekInfo = calculateWeekInfo(options.now || new Date(), record);
  checks.push(check(
    "current-week-calculation",
    currentWeekInfo.weekNo ? "pass" : "warn",
    currentWeekInfo.weekNo
      ? `按 ${record && record.weekStart || "monday"} 起算，当前计算为第 ${currentWeekInfo.weekNo} 周。`
      : "无法计算当前周次。",
    "可计算 currentWeek",
    currentWeekInfo,
    "确认 termStartDate 是正式课程周起点；不要把返校报到日作为 weekStart。"
  ));

  const openRestyRuntimePath = getOpenRestyRuntimePath();
  checks.push(check(
    "openresty-static-root",
    openRestyRuntimePath ? (exists(openRestyRuntimePath) ? "pass" : "warn") : "warn",
    openRestyRuntimePath
      ? (exists(openRestyRuntimePath) ? "OpenResty runtime 静态文件存在。" : "OpenResty runtime 静态文件未检测到。")
      : "未配置 OPENRESTY_STATIC_RUNTIME_DIR；如由 OpenResty 托管 /static/runtime，需要单独同步 runtime 目录。",
    openRestyRuntimePath || "OPENRESTY_STATIC_RUNTIME_DIR/active.json",
    openRestyRuntimePath ? exists(openRestyRuntimePath) : "not-configured",
    "在 VPS 上让 /static/runtime 映射到 server/storage/public/runtime，或同步 active.json 到 OpenResty 静态根。"
  ));

  const summary = summarizeChecks(checks);
  const blockers = checks.filter((item) => item.status === "fail").map((item) => item.key);
  const legacyCalendarRepairEligible = Boolean(
    term === "2025-2026-2" &&
    (
      !manifest ||
      !manifest.calendarUrl ||
      !manifest.calendarHash ||
      !manifest.calendarCount ||
      !calendar ||
      Number(record && record.totalWeeks || 0) === 20
    )
  );
  return {
    term,
    releaseVersion: version,
    record,
    ready: blockers.length === 0,
    blockers,
    checks,
    summary,
    repairAction: legacyCalendarRepairEligible ? {
      type: "current-term-release-repair",
      label: "修复并重建当前学期 Release",
      term,
      sourceReleaseVersion: version,
      reason: "该 Release 创建于教学周历元数据功能上线前，请使用“修复并重建当前学期 Release”，不要仅重新绑定旧 Release。",
    } : null,
    manifest: manifest ? {
      term: manifest.term,
      releaseVersion: manifest.releaseVersion,
      termConfig: manifest.termConfig || null,
      counts: manifest.counts || {},
      calendarUrl: manifest.calendarUrl || "",
      calendarHash: manifest.calendarHash || "",
      calendarCount: manifest.calendarCount || 0,
      calendarUpdatedAt: manifest.calendarUpdatedAt || "",
    } : null,
    releasePack: quickHealth,
    calendarSummary: {
      term: record && record.term || term,
      termStartDate: record && record.termStartDate || "",
      weekStart: record && record.weekStart || "",
      totalWeeks: record && record.totalWeeks || 0,
      currentWeek: currentWeekInfo.weekNo,
      currentWeekRange: currentWeekInfo.startDate && currentWeekInfo.endDate ? `${currentWeekInfo.startDate}~${currentWeekInfo.endDate}` : "",
      calendarWeeks: calendarCount,
      releaseRegistryMatch: Boolean(record && version && record.releaseVersion === version),
    },
    openResty: {
      manifestExists: Boolean(staticManifest),
      staticReleaseUrl: staticManifest && staticManifest.staticReleaseUrl || "",
      runtimePath: openRestyRuntimePath,
    },
    runtimePointer: runtimePointer ? {
      term: runtimePointer.activeTerm,
      releaseVersion: runtimePointer.releaseVersion,
      path: runtimePointerService.ACTIVE_RUNTIME_PATH,
      repair: runtimeRepair || "not-needed",
    } : null,
    rollbackTarget: activeRelease,
    counts: manifest && manifest.counts || {},
    currentWeekInfo,
    releaseIndex,
    paths: {
      manifest: files && files.manifestPath || "",
      staticManifest: files && path.join(files.publicReleaseDir, "manifest.json") || "",
      runtimeActive: runtimePointerService.ACTIVE_RUNTIME_PATH,
      calendar: publicCalendarPath,
      currentSnapshot: path.join(termRegistryService.STORAGE_DIR, "snapshots", "current.json"),
    },
  };
}

function rebuildRuntimePointer(term, releaseVersion) {
  const pointer = runtimePointerService.ensureActivePointer({
    term,
    releaseVersion,
    force: true,
  });
  return {
    success: true,
    pointer,
    path: runtimePointerService.ACTIVE_RUNTIME_PATH,
    stats: readJsonFile(runtimePointerService.ACTIVE_RUNTIME_PATH, null) ? runtimePointerService.getActivePointerStats() : null,
  };
}

module.exports = {
  buildTermReadiness,
  rebuildRuntimePointer,
};
