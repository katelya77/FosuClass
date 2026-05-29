const express = require("express");
const feedbackService = require("../services/feedbackService");
const { safeLog } = require("../utils/safeLogger");

const router = express.Router();

router.post("/", (req, res) => {
  try {
    const record = feedbackService.createFeedback(req.body, req);
    return res.json({
      success: true,
      id: record.id,
      createdAt: record.createdAt,
      status: record.status,
    });
  } catch (error) {
    safeLog("feedback-create-failed", { error: error.message });
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode === 400 ? "反馈内容不能为空" : "反馈提交失败，请稍后再试",
    });
  }
});

module.exports = router;
