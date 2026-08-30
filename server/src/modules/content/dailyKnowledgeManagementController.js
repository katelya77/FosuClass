"use strict";

const contentService = require("./service");

function sendFailure(res, error, fallbackCode) {
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message,
    code: error.code || fallbackCode,
  });
}

function createDailyKnowledgePolicyHandler({ createBackup, writeAuditLog, safeLog }) {
  return function dailyKnowledgePolicyHandler(req, res) {
    try {
      createBackup("config", contentService.CONFIG_PATH);
      const policy = contentService.saveDailyKnowledgePolicy(req.body || {});
      writeAuditLog(req, "update", "daily-knowledge-policy", "active", `更新每日知识轮换策略: ${policy.enabled ? "启用" : "停用"}/${policy.strategy}/偏移${policy.rotationOffset}`);
      return res.json({ success: true, data: { policy, state: contentService.getDailyKnowledgeAdminState(new Date()) } });
    } catch (error) {
      safeLog("admin-daily-knowledge-policy-failed", { error: error.message });
      return sendFailure(res, error, "DAILY_KNOWLEDGE_POLICY_FAILED");
    }
  };
}

function createDailyKnowledgeBulkHandler({ createBackup, writeAuditLog, safeLog }) {
  return function dailyKnowledgeBulkHandler(req, res) {
    try {
      const result = contentService.bulkDailyKnowledge(req.body || {}, {
        dryRun: req.body && req.body.dryRun === true,
        beforeWrite: () => createBackup("notices", contentService.NOTICES_PATH),
      });
      if (!result.dryRun && result.affected) {
        writeAuditLog(req, result.action, "daily-knowledge", "bulk", `批量${result.action}每日知识 ${result.affected} 条`);
      }
      return res.json({ success: true, data: result });
    } catch (error) {
      safeLog("admin-daily-knowledge-bulk-failed", { error: error.message });
      return sendFailure(res, error, "DAILY_KNOWLEDGE_BULK_FAILED");
    }
  };
}

function createDailyKnowledgeSeedHandler({ createBackup, writeAuditLog, safeLog }) {
  return function dailyKnowledgeSeedHandler(req, res) {
    try {
      const result = contentService.seedBuiltinDailyKnowledge({
        dryRun: req.body && req.body.dryRun === true,
        beforeWrite: () => createBackup("notices", contentService.NOTICES_PATH),
      });
      if (!result.dryRun && (result.created || result.updated)) {
        writeAuditLog(req, "seed", "daily-knowledge", "builtin", `接管内置每日知识: 新建 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}`);
      }
      return res.json({ success: true, data: result });
    } catch (error) {
      safeLog("admin-daily-knowledge-seed-failed", { error: error.message });
      return sendFailure(res, error, "DAILY_KNOWLEDGE_SEED_FAILED");
    }
  };
}

function createDailyKnowledgeExportHandler({ safeLog }) {
  return function dailyKnowledgeExportHandler(req, res) {
    try {
      const scope = String(req.query && req.query.scope || "effective");
      const pack = contentService.exportDailyKnowledgePack(scope, new Date());
      res.setHeader("Content-Disposition", `attachment; filename=\"fosu-daily-knowledge-${pack.scope}.json\"`);
      return res.json({ success: true, data: pack });
    } catch (error) {
      safeLog("admin-daily-knowledge-export-failed", { error: error.message });
      return sendFailure(res, error, "DAILY_KNOWLEDGE_EXPORT_FAILED");
    }
  };
}

module.exports = {
  createDailyKnowledgeBulkHandler,
  createDailyKnowledgeExportHandler,
  createDailyKnowledgePolicyHandler,
  createDailyKnowledgeSeedHandler,
};
