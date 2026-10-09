"use strict";
const fs = require("fs"), path = require("path");
const { secretsConfigured } = require("../src/security/fullSyncSignature");
function exportLease(file) {
  if (typeof process.getuid === "function" && process.getuid() !== 0) throw new Error("ROOT_REQUIRED");
  if (!path.isAbsolute(file || "") || path.dirname(file) !== "/app/storage/secure") throw new Error("PRIVATE_EXPORT_PATH_REJECTED");
  const configured = secretsConfigured();
  if (!configured) throw new Error("FULL_SYNC_CREDENTIALS_MISSING");
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const parent = fs.lstatSync(dir);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || (parent.mode & 0o077)) throw new Error("PRIVATE_EXPORT_DIRECTORY_REJECTED");
  const content = "FULL_SYNC_AGENT_ID=" + configured.agentId + "\nFULL_SYNC_AGENT_TOKEN=" + configured.token + "\nFULL_SYNC_SIGNING_SECRET=" + configured.secret + "\nFOSU_API_BASE=https://class.katelya.eu.org\nFOSU_COLLECTOR_EXECUTE=0\nSCHOOL_CONCURRENCY=1\n";
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, content); } finally { fs.closeSync(fd); }
  return { exported: true, permissions: "600", execute: false };
}
if (require.main === module) {
  try { console.log(JSON.stringify(exportLease(process.argv[2]))); }
  catch (_) { console.error("FULL_SYNC_PRIVATE_EXPORT_REJECTED"); process.exitCode = 1; }
}
module.exports = { exportLease };
