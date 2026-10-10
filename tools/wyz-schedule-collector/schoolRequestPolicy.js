"use strict";
const {AUTH_ORIGIN,SCHOOL_ORIGIN,CAS_SERVICE_URL}=require('../fosu-sync-client/schoolLoginProfile');
// No new school background POST has source/purpose/parameter approval. Keep
// production empty until that evidence is reviewed in a separate code change.
const REVIEWED_PUBLIC_POSTS=Object.freeze([]);
const RESOURCE_TYPES=new Set(['Document','Stylesheet','Image','Media','Font','Script','TextTrack','XHR','Fetch','EventSource','WebSocket','Manifest','SignedExchange','Ping','CSPViolationReport','Preflight','Other']);
const sensitiveKey=key=>/user|account|pass|token|cookie|ticket|csrf|session|secret|authorization|captcha|execution/i.test(key);
const fixedValues=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).length<=8&&Object.entries(value).every(([key,item])=>
  /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)&&!sensitiveKey(key)&&['string','number','boolean'].includes(typeof item)&&
  (typeof item!=='number'||Number.isFinite(item))&&(typeof item!=='string'||item.length<=128));
function validResponse(rule){
  const response=rule.response;
  return response&&typeof response==='object'&&!Array.isArray(response)&&Object.keys(response).every(key=>['expected','arrays','maxBytes'].includes(key))&&
    Number.isSafeInteger(response.maxBytes)&&response.maxBytes>=1024&&response.maxBytes<=16384&&fixedValues(response.expected)&&Object.keys(response.expected).length>0&&
    response.arrays&&typeof response.arrays==='object'&&!Array.isArray(response.arrays)&&Object.keys(response.arrays).length<=4&&
    Object.entries(response.arrays).every(([key,fields])=>/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)&&!sensitiveKey(key)&&!Object.hasOwn(response.expected,key)&&
      Array.isArray(fields)&&fields.length>0&&fields.length<=8&&new Set(fields).size===fields.length&&fields.every(field=>typeof field==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(field)&&!sensitiveKey(field)));
}
function validateRules(reviewed=REVIEWED_PUBLIC_POSTS){
  const invalid=()=>{throw Object.assign(new Error('SCHOOL_PUBLIC_POST_RULE_REJECTED'),{code:'SCHOOL_PUBLIC_POST_RULE_REJECTED',diagnosticStage:'public-rule-validation'});};
  if(!Array.isArray(reviewed)||reviewed.length>8)invalid();
  const paths=new Set();
  return Object.freeze(reviewed.map(rule=>{
    const keys=['origin','path','purpose','criticality','resourceTypes','payload','response','maxRequests','evidenceSha256'];
    if(!rule||typeof rule!=='object'||Object.keys(rule).some(k=>!keys.includes(k))||rule.origin!==AUTH_ORIGIN||
      typeof rule.path!=='string'||rule.path.length>256||!/^\/authserver\/[A-Za-z0-9_/-]+(?:\.[A-Za-z0-9]+)?$/.test(rule.path)||rule.path.includes('//')||
      ['/authserver/login','/authserver/checkNeedCaptcha.htl'].includes(rule.path)||paths.has(rule.path)||
      !['public-bootstrap','security-verification'].includes(rule.purpose)||!['required','optional'].includes(rule.criticality)||
      !Array.isArray(rule.resourceTypes)||!rule.resourceTypes.length||rule.resourceTypes.length>2||
      rule.resourceTypes.some(t=>!['XHR','Fetch'].includes(t))||new Set(rule.resourceTypes).size!==rule.resourceTypes.length||
      !Number.isSafeInteger(rule.maxRequests)||rule.maxRequests<1||rule.maxRequests>3||!/^[a-f0-9]{64}$/.test(rule.evidenceSha256||''))invalid();
    paths.add(rule.path);
    if(rule.purpose==='security-verification'){
      if(rule.criticality!=='required'||rule.payload!==undefined||rule.response!==undefined)invalid();
    }else if(!fixedValues(rule.payload)||
      Buffer.byteLength(JSON.stringify(rule.payload))>2048)invalid();
    if(rule.purpose==='public-bootstrap'&&(rule.criticality==='required'||rule.response!==undefined)&&!validResponse(rule))invalid();
    // Only code-reviewed rows may be installed. Freeze a copy so a caller
    // cannot expand parameters or budgets after the browser starts.
    return Object.freeze({...rule,resourceTypes:Object.freeze([...rule.resourceTypes]),...(rule.payload?{payload:Object.freeze({...rule.payload})}:{}),
      ...(rule.response?{response:Object.freeze({...rule.response,expected:Object.freeze({...rule.response.expected}),arrays:Object.freeze(Object.fromEntries(Object.entries(rule.response.arrays).map(([key,fields])=>[key,Object.freeze([...fields])])) )})}:{})});
  }));
}
function describe(request,resourceType,reviewed=REVIEWED_PUBLIC_POSTS){
  let url;try{url=new URL(request.url);}catch(_){}
  const trusted=Boolean(url&&[AUTH_ORIGIN,SCHOOL_ORIGIN].includes(url.origin)&&!url.username&&!url.password);
  const method=['GET','HEAD','POST'].includes(request.method)?request.method:'OTHER';
  const authenticationEndpoint=trusted&&url.origin===AUTH_ORIGIN&&url.pathname==='/authserver/login';
  const precheck=trusted&&url.origin===AUTH_ORIGIN&&url.pathname==='/authserver/checkNeedCaptcha.htl';
  const rule=trusted&&reviewed.find(r=>r.origin===AUTH_ORIGIN&&r.origin===url.origin&&r.path===url.pathname);
  const endpointCategory=!trusted?'unapproved-origin':authenticationEndpoint?'cas-authentication':precheck?'account-captcha-precheck':
    rule?.purpose==='security-verification'?'security-verification':rule?'reviewed-public-background':method==='POST'?'unknown-official-post':'public-resource';
  return {url,rule,trusted,evidence:{methodCategory:method,originCategory:!trusted?'unapproved':url.origin===AUTH_ORIGIN?'school-auth':'school-teaching',
    endpointCategory,resourceType:RESOURCE_TYPES.has(resourceType)?resourceType:'Other',authenticationEndpoint,browserInitiated:true,
    requestPurpose:authenticationEndpoint?'authentication':precheck?'security-verification':rule?rule.purpose:method==='POST'?'unknown':'public-resource',
    criticality:authenticationEndpoint||precheck?'required':rule?.criticality||'unknown'}};
}
function publicPayloadAllowed(request,url,rule){
  if(!rule||url.search||!rule.payload||typeof request.postData!=='string'||request.postData.length>2048||request.postData!==JSON.stringify(rule.payload))return false;
  const headers=Object.entries(request.headers||{}),type=headers.find(([key])=>key.toLowerCase()==='content-type')?.[1]||'';
  if(!/^application\/json(?:\s*;|$)/i.test(type))return false;
  // This inspection stays local. Neither keys nor values are emitted. Only
  // fixed, reviewed public parameters and their exact JSON serialization can
  // pass. This also rejects duplicate keys that JSON.parse alone would hide.
  // Account/token/password fields and arbitrary bootstrap payloads cannot pass.
  try{
    const value=JSON.parse(request.postData);
    return value&&typeof value==='object'&&!Array.isArray(value)&&
      Object.keys(value).length===Object.keys(rule.payload).length&&Object.entries(rule.payload).every(([key,expected])=>
        !sensitiveKey(key)&&Object.hasOwn(value,key)&&
        ['string','number','boolean'].includes(typeof expected)&&value[key]===expected);
  }catch(_){return false;}
}
function decision(request,resourceType,state,reviewed=REVIEWED_PUBLIC_POSTS){
  const description=describe(request,resourceType,reviewed),{url,rule,trusted,evidence}=description;
  const result={...description,allowed:false,reason:'ORIGIN_REJECTED',fatalCode:'SCHOOL_TLS_OR_ORIGIN_REJECTED'};
  if(!trusted)return result;
  if(request.method==='POST'&&evidence.authenticationEndpoint){
    if(url.searchParams.getAll('service').length>1||url.searchParams.has('service')&&url.searchParams.get('service')!==CAS_SERVICE_URL)return {...result,reason:'CAS_SERVICE_REJECTED'};
    if(state.submissionClaimed)return {...result,reason:'DUPLICATE_AUTHENTICATION_POST',fatalCode:'SCHOOL_PASSWORD_RESUBMISSION_BLOCKED'};
    if(!state.armed)return {...result,reason:'AUTHENTICATION_POST_NOT_AUTHORIZED',fatalCode:'SCHOOL_AUTH_POST_NOT_AUTHORIZED'};
    return {...result,allowed:true,reason:'ONE_REVIEWED_AUTHENTICATION_POST',fatalCode:null};
  }
  if(rule?.purpose==='security-verification')return {...result,reason:'SECURITY_VERIFICATION_REQUIRES_MANUAL_ACTION',fatalCode:'SCHOOL_SECURITY_CHALLENGE'};
  // The only account precheck is the explicitly approved context.request GET
  // in login(). A background browser request must not preempt that step.
  if(evidence.endpointCategory==='account-captcha-precheck')return {...result,reason:'ACCOUNT_PRECHECK_NOT_AUTHORIZED',fatalCode:null,reviewRequired:true};
  if(state.credentialsPhase&&!state.submissionReserved)return {...result,reason:'CREDENTIAL_PHASE_REQUEST_REJECTED',fatalCode:'SCHOOL_CREDENTIAL_REQUEST_BLOCKED'};
  if(rule&&request.method!=='POST')return {...result,reason:'PUBLIC_INITIALIZATION_METHOD_REJECTED',fatalCode:null,reviewRequired:true};
  if(request.method==='POST'){
    if(rule&&state.credentialsPhase)return {...result,reason:'CREDENTIAL_PHASE_REQUEST_REJECTED',fatalCode:'SCHOOL_CREDENTIAL_REQUEST_BLOCKED'};
    if(rule&&(!rule.resourceTypes.includes(resourceType)||!publicPayloadAllowed(request,url,rule)))return {...result,reason:'PUBLIC_PARAMETERS_REJECTED',fatalCode:null,reviewRequired:true};
    if(rule?.criticality==='optional')return {...result,reason:'OPTIONAL_INITIALIZATION_BLOCKED',fatalCode:null,noncritical:true};
    if(rule){
      if((state.publicPostCounts?.get(rule.path)||0)>=rule.maxRequests)return {...result,reason:'PUBLIC_INITIALIZATION_BUDGET_EXHAUSTED',fatalCode:null,reviewRequired:true};
      return {...result,allowed:true,reason:'REVIEWED_PUBLIC_PARAMETERS',fatalCode:null};
    }
    return {...result,reason:'BACKGROUND_POST_UNREVIEWED',fatalCode:null,reviewRequired:true};
  }
  if(!['GET','HEAD'].includes(request.method))return {...result,reason:'METHOD_NOT_REVIEWED',fatalCode:null,reviewRequired:true};
  return {...result,allowed:true,reason:'TRUSTED_RESOURCE',fatalCode:null};
}
function publicResponseTransportAllowed(event){
  const type=(event.responseHeaders||[]).find(h=>String(h.name).toLowerCase()==='content-type')?.value||'';
  // A redirect, error page or failed transport is never proof that a required
  // initialization completed, even when its next origin is a school origin.
  return !event.responseErrorReason&&event.responseStatusCode===200&&/^application\/json(?:\s*;|$)/i.test(type);
}
function publicResponseAllowed(event,body,rule){
  if(!publicResponseTransportAllowed(event)||!validResponse(rule)||typeof body!=='string'||Buffer.byteLength(body)>rule.response.maxBytes)return false;
  try{
    const value=JSON.parse(body),{expected,arrays}=rule.response;
    return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===Object.keys(expected).length+Object.keys(arrays).length&&
      Object.entries(expected).every(([key,item])=>Object.hasOwn(value,key)&&value[key]===item)&&
      Object.entries(arrays).every(([key,fields])=>Array.isArray(value[key])&&value[key].length>0&&value[key].length<=100&&value[key].every(item=>
        item&&typeof item==='object'&&!Array.isArray(item)&&Object.keys(item).length===fields.length&&fields.every(field=>Object.hasOwn(item,field)&&typeof item[field]==='string'&&item[field].length>0&&item[field].length<=128)));
  }catch{return false;}
}
module.exports={REVIEWED_PUBLIC_POSTS,validateRules,describe,decision,publicResponseTransportAllowed,publicResponseAllowed};
