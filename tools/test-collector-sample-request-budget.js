"use strict";
const assert=require("assert/strict"),fs=require("fs"),os=require("os"),path=require("path");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"fosu-budget-fixture-"));
process.env.FOSU_COLLECTOR_MODE="1";process.env.FOSU_COLLECTOR_SAMPLE_KIND="class";process.env.FOSU_COLLECTOR_REQUEST_BUDGET="1";
process.env.FOSU_SYNC_DATA_DIR=root;process.env.FOSU_COLLECTOR_SESSION=path.join(root,"session.json");
fs.writeFileSync(process.env.FOSU_COLLECTOR_SESSION,JSON.stringify({cookies:[],origins:[]}));
const runtime=require("./wyz-schedule-collector/browserRuntime"),original=runtime.launch;
let handler,guardHandler,guardCalls=[],contexts=[];
runtime.launch=async()=>({close:async()=>{},newContext:async options=>{contexts.push(options);return {newPage:async()=>({}),newCDPSession:async()=>({on:(_,value)=>guardHandler=value,send:async(method,params)=>guardCalls.push({method,params})}),route:async(pattern,value)=>handler=value};}});
const sync=require("./fosu-sync-client/sync");
let passed=0,aborted=0;
function route(url,type="fetch"){return {request:()=>({url:()=>url,resourceType:()=>type,response:async()=>({finished:async()=>{}})}),continue:async()=>passed++,abort:async()=>aborted++};}
async function main(){
  const {context}=await sync.initBrowserContext();await context.newPage();
  assert.equal(contexts[0].isMobile,true);assert.equal(contexts[0].ignoreHTTPSErrors,false);assert.equal(contexts[0].serviceWorkers,"block");
  await handler(route("https://100.fosu.edu.cn/fixture-one"));
  await handler(route("https://100.fosu.edu.cn/fixture-two"));
  await handler(route("https://100.fosu.edu.cn/fixture-three"));
  assert.equal(passed,1);assert.equal(aborted,2);assert.equal(global.SCHOOL_REQUEST_COUNT,1);assert.equal(global.SCHOOL_REQUEST_FAILURE,"SCHOOL_REQUEST_BUDGET_EXCEEDED");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,"request-count.json"))).count,1);
  global.SCHOOL_REQUEST_FAILURE=null;
  await sync.initBrowserContext();await handler(route("https://authserver.fosu.edu.cn/authserver/login","document"));
  assert.equal(global.SCHOOL_REQUEST_FAILURE,"SCHOOL_SESSION_EXPIRED");
  await handler(route("https://100.fosu.edu.cn/after-expiry"));assert.equal(passed,1);
  guardHandler({requestId:"redirect",request:{url:"https://100.fosu.edu.cn/fixture"},responseStatusCode:302,responseHeaders:[{name:"Location",value:"https://authserver.fosu.edu.cn/authserver/login"}]});
  assert.equal(global.SCHOOL_REQUEST_FAILURE,"SCHOOL_SESSION_EXPIRED");assert.equal(guardCalls.at(-1).method,"Fetch.failRequest");
  guardHandler({requestId:"same-origin",request:{url:"https://100.fosu.edu.cn/fixture"},responseStatusCode:302,responseHeaders:[{name:"Location",value:"/extra"}]});
  assert.equal(global.SCHOOL_REQUEST_FAILURE,"SCHOOL_SAMPLE_REDIRECT_REJECTED");assert.equal(guardCalls.at(-1).method,"Fetch.failRequest");
  process.env.FOSU_COLLECTOR_REQUEST_BUDGET="121";await assert.rejects(sync.initBrowserContext(),/POLICY_REJECTED/);
  console.log("collector-sample-request-budget: PASS; actual collector route handler, 1 permitted/remaining aborted, expiry stop; schoolRequests=0");
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{runtime.launch=original;fs.rmSync(root,{recursive:true,force:true});});
