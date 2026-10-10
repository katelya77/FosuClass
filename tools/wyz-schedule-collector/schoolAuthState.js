"use strict";
const fs=require('fs'),path=require('path');
const {readJson}=require('./runStore');
const COOLDOWN_MS=30*60*1000,DAY_MS=24*60*60*1000;
const fail=code=>Object.assign(new Error(code),{code});
function load(file,platform){
  if(!fs.existsSync(file))return {};
  require('./schoolSession').secureFile(file,platform);
  const state=readJson(file,null);
  if(!state||typeof state!=='object'||Array.isArray(state)||['attempts','windowStart','cooldownUntil'].some(k=>state[k]!==undefined&&(!Number.isSafeInteger(state[k])||state[k]<0))||state.blocked!==undefined&&typeof state.blocked!=='boolean')throw fail('SCHOOL_AUTH_STATE_INVALID');
  return state;
}
function persist(file,state){
  const temp=file+'.'+process.pid+'.pending';let fd;
  try{
    fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    fs.renameSync(temp,file);
    if(process.platform!=='win32'){const directory=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
  }finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function lifecycle(cfg,deps={}){
  const file=path.join(cfg.dataRoot,'school-auth-state.json'),clock=deps.now||Date.now;
  let state=load(file,deps.platform),reserved=false,released=false;
  const save=fields=>{state={...state,...fields};persist(file,state);};
  function check(){
    const now=clock();
    if(state.blocked&&deps.acknowledgeFailure!==true)throw fail('SCHOOL_AUTH_MANUAL_ACTION_REQUIRED');
    if(state.cooldownUntil>now)throw fail('SCHOOL_AUTH_COOLDOWN');
    if(state.windowStart&&now-state.windowStart<DAY_MS&&state.attempts>=2)throw fail('SCHOOL_AUTH_DAILY_LIMIT');
  }
  return {
    check,
    hooks:{
      beforeAuthSubmit(){
        if(reserved)throw fail('SCHOOL_PASSWORD_RESUBMISSION_BLOCKED');
        check();const now=clock();
        const attempts=state.windowStart&&now-state.windowStart<DAY_MS?(state.attempts||0):0;
        // Durable reservation precedes Chromium release. A crash in this gap
        // remains unknown and consumes budget; never refund by error-code guess.
        save({schema:2,windowStart:attempts?state.windowStart:now,attempts:attempts+1,cooldownUntil:now+COOLDOWN_MS,blocked:false,submissionState:'reserved_unknown',lastSubmissionReservedAt:now});reserved=true;
      },
      onAuthSubmitReleased(){released=true;save({submissionState:state.submissionState==='response_received'?'response_received':'released',lastSubmissionReleasedAt:clock()});},
      onAuthResponse(){save({submissionState:'response_received',lastAuthResponseAt:clock()});},
    },
    success(profile){save({cooldownUntil:0,blocked:false,lastSuccessAt:clock(),lastFailureCode:null,lastFailureCategory:null,loginProfile:profile});},
    failure(code,diagnostic){
      const blocked=/INVALID_CREDENTIALS|CHALLENGE|CHANGED|TLS|PAGE_REJECTED|RESOURCE_REJECTED|RESUBMISSION|SESSION_INVALID/.test(code);
      save({cooldownUntil:clock()+COOLDOWN_MS,blocked:state.blocked===true||blocked,lastFailureCode:code,
        lastFailureCategory:reserved?(released&&code==='INVALID_CREDENTIALS'?'authentication_rejected':'submission_outcome_unknown'):'local_preflight',
        lastDiagnosticStage:diagnostic?.stage||null});
    },
    attempts:()=>released?1:0,
  };
}
function view(cfg,deps={}){
  const file=path.join(cfg.dataRoot,'school-auth-state.json');
  const state=load(file,deps.platform),now=(deps.now||Date.now)();
  const number=value=>Number.isSafeInteger(value)&&value>=0?value:0;
  return {status:'LOCAL_AUTH_STATE',schema:state.schema===2?2:'LEGACY_UNVERIFIED',blocked:state.blocked===true,
    dailyBudgetUsed:state.windowStart&&now-state.windowStart<DAY_MS?number(state.attempts):0,dailyLimit:2,
    cooldownRemainingSeconds:Math.max(0,Math.ceil((number(state.cooldownUntil)-now)/1000)),
    lastFailureCode:/^(SCHOOL_[A-Z_]+|INVALID_CREDENTIALS|COLLECTOR_STOPPED)$/.test(state.lastFailureCode||'')?state.lastFailureCode:null,
    failureCategory:['local_preflight','authentication_rejected','submission_outcome_unknown'].includes(state.lastFailureCategory)?state.lastFailureCategory:null,
    submissionState:['reserved_unknown','released','response_received'].includes(state.submissionState)?state.submissionState:'LEGACY_UNVERIFIED',
    schoolRequests:0,passwordSubmissions:0};
}
module.exports={lifecycle,view,COOLDOWN_MS,DAY_MS};
