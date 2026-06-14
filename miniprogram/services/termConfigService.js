const {
  FALLBACK_TERM_CONFIG,
  getRuntimeTermConfig,
  setRuntimeTermConfig,
} = require("../utils/week");

function normalizeTermConfig(config, extra = {}) {
  const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const totalWeeks = Number(source.totalWeeks || source.weeks || source.weekCount || extra.totalWeeks || FALLBACK_TERM_CONFIG.totalWeeks);
  return Object.assign({}, FALLBACK_TERM_CONFIG, {
    term: source.term || source.semester || source.currentSemester || extra.term || FALLBACK_TERM_CONFIG.term,
    semesterText: source.semesterText || source.termText || source.label || extra.semesterText || FALLBACK_TERM_CONFIG.semesterText,
    termStartDate: source.termStartDate || source.startDate || source.termStart || extra.termStartDate || FALLBACK_TERM_CONFIG.termStartDate,
    totalWeeks: Number.isFinite(totalWeeks) && totalWeeks > 0 ? Math.floor(totalWeeks) : FALLBACK_TERM_CONFIG.totalWeeks,
    weekStart: source.weekStart || extra.weekStart || FALLBACK_TERM_CONFIG.weekStart,
    updatedAt: source.updatedAt || extra.updatedAt || "",
    source: source.source || extra.source || FALLBACK_TERM_CONFIG.source,
    releaseVersion: source.releaseVersion || source.version || extra.releaseVersion || "",
  });
}

function unwrapAppConfig(appConfig) {
  return appConfig && appConfig.data ? appConfig.data : (appConfig || {});
}

function resolveTermConfigFromSources(sources = {}) {
  const activeRelease = sources.activeRelease || {};
  const manifest = activeRelease.manifest || {};
  if (manifest.termConfig && typeof manifest.termConfig === "object") {
    return normalizeTermConfig(manifest.termConfig, {
      source: "activeRelease.manifest.termConfig",
      term: manifest.term || activeRelease.term,
      releaseVersion: manifest.releaseVersion || activeRelease.releaseVersion,
      updatedAt: manifest.updatedAt || activeRelease.updatedAt,
    });
  }
  if (activeRelease.manifestStatus === "pointer-only" && activeRelease.termConfig && typeof activeRelease.termConfig === "object") {
    return normalizeTermConfig(activeRelease.termConfig, {
      source: "runtimePointer.termConfig",
      term: activeRelease.term,
      releaseVersion: activeRelease.releaseVersion,
      updatedAt: activeRelease.updatedAt,
    });
  }

  const config = unwrapAppConfig(sources.appConfig);
  if (config.termConfig && typeof config.termConfig === "object") {
    return normalizeTermConfig(config.termConfig, {
      source: "appConfig.data.termConfig",
      term: config.currentSemester,
      releaseVersion: config.dataVersion && config.dataVersion.releaseVersion,
      updatedAt: config.updatedAt,
    });
  }

  if (config.currentSemester || config.dataVersion) {
    const version = config.dataVersion || {};
    return normalizeTermConfig({}, {
      source: "appConfig.data.currentSemester",
      term: config.currentSemester || FALLBACK_TERM_CONFIG.term,
      termStartDate: version.termStartDate || version.startDate || version.termStartDateText || "",
      totalWeeks: version.totalWeeks || version.weekCount || "",
      releaseVersion: version.releaseVersion || "",
      updatedAt: config.updatedAt ||
        version.classScheduleUpdatedAt ||
        version.teacherScheduleUpdatedAt ||
        version.classroomScheduleUpdatedAt ||
        version.courseScheduleUpdatedAt ||
        "",
    });
  }

  return normalizeTermConfig({}, { source: "fallback" });
}

function applyRuntimeTermConfigFromSources(sources = {}) {
  return setRuntimeTermConfig(resolveTermConfigFromSources(sources));
}

function applyRuntimeTermConfigFromApp(app) {
  const globalData = app && app.globalData ? app.globalData : {};
  return applyRuntimeTermConfigFromSources({
    activeRelease: globalData.activeRelease,
    appConfig: globalData.appConfig,
  });
}

module.exports = {
  applyRuntimeTermConfigFromApp,
  applyRuntimeTermConfigFromSources,
  getRuntimeTermConfig,
  normalizeTermConfig,
  resolveTermConfigFromSources,
};
