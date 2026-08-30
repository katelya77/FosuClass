const contentService = require("./service");

function createDailyKnowledgeImportHandler({ createBackup, writeAuditLog, safeLog }) {
  return function dailyKnowledgeImportHandler(req, res) {
    try {
      const dryRun = req.body && req.body.dryRun === true;
      const result = contentService.importDailyKnowledgePack(req.body || {}, {
        dryRun,
        beforeWrite: () => createBackup("notices", contentService.NOTICES_PATH),
      });
      if (!dryRun && (result.created || result.updated)) {
        writeAuditLog(req, "import", "notices", "daily-knowledge", `批量导入每日知识: 新建 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}`);
      }
      return res.json({ success: true, data: result });
    } catch (error) {
      safeLog("admin-daily-knowledge-import-failed", { error: error.message });
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
        code: error.code || undefined,
      });
    }
  };
}

module.exports = {
  createDailyKnowledgeImportHandler,
};
