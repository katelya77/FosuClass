const express = require("express");
const router = express.Router();
const relayService = require("../services/relayService");
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
