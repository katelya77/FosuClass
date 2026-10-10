"use strict";
const assert=require("assert/strict"),fs=require("fs"),os=require("os"),path=require("path"),{EventEmitter}=require("events");
const auth=require("./wyz-schedule-collector/schoolSession"),cli=require("./wyz-schedule-collector/cli");
const prompt=require("./wyz-schedule-collector/terminalPrompt"),{acquireLock}=require("./wyz-schedule-collector/runStore");
const profiles=require("./fosu-sync-client/schoolLoginProfile");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"fosu-manual-fixture-"));
const cfg={dataRoot:root,sessionPath:path.join(root,"session.json")};
let cases=0;
async function test(work){await work();cases++;}
const session={cookies:[{name:"fixture",value:"synthetic-session",domain:"100.fosu.edu.cn"}],origins:[]};
const clear=()=>{for(const file of fs.readdirSync(root))fs.unlinkSync(path.join(root,file));};
const deps=()=>({approved:true,readCredentials:async()=>({account:"fixture-user",password:"fixture-only-secret"}),confirmReuse:async()=>true,
  createAdapter:async()=>({check:async file=>file.endsWith(".candidate")?"SESSION_VALID":"SESSION_EXPIRED",login:async()=>session,close:async()=>{}})});
async function main(){
  await test(()=>{assert.equal(profiles.contextOptions().isMobile,true);assert.equal(profiles.contextOptions().hasTouch,true);assert.equal(profiles.contextOptions().deviceScaleFactor,3);assert.equal(profiles.contextOptions("desktop").isMobile,false);assert.throws(()=>profiles.contextOptions("other"));});
  await test(async()=>{const r=await auth.interactiveSession(cfg,deps());assert.equal(r.status,"SESSION_SAVED");assert.equal(r.passwordPersisted,false);assert.ok(fs.existsSync(cfg.sessionPath));assert.ok(!fs.existsSync(path.join(root,"school-auth.json")));assert.ok(!fs.readFileSync(path.join(root,"school-auth-state.json"),"utf8").includes("fixture-only-secret"));});
  await test(async()=>{const d=deps();d.createAdapter=async()=>({check:async()=>"SESSION_VALID",login:()=>assert.fail("must reuse"),close:async()=>{}});d.readCredentials=()=>assert.fail("valid reuse must not read credentials");assert.equal((await auth.interactiveSession(cfg,d)).status,"SESSION_REUSED");});
  await test(async()=>{const before=fs.readFileSync(cfg.sessionPath);const d=deps();d.createAdapter=async()=>({check:async()=> "SESSION_EXPIRED",login:async()=>session,close:async()=>{}});await assert.rejects(auth.interactiveSession(cfg,d),/SESSION_INVALID/);assert.deepEqual(fs.readFileSync(cfg.sessionPath),before);assert.ok(!fs.existsSync(cfg.sessionPath+".candidate"));});
  await test(async()=>{await assert.rejects(auth.interactiveSession(cfg,deps()),/MANUAL_ACTION_REQUIRED/);});
  await test(async()=>{const release=acquireLock(root,"collector.lock");try{clearStateOnly();assert.equal((await auth.interactiveSession(cfg,deps())).status,"SESSION_SAVED");}finally{release();}});
  await test(async()=>{const release=acquireLock(root,"school-session.lock");try{await assert.rejects(auth.interactiveSession(cfg,deps()),/COLLECTOR_LOCKED/);}finally{release();}});
  await test(async()=>{clear();const d=deps();let submits=0;d.createAdapter=async()=>({check:async()=>"SESSION_EXPIRED",login:async()=>{submits++;throw {code:"INVALID_CREDENTIALS",message:"private fixture-only-secret"};},close:async()=>{}});await assert.rejects(auth.interactiveSession(cfg,d),/INVALID_CREDENTIALS/);await assert.rejects(auth.interactiveSession(cfg,d),/MANUAL_ACTION_REQUIRED/);assert.equal(submits,1);assert.ok(!fs.readFileSync(path.join(root,"school-auth-state.json"),"utf8").includes("private"));assert.ok(!fs.existsSync(cfg.sessionPath));});
  await test(async()=>{await assert.rejects(auth.interactiveSession(cfg,{...deps(),acknowledgeFailure:true}),/COOLDOWN/);});
  await test(async()=>{clear();const control=new AbortController();control.abort();await assert.rejects(auth.interactiveSession(cfg,{...deps(),signal:control.signal}),/COLLECTOR_STOPPED/);assert.equal(fs.existsSync(cfg.sessionPath),false);});
  await test(async()=>{await assert.rejects(prompt.readHidden("fixture",{input:{isTTY:false},output:{isTTY:true}}),/TTY_REQUIRED/);});
  function terminal(){const input=new EventEmitter();let raw=false,paused=true,written="";Object.assign(input,{isTTY:true,isRaw:false,setRawMode:value=>{raw=value;input.isRaw=value;},isPaused:()=>paused,pause:()=>paused=true,resume:()=>paused=false});const output={isTTY:true,write:value=>written+=value};return {input,output,state:()=>({raw,paused,written})};}
  await test(async()=>{const t=terminal(),value=prompt.readHidden("密码: ",t);t.input.emit("data",Buffer.from("fixture-only-secret\r"));assert.equal(await value,"fixture-only-secret");assert.deepEqual(t.state(),{raw:false,paused:true,written:"密码: \n"});assert.equal(t.input.listenerCount("data"),0);});
  await test(async()=>{const t=terminal(),value=prompt.readHidden("密码: ",t);t.input.emit("data",Buffer.from("\x03"));await assert.rejects(value,/COLLECTOR_STOPPED/);assert.equal(t.state().raw,false);});
  await test(async()=>{const t=terminal(),value=prompt.readHidden("密码: ",t);t.input.emit("data",Buffer.from("one\ntwo\n"));await assert.rejects(value,/INPUT_REJECTED/);assert.equal(t.state().raw,false);});
  await test(async()=>{const t=terminal(),control=new AbortController(),value=prompt.readHidden("密码: ",{...t,signal:control.signal});control.abort();await assert.rejects(value,/COLLECTOR_STOPPED/);assert.equal(t.state().raw,false);});
  await test(()=>{for(const args of [["login","--password=fixture"],["login","--account=fixture"],["login","--login-profile=other"],["status","--mode=full"],["manual-sync","--mode=sample","--mode=full"]])assert.throws(()=>cli.parse(args),/ARGUMENT_REJECTED/);assert.throws(()=>cli.parse(["status","--check-session"]),/NOT_AUTHORIZED/);});
  const outputs=[],base={cfg,skipRootCheck:true,output:value=>outputs.push(value),serviceState:()=>"active",ask:async()=>"REUSE"};
  await test(async()=>{clear();await cli.main(["status"],{...base,connection:()=>({request:async()=>({protocol:"collector-manual.v1",status:{recent:[]}}),close:()=>{}}),authDeps:{createAdapter:()=>assert.fail("status cannot contact school")}});assert.equal(outputs.at(-1).session,"SESSION_FILE_MISSING");assert.equal(outputs.at(-1).schoolRequests,0);});
  await test(async()=>{await assert.rejects(cli.main(["manual-sync","--mode=full"],{...base,connection:()=>assert.fail("full blocked before network")}),/SCOPE_REVIEW/);});
  await test(async()=>{await assert.rejects(cli.main(["manual-sync"],{...base,connection:()=>({request:async()=>({protocol:"legacy"}),close:()=>{}}),ask:()=>assert.fail("unsupported Oracle must stop before credentials")}),/API_UNAVAILABLE/);});
  await test(async()=>{await assert.rejects(cli.main(["manual-sync"],{...base,connection:()=>({request:async()=>({protocol:"collector-manual.v1",status:{current:{mode:"routine"}}}),close:()=>{}}),ask:()=>assert.fail("unapproved scope cannot prompt credentials")}),/NOT_AUTHORIZED/);});
  await test(async()=>{clear();const r=await cli.main(["login","--approve-school-access","--login-profile=desktop"],{...base,authDeps:deps()});assert.equal(r.status,"SESSION_SAVED");assert.equal(r.loginProfile,"desktop");assert.equal(outputs.some(v=>JSON.stringify(v).includes("fixture-only-secret")),false);});
  if(!process.stdin.isTTY)await test(async()=>{await assert.rejects(cli.main(["login","--approve-school-access"],{...base,ask:undefined,authDeps:{createAdapter:()=>assert.fail("no network without TTY")}}),/TTY_REQUIRED/);});
  await test(()=>{assert.equal(cli.errorCode({code:"SESSION_EXPIRED"}),"SCHOOL_SESSION_EXPIRED");assert.equal(cli.errorCode({name:"TimeoutError",message:"url private fixture"}),"SCHOOL_NETWORK_TIMEOUT");assert.equal(cli.errorCode({message:"ERR_CERT_AUTHORITY_INVALID private"}),"SCHOOL_TLS_OR_ORIGIN_REJECTED");assert.equal(cli.errorCode({code:"STAGING_SAMPLE_API_UNAVAILABLE"}),"STAGING_SAMPLE_API_UNAVAILABLE");});
  if(process.platform!=="win32")await test(async()=>{clear();fs.chmodSync(root,0o755);try{await assert.rejects(auth.interactiveSession(cfg,deps()),/PERMISSIONS_REJECTED/);}finally{fs.chmodSync(root,0o700);}});
  console.log("collector-manual-cli: "+cases+" PASS; fixture only; schoolRequests=0; productionWrites=0");
}
function clearStateOnly(){const file=path.join(root,"school-auth-state.json");if(fs.existsSync(file))fs.unlinkSync(file);}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
