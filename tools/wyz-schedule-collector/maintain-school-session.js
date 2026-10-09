#!/usr/bin/env node
"use strict";
const { ensureSession } = require("./schoolSession");
async function main(args = process.argv.slice(2)) {
  if (process.platform === "win32" || process.getuid() !== 0) throw Object.assign(new Error("ROOT_REQUIRED"),{code:"ROOT_REQUIRED"});
  if (!args.includes("--approve-school-access") || args.some(arg => arg !== "--approve-school-access")) throw Object.assign(new Error("SCHOOL_AUTH_APPROVAL_REQUIRED"),{code:"SCHOOL_AUTH_APPROVAL_REQUIRED"});
  const { acquireLock } = require("./runStore");
  const cfg = { dataRoot:"/var/lib/fosuclass/schedule-collector",sessionPath:"/var/lib/fosuclass/schedule-collector/session.json" };
  const unlock = acquireLock(cfg.dataRoot);
  try { console.log(JSON.stringify(await ensureSession(cfg,{ approved:true,manualRecovery:true }))); } finally { unlock(); }
}
if (require.main === module) main().catch(error=>{ console.error(JSON.stringify({code:/^[A-Z_]+$/.test(error.code||"")?error.code:"SCHOOL_AUTH_FAILED"}));process.exitCode=1; });
module.exports={main};
