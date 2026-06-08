const express = require("express");
const { scheduleLimiter } = require("../utils/rateLimit");
const { validateJsonBody } = require("../utils/apiSecurity");
const { safeLog } = require("../utils/safeLogger");
const agentService = require("../services/ai/agentService");
const { buildSafeLogPayload } = require("../services/ai/safetyGuard");

const router = express.Router();

router.post("/agent/chat", scheduleLimiter, validateJsonBody(["message", "context"]), async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const message = String(req.body && req.body.message || "").trim();
  if (!message) {
    return res.status(400).json({
      success: false,
      code: "MESSAGE_REQUIRED",
      message: "请输入要咨询的问题。",
      serverTime: new Date().toISOString(),
    });
  }

  try {
    const payload = await agentService.chat({
      message,
      context: req.body.context || {},
    });
    safeLog("ai-agent-chat", buildSafeLogPayload({
      message,
      context: req.body.context || {},
      provider: payload.safety && payload.safety.provider,
      toolCalls: payload.toolCalls,
    }));
    return res.json(payload);
  } catch (error) {
    safeLog("ai-agent-chat-failed", buildSafeLogPayload({
      message,
      context: req.body.context || {},
      provider: "mock",
      toolCalls: [{ name: "agentService", status: "failed", summary: error.message }],
    }));
    return res.status(200).json({
      success: true,
      answer: "AI 校园管家暂时不可用，已进入规则降级模式。你可以先使用全校查询、空教室或个人课表导入页面完成操作。",
      cards: [{
        type: "generic",
        title: "已降级到规则模式",
        subtitle: "没有调用外部模型，核心入口仍可使用。",
        badges: ["mock fallback", "仅供参考"],
        items: [],
        actions: [
          { label: "打开全校查询", type: "navigate", url: "/pages/school/school", payload: {} },
          { label: "打开空教室", type: "navigate", url: "/pages/empty-room/empty-room", payload: {} },
        ],
      }],
      toolCalls: [{ name: "agentService", status: "failed", summary: "fallback mock response" }],
      suggestions: ["现在有空教室吗？", "怎么导入个人课表？"],
      safety: {
        redacted: true,
        usedPersonalContext: false,
        provider: "mock",
        mode: "tool-grounded",
      },
      serverTime: new Date().toISOString(),
    });
  }
});

module.exports = router;
