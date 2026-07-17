/**
 * Audit domain routes — mounted under /api/admin by the admin aggregator.
 * Implementation still lives in admin.js until full cutover; this module
 * documents the boundary and exposes a health/metadata endpoint.
 */
const express = require("express");
const adminAuth = require("../../services/adminAuth");

const router = express.Router();

router.get("/audit/module-info", adminAuth.verifyAdminAccess, (req, res) => {
  const identity = adminAuth.getAuditIdentity(req);
  return res.json({
    success: true,
    domain: "audit",
    identity,
    note: "Primary audit-log list remains GET /api/admin/audit-logs for compatibility.",
  });
});

module.exports = router;
