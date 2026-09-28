const express = require("express");
const { verifySignedRequest } = require("../security/campusAgentSignature");
const { claimJob, claimPayload, finishJob, heartbeat, noteJobStage } = require("../services/campusSyncBroker");

const router = express.Router();

function requireAgent(req, res, next) {
  const result = verifySignedRequest(req, Date.now());
  if (!result.ok) return res.status(result.status).end();
  req.campusAgentId = result.agentId;
  return next();
}

router.get("/health", requireAgent, (req, res) => {
  res.json({ ok: true });
});

router.post("/heartbeat", requireAgent, (req, res) => {
  res.json(heartbeat());
});

router.post("/jobs/claim", requireAgent, async (req, res) => {
  const job = await claimJob(req.campusAgentId);
  if (!job) return res.status(204).end();
  return res.json(claimPayload(job));
});

router.post("/jobs/:jobId/stage", requireAgent, (req, res) => {
  const stage = req.body && req.body.stage;
  if (stage !== "verifying" && stage !== "reading" && stage !== "organizing") return res.status(400).end();
  if (!noteJobStage(req.params.jobId, stage)) return res.status(404).end();
  return res.status(204).end();
});

router.post("/jobs/:jobId/result", requireAgent, (req, res) => {
  try {
    res.json(finishJob(req.params.jobId, req.body || {}));
  } catch (error) {
    res.status(400).end();
  }
});

module.exports = router;
