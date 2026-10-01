"use strict";
const assert=require("assert"),fs=require("fs"),vm=require("vm"),path=require("path");
const catalog=require("../miniprogram/utils/noticeReactions");
let definition, pendingWrite, response={enabled:true,allowedIds:catalog.DEFAULT_IDS,total:0,items:[],myReaction:""}, writes=0;
const api={get:()=>Promise.resolve(response),set:(id,emoji)=>{writes++;return new Promise((resolve,reject)=>{pendingWrite={id,emoji,resolve,reject};});}};
const code=fs.readFileSync(path.join(__dirname,"../miniprogram/components/notice-reactions/notice-reactions.js"),"utf8");
vm.runInNewContext(code,{require:(name)=>name.includes("noticeReactionService")?api:catalog,Component:(item)=>{definition=item;},setTimeout,clearTimeout});
const component={data:{...definition.data,notice:{id:"notice",reactions:response},compact:false},setData(patch){Object.assign(this.data,patch);},triggerEvent(name,detail){this.events.push({name,detail});},events:[],...definition.methods};
function drain(){return new Promise(resolve=>setImmediate(resolve));}
function choose(id){component.select({currentTarget:{dataset:{id}}});}
(async()=>{
  definition.properties.notice.observer.call(component,component.data.notice);definition.lifetimes.attached.call(component);await drain();
  component.openPicker();assert(component.data.pickerOpen);assert.strictEqual(component.data.choices.length,24);
  choose("like");assert.strictEqual(component.data.summary.total,1);assert(component.data.busy);choose("heart");assert.strictEqual(writes,1,"rapid taps must be single-flight");
  response={...response,total:1,items:[{...catalog.CATALOG[0],count:1}],myReaction:"like"};pendingWrite.resolve(response);await drain();assert(!component.data.busy);
  choose("heart");assert.strictEqual(component.data.summary.total,1);assert.strictEqual(component.data.summary.myReaction,"heart");assert(!component.data.items.some(item=>item.id==="like"));
  pendingWrite.reject(new Error("network"));await drain();assert.strictEqual(component.data.summary.myReaction,"like");assert(component.data.error.includes("未发送"));
  choose("like");assert.strictEqual(pendingWrite.emoji,"");assert.strictEqual(component.data.summary.total,0);
  // Simulate accepted write with a lost network acknowledgement.
  response={...response,total:0,items:[],myReaction:""};pendingWrite.reject(new Error("lost acknowledgement"));await drain();assert.strictEqual(component.data.summary.total,0);assert.strictEqual(component.data.error,"");
  choose("heart");const stale=pendingWrite;component.data.notice={id:"other",reactions:response};definition.properties.notice.observer.call(component,component.data.notice);await drain();stale.resolve({...response,total:999,myReaction:"heart"});await drain();assert.strictEqual(component.data.summary.total,0,"stale write cannot change another announcement");
  component.data.compact=true;component.data.notice.reactions={...response,total:45};definition.properties.notice.observer.call(component,component.data.notice);assert.strictEqual(component.data.totalText,"45");
  definition.lifetimes.detached.call(component);
  console.log("test-notice-reaction-client passed (single-flight, switch, withdrawal, failed/lost acknowledgement, stale responses, compact update)");
})().catch(error=>{console.error(error);process.exitCode=1;});
