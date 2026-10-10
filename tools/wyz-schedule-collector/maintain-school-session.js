#!/usr/bin/env node
"use strict";
const { checkSession, ensureSession } = require("./schoolSession");
async function main(args = process.argv.slice(2)) {
  if (process.platform === "win32" || process.getuid() !== 0) throw Object.assign(new Error("ROOT_REQUIRED"),{code:"ROOT_REQUIRED"});
  if (!args.includes("--approve-school-access") || args.some(arg => !["--approve-school-access","--check-only"].includes(arg))) throw Object.assign(new Error("SCHOOL_AUTH_APPROVAL_REQUIRED"),{code:"SCHOOL_AUTH_APPROVAL_REQUIRED"});
  const { acquireLock } = require("./runStore");
  const cfg = { dataRoot:"/var/lib/fosuclass/schedule-collector",sessionPath:"/var/lib/fosuclass/schedule-collector/session.json" };
  if (args.includes("--check-only")) {
    const result = await checkSession(cfg,{ approved:true });
    console.log(JSON.stringify(result));
    if (result.status !== "SESSION_VALID") process.exitCode = 78;
    return result;
  }
  const unlock = acquireLock(cfg.dataRoot);
  try { console.log(JSON.stringify(await ensureSession(cfg,{ approved:true,manualRecovery:true }))); } finally { unlock(); }
}
if (require.main === module) main().catch(error=>{ console.error(JSON.stringify({code:/^[A-Z_]+$/.test(error.code||"")?error.code:"SCHOOL_AUTH_FAILED"}));process.exitCode=1; });
module.exports={main};
