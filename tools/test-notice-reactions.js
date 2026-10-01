"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const compatibility = spawnSync(process.execPath, [path.join(__dirname, "generate-notice-reactions.js"), "--check"], { encoding: "utf8" });
assert.strictEqual(compatibility.status, 0, compatibility.stderr);
const storage = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-reactions-"));
process.env.FOSU_STORAGE_DIR = storage;
process.env.FOSU_SESSION_SECRET_CURRENT = "test-notice-reaction-session-secret-00000000";
process.env.FOSU_SECURITY_MODE = "observe";
process.env.NODE_ENV = "test";
const express = require("../server/node_modules/express");
const content = require("../server/src/services/appConfigService");
const reactions = require("../server/src/services/noticeReactionService");
const { createSessionToken } = require("../server/src/utils/apiSecurity");
let checks = 0;
function eq(a,b) { assert.deepStrictEqual(a,b); checks++; }
async function main() {
  const notice = content.createNotice({ title:"公告回应测试", content:"只有表情，没有文字评论。", displayMode:"ticker", targetPage:"home", enabled:true });
  const app = express(); app.use(express.json()); app.use("/api/fosu",require("../server/src/routes/fosu"));
  const server = await new Promise((resolve)=>{const value=app.listen(0,"127.0.0.1",()=>resolve(value));});
  const base = "http://127.0.0.1:"+server.address().port;
  const sessionA=createSessionToken({appid:"test",openid:"notice-user-a"}).token;
  const sessionB=createSessionToken({appid:"test",openid:"notice-user-b"}).token;
  async function call(method,body,token,id=notice.id) {
    const res=await fetch(base+"/api/fosu/notices/"+encodeURIComponent(id)+"/reactions",{method,headers:{"Content-Type":"application/json","User-Agent":"MicroMessenger FosuClass-Test",...(token?{"X-Fosu-Session":token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    return {status:res.status,body:await res.json(),cache:res.headers.get("cache-control")};
  }
  try {
    eq((await call("GET")).body.data.total,0);
    eq((await call("PUT",{emoji:"like"})).status,401);
    eq((await call("PUT",{emoji:"like"},"invalid")).status,401);
    eq((await call("PUT",{emoji:"like",userId:"spoof"},sessionA)).status,400);
    eq((await call("PUT",{emoji:"<script>"},sessionA)).status,400);
    eq((await call("PUT",{text:"评论"},sessionA)).status,400);
    eq((await call("PUT",{},sessionA)).status,400);
    eq((await call("PUT",{emoji:"like"},sessionA)).body.data.myReaction,"like");
    eq((await call("PUT",{emoji:"like"},sessionA)).body.data.total,1);
    eq((await call("PUT",{emoji:"heart"},sessionA)).body.data.total,1);
    eq((await call("PUT",{emoji:"like"},sessionB)).body.data.total,2);
    const read=await call("GET",undefined,sessionA);
    eq(read.body.data.myReaction,"heart"); eq(read.cache,"private, no-store");
    eq(Object.keys(read.body.data).sort(),["allowedIds","enabled","items","myReaction","revision","total"].sort());
    const nextSession=createSessionToken({appid:"test",openid:"notice-user-a"}).token;
    eq((await call("GET",undefined,nextSession)).body.data.myReaction,"heart");
    eq((await call("PUT",{emoji:null},nextSession)).body.data.total,1);
    eq((await call("PUT",{emoji:null},nextSession)).body.data.total,1);
    const restarted=spawnSync(process.execPath,["-e","const s=require('./server/src/services/appConfigService'),r=require('./server/src/services/noticeReactionService');process.stdout.write(String(r.summary(s.listNotices()[0]).total))"],{cwd:path.join(__dirname,".."),env:process.env,encoding:"utf8"});
    eq(restarted.status,0);eq(restarted.stdout,"1");
    let current=content.updateNotice(notice.id,{reactionEmojis:["heart"]});
    eq((await call("PUT",{emoji:"like"},sessionA)).status,400);
    eq((await call("GET",undefined,sessionB)).body.data.items[0].id,"like");
    current=content.updateNotice(notice.id,{reactionsEnabled:false});
    eq((await call("PUT",{emoji:"heart"},sessionA)).status,409);
    eq((await call("PUT",{emoji:null},sessionB)).body.data.total,0);
    current=content.updateNotice(notice.id,{enabled:false});eq((await call("PUT",{emoji:"heart"},sessionA)).status,404);
    current=content.updateNotice(notice.id,{enabled:true,reactionsEnabled:true,endAt:"2000-01-01"});eq((await call("GET")).status,404);
    current=content.updateNotice(notice.id,{endAt:"",startAt:"2099-01-01"});eq((await call("PUT",{emoji:"heart"},sessionA)).status,404);
    current=content.updateNotice(notice.id,{startAt:""});content.saveAnnouncementsPolicy(false);eq((await call("GET")).status,404);content.saveAnnouncementsPolicy(true);
    eq((await call("GET",undefined,sessionA,"missing")).status,404);
    assert.throws(()=>content.createNotice({title:"非法",reactionEmojis:["bad"]}),/支持/);checks++;
    assert.throws(()=>content.updateNotice(notice.id,{reactionEmojis:[]}),/至少/);checks++;
    // Concurrent different users never increase the count twice for one owner.
    const many=Array.from({length:16},(_,i)=>createSessionToken({appid:"test",openid:"concurrent-"+i}).token);
    const writes=await Promise.all(many.map(token=>call("PUT",{emoji:"heart"},token)));
    eq(writes.every(result=>result.status===200),true);eq((await call("GET")).body.data.total,16);
    eq(content.getPublicAppConfig().data.notices.find(item=>item.id===notice.id).reactions.total,16);
    const file=reactions.fileFor(notice.id);fs.writeFileSync(file,"broken");
    eq((await call("PUT",{emoji:"heart"},sessionA)).status,503);eq(fs.readFileSync(file,"utf8"),"broken");
    console.log("test-notice-reactions passed ("+checks+" checks)");
  } finally { await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(storage,{recursive:true,force:true}));
