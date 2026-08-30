"use strict";

const express = require("express");
const { createDailyKnowledgeImportHandler } = require("./dailyKnowledgeImportController");
const {
  createDailyKnowledgeListHandler,
  createDailyKnowledgeCloudbaseVerifyHandler,
  createDailyKnowledgeCloudbaseSyncHandler,
} = require("./dailyKnowledgeCloudbaseController");
const {
  createDailyKnowledgeBulkHandler,
  createDailyKnowledgeExportHandler,
  createDailyKnowledgePolicyHandler,
  createDailyKnowledgeSeedHandler,
} = require("./dailyKnowledgeManagementController");

function createDailyKnowledgeRoutes({ adminAuth, verifyAdminWriteAccess, createBackup, writeAuditLog, safeLog }) {
  const router = express.Router();
  const write = { createBackup, writeAuditLog, safeLog };
  router.get("/daily-knowledge", adminAuth.verifyAdminAccess, createDailyKnowledgeListHandler({ safeLog }));
  router.get("/daily-knowledge/export", adminAuth.verifyAdminAccess, createDailyKnowledgeExportHandler({ safeLog }));
  router.get("/daily-knowledge/cloudbase/verify", adminAuth.verifyAdminAccess, createDailyKnowledgeCloudbaseVerifyHandler({ safeLog }));
  router.post("/daily-knowledge/policy", verifyAdminWriteAccess, createDailyKnowledgePolicyHandler(write));
  router.post("/daily-knowledge/bulk", verifyAdminWriteAccess, createDailyKnowledgeBulkHandler(write));
  router.post("/daily-knowledge/seed-builtins", verifyAdminWriteAccess, createDailyKnowledgeSeedHandler(write));
  router.post("/daily-knowledge/import", verifyAdminWriteAccess, createDailyKnowledgeImportHandler(write));
  router.post("/daily-knowledge/cloudbase/sync", verifyAdminWriteAccess, createDailyKnowledgeCloudbaseSyncHandler({ safeLog, writeAuditLog }));
  return router;
}

module.exports = { createDailyKnowledgeRoutes };
