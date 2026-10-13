"use strict";
// systemd ExecStopPost after exit/timeout/SIGKILL. Never calls a school or retries.
const fs = require("node:fs"), path = require("node:path");
const { privatePath } = require("./wyz-sample"), contract = require("./contract"), diagnostics = require("./worker-diagnostics");
function finalize(file) {
  privatePath(file);
  const a = JSON.parse(fs.readFileSync(file, "utf8")), root = path.dirname(file);
  if (file !== "/root/fosu-collector-closure/" + a.runId + "/approval.json" || a.runId === contract.RETIRED_RUN || a.wyzRevision !== contract.WYZ_REVISION) throw new Error("CLOSURE_FINALIZER_SCOPE_REJECTED");
  const result = path.join(root, "result.json");
  if (fs.existsSync(result)) { privatePath(result); return; }
  const pins = require("./installed-source-pins.json");
  const detail = diagnostics.read(path.join("/var/lib/fosuclass/schedule-collector/runs", a.term, a.runId), a, pins.files["tools/fosu-sync-client/sync.js"]);
  const value = { status:"BLOCKED", code:"CLOSURE_EXECUTOR_INTERRUPTED", runId:a.runId,
    schoolAccessReserved:fs.existsSync(path.join(root,"school-access.started.json")),
    passwordSubmissions:"UNKNOWN", schoolRequests:"UNKNOWN", evidenceRetained:true,
    replayAllowed:false, publication:"NOT_APPROVED", ...detail };
  const fd = fs.openSync(result,"wx",0o600);
  try {fs.writeFileSync(fd,JSON.stringify(value)+"\n");fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const directory=fs.openSync(root,"r");try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
}
if(require.main===module){try{finalize(process.argv[2]);}catch{console.error("CLOSURE_FINALIZER_FAILED");process.exitCode=2;}}
module.exports={finalize};
