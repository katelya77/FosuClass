const express = require("express");
const router = express.Router();
const relayService = require("../services/relayService");
const stagingUploadService = require("../services/stagingUploadService");
const { safeLog } = require("../utils/safeLogger");

function getRelayToken(req) {
  const authHeader = String(req.headers.authorization || "");
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  return String(
    req.headers["x-relay-token"] ||
    (bearerMatch ? bearerMatch[1] : "") ||
    (req.body && req.body.token) ||
    ""
  ).trim();
}

function getRelayTokenFromAny(req) {
  return String(
    getRelayToken(req) ||
    req.query.token ||
    req.headers["x-relay-token"] ||
    ""
  ).trim();
}

function buildRelayActor(task) {
  return { type: "relay", id: task.id };
}

function assertRelayTask(req) {
  const token = getRelayTokenFromAny(req);
  if (!token) {
    const error = new Error("缺少 relay token");
    error.statusCode = 401;
    throw error;
  }
  return {
    token,
    task: relayService.validateTokenForUpload(token),
  };
}

router.get("/tasks/:token", (req, res) => {
  try {
    const task = relayService.findTaskByToken(req.params.token);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: "接力任务不存在或 token 无效",
      });
    }
    const status = relayService.getTaskStatus(task);
    if (status === "revoked") {
      return res.status(403).json({ success: false, message: "接力任务已被吊销" });
    }
    if (status === "expired") {
      return res.status(403).json({ success: false, message: "接力任务已过期" });
    }
    return res.json({
      success: true,
      task: relayService.safeTaskForAgent(task),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    safeLog("relay-task-read-failed", { error: error.message });
    return res.status(500).json({ success: false, message: "读取接力任务失败" });
  }
});

router.post("/tasks/:token/heartbeat", (req, res) => {
  try {
    const token = req.params.token || getRelayToken(req);
    const task = relayService.heartbeatTaskByToken(token, req.body || {});
    return res.json({ success: true, task: relayService.safeTaskForAgent(task) });
  } catch (error) {
    safeLog("relay-heartbeat-failed", { error: error.message, statusCode: error.statusCode });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post("/tasks/:token/progress", (req, res) => {
  try {
    const token = req.params.token || getRelayToken(req);
    const task = relayService.updateTaskProgressByToken(token, req.body || {});
    return res.json({ success: true, task: relayService.safeTaskForAgent(task) });
  } catch (error) {
    safeLog("relay-progress-failed", { error: error.message, statusCode: error.statusCode });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post("/staging/upload/init", (req, res) => {
  try {
    const { task } = assertRelayTask(req);
    const body = Object.assign({}, req.body || {});
    if (body.term && String(body.term) !== String(task.term)) {
      return res.status(403).json({ success: false, message: "relay token 只能上传指定学期的 staging" });
    }
    body.term = task.term;
    body.source = "relay-agent";
    const upload = stagingUploadService.initUpload(body, buildRelayActor(task));
    return res.json({ success: true, uploadId: upload.uploadId, upload });
  } catch (error) {
    safeLog("relay-upload-init-failed", { error: error.message, statusCode: error.statusCode });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post(
  "/staging/upload/chunk",
  express.raw({ type: "*/*", limit: "12mb" }),
  (req, res) => {
    try {
      const { task } = assertRelayTask(req);
      const status = stagingUploadService.writeChunk(
        req.query.uploadId || req.headers["x-upload-id"],
        req.query.chunkIndex || req.headers["x-chunk-index"],
        req.body,
        buildRelayActor(task),
        { chunkSha256: req.headers["x-chunk-sha256"] }
      );
      return res.json({ success: true, upload: status });
    } catch (error) {
      safeLog("relay-upload-chunk-failed", { error: error.message, statusCode: error.statusCode });
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }
);

router.post("/staging/upload/finalize", async (req, res) => {
  const uploadId = req.body && req.body.uploadId;
  try {
    const { token, task } = assertRelayTask(req);
    const finalized = await stagingUploadService.finalizeUpload(uploadId, buildRelayActor(task), req.body || {});
    const stagingData = stagingUploadService.normalizeStagingData(finalized.stagingData);
    if (String(stagingData.term || stagingData.semester || "") !== String(task.term)) {
      stagingUploadService.markUploadFailed(uploadId, "relay term mismatch");
      return res.status(403).json({ success: false, message: "relay token 只能上传指定学期的 staging" });
    }
    const upload = relayService.recordUpload(token, {
      data: stagingData,
      uploaderNote: req.body.uploaderNote || req.body.note || "",
      environment: req.body.environment || req.body.env || "",
    });
    stagingUploadService.markUploadPendingReview(uploadId, {
      term: upload.term,
      releaseVersion: upload.summary?.releaseVersion || "",
      relayUploadId: upload.id,
      counts: upload.summary || {},
    });
    return res.json({
      success: true,
      message: "接力 Staging JSON 已分片上传，等待管理员审核发布",
      upload: {
        id: upload.id,
        taskId: upload.taskId,
        status: upload.status,
        summary: upload.summary,
        uploadedAt: upload.uploadedAt,
        validation: upload.validation,
      },
      stagingUploadId: uploadId,
    });
  } catch (error) {
    stagingUploadService.markUploadFailed(uploadId, error.message);
    safeLog("relay-upload-finalize-failed", { error: error.message, statusCode: error.statusCode });
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "接力上传失败",
      errors: error.validation ? error.validation.errors : undefined,
      warnings: error.validation ? error.validation.warnings : undefined,
    });
  }
});

router.post("/staging/upload", (req, res) => {
  try {
    const token = getRelayToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: "缺少 relay token" });
    }
    const body = req.body || {};
    const upload = relayService.recordUpload(token, {
      data: body.data || body.staging || body,
      uploaderNote: body.uploaderNote || body.note || "",
      environment: body.environment || body.env || "",
    });
    return res.json({
      success: true,
      message: "接力 Staging JSON 已上传，等待管理员审核发布",
      upload: {
        id: upload.id,
        taskId: upload.taskId,
        status: upload.status,
        summary: upload.summary,
        uploadedAt: upload.uploadedAt,
        validation: upload.validation,
      },
    });
  } catch (error) {
    safeLog("relay-upload-failed", { error: error.message, statusCode: error.statusCode });
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "接力上传失败",
      errors: error.validation ? error.validation.errors : undefined,
      warnings: error.validation ? error.validation.warnings : undefined,
    });
  }
});

module.exports = router;
