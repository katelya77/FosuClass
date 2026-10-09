#!/usr/bin/env node
"use strict";
const fs = require("fs"), path = require("path");
const { secretsConfigured } = require(require("path").resolve(__dirname.startsWith("/app/storage/") ? "/app/server/src/security/fullSyncSignature" : __dirname + "/../src/security/fullSyncSignature"));
function exportEncrypted(publicFile, outputFile, helperFile) {
  if (process.getuid() !== 0 || path.dirname(publicFile || "") !== "/app/storage/secure" || path.dirname(outputFile || "") !== "/app/storage/secure") throw new Error("PRIVATE_TRANSFER_PATH_REJECTED");
  const { seal, exclusive } = require(helperFile);
  const configured = secretsConfigured();
  if (!configured || configured.agentId !== "wyz-schedule-collector") throw new Error("FULL_SYNC_CONFIGURATION_INVALID");
  if (fs.statSync(publicFile).size > 8192) throw new Error("RECIPIENT_KEY_REJECTED");
  exclusive(outputFile, JSON.stringify(seal({ FULL_SYNC_AGENT_ID: configured.agentId, FULL_SYNC_AGENT_TOKEN: configured.token, FULL_SYNC_SIGNING_SECRET: configured.secret }, fs.readFileSync(publicFile)), null, 2));
  return { encryptedExport: "PASS", permissions: "600", plaintextExported: false };
}
if (require.main === module) { try { console.log(JSON.stringify(exportEncrypted(...process.argv.slice(2)))); } catch (_) { console.error("ENCRYPTED_TRANSFER_REJECTED"); process.exitCode = 1; } }
module.exports = { exportEncrypted };
