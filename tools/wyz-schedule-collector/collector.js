#!/usr/bin/env node
/**
 * WYZ full-schedule collector. Separate from wyz-campus-agent.
 * Does not publish a release. School access stays behind FOSU_COLLECTOR_EXECUTE=1
 * and a root-only session lease. The daily timer must stay disabled until a real MVP run.
 */
const fs = require("fs");
const path = require("path");
const { signRequest } = require("../../server/src/security/fullSyncSignature");
const { collectorCommand } = require("../../server/src/services/scheduleCollectorService");

const ORACLE = process.env.FOSU_API_BASE || "https://class.katelya.eu.org";
const TOKEN = process.env.FULL_SYNC_AGENT_TOKEN || "";
const SECRET = process.env.FULL_SYNC_SIGNING_SECRET || "";
const AGENT_ID = process.env.FULL_SYNC_AGENT_ID || "wyz-schedule-collector";
const SESSION_PATH = process.env.FOSU_COLLECTOR_SESSION || "/var/lib/fosuclass/schedule-collector/session.json";

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function signed(method, urlPath, body) {
  const raw = body ? JSON.stringify(body) : "";
  const timestamp = String(Date.now());
  const nonce = Math.random().toString(16).slice(2) + Date.now().toString(16);
  const signature = signRequest(SECRET, { method, path: urlPath, timestamp, nonce, body: raw });
  const response = await fetch(ORACLE + urlPath, {
    method,
    headers: {
      authorization: "Bearer " + TOKEN,
      "content-type": "application/json",
      "x-full-sync-agent-id": AGENT_ID,
      "x-full-sync-timestamp": timestamp,
      "x-full-sync-nonce": nonce,
      "x-full-sync-signature": signature,
    },
    body: raw || undefined,
  });
  return response;
}

async function main() {
  if (TOKEN.length < 32 || SECRET.length < 32 || TOKEN === SECRET) fail("full-sync credentials are not configured");
  if (process.env.CAMPUS_AGENT_TOKEN && TOKEN === process.env.CAMPUS_AGENT_TOKEN) fail("full-sync token must not reuse the personal agent token");
  await signed("POST", "/api/full-sync/v1/heartbeat", { ok: true });
  if (process.env.FOSU_COLLECTOR_EXECUTE !== "1") {
    console.log("collector-heartbeat-only execute=disabled");
    return;
  }
  if (!fs.existsSync(SESSION_PATH)) {
    console.log("校内采集会话已失效，请人工刷新");
    return;
  }
  const mode = process.argv.includes("--full") ? "full" : "routine";
  const command = collectorCommand(mode);
  if (command.publishesRelease || command.concurrency > 2) fail("collector command is not allowed");
  console.log("collector-planned script=" + command.script + " args=" + command.args.join(","));
}

main().catch((error) => fail(error && error.message || "collector failed"));
