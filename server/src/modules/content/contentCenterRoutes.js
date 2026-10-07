"use strict";

const express = require("express");
const contentService = require("./service");
const cloudbaseService = require("../../services/dailyKnowledgeCloudbaseService");
const noticeReactions = require("../../services/noticeReactionService");

function createContentCenterRoutes({ adminAuth, verifyAdminWriteAccess, createBackup, writeAuditLog, safeLog }) {
  const router = express.Router();

  router.get("/content-center", adminAuth.verifyAdminAccess, (req, res) => {
    try {
      const config = contentService.getAdminConfig();
      const dailyKnowledge = contentService.getDailyKnowledgeAdminState();
      return res.json({ success: true, data: {
        modules: {
          announcements: config.contentModules.announcements,
          dailyKnowledge: { enabled: config.dailyKnowledge.enabled, version: config.contentModules.dailyKnowledge.version },
        },
        notices: contentService.listNotices().filter((item) => item.displayMode !== "daily-tip"),
        dailyKnowledge: { policy: dailyKnowledge.policy, counts: dailyKnowledge.counts, selected: dailyKnowledge.selected },
        mirror: cloudbaseService.getMirrorStatus(),
      } });
    } catch (error) {
      safeLog("admin-content-center-read-failed", { error: error.message });
      return res.status(500).json({ success: false, message: "首页内容读取失败" });
    }
  });

  router.put("/content-center/policy", verifyAdminWriteAccess, (req, res) => {
    try {
      const body = req.body || {};
      if (typeof body.announcementsEnabled !== "boolean") {
        return res.status(400).json({ success: false, message: "公告播报状态必须为布尔值" });
      }
      createBackup("config", contentService.CONFIG_PATH);
      const announcements = contentService.saveAnnouncementsPolicy(body.announcementsEnabled, {
        expectedVersion: req.get("if-match") || body.expectedVersion,
      });
      writeAuditLog(req, "update", "content-center-policy", "announcements", `公告播报${announcements.enabled ? "启用" : "停用"}`);
      return res.json({ success: true, data: { announcements } });
    } catch (error) {
      safeLog("admin-content-center-policy-failed", { error: error.message });
      return res.status(error.statusCode || 500).json({ success: false, code: error.code, message: error.message });
    }
  });

  router.get("/notices", adminAuth.verifyAdminAccess, (req, res) => {
    try {
      return res.json({ success: true, items: contentService.listNotices().map((item) => ({ ...item, reactions: noticeReactions.publicSummary(item) })) });
    } catch (error) {
      safeLog("admin-notices-list-failed", { error: error.message });
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  router.post("/notices", verifyAdminWriteAccess, (req, res) => {
    try {
      const operation = contentService.createNoticeOperation(req.body || {}, {
        idempotencyKey: req.get("idempotency-key") || "",
        beforeCreate: () => createBackup("notices", contentService.NOTICES_PATH),
      });
      const item = operation.item;
      if (!operation.replayed) writeAuditLog(req, "create", "notices", item.id, `创建公告: ${item.title}`);
      return res.json({ success: true, item, replayed: operation.replayed });
    } catch (error) {
      safeLog("admin-notice-create-failed", { error: error.message });
      return res.status(error.statusCode || 500).json({ success: false, message: error.message, code: error.code || undefined });
    }
  });

  router.put("/notices/:id", verifyAdminWriteAccess, (req, res) => {
    try {
      createBackup("notices", contentService.NOTICES_PATH);
      const body = req.body || {};
      const client = String(req.get("x-fosu-admin-client") || "").toLowerCase();
      const ifMatch = req.get("if-match") || body.expectedVersion || body.version;
      const item = contentService.updateNotice(req.params.id, body, {
        expectedVersion: ifMatch,
        ifMatch,
        requireIfMatch: client === "next",
        client,
      });
      writeAuditLog(req, "update", "notices", req.params.id, `编辑公告: ${item.title}`);
      return res.json({ success: true, item, etag: item.version });
    } catch (error) {
      safeLog("admin-notice-update-failed", { id: req.params.id, error: error.message });
      return res.status(error.statusCode || 500).json({
        success: false, message: error.message, code: error.code || undefined, currentVersion: error.currentVersion,
      });
    }
  });

  router.delete("/notices/:id", verifyAdminWriteAccess, (req, res) => {
    try {
      createBackup("notices", contentService.NOTICES_PATH);
      const deleted = contentService.deleteNotice(req.params.id, {
        expectedVersion: req.get("if-match") || req.body && req.body.expectedVersion,
      });
      writeAuditLog(req, "delete", "notices", req.params.id, `删除公告 id: ${req.params.id}`);
      return res.json({ success: true, deleted });
    } catch (error) {
      safeLog("admin-notice-delete-failed", { id: req.params.id, error: error.message });
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  });

  return router;
}

module.exports = { createContentCenterRoutes };
