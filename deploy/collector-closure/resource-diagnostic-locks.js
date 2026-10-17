"use strict";
// Diagnostic-only interop with the installed PID locks. Never reclaim a lock.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), {execFileSync} = require("node:child_process");
const fail = code => Object.assign(new Error(code), {code});
const RUNNER = "/var/lib/fosuclass/schedule-collector/acceptance/heartbeat-only-runner.js";
const RUNNER_HASHES = ["4e0b685381799fba263cf54bbf7a95db6689f7aa9c71e7e88481c7444acb13ba", "b3fae60cc03d39257608c046fafc25eedb6c94b172c73f1e8963fbf06aa945f0"];
function privateStat(file, directory=false) {
  const s=fs.lstatSync(file);
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile() || s.nlink!==1) || s.uid!==process.geteuid() || s.mode&0o077 || !directory && s.size>65536) throw fail("COLLECTOR_LOCK_STATE_UNKNOWN");
  return s;
}
function json(file) { privateStat(file); return JSON.parse(fs.readFileSync(file,"utf8")); }
function identity(pid) {
  if (!Number.isSafeInteger(pid) || pid<2) throw fail("COLLECTOR_LOCK_STATE_UNKNOWN");
  const stat=fs.readFileSync(`/proc/${pid}/stat`,"utf8"), fields=stat.slice(stat.lastIndexOf(")")+2).split(" ");
  if (!["R","S","D","I"].includes(fields[0]) || !/^\d+$/.test(fields[19])) throw fail("COLLECTOR_LOCK_STATE_UNKNOWN");
  return {pid, start:fields[19], boot:fs.readFileSync("/proc/sys/kernel/random/boot_id","utf8").trim()};
}
function verifyHeartbeat(state, binding) {
  privateStat(state,true);
  const lock=path.join(state,"collector.lock"), owner=json(lock), before=identity(owner.pid);
  if (owner.pid!==binding.pid) throw fail("COLLECTOR_LOCK_STATE_UNKNOWN");
  const argv=fs.readFileSync(`/proc/${owner.pid}/cmdline`).toString().split("\0").filter(Boolean);
  if (JSON.stringify(argv)!==JSON.stringify(binding.argv)) throw fail("COLLECTOR_LOCK_STATE_UNKNOWN");
  // Values are inspected in-process only; never return or print the environment.
  const execute=fs.readFileSync(`/proc/${owner.pid}/environ`).toString().split("\0").filter(v=>v.startsWith("FOSU_COLLECTOR_EXECUTE="));
  if (execute.length!==1 || execute[0]!=="FOSU_COLLECTOR_EXECUTE=0") throw fail("COLLECTOR_NOT_HEARTBEAT_ONLY");
  const status=json(path.join(state,"collector-status.json")), stamp=Date.parse(status.lastSuccessfulHeartbeatAt);
  const hz=Number(execFileSync("getconf",["CLK_TCK"],{encoding:"utf8",timeout:3000}));
  const boot=Number(fs.readFileSync("/proc/stat","utf8").match(/^btime (\d+)$/m)?.[1]);
  const started=(boot+Number(before.start)/hz)*1000;
  if (!Number.isFinite(started) || fs.statSync(lock).mtimeMs<started-1000 || fs.statSync(path.join(state,"collector-status.json")).mtimeMs<started-1000 || !Number.isFinite(stamp) || stamp<started-1000 || stamp>Date.now()+1000 || Date.now()-stamp>90000 || status.mode!=="heartbeat-only" || !["healthy","recovering"].includes(status.networkStatus)) throw fail("COLLECTOR_LOCK_STATE_UNKNOWN");
  if (JSON.stringify(before)!==JSON.stringify(identity(owner.pid)) || json(lock).pid!==owner.pid) throw fail("COLLECTOR_LOCK_STATE_UNKNOWN");
  return before;
}
function productionHeartbeat(state) {
  const query=()=>{
    const raw=execFileSync("systemctl",["show","wyz-schedule-collector.service","-p","MainPID","-p","ActiveState","-p","SubState"],{encoding:"utf8",timeout:3000,maxBuffer:4096});
    const values=Object.fromEntries(raw.trim().split("\n").map(line=>line.split("=")));
    if (values.ActiveState!=="active" || values.SubState!=="running") throw fail("COLLECTOR_LOCK_STATE_UNKNOWN");
    return Number(values.MainPID);
  };
  const pid=query(); privateStat(RUNNER);
  if (!RUNNER_HASHES.includes(crypto.createHash("sha256").update(fs.readFileSync(RUNNER)).digest("hex"))) throw fail("COLLECTOR_NOT_HEARTBEAT_ONLY");
  const result=verifyHeartbeat(state,{pid,argv:["/usr/bin/node",RUNNER]});
  if (query()!==pid) throw fail("COLLECTOR_LOCK_STATE_UNKNOWN");
  return result;
}
function acquireDiagnosticLocks(state, _legacyStore, verify=()=>productionHeartbeat(state)) {
  const held=[]; let initial;
  function owned(item) {
    const s=privateStat(item.file);
    return s.ino===item.ino && s.dev===item.dev && fs.readFileSync(item.file,"utf8")===item.raw;
  }
  const release=()=>{
    while(held.length) { const item=held.pop(); try { if(owned(item)) fs.unlinkSync(item.file); } catch (_) { /* Preserve unknown ownership for review. */ } }
  };
  try {
    initial=verify();
    for (const name of ["manual-sync.lock","school-session.lock"]) {
      const file=path.join(state,name), nonce=crypto.randomBytes(24).toString("hex");
      const raw=JSON.stringify({...identity(process.pid),nonce});
      let fd;
      try { fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600); }
      catch (e) { if(e.code==="EEXIST") throw fail("COLLECTOR_LOCKED"); throw e; }
      try { fs.writeFileSync(fd,raw); fs.fsyncSync(fd); const s=fs.fstatSync(fd); held.push({file,raw,ino:s.ino,dev:s.dev}); }
      finally { fs.closeSync(fd); }
    }
    const check=()=>{ if(JSON.stringify(verify())!==JSON.stringify(initial) || held.length!==2 || held.some(item=>!owned(item))) throw fail("COLLECTOR_LOCK_STATE_UNKNOWN"); };
    check(); release.check=check; return release;
  } catch(e) { release(); throw fail(e.code==="COLLECTOR_LOCKED" || e.code==="COLLECTOR_NOT_HEARTBEAT_ONLY" ? e.code : "COLLECTOR_LOCK_STATE_UNKNOWN"); }
}
module.exports={acquireDiagnosticLocks,verifyHeartbeat,productionHeartbeat,identity};
