"use strict";
// Component -> real mini service/request -> HTTP parsers -> protected route/storage.
// Only wx transport and session acquisition use local test adapters.
const assert=require("assert"),fs=require("fs"),os=require("os"),path=require("path"),vm=require("vm");
const storage=fs.mkdtempSync(path.join(os.tmpdir(),"fosu-reaction-wire-"));
process.env.FOSU_STORAGE_DIR=storage;
process.env.FOSU_SESSION_SECRET_CURRENT="test-reaction-wire-session-secret-00000000";
process.env.FOSU_SECURITY_MODE="observe";process.env.NODE_ENV="test";
const express=require("../server/node_modules/express");
const content=require("../server/src/services/appConfigService");
const {createSessionToken}=require("../server/src/utils/apiSecurity");
const mockEnv=require("./mock-env");mockEnv.clearStorage();
const session=createSessionToken({appid:"test",openid:"reaction-wire-user"}).token;
const sessionService=require("../miniprogram/services/securitySessionService");
sessionService.buildSessionHeaders=async()=>({"X-Fosu-Session":session});
require("../miniprogram/services/staticAccessService").buildStaticHeaders=async()=>({});
const service=require("../miniprogram/services/noticeReactionService");
const catalog=require("../miniprogram/utils/noticeReactions");
let definition,pending=0,server,base,checks=0;
const wire=[];
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../miniprogram/components/notice-reactions/notice-reactions.js"),"utf8"),{Component(value){definition=value;},require(name){return name.includes("noticeReactionService")?service:catalog;},setTimeout,clearTimeout});
function eq(a,b,message){assert.deepStrictEqual(a,b,message);checks++;}
async function settle(component){
  for(let i=0;i<500;i++){await new Promise(resolve=>setTimeout(resolve,5));if(!pending&&!component.data.busy)return;}
  throw new Error("component HTTP loop timed out");
}
async function main(){
  const notice=content.createNotice({title:"撤回传输测试",content:"本地隔离测试",displayMode:"ticker",targetPage:"home",enabled:true});
  const app=express();app.use(express.json());app.use(express.urlencoded({extended:true}));
  app.use("/api/fosu",require("../server/src/routes/fosu"));
  server=await new Promise(resolve=>{const value=app.listen(0,"127.0.0.1",()=>resolve(value));});
  base="http://127.0.0.1:"+server.address().port;
  wx.mockRequest=options=>{
    const method=options.method||"GET",contentType=options.header["content-type"];
    const body=method==="GET"?undefined:contentType.includes("application/json")?JSON.stringify(options.data):new URLSearchParams(Object.entries(options.data).map(([key,value])=>[key,value===null?"null":String(value)])).toString();
    if(method==="PUT")wire.push({contentType,body});
    pending++;
    fetch(base+new URL(options.url).pathname,{method,headers:{...options.header,"User-Agent":"MicroMessenger FosuClass-Wire-Test"},body}).then(async response=>{
      options.success({statusCode:response.status,data:await response.json()});
    }).catch(error=>options.fail({errMsg:error.message})).finally(()=>{pending--;});
  };
  const response=await service.get(notice.id);
  const component={...definition.methods,data:{...definition.data,notice:{id:notice.id,reactions:response},compact:false},setData(patch,callback){Object.assign(this.data,patch);if(callback)callback();},triggerEvent(){}};
  definition.properties.notice.observer.call(component,component.data.notice);definition.lifetimes.attached.call(component);await settle(component);
  const choose=id=>component.select({currentTarget:{dataset:{id}}});
  try{
    choose("like");await settle(component);eq(component.data.summary.myReaction,"like");eq(component.data.summary.total,1);
    choose("like");await settle(component);
    eq(component.data.error,"","点击已选表情应撤回；实际提示："+component.data.error);
    eq(component.data.summary.myReaction,"");eq(component.data.summary.total,0);
    eq(wire[1].contentType,"application/json","withdrawal must retain JSON null on the wire");
    eq(JSON.parse(wire[1].body),{emoji:null});
    await service.set(notice.id,"heart");eq((await service.get(notice.id)).myReaction,"heart");
    await service.set(notice.id,"");await service.set(notice.id,"");eq((await service.get(notice.id)).total,0,"repeat withdrawal is idempotent");
    console.log("test-notice-reaction-transport passed ("+checks+" checks; real service/request, component withdrawal, JSON wire, protected HTTP route, persistence, idempotency)");
  }finally{definition.lifetimes.detached.call(component);}
}
main().catch(error=>{console.error(error.message);console.error("PUT wire metadata: "+JSON.stringify(wire));process.exitCode=1;}).finally(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(storage,{recursive:true,force:true});
});
