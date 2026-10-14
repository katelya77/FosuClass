"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
process.env.FOSU_COLLECTOR_MODE="1";
const receipt=require("./wyz-schedule-collector/workerReceipt"),sync=require("./fosu-sync-client/sync");
async function quiet(mode,fn){const before=process.env.FOSU_COLLECTOR_MODE,log={log:console.log,error:console.error};
 process.env.FOSU_COLLECTOR_MODE=mode;console.log=console.error=()=>{};
 try{return await fn();}finally{if(before===undefined)delete process.env.FOSU_COLLECTOR_MODE;else process.env.FOSU_COLLECTOR_MODE=before;Object.assign(console,log);}}
function page(){const p={body:"教学一体化服务平台",url:()=>"https://100.fosu.edu.cn/framework/xsMain.jsp",status:200};p.content=async()=>p.body;p.response={status:()=>p.status,url:()=>p.url(),text:async()=>p.body};p.goto=async()=>p.response;return p;}
test("Collector readiness reads the protected response without waiting for optional images or rendered DOM",async()=>quiet("1",async()=>{
 const p=page();let reads=0;
 p.goto=async(url,options)=>{assert.equal(options.waitUntil,"domcontentloaded");assert.equal(options.timeout,20000);return {status:()=>200,url:()=>url,text:async()=>{reads++;return "教学一体化服务平台";}};};
 p.content=async()=>assert.fail("rendered DOM may be navigating while a decorative image is pending");
 assert.equal(await sync.checkSession(p),true);assert.equal(reads,1);
}));
test("Collector transport failure stays typed, with one navigation and no password action",async()=>quiet("1",async()=>{
 const p=page();let calls=0;p.goto=async url=>{calls++;assert.equal(new URL(url).protocol,"https:");throw new Error("page.goto: net::ERR_CONNECTION_RESET at https://private.invalid/?ticket=SECRET");};
 await assert.rejects(sync.checkSession(p),e=>e.code==="SCHOOL_CONNECTION_RESET");assert.equal(calls,1);
}));
test("Collector protected response read failure stops without another request or Session-expired claim",async()=>quiet("1",async()=>{
 const p=page();let calls=0,reads=0;p.goto=async()=>{calls++;return p.response;};p.response.text=async()=>{reads++;throw new Error("response.body: net::ERR_CONNECTION_RESET");};
 await assert.rejects(sync.checkSession(p),e=>e.code==="SCHOOL_CONNECTION_RESET");assert.equal(calls,1);assert.equal(reads,1);
}));
test("closed browser and JavaScript runtime errors have distinct non-authentication causes",async()=>quiet("1",async()=>{
 for(const [error,code]of [[new Error("Target page, context or browser has been closed"),"COLLECTOR_BROWSER_TARGET_CLOSED"],[new ReferenceError("fixture-private-variable"),"COLLECTOR_WORKER_REFERENCE_ERROR"]]){
  const p=page();p.response.text=async()=>{throw error;};await assert.rejects(sync.checkSession(p),e=>e.code===code);
 }
}));
test("actual login markers still reject Session while a valid protected page succeeds",async()=>quiet("1",async()=>{
 const p=page();assert.equal(await sync.checkSession(p),true);p.body="统一身份认证 密码登录";assert.equal(await sync.checkSession(p),false);
 p.body="教学一体化服务平台";p.url=()=>"https://authserver.fosu.edu.cn/authserver/login";assert.equal(await sync.checkSession(p),false);
}));
test("challenge, unknown page and HTTP failures cannot become valid merely by blocking images",async()=>quiet("1",async()=>{
 const p=page();p.body="教学一体化服务平台 请完成安全验证";await assert.rejects(sync.checkSession(p),e=>e.code==="SCHOOL_SECURITY_CHALLENGE");
 p.body="generic public page";await assert.rejects(sync.checkSession(p),e=>e.code==="SCHOOL_PAGE_CHANGED");
 p.body="教学一体化服务平台";
 for(const [status,code]of [[401,"SCHOOL_SESSION_EXPIRED"],[403,"SCHOOL_SESSION_EXPIRED"],[429,"SCHOOL_RATE_LIMITED"],[503,"SCHOOL_UPSTREAM_UNAVAILABLE"]]){p.status=status;await assert.rejects(sync.checkSession(p),e=>e.code===code);}
}));
test("Windows/manual navigation failure retains its existing return contract",async()=>quiet("0",async()=>{
 const p=page();p.goto=async()=>{throw new Error("fixture navigation unavailable");};assert.equal(await sync.checkSession(p),false);
}));
