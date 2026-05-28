/**
 * 健康检查路由：提供基本的健康探测 API
 */

const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "FosuClass API is running",
    time: new Date().toISOString(),
  });
});

module.exports = router;
