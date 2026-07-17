/**
 * Dashboard domain metadata route.
 * Live dashboard data continues to use GET /api/admin/dashboard and /sync/status.
 */
const express = require("express");
const adminAuth = require("../../services/adminAuth");

const router = express.Router();

router.get("/dashboard/module-info", adminAuth.verifyAdminAccess, (req, res) => {
  return res.json({
    success: true,
    domain: "dashboard",
    primaryEndpoints: ["/api/admin/dashboard", "/api/admin/sync/status"],
    tier: 1,
  });
});

module.exports = router;
