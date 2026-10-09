#!/usr/bin/env node
"use strict";
const fs = require("fs"), crypto = require("crypto");
const signature = require(require("path").resolve(__dirname.startsWith("/app/storage/") ? "/app/server/src/security/fullSyncSignature" : __dirname + "/../src/security/fullSyncSignature"));
async function audit() {
  const status = Object.fromEntries(["FULL_SYNC_AGENT_ID", "FULL_SYNC_AGENT_TOKEN", "FULL_SYNC_SIGNING_SECRET"].map(key => [key, process.env[key] ? "CONFIGURED" : "MISSING"]));
  console.log(JSON.stringify(status));
  if (Object.values(status).includes("MISSING")) throw new Error("FULL_SYNC_CONFIGURATION_MISSING");
  const configured = signature.secretsConfigured();
  if (!configured) throw new Error("FULL_SYNC_CONFIGURATION_INVALID");
  // Real HTTP authentication against the running Broker. No job claim, upload,
  // school request, personal-Agent secret access or pointer operation.
  const route = "/api/full-sync/v1/heartbeat", body = Buffer.from('{"ok":true}');
  const timestamp = String(Date.now()), nonce = crypto.randomBytes(20).toString("hex");
  const response = await fetch("http://127.0.0.1:3000" + route, { method: "POST", signal: AbortSignal.timeout(15000), redirect: "error", headers: { "content-type": "application/json", authorization: "Bearer " + configured.token, "x-full-sync-agent-id": configured.agentId, "x-full-sync-timestamp": timestamp, "x-full-sync-nonce": nonce, "x-full-sync-signature": signature.signRequest(configured.secret, { method: "POST", path: route, timestamp, nonce, body }) }, body });
  if (response.status !== 200 || (await response.json()).ok !== true) throw new Error("BROKER_AUTHENTICATION_FAILED");
  // Bind successful authentication to the persisted source, without printing it.
  const file = "/app/server/.env";
  const persisted = process.argv.includes("--persisted-stdin") ? fs.readFileSync(0, "utf8") : fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (persisted !== null) {
    const values = Object.fromEntries(persisted.split(/\r?\n/).map(line => line.match(/^(FULL_SYNC_[A-Z_]+)=(.*)$/)).filter(Boolean).map(match => [match[1], match[2]]));
    if (["FULL_SYNC_AGENT_ID", "FULL_SYNC_AGENT_TOKEN", "FULL_SYNC_SIGNING_SECRET"].some(key => values[key] !== process.env[key])) throw new Error("PERSISTED_CREDENTIALS_MISMATCH");
  }
  return { brokerAuthentication: "PASS", persistedSource: persisted === null ? "UNKNOWN" : "MATCH", httpStatus: 200, probeOrigin: "ORACLE_LOOPBACK", claimRequests: 0, schoolRequests: 0 };
}
if (require.main === module) audit().then(value => console.log(JSON.stringify(value))).catch(() => { console.error("FULL_SYNC_BROKER_AUDIT_FAILED"); process.exitCode = 1; });
module.exports = { audit };
