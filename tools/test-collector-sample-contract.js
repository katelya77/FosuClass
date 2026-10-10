"use strict";
const assert=require("assert/strict"),fs=require("fs"),os=require("os"),path=require("path"),crypto=require("crypto");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"fosu-sample-fixture-"));
process.env.FOSU_STORAGE_DIR=path.join(root,"oracle");process.env.FOSU_DATA_DIR=path.join(root,"data");process.env.SCHEDULE_COLLECTOR_DIR=path.join(root,"control");
process.env.FULL_SYNC_AGENT_TOKEN=crypto.randomBytes(32).toString("hex");process.env.FULL_SYNC_SIGNING_SECRET=crypto.randomBytes(32).toString("hex");process.env.FULL_SYNC_AGENT_ID="wyz-schedule-collector";
const contract=require("../server/src/shared/sampleCollectionContract"),control=require("../server/src/services/scheduleCollectorService");
const collector=require("./wyz-schedule-collector/collector"),fingerprint=require("../server/src/utils/stagingFingerprint").calculateFingerprint;
const four=require("../server/src/shared/fourDirectSourceContract"),express=require("../server/node_modules/express");
const term="2026-2027-1";let cases=0;
function check(fn){fn();cases++;}
function sample(kind="four"){
  const value=require("./fixtures/four-direct-source")();
  value.meta.sampleOnly=true;value.meta.sampleKind=kind;value.meta.actualNetworkRequestCount=kind==="four"?12:5;
  for(const k of ["class","teacher","classroom","course"])value.directSourceSummary[k].requestCount=1;
  if(kind==="class"){value.resources={};for(const k of ["teacher","classroom","course"]){delete value.directSourceSummary[k];delete value.scopeSources[k+"Schedules"];}value.meta.includeScopes=["classSchedules"];}
  value.canonicalHash=fingerprint(value).canonicalHash;return value;
}
async function main(){
  check(()=>assert.throws(()=>contract.policy("full",40),/POLICY_REJECTED/));
  check(()=>assert.throws(()=>contract.policy("four",121),/POLICY_REJECTED/));
  for(const kind of ["class","four"]){
    check(()=>assert.equal(contract.assertSample(sample(kind),term,{kind,requestBudget:40}).publishable,false));
    check(()=>assert.throws(()=>four.assertFourSources(sample(kind),term),/FOUR_DIRECT_SOURCE_INVALID/));
    check(()=>assert.equal(require("../server/src/services/stagingSafetyService").validateStagingData(sample(kind)).valid,false));
  }
  for(const mutate of [v=>v.meta.actualNetworkRequestCount=41,v=>v.directSourceSummary.teacher.sourceMode="derived-current-run",v=>v.directSourceSummary.class.requestedEntities=2,v=>v.resources.teacherSchedules[0].password="synthetic",v=>v.resources.courseSchedules=[],v=>v.classSchedules[0].courses[0].weekday=8,v=>v.classSchedules[0].courses[0].weeks=[999],v=>v.classSchedules[0].courses[0].endSection=0,v=>{v.directSourceSummary.class.success=2;v.directSourceSummary.class.empty=-1;}]){
    const value=sample();mutate(value);check(()=>assert.throws(()=>contract.assertSample(value,term,{kind:"four",requestBudget:40})));
  }
  require("../server/src/services/termRegistryService").createPlannedTerm({term,semesterText:term,termStartDate:"2026-09-07",totalWeeks:20,weekStart:"monday"});
  const app=express();app.use(express.json({verify(req,res,buf){req.rawBody=buf;}}));app.use("/api/full-sync/v1",require("../server/src/routes/fullSyncAgent"));
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  try{
    const cfg={...collector.config(process.env),oracle:"http://127.0.0.1:"+server.address().port,dataRoot:path.join(root,"campus"),sessionPath:path.join(root,"campus","session.json"),execute:true};
    fs.mkdirSync(cfg.dataRoot,{mode:0o700});fs.mkdirSync(process.env.FOSU_STORAGE_DIR,{recursive:true});
    const latest=path.join(process.env.FOSU_STORAGE_DIR,"staging-latest.json");fs.writeFileSync(latest,'{"fixturePreviousStaging":true}');const before=fs.readFileSync(latest);
    const api=collector.client(cfg);
    check(()=>assert.equal(control.snapshot().lastSuccessAt,null));
    for(const kind of ["class","four"]){
      control.resetForTests();
      const queued=control.requestRun("sample","fixture-approved",Date.now(),{term,sampleKind:kind,requestBudget:40}).run;
      let command;
      const runtime=require("./wyz-schedule-collector/browserRuntime"),originalCommand=runtime.workerCommand;
      runtime.workerCommand=(executable,args,env)=>{command={args,env};throw Object.assign(new Error("FIXTURE_CAPTURE"),{code:"FIXTURE_CAPTURE"});};
      try {
        const probeRun={...queued,claimId:"a".repeat(48),termConfig:{term,termStartDate:"2026-09-07",totalWeeks:20,weekStart:"monday"}};
        await assert.rejects(collector.executeSync(probeRun,cfg,cfg.dataRoot,()=>{}),/FIXTURE_CAPTURE/);
        check(()=>assert.ok(command.args.includes("--entity-limit=1")));
        check(()=>assert.ok(command.args.includes("--diagnostic")&&command.args.includes("--allow-derived=false")));
        check(()=>assert.equal(command.env.FOSU_COLLECTOR_REQUEST_BUDGET,"40"));
        check(()=>assert.equal(command.env.FULL_SYNC_AGENT_TOKEN,undefined));
      } finally { runtime.workerCommand=originalCommand; }
      check(()=>assert.equal(control.claim(cfg.agentId),null));
      const wrong=await api("POST","/api/full-sync/v1/runs/claim",{runId:queued.id,mode:"routine"});check(()=>assert.equal(wrong,null));
      const status=await api("GET","/api/full-sync/v1/status");check(()=>assert.equal(status.protocol,"collector-manual.v1"));
      const runDeps={assertSession:()=>{},
        executeSync:async(run,config,dir)=>{assert.equal(collector.validateRun(run).allowDerived,false);fs.writeFileSync(path.join(dir,"staging.json"),JSON.stringify(sample(kind)));},
        promoteRun:()=>assert.fail("sample must not promote full catalog"),
      };
      let result;
      if(kind==="four") {
        fs.writeFileSync(cfg.sessionPath,JSON.stringify({cookies:[],origins:[]}),{mode:0o600});
        result=await require("./wyz-schedule-collector/cli").main(["manual-sync","--sample-kind=four","--approve-school-access"],{
          skipRootCheck:true,cfg,connection:()=>({cfg,request:api,close:()=>{}}),output:()=>{},
          ask:async message=>message.includes("已有有效")?"REUSE":"SAMPLE four",
          authDeps:{createAdapter:async()=>({check:async()=>"SESSION_VALID",login:()=>assert.fail("reuse only"),close:async()=>{}})},runDeps,
        });
      } else result=await collector.runOnce(cfg,{...runDeps,request:api,claimSelector:{runId:queued.id,mode:"sample"},ensureSchoolSession:async()=>{}});
      check(()=>assert.equal(result.result,"PENDING SAMPLE REVIEW"));
      check(()=>assert.equal(result.published,false));
      check(()=>assert.deepEqual(fs.readFileSync(latest),before));
      check(()=>assert.equal(control.snapshot().lastSuccessAt,null));
      check(()=>assert.equal(fs.existsSync(path.join(cfg.dataRoot,"last-success.json")),false));
      check(()=>assert.equal(fs.existsSync(path.join(process.env.FOSU_STORAGE_DIR,"active-release.json")),false));
      const upload=require("../server/src/services/stagingUploadService").getUploadStatus(result.uploadId,{type:"full-sync",id:result.runId});
      check(()=>assert.equal(upload.summary.sampleOnly,true));check(()=>assert.equal(upload.summary.coverageValid,false));
      const cli=require("./wyz-schedule-collector/cli");
      let view;const inspection=await cli.main(["inspect"],{skipRootCheck:true,cfg,output:value=>view=value,connection:()=>({cfg,request:api,close:()=>{}})});check(()=>assert.equal(inspection.result,"PENDING SAMPLE REVIEW"));
      check(()=>{assert.equal(view.oracleStagingStatus,"PENDING SAMPLE REVIEW");assert.equal(view.uploadMatches,true);assert.equal(view.lastSample.directSourceSummary.class.sourceMode,"network-direct");});
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
  console.log("collector-sample-contract: "+cases+" PASS; signed localhost upload + real local worker; schoolRequests=0; active unchanged");
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
