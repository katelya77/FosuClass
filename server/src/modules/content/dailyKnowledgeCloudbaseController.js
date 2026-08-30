const dailyKnowledgeCloudbaseService = require("../../services/dailyKnowledgeCloudbaseService");
const contentService = require("./service");

function createDailyKnowledgeListHandler({ safeLog }) {
  return function dailyKnowledgeListHandler(req, res) {
    try {
      const data = contentService.getDailyKnowledgeAdminState(new Date());
      data.cloudbase = dailyKnowledgeCloudbaseService.getPlan(new Date());
      return res.json({ success: true, data });
    } catch (error) {
      safeLog("admin-daily-knowledge-list-failed", { error: error.message });
      return res.status(500).json({ success: false, message: error.message });
    }
  };
}

function createDailyKnowledgeCloudbaseVerifyHandler({ safeLog }) {
  return function dailyKnowledgeCloudbaseVerifyHandler(req, res) {
    try {
      return res.json({ success: true, data: dailyKnowledgeCloudbaseService.verify() });
    } catch (error) {
      safeLog("admin-daily-knowledge-cloudbase-verify-failed", { error: error.message, code: error.code || "" });
      return res.status(400).json({
        success: false,
        code: error.code || "DAILY_KNOWLEDGE_CLOUDBASE_VERIFY_FAILED",
        message: error.message,
      });
    }
  };
}

function createDailyKnowledgeCloudbaseSyncHandler({ safeLog, writeAuditLog }) {
  return function dailyKnowledgeCloudbaseSyncHandler(req, res) {
    try {
      const result = dailyKnowledgeCloudbaseService.sync();
      writeAuditLog(req, "sync", "daily-knowledge-cloudbase", result.contentVersion || "pending", "同步并验证每日知识 CloudBase 只读镜像");
      return res.json({ success: true, data: result });
    } catch (error) {
      safeLog("admin-daily-knowledge-cloudbase-sync-failed", { error: error.message, code: error.code || "" });
      return res.status(400).json({
        success: false,
        code: error.code || "DAILY_KNOWLEDGE_CLOUDBASE_SYNC_FAILED",
        message: error.message,
      });
    }
  };
}

module.exports = {
  createDailyKnowledgeListHandler,
  createDailyKnowledgeCloudbaseVerifyHandler,
  createDailyKnowledgeCloudbaseSyncHandler,
};
