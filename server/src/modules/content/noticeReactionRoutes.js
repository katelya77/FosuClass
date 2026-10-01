"use strict";
const express = require("express");
const content = require("../../services/appConfigService");
const reactions = require("../../services/noticeReactionService");
const { validateJsonBody } = require("../../utils/apiSecurity");
const { checkRateLimit } = require("../../services/rateLimitService");
function createNoticeReactionRoutes() {
  const router = express.Router();
  function noticeFor(req) {
    const notice = content.listNotices().find((item) => item.id === req.params.id);
    const now = Date.now();
    if (!content.getAdminConfig().contentModules.announcements.enabled || !notice || notice.enabled !== true ||
        notice.displayMode === "daily-tip" || (notice.startAt && Date.parse(notice.startAt) > now) ||
        (notice.endAt && Date.parse(notice.endAt) < now)) {
      throw Object.assign(new Error("这条公告已结束或暂不可用"), { statusCode: 404, code: "NOTICE_UNAVAILABLE" });
    }
    return notice;
  }
  function handle(write) {
    return (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      try {
        const notice = noticeFor(req);
        const principal = req.fosuSession && req.fosuSession.openidHash ? reactions.owner(req.fosuSession) : "";
        if (write && !principal) reactions.owner(null);
        if (write && !checkRateLimit("notice-reaction-write", principal).allowed) {
          throw Object.assign(new Error("操作太快了，请稍后再试"), { statusCode: 429, code: "NOTICE_REACTION_RATE_LIMIT" });
        }
        const emoji = req.body ? req.body.emoji : undefined;
        // Older mini clients encode PUT data as forms, turning null into "null".
        // Limit this compatibility conversion to form bodies; JSON stays strict.
        const target = req.is("application/x-www-form-urlencoded") && (emoji === "null" || emoji === "") ? null : emoji;
        const result = write ? reactions.setReaction(notice, principal, target) : reactions.summary(notice, principal);
        return res.json({ success: true, data: result });
      } catch (error) {
        return res.status(error.statusCode || 503).json({ success: false, code: error.code || "NOTICE_REACTIONS_UNAVAILABLE", message: error.statusCode ? error.message : "表情服务暂不可用，请稍后重试" });
      }
    };
  }
  router.get("/notices/:id/reactions", handle(false));
  router.put("/notices/:id/reactions", validateJsonBody(["emoji"]), handle(true));
  return router;
}
module.exports = { createNoticeReactionRoutes };
