"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path"),os=require("os"),store=require("./wyz-schedule-collector/runStore");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"fosu-retention-fixture-")),term="2026-2027-1";
function run(id,status,result){const dir=path.join(root,"runs",term,"sc-"+id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,"state.json"),JSON.stringify({status,result,finishedAt:"2026-01-01T00:00:00Z"}));fs.writeFileSync(path.join(dir,"checkpoint.json"),"synthetic");return dir;}
try{
  const current=run("aa","running"),good=run("bb","completed","NO CHANGE"),failed=run("cc","failed"),old=run("dd","cancelled"),pending=run("ee","completed","PENDING REVIEW");
  const sample=run("ff","completed","PENDING SAMPLE REVIEW");
  const plan=store.pruneRuns(root,current,good);assert.equal(plan.dryRun,true);assert.equal(plan.estimatedDeleteDirectories,0);assert.ok(fs.existsSync(old));assert.ok(fs.existsSync(pending));
  const attested=store.pruneRuns(root,current,good,{now:Date.parse("2026-10-09T00:00:00Z"),referencesComplete:true,references:[failed]});
  assert.ok(attested.candidates.some(e=>e.path===old));assert.ok(!attested.candidates.some(e=>e.path===pending));assert.equal(attested.executeAllowed,false);assert.ok(fs.existsSync(old));assert.ok(attested.estimatedReclaimBytes>0);
  assert.ok(!attested.candidates.some(e=>e.path===sample));
  console.log("collector retention: dry-run, external references, pending review, per-term recovery, reclaim measurement fixtures PASS; files deleted=0");
}finally{fs.rmSync(root,{recursive:true,force:true});}
