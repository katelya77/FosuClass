"use strict";
// Actual four-source adapters against loopback HTML, with continuous completed
// background fetches. No school DNS, credentials, Session or external traffic.
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),http=require("node:http");
const {chromium}=require("./fosu-sync-client/node_modules/playwright");
const {buildSyncPlan}=require("../shared/syncPlan");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"fosu-schedule-readiness-"));
let browser,server,scenario="valid",posts=[];
const term="2026-2027-1";
const table="<table id='kbtable'><tr><td>班级</td><td>星期一</td></tr><tr><td>节次</td><td>[1-2]</td></tr><tr><td>26测试1班</td><td>测试课程<br>测试教师<br>1-2周<br>B1-101[1-2]节<br>26测试1班</td></tr></table>";
const controls=kind=>"<select name='xnxqh'><option value='"+term+"'>"+term+"</option></select>"+(kind==="class"?"<select name='skyx'><option value='fixture-college'>测试学院</option></select><select name='sknj'><option value='2026'>2026</option></select>":"<select name='"+({teacher:"teacher",classroom:"roomid",course:"kcid"}[kind])+"'><option value='fixture-one'>测试目标</option></select>");
(async()=>{
 server=http.createServer(async(req,res)=>{
  res.setHeader("content-type","text/html; charset=utf-8");
  if(scenario.startsWith("status-")){res.statusCode=Number(scenario.slice(7));res.end(controls("class"));return;}
  if(req.url==="/fixture-background"){setTimeout(()=>res.end("ok"),160);return;}
  if(req.method==="POST"){posts.push(req.url);res.end(scenario==="data-login"?"统一身份认证 密码登录":table);return;}
  const kind=/teacher/.test(req.url)?"teacher":/classroom/.test(req.url)?"classroom":/kbxx_kc/.test(req.url)?"course":"class";
  let content=scenario==="login"?"统一身份认证 密码登录":scenario==="challenge"?"请完成安全验证":scenario==="missing-controls"||scenario==="delayed-controls"?"学期理论课表":controls(kind);
  if(scenario==="term-populates-target") content="<select name='xnxqh'><option value='2025-2026-2'>旧学期</option><option value='"+term+"'>"+term+"</option></select><select name='teacher'></select><script>document.querySelector('[name=xnxqh]').onchange=()=>setTimeout(()=>document.querySelector('[name=teacher]').innerHTML=\"<option value='fixture-new'>新学期教师</option>\",150)</script>";
  if(scenario==="filtered-target") content+="<select name='skyx'><option value='fixture-college'>测试学院</option></select>";
  if(scenario==="ambiguous-target") content+="<select name='skjs'><option value='fixture-two'>另一目标</option></select>";
  if(scenario==="missing-target") content="<select name='xnxqh'><option value='"+term+"'>"+term+"</option></select><input name='jsxm' value='PRIVATE-NAME'><input name='token' value='PRIVATE-TOKEN'><select name='SECRET-CONTROL'><option value='PRIVATE-ID'>PRIVATE-LABEL</option></select>";
  if(scenario==="empty-target") content=controls(kind).replace("<option value='fixture-one'>测试目标</option>","");
  if(scenario==="disabled-target") content=controls(kind).replace("name='teacher'","name='teacher' disabled");
  if(scenario==="unavailable-term") content=controls(kind).replaceAll(term,"2025-2026-2");
  if(scenario==="stale-term-target") content=controls(kind).replace("<select name='xnxqh'>","<select name='xnxqh'><option value='2025-2026-2'>旧学期</option>");
  if(scenario==="permission-denied") content="您没有权限访问此页面"+controls(kind);
  const delayed=scenario==="delayed-controls"?"setTimeout(()=>document.body.insertAdjacentHTML('afterbegin',"+JSON.stringify(controls(kind))+"),150);":"";
  res.end("<!doctype html><html><body>"+content+"<script>"+delayed+"setInterval(()=>fetch('/fixture-background'),100)</script></body></html>");
 });
 await new Promise(r=>server.listen(0,"127.0.0.1",r));
 Object.assign(process.env,{FOSU_COLLECTOR_MODE:"1",FOSU_SYNC_FIXTURE_ONLY:"1",FOSU_BASE_URL:"http://127.0.0.1:"+server.address().port,FOSU_SYNC_DATA_DIR:root,FOSU_STORAGE_DIR:path.join(root,"storage"),FOSU_COLLECTOR_SAMPLE_KIND:"class"});
 global.SYNC_PLAN=buildSyncPlan("crawl:daily",{term,"run-id":"fixture-schedule-readiness","allow-derived":false},{});global.CLI_PARAMS={"entity-limit":1};
 const sync=require("./fosu-sync-client/sync");
 browser=await chromium.launch({headless:true,args:["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"]});
 const context=await browser.newContext();
 await context.route("**/*",route=>new URL(route.request().url()).origin===process.env.FOSU_BASE_URL?route.continue():route.abort());
 const page=await context.newPage(),goto=page.goto.bind(page),wait=page.waitForFunction.bind(page);
 // Bound the reproduction, preserving the production wait condition.
 page.goto=(url,options)=>goto(url,{...options,timeout:1200});
 page.waitForFunction=(fn,arg,options)=>wait(fn,arg,{...options,polling:25,timeout:1200});
 const catalog={colleges:[{code:"fixture-college",name:"测试学院"}],grades:["2026"]},majors=[{collegeCode:"fixture-college",grade:"2026",code:"fixture-major",name:"测试专业"}];
 const result=await sync.crawlStrictClassSchedules(page,catalog,majors);
 assert(result.some(s=>s.className==="26测试1班"));
 await sync.crawlStrictResources(page,["teacher","classroom","course"],term);
 assert.deepEqual(posts,["/kbcx/kbxx_xzb_ifr","/kbcx/kbxx_teacher_ifr","/kbcx/kbxx_classroom_ifr","/kbcx/kbxx_kc_ifr"]);
 scenario="delayed-controls";global.SYNC_PLAN={...global.SYNC_PLAN,runId:"fixture-delayed-controls"};
 await sync.crawlStrictClassSchedules(page,catalog,majors);assert.equal(posts.length,5);
 for(const [value,code] of [["login","SCHOOL_SESSION_EXPIRED"],["challenge","SCHOOL_SECURITY_CHALLENGE"],["missing-controls","SCHOOL_PAGE_CHANGED"]]){
  scenario=value;await assert.rejects(sync.crawlStrictClassSchedules(page,catalog,majors),e=>e.code===code);assert.equal(posts.length,5);
 }
 for(const [status,code] of [[401,"SCHOOL_SESSION_EXPIRED"],[429,"SCHOOL_RATE_LIMITED"],[503,"SCHOOL_UPSTREAM_UNAVAILABLE"]]){
  scenario="status-"+status;await assert.rejects(sync.crawlStrictClassSchedules(page,catalog,majors),e=>e.code===code);assert.equal(posts.length,5);
 }
 scenario="data-login";global.SYNC_PLAN={...global.SYNC_PLAN,runId:"fixture-login-data"};
 await assert.rejects(sync.crawlStrictClassSchedules(page,catalog,majors),e=>e.code==="SESSION_EXPIRED");
 const resultFile=path.join(root,"result.json");process.env.FOSU_COLLECTOR_RESULT_FILE=resultFile;
 process.env.FOSU_COLLECTOR_SAMPLE_KIND="four";global.SYNC_PLAN={...global.SYNC_PLAN,runId:"fixture-resource-sample"};
 scenario="term-populates-target";let targets=await sync.discoverStrictDirectory(page,"teacher",term);
 assert.equal(targets[0].key,"fixture-new","target must come from requested term, after its asynchronous change");
 scenario="filtered-target";const sample=await sync.crawlStrictResources(page,["teacher"],term);
 assert.equal(sample.teacherSchedules.length,1);assert.equal(global.DIRECT_SOURCE_SUMMARY.teacher.coverageValid,false,"Sample must not attest full directory coverage");
 let detail=JSON.parse(fs.readFileSync(path.join(root,"resource-directory.json")));assert.equal(detail.filteredScope,true);assert.equal(detail.catalogComplete,false);
 process.env.FOSU_COLLECTOR_SAMPLE_KIND="class";
 await assert.rejects(sync.discoverStrictDirectory(page,"teacher",term),e=>e.code==="DIRECT_TEACHER_DIRECTORY_INCOMPLETE","formal catalog remains strict");
 for(const [value,code] of [["ambiguous-target","DIRECT_DIRECTORY_AMBIGUOUS"],["missing-target","SCHOOL_DIRECTORY_CONTROL_MISSING"],["empty-target","SCHOOL_DIRECTORY_EMPTY"],["disabled-target","SCHOOL_DIRECTORY_NOT_READY"],["unavailable-term","DIRECT_TERM_UNAVAILABLE"],["stale-term-target","SCHOOL_DIRECTORY_TERM_REBIND_UNVERIFIED"],["permission-denied","SCHOOL_ACCESS_DENIED"]]){
  scenario=value;const count=posts.length;await assert.rejects(sync.discoverStrictDirectory(page,"teacher",term),e=>e.code===code);assert.equal(posts.length,count,"directory failure cannot fetch a timetable");
  if(value==="missing-target") {const raw=fs.readFileSync(path.join(root,"resource-directory.json"),"utf8");for(const value of ["PRIVATE-NAME","PRIVATE-TOKEN","SECRET-CONTROL","PRIVATE-ID","PRIVATE-LABEL"])assert(!raw.includes(value));}
 }
 scenario="unavailable-term";
 await assert.rejects(sync.discoverStrictDirectory(page,"classroom",term),e=>e.code==="DIRECT_TERM_UNAVAILABLE");
 detail=JSON.parse(fs.readFileSync(path.join(root,"resource-directory.json")));assert.equal(detail.source,"classroom");assert.equal(detail.stage,"term-unavailable","failure must replace previous source diagnostic");
 assert(fs.existsSync(path.join(root,"resource-directory-teacher.json")),"previous source evidence remains independently available");
 delete process.env.FOSU_COLLECTOR_RESULT_FILE;
 process.env.FOSU_COLLECTOR_MODE="0";let calls=0;
 await assert.rejects(sync.crawlStrictClassSchedules({goto:async(url,options)=>{calls++;assert.equal(options.waitUntil,"networkidle");throw new Error("fixture-manual-stop");}},catalog,majors),/fixture-manual-stop/);
 assert.equal(calls,2,"manual HTTP/HTTPS compatibility remains unchanged");
 console.log("collector-schedule-browser: PASS; four adapters, term-triggered targets, scoped Sample, 7 directory stop classes, sanitized evidence; schoolRequests=0");
})().catch(e=>{console.error("collector-schedule-browser: FAIL "+(e.code||e.name));if(e.code==="ERR_ASSERTION")console.error(e.message);process.exitCode=1;}).finally(async()=>{
 if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});
});
