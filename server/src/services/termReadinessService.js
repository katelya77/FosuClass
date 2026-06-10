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
  if (process.env.OPENRESTY_STATIC_RELEASE_DIR) {
    return path.resolve(process.env.OPENRESTY_STATIC_RELEASE_DIR, "..", "runtime", "active.json");
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
    manifestCheck.valid ? "pass" : "fail",
    manifestCheck.valid ? "manifest.term 与目标学期一致。" : `manifest 校验失败：${manifestCheck.errors.join("; ")}`,
    term,
    manifest ? (manifest.term || manifest.semester || "") : "",
    "不要用其他学期的 release 激活当前学期；重新绑定正确 releaseVersion。"
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
    "manifest-calendar-url",
    manifest && manifest.calendarUrl ? "pass" : "fail",
    manifest && manifest.calendarUrl ? "manifest.calendarUrl 已配置。" : "manifest.calendarUrl 缺失。",
    `/static/releases/${version}/calendar.json`,
    manifest && manifest.calendarUrl || "",
    "重新构建 release manifest，确保包含 calendarUrl/calendarHash/calendarCount/calendarUpdatedAt。"
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
    calendarCount >= 20 && (!manifest || Number(manifest.calendarCount || 0) >= 20) ? "pass" : "fail",
    calendarCount >= 20 ? "教学周历周数满足当前学期要求。" : "教学周历少于 20 周。",
    "calendarCount >= 20",
    { manifestCalendarCount: manifest && manifest.calendarCount || 0, calendarCount },
    "维护 server/storage/terms/2025-2026-2/teaching-calendar.json，至少包含 20 周 start/end/type/title/note。"
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
  return {
    term,
    releaseVersion: version,
    record,
    ready: blockers.length === 0,
    blockers,
    checks,
    summary,
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
