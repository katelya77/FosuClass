"use strict";
const {AUTH_ORIGIN,SCHOOL_ORIGIN,CAS_SERVICE_URL}=require('../fosu-sync-client/schoolLoginProfile');
// No new school background POST has source/purpose/parameter approval. Keep
// production empty until that evidence is reviewed in a separate code change.
const REVIEWED_PUBLIC_POSTS=Object.freeze([]);
const RESOURCE_TYPES=new Set(['Document','Stylesheet','Image','Media','Font','Script','TextTrack','XHR','Fetch','EventSource','WebSocket','Manifest','SignedExchange','Ping','CSPViolationReport','Preflight','Other']);
function describe(request,resourceType,reviewed=REVIEWED_PUBLIC_POSTS){
  let url;try{url=new URL(request.url);}catch(_){}
  const trusted=Boolean(url&&[AUTH_ORIGIN,SCHOOL_ORIGIN].includes(url.origin)&&!url.username&&!url.password);
  const method=['GET','HEAD','POST'].includes(request.method)?request.method:'OTHER';
  const authenticationEndpoint=trusted&&url.origin===AUTH_ORIGIN&&url.pathname==='/authserver/login';
  const precheck=trusted&&url.origin===AUTH_ORIGIN&&url.pathname==='/authserver/checkNeedCaptcha.htl';
  const rule=trusted&&reviewed.find(r=>r.origin===AUTH_ORIGIN&&r.origin===url.origin&&r.path===url.pathname&&r.purpose==='public-bootstrap'&&['required','optional'].includes(r.criticality));
  const endpointCategory=!trusted?'unapproved-origin':authenticationEndpoint?'cas-authentication':precheck?'account-captcha-precheck':
    rule?'reviewed-public-background':method==='POST'?'unknown-official-post':'public-resource';
  return {url,rule,trusted,evidence:{methodCategory:method,originCategory:!trusted?'unapproved':url.origin===AUTH_ORIGIN?'school-auth':'school-teaching',
    endpointCategory,resourceType:RESOURCE_TYPES.has(resourceType)?resourceType:'Other',authenticationEndpoint,browserInitiated:true}};
}
function publicPayloadAllowed(request,url,rule){
  if(!rule||url.search||!rule.payload||typeof request.postData!=='string'||request.postData.length>2048)return false;
  const headers=Object.entries(request.headers||{}),type=headers.find(([key])=>key.toLowerCase()==='content-type')?.[1]||'';
  if(!/^application\/json(?:\s*;|$)/i.test(type))return false;
  // This inspection stays local. Neither keys nor values are emitted. Only
  // fixed, reviewed public parameters can pass; account/token/password fields
  // and arbitrary bootstrap payloads are never accepted.
  try{
    const value=JSON.parse(request.postData);
    return value&&typeof value==='object'&&!Array.isArray(value)&&
      Object.keys(value).length===Object.keys(rule.payload).length&&Object.entries(rule.payload).every(([key,expected])=>
        !/user|account|pass|token|cookie|ticket|csrf|session|secret/i.test(key)&&Object.hasOwn(value,key)&&
        ['string','number','boolean'].includes(typeof expected)&&value[key]===expected);
  }catch(_){return false;}
}
function decision(request,resourceType,state,reviewed=REVIEWED_PUBLIC_POSTS){
  const description=describe(request,resourceType,reviewed),{url,rule,trusted,evidence}=description;
  const result={...description,allowed:false,reason:'ORIGIN_REJECTED',fatalCode:'SCHOOL_TLS_OR_ORIGIN_REJECTED'};
  if(!trusted)return result;
  if(request.method==='POST'&&evidence.authenticationEndpoint){
    if(url.searchParams.has('service')&&url.searchParams.get('service')!==CAS_SERVICE_URL)return {...result,reason:'CAS_SERVICE_REJECTED'};
    if(state.submissionClaimed)return {...result,reason:'DUPLICATE_AUTHENTICATION_POST',fatalCode:'SCHOOL_PASSWORD_RESUBMISSION_BLOCKED'};
    if(!state.armed)return {...result,reason:'AUTHENTICATION_POST_NOT_AUTHORIZED',fatalCode:'SCHOOL_AUTH_POST_NOT_AUTHORIZED'};
    return {...result,allowed:true,reason:'ONE_REVIEWED_AUTHENTICATION_POST',fatalCode:null};
  }
  if(state.credentialsPhase&&!state.submissionReserved)return {...result,reason:'CREDENTIAL_PHASE_REQUEST_REJECTED',fatalCode:'SCHOOL_CREDENTIAL_REQUEST_BLOCKED'};
  if(request.method==='POST'){
    if(evidence.endpointCategory==='account-captcha-precheck')return {...result,reason:'ACCOUNT_PRECHECK_NOT_AUTHORIZED',fatalCode:null,reviewRequired:true};
    if(rule&&publicPayloadAllowed(request,url,rule)&&!state.credentialsPhase)return {...result,allowed:true,reason:'REVIEWED_PUBLIC_PARAMETERS',fatalCode:null};
    return {...result,reason:rule?'PUBLIC_PARAMETERS_REJECTED':'BACKGROUND_POST_UNREVIEWED',fatalCode:null,
      reviewRequired:!rule||rule.criticality==='required',noncritical:Boolean(rule&&rule.criticality==='optional')};
  }
  if(!['GET','HEAD'].includes(request.method))return {...result,reason:'METHOD_NOT_REVIEWED',fatalCode:null,reviewRequired:true};
  return {...result,allowed:true,reason:'TRUSTED_RESOURCE',fatalCode:null};
}
module.exports={REVIEWED_PUBLIC_POSTS,describe,decision};
