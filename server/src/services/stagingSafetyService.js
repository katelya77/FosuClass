const appConfigService = require("./appConfigService");
const releaseService = require("./releaseService");
const termRegistryService = require("./termRegistryService");
const {
  buildResourceCountContract,
  compareResourceCountContracts,
  flattenLegacyCounts,
} = require("../shared/resourceCountContract");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getStagingIncludeScopes(data) {
  const scopes = data && data.meta && data.meta.includeScopes;
  return Array.isArray(scopes) ? scopes : [];
}

function getStagingClassSchedules(data) {
  return data && (data.classSchedules || data.resources && data.resources.classSchedules) || [];
}

function summarizeStagingData(data) {
  const classSchedules = getStagingClassSchedules(data);
  const resourceCounts = buildResourceCountContract(data || {});
  const counts = flattenLegacyCounts(resourceCounts);
  return { classSchedules, counts, resourceCounts };
}

function areStagingCountsAllZero(counts) {
  return Object.values(counts || {}).every((value) => Number(value || 0) === 0);
}

function validateTermConfig(data, errors) {
  const termConfig = data && data.termConfig && typeof data.termConfig === "object" ? data.termConfig : null;
  if (!termConfig) {
    errors.push("Missing required field: termConfig");
    return;
  }
  try {
    const normalizedTermConfig = termRegistryService.normalizeTermRecord(Object.assign({}, termConfig, {
      term: data.term || termConfig.term,
      status: "ready",
      releaseVersion: data.releaseVersion || data.version || termConfig.releaseVersion || "",
      dataAvailable: true,
      updatedAt: data.generatedAt || data.updatedAt || new Date().toISOString(),
    }));
    const termValidation = termRegistryService.validateTermRecord(normalizedTermConfig);
    if (!termValidation.valid) {
      termValidation.errors.forEach((error) => errors.push(`termConfig.${error}`));
    }
    if (normalizedTermConfig.term !== data.term) {
      errors.push(`termConfig.term mismatch: ${normalizedTermConfig.term} != ${data.term}`);
    }
  } catch (error) {
    errors.push(`termConfig.${error.code || error.message}`);
  }
}

function validateStagingData(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object") {
    errors.push("Staging data must be a JSON object");
    return { valid: false, errors, warnings };
  }

  ["schemaVersion", "releaseVersion", "term", "termStartDate", "generatedAt"].forEach((field) => {
    if (!data[field]) errors.push(`Missing required field: ${field}`);
  });
  validateTermConfig(data, errors);

  const includeScopes = getStagingIncludeScopes(data);
  const hasClassSchedules = includeScopes.length === 0 || includeScopes.includes("classSchedules");
  const { classSchedules, counts } = summarizeStagingData(data);

  if (hasClassSchedules) {
    if (!Array.isArray(classSchedules) || classSchedules.length === 0) {
      errors.push("Missing classSchedules");
    } else {
      classSchedules.slice(0, 5).forEach((item, index) => {
        if (!item.className) warnings.push(`classSchedules[${index}] missing className`);
      });
    }
  }

  if (areStagingCountsAllZero(counts)) {
    errors.push("Staging counts are all zero");
  }

  ["teacherSchedules", "classroomSchedules", "courseSchedules", "classrooms", "teachers", "courses"].forEach((key) => {
    const list = data[key] || data.resources && data.resources[key];
    if (!Array.isArray(list)) warnings.push(`Missing resource scope: ${key}`);
  });

  if (data.meta && data.meta.counts) {
    const reportedClassCount = Number(data.meta.counts.classScheduleCount || 0);
    if (hasClassSchedules && reportedClassCount === 0 && classSchedules.length > 0) {
      warnings.push("meta.counts.classScheduleCount is 0, but actual classSchedules is not empty; actual data was used.");
    }
  }

  const cacheUsage = data.meta && data.meta.cacheUsage || {};
  if (data.meta && (data.meta.usedClassScheduleCache || cacheUsage.usedClassScheduleCache)) {
    warnings.push(`Staging used historical classSchedules cache: ${data.meta.cacheSource || cacheUsage.cacheSource || "unknown"}`);
  }
  if (data.meta && (data.meta.cacheWarning || cacheUsage.cacheWarning)) {
    warnings.push(data.meta.cacheWarning || cacheUsage.cacheWarning);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function buildValidationBlockerDetails(errors) {
  return asArray(errors).map((message) => ({
    code: "STAGING_VALIDATION_ERROR",
    field: "",
    resource: "",
    message,
    source: "staging-validation",
    publishable: false,
  }));
}

function enrichBlocker(blocker) {
  if (!blocker || typeof blocker !== "object") {
    return {
      code: "STAGING_SAFETY_BLOCKER",
      message: String(blocker || "Unknown safety blocker"),
      publishable: false,
    };
  }
  return Object.assign({
    code: blocker.code || "STAGING_SAFETY_BLOCKER",
    resource: blocker.resource || "",
    field: blocker.field || "",
    message: blocker.message || blocker.code || "Staging safety blocker",
    publishable: false,
  }, blocker);
}

function buildCompatibilityWarnings(contractComparison) {
  return asArray(contractComparison && contractComparison.warnings)
    .filter((item) => item && item.code === "LEGACY_ACTIVE_SOURCE_MODE_COMPAT")
    .map((item) => {
      const label = item.resource ? `${item.resource}.sourceMode` : "sourceMode";
      return `${item.code}: ${label} ${item.activeValue || "unknown"} -> ${item.stagingValue || "unknown"}, compatible with legacy Active Release statistics.`;
    });
}

function buildSafetyReport(input) {
  const contractComparison = input.contractComparison || {};
  const blockerDetails = []
    .concat(buildValidationBlockerDetails(input.validationErrors || []))
    .concat(asArray(contractComparison.blockers).map(enrichBlocker));
  const warningDetails = asArray(contractComparison.warnings).map((item) => Object.assign({
    code: item && item.code || "STAGING_SAFETY_WARNING",
    severity: "warning",
    publishable: true,
  }, item || {}));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    allowPublish: blockerDetails.length === 0,
    blockerCodes: Array.from(new Set(blockerDetails.map((item) => item.code).filter(Boolean))),
    blockers: blockerDetails,
    warnings: warningDetails,
    comparisons: asArray(contractComparison.comparisons),
    activeResourceCounts: input.activeResourceCounts || null,
    stagingResourceCounts: input.stagingResourceCounts || null,
    counts: input.counts || {},
    riskDrops: input.riskDrops || [],
    compatibility: {
      legacyActiveSourceMode: warningDetails.some((item) => item.code === "LEGACY_ACTIVE_SOURCE_MODE_COMPAT"),
    },
  };
}

function getSourceMode(resourceCounts, resource) {
  return resourceCounts && resourceCounts[resource] && resourceCounts[resource].sourceMode || "unknown";
}

function resolveStagingPublishMode(data, activeSnapshot, options = {}) {
  const stagingTerm = String(data && (data.term || data.semester) || "").trim();
  const registryTerm = options.registryTerm === undefined
    ? (stagingTerm ? termRegistryService.getTerm(stagingTerm) : null)
    : options.registryTerm;
  const activeRegistryTerm = options.activeRegistryTerm === undefined
    ? termRegistryService.getActiveTerm()
    : options.activeRegistryTerm;
  const activeTerm = String(
    options.currentTerm ||
    activeSnapshot && (activeSnapshot.term || activeSnapshot.semester) ||
    activeRegistryTerm && activeRegistryTerm.term ||
    appConfigService.getAdminConfig().currentSemester ||
    ""
  ).trim();
  const crossTermReadyCandidate = Boolean(
    stagingTerm &&
    activeTerm &&
    stagingTerm !== activeTerm &&
    registryTerm &&
    ["planned", "ready"].includes(registryTerm.status)
  );
  const readyOnly = options.readyOnly === true || crossTermReadyCandidate;
  return {
    activeTerm,
    stagingTerm,
    registryStatus: registryTerm && registryTerm.status || "",
    crossTermReadyCandidate,
    readyOnly,
    publishMode: readyOnly ? "ready-only" : "activate-current",
  };
}

function buildStagingSafety(data, activeSnapshot, options = {}) {
  const includeScopes = getStagingIncludeScopes(data);
  const hasClassSchedules = includeScopes.length === 0 || includeScopes.includes("classSchedules");
  const { counts, resourceCounts: stagingResourceCounts } = summarizeStagingData(data);
  const validation = validateStagingData(data);
  const blockers = validation.errors.slice();
  const warnings = validation.warnings.slice();
  const activeInfo = releaseService.getActiveReleaseInfo();
  const activeResourceCounts = activeSnapshot
    ? releaseService.getReleaseResourceCounts(
      activeSnapshot.version || activeSnapshot.releaseVersion || activeInfo && activeInfo.version || "",
      activeSnapshot
    )
    : (options.activeResourceCounts || null);
  const crossTermReadyCandidate = options.crossTermReadyCandidate === true;
  const contractComparison = activeResourceCounts && !crossTermReadyCandidate
    ? compareResourceCountContracts(activeResourceCounts, stagingResourceCounts)
    : { allowPublish: true, blockers: [], warnings: [], comparisons: [] };
  const activeCounts = activeResourceCounts ? flattenLegacyCounts(activeResourceCounts) : {};
  const activeClassCount = activeCounts.classScheduleCount || (activeSnapshot && activeSnapshot.classSchedules || []).length;
  const currentTerm = options.currentTerm || appConfigService.getAdminConfig().currentSemester || "";
  const stagingTerm = data.term || data.semester || "";
  const releaseVersion = data.releaseVersion || data.version || "";
  const releaseVersionExists = Boolean(
    releaseVersion &&
    releaseService.listReleases(200).some((item) => item.version === releaseVersion)
  );
  const riskDrops = [];
  let maxDropRate = 0;
  let severeDrop = false;

  [
    { key: "classScheduleCount", label: "class schedules" },
    { key: "teacherScheduleCount", label: "teacher schedules" },
    { key: "classroomScheduleCount", label: "classroom schedules" },
    { key: "courseScheduleCount", label: "course schedules" },
  ].forEach((item) => {
    const activeCount = Number(activeCounts[item.key] || 0);
    const stagingCount = Number(counts[item.key] || 0);
    if (crossTermReadyCandidate || !activeResourceCounts || activeCount <= 0 || stagingCount >= activeCount) return;
    const dropRate = (activeCount - stagingCount) / activeCount;
    if (dropRate <= 0.3) return;
    const dropPercent = parseFloat((dropRate * 100).toFixed(2));
    maxDropRate = Math.max(maxDropRate, dropRate);
    if (dropRate > 0.5) severeDrop = true;
    riskDrops.push({
      key: item.key,
      label: item.label,
      activeCount,
      stagingCount,
      dropPercent,
      severity: dropRate > 0.5 ? "danger" : "warning",
    });
    warnings.push(
      `${item.label}: active ${activeCount} -> staging ${stagingCount}, drop ${dropPercent}%` +
      (dropRate > 0.5 ? ", normal publish is blocked." : ", verify whether this is a normal term change.")
    );
  });

  contractComparison.blockers.forEach((blocker) => {
    const code = blocker.code || "COUNT_CONTRACT_MISMATCH";
    blockers.push(`${code}: ${blocker.message || "resource count contract mismatch"}`);
  });
  buildCompatibilityWarnings(contractComparison).forEach((warning) => warnings.push(warning));

  const teacherDiff = (contractComparison.comparisons || []).find((item) => item.path === "teacher.scheduleDocuments");
  if (teacherDiff && Number(teacherDiff.active || 0) && Number(teacherDiff.staging || 0) < Number(teacherDiff.active || 0)) {
    warnings.push(
      `teacher schedules: active ${teacherDiff.active}, staging ${teacherDiff.staging}, delta ${teacherDiff.delta} (${teacherDiff.percent}%). ` +
      `active source: ${getSourceMode(activeResourceCounts, "teacher")}; ` +
      `staging source: ${getSourceMode(stagingResourceCounts, "teacher")}.`
    );
  }

  if (hasClassSchedules && counts.classScheduleCount === 0 && !blockers.includes("Missing classSchedules")) {
    blockers.push("includeScopes contains classSchedules but classSchedules=0");
  }
  if (!data.term) blockers.push("term is empty");
  if (!data.releaseVersion) blockers.push("releaseVersion is empty");
  if (areStagingCountsAllZero(counts)) blockers.push("counts are all zero");
  if (data.partial || data.meta && data.meta.partial) {
    blockers.push("partial staging snapshots cannot be published by default");
  }
  if (currentTerm && stagingTerm && currentTerm !== stagingTerm) {
    warnings.push(crossTermReadyCandidate
      ? `Ready-only candidate ${stagingTerm} differs from active term ${currentTerm}; activation remains disabled.`
      : `Staging term ${stagingTerm} differs from configured term ${currentTerm}`);
  }
  if (releaseVersionExists) {
    warnings.push(`releaseVersion ${releaseVersion} already exists`);
  }

  const extraValidationErrors = blockers
    .filter((message) => !String(message).includes(":"))
    .filter((message) => !validation.errors.includes(message));
  const safetyReport = buildSafetyReport({
    validationErrors: validation.errors.concat(extraValidationErrors),
    contractComparison,
    activeResourceCounts,
    stagingResourceCounts,
    counts,
    riskDrops,
  });

  return {
    allowPublish: blockers.length === 0,
    requiresForceConfirm: severeDrop || releaseVersionExists,
    blockers,
    warnings,
    counts,
    resourceCounts: stagingResourceCounts,
    activeResourceCounts,
    contractComparison,
    blockerDetails: safetyReport.blockers,
    blockerCodes: Array.from(new Set(safetyReport.blockerCodes)),
    warningDetails: safetyReport.warnings,
    safetyReport,
    activeCounts,
    riskDrops,
    activeClassScheduleCount: activeClassCount,
    classScheduleDropRate: parseFloat(Math.max(0, maxDropRate * 100).toFixed(2)),
    currentTerm,
    stagingTerm,
    releaseVersionExists,
    crossTermReadyCandidate,
  };
}

module.exports = {
  areStagingCountsAllZero,
  buildSafetyReport,
  buildStagingSafety,
  getStagingClassSchedules,
  getStagingIncludeScopes,
  resolveStagingPublishMode,
  summarizeStagingData,
  validateStagingData,
};
