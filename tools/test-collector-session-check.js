"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
process.env.FOSU_COLLECTOR_MODE="1";
const receipt=require("./wyz-schedule-collector/workerReceipt"),sync=require("./fosu-sync-client/sync");
async function quiet(mode,fn){const before=process.env.FOSU_COLLECTOR_MODE,log={log:console.log,error:console.error};
 process.env.FOSU_COLLECTOR_MODE=mode;console.log=console.error=()=>{};
 try{return await fn();}finally{if(before===undefined)delete process.env.FOSU_COLLECTOR_MODE;else process.env.FOSU_COLLECTOR_MODE=before;Object.assign(console,log);}}
function page(){return {goto:async()=>{},url:()=>"https://100.fosu.edu.cn/framework/xsMain.jsp",content:async()=>"教学一体化服务平台"};}
test("Collector transport failure stays typed, with one navigation and no password action",async()=>quiet("1",async()=>{
 const p=page();let calls=0;p.goto=async url=>{calls++;assert.equal(new URL(url).protocol,"https:");throw new Error("page.goto: net::ERR_CONNECTION_RESET at https://private.invalid/?ticket=SECRET");};
 await assert.rejects(sync.checkSession(p),e=>e.code==="SCHOOL_CONNECTION_RESET");assert.equal(calls,1);
}));
test("Collector content navigation race stops without another school request or Session-expired claim",async()=>quiet("1",async()=>{
 const p=page();let calls=0,reads=0;p.goto=async()=>{calls++;};p.content=async()=>{reads++;throw new Error("Unable to retrieve content because the page is navigating and changing the content.");};
 await assert.rejects(sync.checkSession(p),e=>e.code==="SCHOOL_SESSION_PAGE_UNSTABLE");assert.equal(calls,1);assert.equal(reads,1);
}));
test("closed browser and JavaScript runtime errors have distinct non-authentication causes",async()=>quiet("1",async()=>{
 for(const [error,code]of [[new Error("Target page, context or browser has been closed"),"COLLECTOR_BROWSER_TARGET_CLOSED"],[new ReferenceError("fixture-private-variable"),"COLLECTOR_WORKER_REFERENCE_ERROR"]]){
  const p=page();p.content=async()=>{throw error;};await assert.rejects(sync.checkSession(p),e=>e.code===code);
 }
}));
test("actual login markers still reject Session while a valid protected page succeeds",async()=>quiet("1",async()=>{
 const p=page();assert.equal(await sync.checkSession(p),true);p.content=async()=>"统一身份认证 密码登录";assert.equal(await sync.checkSession(p),false);
 p.content=async()=>"教学一体化服务平台";p.url=()=>"https://authserver.fosu.edu.cn/authserver/login";assert.equal(await sync.checkSession(p),false);
}));
test("Windows/manual navigation failure retains its existing return contract",async()=>quiet("0",async()=>{
 const p=page();p.goto=async()=>{throw new Error("fixture navigation unavailable");};assert.equal(await sync.checkSession(p),false);
}));
