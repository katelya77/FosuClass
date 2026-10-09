"use strict";
const fs=require("fs"),path=require("path"),crypto=require("crypto");
function fail(code){return Object.assign(new Error(code),{code,statusCode:409});}
function acquire(directory){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  if(fs.lstatSync(directory).isSymbolicLink())throw fail("PUBLICATION_LOCK_PATH_REJECTED");
  const file=path.join(directory,"publication.lock"),owner=crypto.randomBytes(16).toString("hex");
  let fd;try{fd=fs.openSync(file,"wx",0o600);}catch(e){if(e.code==="EEXIST")throw fail("PUBLICATION_LOCKED");throw e;}
  try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,owner,startedAt:new Date().toISOString()}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return ()=>{const entry=JSON.parse(fs.readFileSync(file,"utf8"));if(entry.pid===process.pid&&entry.owner===owner)fs.unlinkSync(file);};
}
function assertExpectedVersion(actual,expected){if(expected!==undefined&&String(actual||"")!==String(expected||""))throw fail("PUBLICATION_BASELINE_CHANGED");}
function epoch(pointer){return Math.max(Number(pointer&&pointer.cacheEpoch)||0,Date.parse(pointer&&pointer.updatedAt||"")||0);}
function assertNotOlder(candidate,current){if(epoch(current)>epoch(candidate))throw fail("PUBLICATION_POINTER_REGRESSION");}
module.exports={acquire,assertExpectedVersion,assertNotOlder,epoch};
