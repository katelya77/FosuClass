const express = require("express");
const { verifySignedRequest } = require("../security/fullSyncSignature");
const collector = require("../services/scheduleCollectorService");

const router = express.Router();

function requireAgent(req, res, next) {
  const result = verifySignedRequest(req, Date.now());
  if (!result.ok) return res.status(result.status).end();
  req.fullSyncAgentId = result.agentId;
  return next();
}

router.post("/heartbeat", requireAgent, (req, res) => {
  res.json(collector.heartbeat(req.fullSyncAgentId));
});

router.post("/runs/claim", requireAgent, (req, res) => {
  const run = collector.claim(req.fullSyncAgentId);
  if (!run) return res.status(204).end();
  return res.json({ run });
});

router.post("/runs/:runId/report", requireAgent, (req, res) => {
  try {
    res.json({ run: collector.applyReport(req.params.runId, req.body || {}) });
  } catch (error) {
    const status = error && error.code === "STAGING_SENSITIVE" ? 400 : 404;
    res.status(status).end();
  }
});

module.exports = router;
