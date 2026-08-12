"use strict";

function isFreshNetworkSidecar(sidecar, options = {}) {
  const source = sidecar && typeof sidecar === "object" ? sidecar : {};
  const snapshotMeta = options.snapshotMeta || {};
  const classSource = source.scopeSources && source.scopeSources.classSchedules || {};
  const cacheSource = String(source.cacheSource || snapshotMeta.cacheSource || "").replace(/\\/g, "/");
  const progressRunId = String(source.progressCacheRunId || snapshotMeta.progressCacheRunId || "");
  const currentRunId = String(options.currentRunId || "");
  const currentRunProgress = Boolean(
    currentRunId && source.freshRunId === currentRunId &&
    source.usedProgressCache && !source.usedNoScheduleCache &&
    (source.resumedFromRunProgress || snapshotMeta.resumedFromRunProgress ||
      (cacheSource.includes(source.freshRunId) && cacheSource.includes("/progress/"))) &&
    (!progressRunId || progressRunId === source.freshRunId) &&
    Number(source.actualNetworkRequestCount || 0) > 0 &&
    Number(source.skippedByProgressCount || 0) > 0 &&
    !source.partial && Number(source.failedTargetCount || 0) === 0 &&
    classSource.sourceMode === "network-direct" &&
    Number(classSource.succeeded || 0) === Number(classSource.requested || 0) &&
    Number(classSource.failed || 0) === 0 && Number(classSource.cacheHits || 0) === 0
  );
  return Boolean(
    (source.crawlMode === "full-fresh" &&
      !source.usedClassScheduleCache && !source.usedProgressCache &&
      !source.usedNoScheduleCache && Number(source.actualNetworkRequestCount || 0) > 0) ||
    currentRunProgress
  );
}

module.exports = { isFreshNetworkSidecar };
