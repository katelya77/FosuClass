/**
 * 健康检查路由：提供基本的健康探测 API
 */

const express = require("express");
const router = express.Router();
const jobService = require("../services/jobService");
const performanceMonitorService = require("../services/performanceMonitorService");
const releaseWorkerManager = require("../services/releaseWorkerManager");
const runtimePointerService = require("../services/runtimePointerService");

router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "FosuClass API is running",
    time: new Date().toISOString(),
  });
});

router.get("/live", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(performanceMonitorService.getLiveStatus());
});

router.get("/ready", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const pointer = runtimePointerService.readActivePointer();
  const runningHeavyJob = jobService.getRunningJobByLockGroup(releaseWorkerManager.RELEASE_HEAVY_LOCK_GROUP);
  res.json(performanceMonitorService.getSnapshot({
    status: pointer && pointer.releaseVersion ? "ready" : "degraded",
    activeReleaseVersion: pointer && pointer.releaseVersion || "",
    activeTerm: pointer && (pointer.activeTerm || pointer.term) || "",
    worker: {
      releaseHeavyBusy: Boolean(runningHeavyJob),
      runningJob: jobService.publicJob(runningHeavyJob),
      latestJob: jobService.publicJob(jobService.latestJob()),
    },
  }));
});

module.exports = router;
