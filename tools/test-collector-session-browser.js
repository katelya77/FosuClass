"use strict";
// Real Chromium + actual Collector route/CDP guards. Every released request is
// fulfilled by this fixture. CI also runs this in a network-disabled container.
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const runtime=require("./wyz-schedule-collector/browserRuntime"),original=runtime.launch;
const saved={log:console.log,warn:console.warn,error:console.error};
const root=fs.mkdtempSync(path.join(os.tmpdir(),"fosu-session-browser-"));
let browser,context,scenario=0,releases=[];
runtime.launch=async(chromium,args)=>{
 const b=await original(chromium,[...args,"--host-resolver-rules=MAP * ~NOTFOUND"]),create=b.newContext.bind(b);
 b.newContext=async options=>{const c=await create(options),install=c.route.bind(c);
  c.route=async(pattern,handler)=>install(pattern,route=>handler({request:()=>route.request(),abort:reason=>route.abort(reason),continue:async()=>{
   const type=route.request().resourceType();releases.push(type);
   if(type==="image")return new Promise(()=>{}); // Exact observed pending resource type.
   const text=scenario===1?"教学一体化服务平台 请完成安全验证":scenario===2?"统一身份认证 密码登录":"教学一体化服务平台 我的桌面";
   return route.fulfill({status:200,contentType:"text/html; charset=utf-8",body:'<!doctype html><html><body>'+text+'<img src="/fixture-stalled.png"></body></html>'});
  }}));return c;};return b;
};
(async()=>{
 fs.writeFileSync(path.join(root,"session.json"),JSON.stringify({cookies:[],origins:[]}),{mode:0o600});
 Object.assign(process.env,{FOSU_COLLECTOR_MODE:"1",FOSU_SYNC_HEADLESS:"1",FOSU_COLLECTOR_SESSION:path.join(root,"session.json"),FOSU_SYNC_DATA_DIR:root,FOSU_STORAGE_DIR:path.join(root,"storage"),FOSU_COLLECTOR_SAMPLE_KIND:"class",FOSU_COLLECTOR_REQUEST_BUDGET:"40",FOSU_COLLECTOR_RUN_ID:"sc-session-browser-fixture",FOSU_COLLECTOR_TERM:"2026-2027-1",FOSU_COLLECTOR_APPROVAL_EXPIRES_AT:new Date(Date.now()+120000).toISOString(),FOSU_COLLECTOR_WORKER_SOURCE_HASH:crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname,"fosu-sync-client/sync.js"))).digest("hex")});
 console.log=console.warn=console.error=()=>{};
 const sync=require("./fosu-sync-client/sync");
 ({browser,context}=await sync.initBrowserContext());
 const page=await context.newPage();
 page.content=async()=>assert.fail("unstable rendered DOM must not participate in Collector Session readiness");
 assert.equal(await sync.checkSession(page),true);
 await page.waitForTimeout(100);
 assert.deepEqual(releases,["document"]);
 assert.equal(global.COLLECTOR_REQUEST_LEDGER.snapshot().reserved,1);
 assert.equal(global.COLLECTOR_REQUEST_LEDGER.snapshot().pending,false);
 scenario=1;await assert.rejects(sync.checkSession(page),e=>e.code==="SCHOOL_SECURITY_CHALLENGE");
 scenario=2;assert.equal(await sync.checkSession(page),false);
 assert(releases.every(type=>type==="document"));
 assert.equal(global.COLLECTOR_REQUEST_LEDGER.snapshot().reserved,3);
 saved.log("collector-session-browser: PASS; real Chromium route/CDP, stalled image never released, stable protected response, challenge/expired stop; schoolRequests=0");
})().catch(e=>{saved.error("collector-session-browser: FAIL "+(e.code||e.name||"UNKNOWN"));process.exitCode=1;}).finally(async()=>{
 if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
 runtime.launch=original;Object.assign(console,saved);fs.rmSync(root,{recursive:true,force:true});
});
