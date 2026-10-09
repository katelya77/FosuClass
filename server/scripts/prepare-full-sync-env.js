"use strict";
const fs = require("fs"), crypto = require("crypto");
function values(text) {
  return Object.fromEntries(String(text).split(/\r?\n/).map(line => line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(match => [match[1], match[2].replace(/^(["'])(.*)\1$/, "$2")]));
}
function prepare(file, previousFile) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("FULL_SYNC_ENV_FILE_REJECTED");
  const text = fs.readFileSync(file, "utf8"), incoming = values(text);
  const previous = previousFile && fs.existsSync(previousFile) ? values(fs.readFileSync(previousFile, "utf8")) : {};
  const id = incoming.FULL_SYNC_AGENT_ID || previous.FULL_SYNC_AGENT_ID || "wyz-schedule-collector";
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id)) throw new Error("FULL_SYNC_AGENT_ID_REJECTED");
  const protectedValues = [incoming.CAMPUS_AGENT_TOKEN, incoming.CAMPUS_AGENT_SIGNING_SECRET, previous.CAMPUS_AGENT_TOKEN, previous.CAMPUS_AGENT_SIGNING_SECRET].filter(Boolean);
  const keys = ["FULL_SYNC_AGENT_TOKEN", "FULL_SYNC_SIGNING_SECRET"], credentials = [];
  let created = false;
  for (const key of keys) {
    let value = incoming[key] || previous[key];
    if (!value) { value = crypto.randomBytes(32).toString("hex"); created = true; }
    if (!/^[A-Za-z0-9+\/_=~.-]{32,256}$/.test(value) || protectedValues.includes(value) || credentials.includes(value)) throw new Error("FULL_SYNC_CREDENTIAL_ISOLATION_REJECTED");
    credentials.push(value);
  }
  const retained = text.split(/\r?\n/).filter(line => !/^(FULL_SYNC_AGENT_ID|FULL_SYNC_AGENT_TOKEN|FULL_SYNC_SIGNING_SECRET|FOSU_COLLECTOR_TIMER_VERIFIED)=/.test(line)).join("\n").trimEnd();
  fs.writeFileSync(file, retained + "\nFULL_SYNC_AGENT_ID=" + id + "\n" + keys.map((key, index) => key + "=" + credentials[index]).join("\n") + "\nFOSU_COLLECTOR_TIMER_VERIFIED=0\n", { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return { agentId: id, token: "present", signingSecret: "present", created, timerVerified: false };
}
if (require.main === module) {
  try { console.log(JSON.stringify(prepare(process.argv[2], process.argv[3]))); }
  catch (_) { console.error("FULL_SYNC_ENV_PREPARATION_REJECTED"); process.exitCode = 1; }
}
module.exports = { prepare, values };
