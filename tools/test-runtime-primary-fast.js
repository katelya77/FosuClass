"use strict";
const assert=require("assert"),mock=require("./mock-env");
const request=require("../miniprogram/utils/request"),origins=require("../miniprogram/services/staticOriginService"),packs=require("../miniprogram/services/releasePackService");
const pointer=(version,epoch)=>({success:true,term:"2026-2027-1",activeTerm:"2026-2027-1",releaseVersion:version,cacheEpoch:epoch,updatedAt:new Date(epoch).toISOString()});
const previous=request.get;
const previousManifest=origins.fetchManifest;
function setup(){mock.clearStorage();packs.__resetForTest();origins.__setTestConfig({cloudbase:{CLOUDBASE_HOSTING_ENABLED:true,CLOUDBASE_HOSTING_READY:true,CLOUDBASE_HOSTING_BASE_URL:"https://cloudbase.example.com"},oracle:{ORACLE_RUNTIME_BASE_URL:"https://oracle.example.com/runtime",ORACLE_STATIC_RELEASE_BASE_URL:"https://oracle.example.com/releases"}});}
async function main(){
  setup();let finishOracle;const updates=[];request.get=url=>url.includes("cloudbase")?Promise.resolve(pointer("v2",2000)):new Promise(r=>{finishOracle=r;});
  const start=Date.now();const p=await Promise.race([origins.fetchRuntimePointer({onNewerPointer:q=>updates.push(q.releaseVersion)}),new Promise((_,reject)=>setTimeout(()=>reject(Error("Oracle blocked primary")),100))]);
  assert.equal(p.releaseVersion,"v2");assert.ok(Date.now()-start<100);finishOracle(pointer("v3",3000));await new Promise(r=>setTimeout(r,0));assert.equal(updates.at(-1),"v3");
  setup();request.get=url=>url.includes("cloudbase")?Promise.resolve(pointer("v1",1000)):Promise.resolve(pointer("v2",2000));assert.equal((await origins.fetchRuntimePointer({minimumPointer:pointer("v3",3000)})).releaseVersion,"v3");
  setup();request.get=url=>url.includes("cloudbase")?Promise.reject(Error("offline")):Promise.resolve(pointer("v2",2000));assert.equal((await origins.fetchRuntimePointer()).releaseVersion,"v2");
  setup();request.get=url=>url.includes("cloudbase")?Promise.resolve({error:"invalid"}):Promise.resolve(pointer("v2",2000));assert.equal((await origins.fetchRuntimePointer()).releaseVersion,"v2");
  setup();request.get=url=>url.includes("cloudbase")?Promise.resolve({...pointer("v9",9000),success:false}):Promise.resolve(pointer("v2",2000));assert.equal((await origins.fetchRuntimePointer()).releaseVersion,"v2");
  setup();let calls=0;request.get=()=>{calls++;return Promise.resolve(pointer("v3",3000));};assert.equal((await packs.resolveRuntimePointer()).releaseVersion,"v3");const count=calls;await packs.resolveRuntimePointer();assert.equal(calls,count,"foreground dedupe must avoid duplicate downloads");
  request.get=()=>Promise.resolve(pointer("v1",1000));assert.equal((await packs.resolveRuntimePointer({forceNetwork:true})).releaseVersion,"v3","stale mirrors must not regress persistent pointer");
  setup();let finishOld;
  const manifest=(version,epoch)=>({...pointer(version,epoch),schemaVersion:2,files:{"index/class/all.json":{hash:"fixture",size:1}}});
  origins.fetchManifest=version=>version==="v1"?new Promise(resolve=>{finishOld=resolve;}):Promise.resolve(manifest(version,version==="v0"?500:2000));
  packs.writeRuntimePointerCache(pointer("v0",500));
  await packs.switchReleaseSafely({term:"2026-2027-1",releaseVersion:"v0",pointer:pointer("v0",500),skipWarmup:true});
  const old=packs.switchReleaseSafely({term:"2026-2027-1",releaseVersion:"v1",pointer:pointer("v1",1000),skipWarmup:true});
  packs.writeRuntimePointerCache(pointer("v2",2000));
  await packs.switchReleaseSafely({term:"2026-2027-1",releaseVersion:"v2",pointer:pointer("v2",2000),skipWarmup:true});
  finishOld(manifest("v1",1000));assert.equal((await old).releaseVersion,"v2");assert.equal(packs.getLocalActiveRelease("2026-2027-1").releaseVersion,"v2","late manifest must not overwrite a newer activation");
  wx.setStorageSync(packs.getLastGoodCacheKey("2025-2026-2"),{releaseVersion:"historical"});
  const oldIndex=packs.getIndexCacheKey("2025-2026-2","historical","class");wx.setStorageSync(oldIndex,{savedAt:1});
  wx.setStorageSync("user-browsing-week",7);wx.setStorageSync("school-filter",{college:"fixture"});
  packs.clearOldReleaseCaches({keepLatestN:1});assert.ok(wx.getStorageSync(oldIndex));assert.equal(wx.getStorageSync("user-browsing-week"),7);assert.deepEqual(wx.getStorageSync("school-filter"),{college:"fixture"});
  console.log("runtime primary: fast CloudBase, late Oracle reconciliation, persistent no-regression, 30s dedupe, invalid primary fallback fixtures PASS; device SLO unverified");
}
main().finally(()=>{request.get=previous;origins.fetchManifest=previousManifest;origins.__resetForTest();packs.__resetForTest();mock.clearStorage();}).catch(e=>{console.error(e);process.exitCode=1;});
