"use strict";
// One bounded, credential-free audit of the path already observed by WYZ.
// Observers cannot release a request or widen the installed request policy.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const TARGET='/authserver/common/getLanguageTypes.htl',AUTH='https://authserver.fosu.edu.cn';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
async function bounded(work,ms){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('SCHOOL_PUBLIC_AUDIT_TIMEOUT'),{code:'SCHOOL_PUBLIC_AUDIT_TIMEOUT'})),Math.max(1,ms));})]);}finally{clearTimeout(timer);}}
const allowedName=value=>typeof value==='string'&&/^[A-Za-z_$][A-Za-z0-9_$.-]{0,63}$/.test(value)&&!/\d{6}|https?/i.test(value)?value:'REDACTED_NAME';
function publicScriptPath(value){
  try{const u=new URL(value);return u.origin===AUTH&&!u.username&&!u.password&&/^\/authserver\/[A-Za-z0-9_./-]{1,256}$/.test(u.pathname)&&!u.pathname.includes('..')?u.pathname:null;}catch{return null;}
}
function parameterSummary(request){
  const type=Object.entries(request.headers||{}).find(([key])=>key.toLowerCase()==='content-type')?.[1]||'';
  const body=request.postData,bodyCaptureComplete=typeof body==='string'||request.hasPostData!==true&&!request.postDataEntries?.length;
  let names=[],bodyFormat='unknown';
  if(bodyCaptureComplete&&(body===undefined||body===''))bodyFormat='empty';
  else if(typeof body==='string'&&body.length<=8192){
    if(/^application\/json(?:\s*;|$)/i.test(type)){
      try{const value=JSON.parse(body);if(value&&typeof value==='object'&&!Array.isArray(value)){names=Object.keys(value);bodyFormat='json-object';}}catch{}
    }else if(/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(type)){names=[...new URLSearchParams(body).keys()];bodyFormat='form-urlencoded';}
  }
  return {bodyEmpty:bodyCaptureComplete?body===undefined||body==='':null,bodyCaptureComplete,bodyFormat,contentType:bodyFormat==='json-object'?'application/json':bodyFormat==='form-urlencoded'?'application/x-www-form-urlencoded':/^application\/json(?:\s*;|$)/i.test(type)?'application/json':'other-or-absent',
    parameterNames:[...new Set(names.map(allowedName))].slice(0,32),sensitiveParameterPresent:names.some(key=>/user|account|pass|token|cookie|ticket|csrf|session|secret|authorization|captcha|execution/i.test(key)),
    queryParameterNames:[...new Set([...new URL(request.url).searchParams.keys()].map(allowedName))].slice(0,32)};
}
function sourceSummary(source){
  const needle='getLanguageTypes.htl',offsets=[];let start=0,index;
  while(offsets.length<8&&(index=source.indexOf(needle,start))>=0){offsets.push(index);start=index+needle.length;}
  const windows=offsets.map(at=>source.slice(Math.max(0,at-1000),at+1500));
  // Emit only fixed vocabulary and booleans, never raw code, literal strings,
  // response values, hidden fields, cookies or credentials from page sources.
  const vocabulary=['getLanguageTypes','languageTypes','languageType','language','languages','lang','locale','i18n','success','error','fail','complete','catch'];
  const signals=vocabulary.filter(word=>windows.some(text=>new RegExp('\\b'+word+'\\b','i').test(text)));
  return {sourceSha256:sha(source),endpointOccurrences:offsets.length,endpointLineNumbers:offsets.map(at=>source.slice(0,at).split('\n').length),knownUsageSignals:signals,
    nearbyCredentialLogic:windows.some(text=>/username|password|account/i.test(text)),nearbySecurityLogic:windows.some(text=>/captcha|csrf|execution|ticket|token|risk|verify/i.test(text)),
    nearbyAuthenticationSubmit:windows.some(text=>/\/authserver\/login|login_submit|submit\s*\(/i.test(text)),purposeConfirmed:false};
}
function sanitizedPublicSource(source){
  // Mask literals/comments across the complete script before taking an
  // excerpt; clipping first could expose a partial secret literal. Preserve
  // only fixed protocol words and public UI selectors needed for local review.
  const publicWords=new Set(['GET','POST','json','url','type','method','data','dataType','contentType','disabled','readonly','val','attr','prop','append','html','text','success','error','complete','done','fail','then','catch','language','languages','languageTypes','languageType','languageName','lang','locale','i18n','getLanguageTypes.htl','username','password','account','csrf','execution','captcha','ticket','token']);
  const publicSelectors=new Set(['#language','#languages','#lang','#locale','#login','#login_submit','.login-btn','#submit']);
  const masked=source.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|\/(?:\\[\s\S]|\[(?:\\[\s\S]|[^\]\\])*\]|[^/\r\n\\])+\/[dgimsuvy]*/g,token=>{
    if(token.startsWith('/'))return token.replace(/[^\r\n]/g,' ');
    const value=token.slice(1,-1);
    if(value===''||publicWords.has(value)||value===TARGET||value==='/common/getLanguageTypes.htl'||publicSelectors.has(value))return token;
    const redacted=token[0]+'REDACTED'.slice(0,token.length-2).padEnd(token.length-2,' ')+token[token.length-1];
    return redacted.split('').map((char,index)=>/[\r\n]/.test(token[index])?token[index]:char).join('');
  });
  const syntax=new Set(('var let const function return if else for while do try catch finally throw new class get set async await true false null undefined switch case break continue instanceof typeof void delete in of this yield default export import extends static super Array Object JSON Number String Boolean Error Math Date document window console ajax fetch getLanguageTypes append html text attr prop val show hide addClass removeClass length login submit login_submit authserver common htl REDACTED').split(' '));
  const aliases=new Map();
  return masked.replace(/\b(?:0[xob][A-Fa-f0-9]+|\d+(?:\.\d+)?)\b/g,token=>'0'+' '.repeat(token.length-1))
    .replace(/(?:[$_]|\p{ID_Start})(?:[$]|\p{ID_Continue})*/gu,token=>{
      if(publicWords.has(token)||syntax.has(token))return token;
      if(!aliases.has(token))aliases.set(token,'v'+(aliases.size+1));return aliases.get(token);
    });
}
function sanitizedCallExcerpts(source,maxChars=6000){
  const excerpts=[];let offset=0,budget=Math.min(6000,maxChars),index;
  while(excerpts.length<2&&budget>0&&(index=source.indexOf('getLanguageTypes.htl',offset))>=0){
    const start=Math.max(0,index-900),end=Math.min(source.length,index+2100),text=source.slice(start,end).slice(0,Math.min(3000,budget));
    excerpts.push(text);budget-=text.length;offset=end;
  }
  return excerpts;
}
const AUDIT_STAGES=new Set(['module-load','runtime-validation','state-snapshot','session-lock','playwright-module-load','browser-start','browser-context','cdp-observer-start','public-page-navigation','source-review','output-validation','browser-close']);
const AUDIT_CODES=new Set(('SCHOOL_PUBLIC_AUDIT_TIMEOUT SCHOOL_PUBLIC_AUDIT_SESSION_REJECTED SCHOOL_PUBLIC_AUDIT_MODULE_FAILED SCHOOL_PUBLIC_AUDIT_CLOSE_FAILED SCHOOL_AUTH_PERMISSIONS_REJECTED SCHOOL_TLS_OR_ORIGIN_REJECTED SCHOOL_AUTH_DEBUG_REJECTED SCHOOL_AUTH_NATIVE_BROWSER_REQUIRED SCHOOL_NETWORK_TIMEOUT SCHOOL_AUTH_TRANSPORT_FAILED SCHOOL_AUTH_BROWSER_CLOSED SCHOOL_LOGIN_RESOURCE_REJECTED SCHOOL_AUTH_POST_NOT_AUTHORIZED SCHOOL_PASSWORD_RESUBMISSION_BLOCKED SCHOOL_CREDENTIAL_REQUEST_BLOCKED SCHOOL_SECURITY_CHALLENGE SCHOOL_LOGIN_FORM_CHANGED SCHOOL_LOGIN_PAGE_REJECTED SCHOOL_LOGIN_ACCOUNT_FIELD_CHANGED SCHOOL_LOGIN_PASSWORD_FIELD_CHANGED SCHOOL_LOGIN_SUBMIT_CHANGED SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED SCHOOL_PAGE_CHANGED SCHOOL_LOGIN_PRECHECK_CHANGED SCHOOL_PUBLIC_POST_RULE_REJECTED COLLECTOR_STOPPED LOCAL_RUN_LOCKED').split(' '));
function auditFailure(error,stage){
  const code=error?.code;
  if(AUDIT_CODES.has(code))return {code,reason:code};
  if(stage==='browser-start')return {code:'SCHOOL_PUBLIC_AUDIT_BROWSER_START_FAILED',reason:'BROWSER_RUNTIME_UNAVAILABLE'};
  if(stage==='module-load'||stage==='playwright-module-load')return {code:'SCHOOL_PUBLIC_AUDIT_MODULE_FAILED',reason:'INSTALLED_MODULE_UNAVAILABLE'};
  if(stage==='cdp-observer-start')return {code:'SCHOOL_PUBLIC_AUDIT_OBSERVER_FAILED',reason:'PUBLIC_OBSERVER_UNAVAILABLE'};
  return {code:'SCHOOL_PUBLIC_AUDIT_FAILED',reason:'PUBLIC_AUDIT_STAGE_FAILED'};
}
async function audit(cfg,deps={}){
  const moduleRoot=deps.moduleRoot||__dirname;
  const deadline=Date.now()+45000,remaining=()=>Math.max(1,deadline-Date.now()),control=new AbortController();
  const history=path.join(cfg.dataRoot,'school-auth-state.json');
  const snapshot=()=>fs.existsSync(history)?sha(fs.readFileSync(history)):null;
  let stage='module-load',auth,native,unlock=()=>{},before,sessionBefore,snapshotsComplete=false;
  const setStage=value=>{if(AUDIT_STAGES.has(value))stage=value;};
  const cancel=()=>control.abort(),timer=setTimeout(cancel,45000);deps.signal?.addEventListener('abort',cancel,{once:true});
  const initiators=new Map(),scripts=[],requests=[];let adapter,result,failure,activeBrowser,auditDirectory;
  const wrapped={launch:async options=>{
    setStage('browser-start');
    const browser=await bounded(native.launch(options),remaining());activeBrowser=browser;const newContext=browser.newContext.bind(browser);
    browser.newContext=async options=>{
      setStage('browser-context');
      if(options.storageState)throw Object.assign(new Error('PUBLIC_AUDIT_SESSION_REJECTED'),{code:'SCHOOL_PUBLIC_AUDIT_SESSION_REJECTED'});
      const context=await newContext(options),newSession=context.newCDPSession.bind(context);
      context.newCDPSession=async page=>{
        setStage('cdp-observer-start');
        const cdp=await bounded(newSession(page),Math.min(3000,remaining()));
        cdp.on('Network.requestWillBeSent',event=>{
          try{const u=new URL(event.request.url);if(u.origin===AUTH&&u.pathname===TARGET)initiators.set(event.requestId,event.initiator?.stack?.callFrames||[]);}catch{}
        });
        cdp.on('Debugger.scriptParsed',event=>{const scriptPath=publicScriptPath(event.url);if(scriptPath&&scripts.length<96)scripts.push({cdp,scriptId:event.scriptId,scriptPath});});
        cdp.on('Fetch.requestPaused',event=>{
          if(event.responseStatusCode!==undefined||event.responseErrorReason!==undefined||event.request.method!=='POST')return;
          try{const u=new URL(event.request.url);if(u.origin===AUTH&&u.pathname===TARGET&&requests.length<12)requests.push({networkId:event.networkId,parameters:parameterSummary(event.request)});}catch{}
        });
        await bounded(cdp.send('Network.enable'),Math.min(3000,remaining()));await bounded(cdp.send('Debugger.enable'),Math.min(3000,remaining()));return cdp;
      };
      return context;
    };return browser;
  }};
  try{
    auth=require(path.join(moduleRoot,'schoolSession'));
    if(typeof auth.createAdapter!=='function'||typeof auth.secureDirectory!=='function'||typeof auth.assertSafeRuntime!=='function')throw Object.assign(new Error('SCHOOL_PUBLIC_AUDIT_MODULE_FAILED'),{code:'SCHOOL_PUBLIC_AUDIT_MODULE_FAILED'});
    setStage('runtime-validation');auth.secureDirectory(cfg.dataRoot);auth.assertSafeRuntime();
    if(deps.signal?.aborted)throw Object.assign(new Error('COLLECTOR_STOPPED'),{code:'COLLECTOR_STOPPED'});
    setStage('state-snapshot');before=snapshot();sessionBefore=fs.existsSync(cfg.sessionPath)?fs.statSync(cfg.sessionPath):null;snapshotsComplete=true;
    setStage('session-lock');unlock=require(path.join(moduleRoot,'runStore')).acquireLock(cfg.dataRoot,'school-session.lock');
    setStage('playwright-module-load');native=deps.chromium||require(path.join(moduleRoot,'../fosu-sync-client/node_modules/playwright')).chromium;
    setStage('browser-start');
    adapter=await bounded((deps.createAdapter||auth.createAdapter)(cfg,{chromium:wrapped,signal:control.signal,onDiagnostic:value=>{
      if(['cas-navigation','cas-load','form-selection','form-ready','public-network-summary'].includes(value?.stage))setStage('public-page-navigation');
    }}),remaining());
    setStage('public-page-navigation');
    try{result=await bounded(adapter.diagnose(),remaining());}catch(error){failure={...auditFailure(error,stage),stage};}
    const sourceEvidence=[];let excerptBudget=6000;
    setStage('source-review');
    for(const script of scripts){
      if(control.signal.aborted||Date.now()>=deadline)break;
      let source;try{source=(await bounded(script.cdp.send('Debugger.getScriptSource',{scriptId:script.scriptId}),Math.min(2000,remaining()))).scriptSource;}catch{continue;}
      if(typeof source!=='string'||source.length>2*1024*1024||!source.includes('getLanguageTypes.htl'))continue;
      const evidence={publicScriptPath:script.scriptPath,...sourceSummary(source)};
      if(!sourceEvidence.some(value=>value.sourceSha256===evidence.sourceSha256)){
        if(!auditDirectory){auditDirectory=fs.mkdtempSync(path.join(cfg.dataRoot,'public-cas-audit-'));fs.chmodSync(auditDirectory,0o700);}
        const file=path.join(auditDirectory,'public-script-'+evidence.sourceSha256.slice(0,12)+'.sanitized.js');
        const sanitized=sanitizedPublicSource(source);fs.writeFileSync(file,sanitized,{mode:0o600,flag:'wx'});
        evidence.sanitizedCallExcerpts=sanitizedCallExcerpts(sanitized,excerptBudget);excerptBudget-=evidence.sanitizedCallExcerpts.reduce((count,text)=>count+text.length,0);
        evidence.localSanitizedSource=file;evidence.localReviewRequired=['successCallbackLanguageComponent','failureCallbackDisablesLogin','requestDataFixedOrAccountDerived'];
        sourceEvidence.push(evidence);
      }
      if(sourceEvidence.length>=8)break;
    }
    const endpointAudit=requests.map(record=>({path:TARGET,...record.parameters,initiator:(initiators.get(record.networkId)||[]).slice(0,6).map(frame=>({publicScriptPath:publicScriptPath(frame.url)||'unresolved-public-script',functionName:['getLanguageTypes','getLanguageType','setLanguage','initLanguage'].includes(frame.functionName)?frame.functionName:'unreviewed-function',functionFingerprint:sha(String(frame.functionName||'')).slice(0,12),line:Number.isSafeInteger(frame.lineNumber)?frame.lineNumber+1:null}))}));
    setStage('output-validation');const stats=adapter.stats(),sessionAfter=fs.existsSync(cfg.sessionPath)?fs.statSync(cfg.sessionPath):null;
    return {status:failure?'BLOCKED':'PUBLIC_BOOTSTRAP_EVIDENCE',...(failure||{}),installedPolicyExpanded:false,formReady:result?.formReady===true,networkCompatibility:result?.networkCompatibility||'UNVERIFIED',
      endpointAudit,sourceEvidence,credentialsRead:false,sessionSaved:false,passwordSubmissions:stats.passwordSubmissions,schoolRequests:stats.schoolRequests,
      backgroundPostsBlocked:stats.backgroundPostsBlocked,requiredInitializationComplete:result?.requiredInitializationComplete===true,authHistoryChanged:before!==snapshot(),
      sessionMetadataChanged:Boolean(sessionBefore)!==Boolean(sessionAfter)||Boolean(sessionBefore&&sessionAfter&&(sessionBefore.size!==sessionAfter.size||sessionBefore.mtimeMs!==sessionAfter.mtimeMs)),
      extraScriptGetRequests:0,postReleasePolicy:'installed-guard-unchanged',purposeConfirmed:false};
  }catch(error){
    const stats=adapter?.stats?.(),sessionAfter=snapshotsComplete&&fs.existsSync(cfg.sessionPath)?fs.statSync(cfg.sessionPath):null;
    return {status:'BLOCKED',...auditFailure(error,stage),stage,endpointAudit:[],sourceEvidence:[],installedPolicyExpanded:false,credentialsRead:false,sessionSaved:false,
      passwordSubmissions:stats?.passwordSubmissions||0,schoolRequests:stats?.schoolRequests||0,backgroundPostsBlocked:stats?.backgroundPostsBlocked??null,
      authHistoryChanged:snapshotsComplete?before!==snapshot():null,sessionMetadataChanged:snapshotsComplete?Boolean(sessionBefore)!==Boolean(sessionAfter)||Boolean(sessionBefore&&sessionAfter&&(sessionBefore.size!==sessionAfter.size||sessionBefore.mtimeMs!==sessionAfter.mtimeMs)):null,
      extraScriptGetRequests:0,postReleasePolicy:'installed-guard-unchanged',purposeConfirmed:false};
  }finally{
    clearTimeout(timer);deps.signal?.removeEventListener('abort',cancel);
    try{if(adapter)await bounded(adapter.close(),5000);else if(activeBrowser)await bounded(activeBrowser.close(),5000);}
    catch{throw Object.assign(new Error('SCHOOL_PUBLIC_AUDIT_CLOSE_FAILED'),{code:'SCHOOL_PUBLIC_AUDIT_CLOSE_FAILED',diagnosticStage:'browser-close'});}
    finally{unlock();}
  }
}
module.exports={TARGET,parameterSummary,sourceSummary,sanitizedPublicSource,sanitizedCallExcerpts,publicScriptPath,auditFailure,audit};
