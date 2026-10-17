"use strict";
const assert=require("node:assert/strict"), fs=require("node:fs"), os=require("node:os"), path=require("node:path"), cp=require("node:child_process");
const diagnostic=require("../deploy/collector-closure/resource-page-diagnostic"), locks=require("../deploy/collector-closure/resource-diagnostic-locks"), store=require("./wyz-schedule-collector/runStore");
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn) { for(let i=0;i<250;i++){if(fn())return;await wait(20);}throw Error("FIXTURE_TIMEOUT"); }
const kind=process.argv[2], state=process.argv[3];
if(kind==="--daemon") {
  process.umask(0o077);
  require("./wyz-schedule-collector/collector").main({fetcher:async url=>({ok:true,status:url.endsWith("/claim")?204:200,json:async()=>({ok:true})})}).catch(e=>{console.error(e);process.exitCode=1;});
} else if(kind==="--operation") {
  const release=store.acquireLock(state,process.argv[4]);
  process.send({status:"HELD"});const timer=setInterval(()=>{},1000);
  process.once("SIGTERM",()=>{release();clearInterval(timer);});
} else if(kind==="--diagnostic") {
  let release, timer;
  const binding=JSON.parse(process.argv[4]);
  const stop=()=>{if(release)release();clearInterval(timer);process.exit(0);};
  process.once("SIGTERM",stop);
  process.on("message",message=>{
    if(message!=="START")return;
    try { release=diagnostic.acquireDiagnosticLocks(state,store,()=>locks.verifyHeartbeat(state,binding)); process.send({status:"HELD"}); timer=setInterval(()=>{},1000); }
    catch(e){process.send({status:"BLOCKED",code:e.code,schoolRequests:0});process.exitCode=2;process.disconnect();}
  });
} else if(process.platform!=="linux") {console.log("diagnostic-locks: Linux process identity scenarios require Linux; Windows browser/delivery tests run separately");}
else (async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"fosu-diagnostic-locks-")); const children=[];
  const env={...process.env,FOSU_COLLECTOR_EXECUTE:"0",FOSU_COLLECTOR_DATA_DIR:root,FULL_SYNC_AGENT_ID:"fixture",FULL_SYNC_AGENT_TOKEN:"a".repeat(40),FULL_SYNC_SIGNING_SECRET:"b".repeat(40)};
  const spawn=(args)=>{const c=cp.fork(__filename,args,{env,stdio:["ignore","ignore","pipe","ipc"]});children.push(c);return c;};
  const gone=c=>c.exitCode!==null||c.signalCode!==null;
  const message=c=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error("IPC_TIMEOUT")),6000);c.once("message",v=>{clearTimeout(t);resolve(v);});});
  const bytes=name=>fs.readFileSync(path.join(root,name),"utf8");
  let daemon;
  try {
    daemon=spawn(["--daemon",root]); await until(()=>fs.existsSync(path.join(root,"collector-status.json")));
    const binding={pid:daemon.pid,argv:[process.execPath,__filename,"--daemon",root]};
    const verify=()=>locks.verifyHeartbeat(root,binding), acquire=()=>diagnostic.acquireDiagnosticLocks(root,store,verify);
    const original=bytes("collector.lock");
    let unlock=acquire();unlock.check();
    assert.equal(JSON.parse(bytes("school-session.lock")).pid,process.pid);unlock();
    assert.equal(bytes("collector.lock"),original);assert(!gone(daemon));
    console.log("A PASS: actual collector.main execute=0 heartbeat holds collector.lock; diagnostic enters; daemon untouched");
    const executableRoot=path.join(root,"execute-mode");fs.mkdirSync(executableRoot,{mode:0o700});
    const executing=cp.fork(__filename,["--daemon",executableRoot],{env:{...env,FOSU_COLLECTOR_EXECUTE:"1",FOSU_COLLECTOR_DATA_DIR:executableRoot},stdio:"ignore"});children.push(executing);
    await until(()=>fs.existsSync(path.join(executableRoot,"collector-status.json")));
    assert.throws(()=>diagnostic.acquireDiagnosticLocks(executableRoot,store,()=>locks.verifyHeartbeat(executableRoot,{pid:executing.pid,argv:[process.execPath,__filename,"--daemon",executableRoot]})),e=>e.code==="COLLECTOR_NOT_HEARTBEAT_ONLY");assert(!gone(executing));
    executing.kill("SIGTERM");await until(()=>gone(executing));
    for(const name of ["school-session.lock","manual-sync.lock"]) {
      const c=spawn(["--operation",root,name]);assert.equal((await message(c)).status,"HELD");const before=bytes(name);
      assert.throws(acquire,e=>e.code==="COLLECTOR_LOCKED");assert.equal(bytes(name),before);assert(!gone(c));
      c.kill("SIGTERM");await until(()=>gone(c));
    }
    console.log("B/C PASS: live legacy runStore Session/auth/collection and manual-sync owners block; requests=0; owners intact");
    const statusFile=path.join(root,"collector-status.json"), status=bytes("collector-status.json");
    for(const patch of [{mode:"execute"},{lastSuccessfulHeartbeatAt:"2000-01-01T00:00:00Z"},{networkStatus:"fatal"}]) {
      fs.writeFileSync(statusFile,JSON.stringify({...JSON.parse(status),...patch}));
      assert.throws(acquire,e=>e.code==="COLLECTOR_LOCK_STATE_UNKNOWN");fs.writeFileSync(statusFile,status);
    }
    assert.throws(()=>diagnostic.acquireDiagnosticLocks(root,store,()=>locks.verifyHeartbeat(root,{...binding,pid:process.pid})),e=>e.code==="COLLECTOR_LOCK_STATE_UNKNOWN");
    const oldTime=fs.statSync(path.join(root,"collector.lock")).mtime;
    fs.utimesSync(path.join(root,"collector.lock"),new Date(0),new Date(0));assert.throws(acquire);fs.utimesSync(path.join(root,"collector.lock"),oldTime,oldTime);
    const stale=path.join(root,"school-session.lock");fs.writeFileSync(stale,JSON.stringify({pid:2147483647}),{mode:0o600});const staleBytes=bytes("school-session.lock");assert.throws(acquire);assert.equal(bytes("school-session.lock"),staleBytes);fs.unlinkSync(stale);
    unlock=acquire();fs.unlinkSync(stale);fs.writeFileSync(stale,JSON.stringify({pid:process.pid,nonce:"replacement"}),{mode:0o600});unlock();assert.equal(JSON.parse(bytes("school-session.lock")).nonce,"replacement");fs.unlinkSync(stale);
    console.log("D PASS: unknown/execute/stale heartbeat, PID mismatch/reuse and stale locks deny; replacement lock not released");
    const start=()=>{const c=spawn(["--diagnostic",root,JSON.stringify(binding)]),p=message(c);c.send("START");return {c,p};};
    const one=start(),two=start(),answers=await Promise.all([one.p,two.p]);assert.equal(answers.filter(a=>a.status==="HELD").length,1);assert.equal(answers.filter(a=>a.status==="BLOCKED"&&a.code==="COLLECTOR_LOCKED"&&a.schoolRequests===0).length,1);
    const winner=answers[0].status==="HELD"?one.c:two.c;
    winner.disconnect();await wait(100);assert(!gone(winner));assert.equal(JSON.parse(bytes("school-session.lock")).pid,winner.pid);
    winner.kill("SIGTERM");await until(()=>gone(winner));assert(!fs.existsSync(stale));assert(!fs.existsSync(path.join(root,"manual-sync.lock")));
    const timed=cp.spawn("timeout",["--signal=TERM","--kill-after=1s","1s",process.execPath,__filename,"--diagnostic",root,JSON.stringify(binding)],{env:{...env,NODE_CHANNEL_FD:"3",NODE_CHANNEL_SERIALIZATION_MODE:"json"},stdio:["ignore","ignore","pipe","ipc"]});children.push(timed);
    const timedAnswer=message(timed);timed.send("START");assert.equal((await timedAnswer).status,"HELD");await until(()=>gone(timed));assert.equal(timed.exitCode,124);assert(!fs.existsSync(stale));
    const hard=start();assert.equal((await hard.p).status,"HELD");hard.c.kill("SIGKILL");await until(()=>gone(hard.c));const unknown=bytes("school-session.lock");assert.throws(acquire);assert.equal(bytes("school-session.lock"),unknown);
    console.log("D/E PASS: IPC/PAM detach retains active ownership; TERM releases own locks; KILL retains review evidence; simultaneous diagnoses admit exactly one; requests=0");
    assert.equal(bytes("collector.lock"),original);assert(!gone(daemon));
    console.log("diagnostic-locks: PASS all A-E Linux scenarios; no network/school requests; real heartbeat process remains alive");
  } finally {
    for(const c of children) if(!gone(c)) c.kill("SIGTERM");
    await until(()=>children.every(gone));fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
