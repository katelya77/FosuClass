// Coze Tool Gateway 路由（薄壳）
// POST /api/coze/tools/:toolId  —— 由 Coze Agent（coze-native，仅 trial/dev）调用
// 业务与安全逻辑全部在 services/ai/cozeToolGatewayService.js。

const express = require("express");
const cozeToolGatewayService = require("../services/ai/cozeToolGatewayService");
const { safeLog } = require("../utils/safeLogger");

const router = express.Router();

router.post("/:toolId", async (req, res) => {
  try {
    const result = await cozeToolGatewayService.executeGatewayCall(
      req.params.toolId,
      req.body || {},
      req.headers || {}
    );
    if (result.status === 401 || result.status === 403) {
      safeLog("coze-tool-gateway-rejected", { toolId: req.params.toolId, code: result.body && result.body.code });
    }
    res.status(result.status).json(result.body);
  } catch (error) {
    safeLog("coze-tool-gateway-failed", { toolId: req.params.toolId, error: error.message });
    res.status(500).json({ success: false, code: "GATEWAY_INTERNAL_ERROR" });
  }
});

module.exports = router;
