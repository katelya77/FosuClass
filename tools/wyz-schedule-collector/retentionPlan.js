"use strict";
const fs=require("fs"),path=require("path");
const {readJson}=require("../../shared/syncCacheStore");
function size(directory){let bytes=0,files=0;for(const e of fs.readdirSync(directory,{withFileTypes:true})){if(e.isSymbolicLink())return {bytes,files,unsafe:true};const file=path.join(directory,e.name);if(e.isDirectory()){const child=size(file);bytes+=child.bytes;files+=child.files;if(child.unsafe)return {bytes,files,unsafe:true};}else if(e.isFile()){bytes+=fs.statSync(file).size;files++;}}return {bytes,files,unsafe:false};}
function plan(root,current,lastSuccess,options={}){
  const runs=path.join(root,"runs"),entries=[];
  if(fs.existsSync(runs)&&!fs.lstatSync(runs).isSymbolicLink())for(const term of fs.readdirSync(runs,{withFileTypes:true})){
    if(!term.isDirectory()||term.isSymbolicLink())continue;
    for(const run of fs.readdirSync(path.join(runs,term.name),{withFileTypes:true})){
      if(!run.isDirectory()||run.isSymbolicLink()||!/^sc-[a-f0-9-]+$/.test(run.name))continue;
      const target=path.join(runs,term.name,run.name),state=readJson(path.join(target,"state.json"),{});
      entries.push({path:target,term:term.name,runId:run.name,status:state.status,result:state.result,finishedAt:Date.parse(state.finishedAt||"")||0,...size(target)});
    }
  }
  const references=new Set([current,lastSuccess,...(options.references||[])].filter(Boolean).map(p=>path.resolve(p)));
  for(const term of new Set(entries.map(e=>e.term)))for(const status of ["completed","failed"]){
    const latest=entries.filter(e=>e.term===term&&e.status===status).sort((a,b)=>b.finishedAt-a.finishedAt)[0];if(latest)references.add(path.resolve(latest.path));
  }
  const now=options.now||Date.now(),age=(options.retentionDays||30)*86400000;
  for(const item of entries){
    item.protection=[];
    if(references.has(path.resolve(item.path)))item.protection.push("referenced-or-term-recovery");
    if(!["completed","cancelled","failed"].includes(item.status))item.protection.push("non-terminal-or-unknown");
    if(item.result==="PENDING REVIEW")item.protection.push("pending-review");
    if(!item.finishedAt||now-item.finishedAt<age)item.protection.push("unconfirmed-finish-or-retention");
    if(item.unsafe)item.protection.push("symlink-detected");
    if(options.referencesComplete!==true)item.protection.push("external-references-not-attested");
  }
  const candidates=entries.filter(e=>!e.protection.length);
  return {schema:1,dryRun:true,retentionDays:options.retentionDays||30,referencesComplete:options.referencesComplete===true,entries,candidates,estimatedDeleteDirectories:candidates.length,estimatedReclaimBytes:candidates.reduce((a,e)=>a+e.bytes,0),historyAffected:candidates.map(e=>e.term),rollbackReferencesProtected:true,executeAllowed:false,recovery:"No files deleted; future quarantine must be approved and audited"};
}
module.exports={plan};
