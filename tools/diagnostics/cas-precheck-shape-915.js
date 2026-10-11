#!/usr/bin/env node
"use strict";
// Diagnostic only. Imports the verified installed 915 adapter without changing
// its files or policy. Every account-precheck and authentication POST is denied.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const REVISION='9153876458df7b1dd6b4fae698851638b31c702e';
const ROOT='/opt/fosuclass/schedule-collector/releases/'+REVISION;
const DATA='/var/lib/fosuclass/schedule-collector';
const ORIGIN='https://authserver.fosu.edu.cn',ENDPOINT='/authserver/checkNeedCaptcha.htl';
const EVENTS=new Set(['focus','input','change','blur']);
const TYPES=new Set(['Document','Stylesheet','Image','Media','Font','Script','TextTrack','XHR','Fetch','EventSource','WebSocket','Manifest','SignedExchange','Ping','CSPViolationReport','Preflight','Other']);
const SOURCE_HASHES={
  "shared/syncCacheStore.js": "e3120f702f4e96c5cb44e2029133b914ce0e7720d2fcb89f9c11f7ae31cfea6b",
  "tools/wyz-schedule-collector/schoolBrowserAdapter.js": "8c1637e330a4f0b139d09dfccf1b372372e99a56e7d54b87a1f14182c972ef18",
  "tools/wyz-schedule-collector/schoolRequestPolicy.js": "4c277ffb2c240ee7c0b6bd7b29cfc845e5ed94473270ce359efdaa54e1f40d95",
  "tools/wyz-schedule-collector/schoolPrecheck.js": "3b2c43bb5e10907abb75be60fc4a5a8c0d7b34174423e73a16f223e50eb01a1f",
  "tools/wyz-schedule-collector/schoolSession.js": "61d8abb1acf6a8655bf47dec6782734d7ed38ad7ee950364dfef793a2954ac13",
  "tools/wyz-schedule-collector/terminalPrompt.js": "c1889d41ee36ca334ccc188d41f046a057727e13f27a89ac0620406a1010e594",
  "tools/wyz-schedule-collector/schoolAuthState.js": "a5511c8bd37d1ca8cf629e460f1c4aca9987433e3aabe991b85389659f8ae0f1",
  "tools/wyz-schedule-collector/browserRuntime.js": "82bdc7a5ec6a5c3de5444836e5efc20542bee8afc11f873828813d695117333d",
  "tools/wyz-schedule-collector/runStore.js": "bb18b828bc59f168eb2eb5ace6f1879822f0243f3eaccea9cef060f41fc358b8",
  "tools/fosu-sync-client/schoolCasPage.js": "d9b7ae9e22c1cb2e4b56ac181cf711831e8ef5c1da4cc7e01559b4dccc4ce83d",
  "tools/fosu-sync-client/schoolLoginProfile.js": "18ba9dcb079f2f9ac7542c33a037d14e6d443545b74d8b9d9cfdb2e29be7e4a3"
};
const fail=code=>Object.assign(new Error(code),{code});
function requestShape(request,resourceType,account){
  let url;try{url=new URL(request.url);}catch{}
  const keys=url?[...url.searchParams.keys()]:[],usernameCount=keys.filter(k=>k==='username').length;
  const extra=keys.filter(k=>k!=='username'),value=url?.searchParams.get('username');
  const entries=request.postDataEntries;
  const entryShape=entries===undefined?'ABSENT':!Array.isArray(entries)?'INVALID':entries.length?'NONEMPTY':'EMPTY';
  const hasBody=request.postData!==undefined&&request.postData!==''||request.hasPostData===true||!['ABSENT','EMPTY'].includes(entryShape);
  return {
    methodCategory:['GET','HEAD','POST'].includes(request.method)?request.method:'OTHER',methodMatches:request.method==='GET',
    resourceType:TYPES.has(resourceType)?resourceType:'Other',resourceTypeMatches:resourceType==='XHR',
    urlParseable:Boolean(url),originMatches:Boolean(url&&url.origin===ORIGIN&&!url.username&&!url.password),pathMatches:url?.pathname===ENDPOINT,
    exactWirePathMatches:typeof request.url==='string'&&request.url.split('?')[0]===ORIGIN+ENDPOINT,hasFragment:Boolean(url?.hash),
    queryKeyCount:Math.min(keys.length,16),queryKeyCountOverflow:keys.length>16,usernameKeyCount:Math.min(usernameCount,16),
    hasExpectedUsernameKey:usernameCount>0,boundAccountPresent:typeof account==='string'&&Boolean(account),
    accountMatches:typeof account==='string'&&Boolean(account)&&value===account,accountEmpty:value==='',
    hasExtraKeys:extra.length>0,extraKeyCategory:extra.length===0?'NONE':extra.length===1&&extra[0]==='_'?'JQUERY_CACHE_BUSTER':'OTHER',
    cacheBusterDecimal13:extra.length===1&&extra[0]==='_'&&/^\d{13}$/.test(url.searchParams.get('_')||''),
    hasBody,hasOpaqueBody:request.hasPostData===true,postDataProvided:request.postData!==undefined,postDataEntriesShape:entryShape,
    hasAuthorization:Object.keys(request.headers||{}).some(k=>/^(?:proxy-)?authorization$/i.test(k))
  };
}
function mismatches(s){
  const out=[];
  for(const key of ['methodMatches','resourceTypeMatches','originMatches','pathMatches','exactWirePathMatches','boundAccountPresent','accountMatches'])if(!s[key])out.push(key);
  for(const key of ['hasFragment','hasExtraKeys','hasBody','hasAuthorization'])if(s[key])out.push(key);
  if(s.queryKeyCount!==1||s.queryKeyCountOverflow)out.push('queryKeyCount');
  if(s.usernameKeyCount!==1)out.push('usernameKeyCount');
  return out;
}
function metadata(file){
  try{const s=fs.lstatSync(file,{bigint:true});return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.uid].map(String).join(':');}
  catch(e){if(e.code==='ENOENT')return 'MISSING';throw fail('PRECHECK_SHAPE_LOCAL_STATE_REJECTED');}
}
function modules(root){
  const local=name=>require(path.join(root,'tools/wyz-schedule-collector',name));
  return {createAdapter:local('schoolBrowserAdapter').createAdapter,policy:local('schoolRequestPolicy'),cas:require(path.join(root,'tools/fosu-sync-client/schoolCasPage')),auth:local('schoolSession')};
}
async function probe(cfg,deps){
  const m=deps.modules||modules(deps.root),real=deps.chromium;
  let page,form,account='',phase='PUBLIC_CAS',observed,observations=0,authPostsBlocked=0,terminalCode,adapter;
  let resolveObserved;const pending=new Promise(yes=>{resolveObserved=yes;});
  const stop=code=>{terminalCode=terminalCode||code;resolveObserved();};
  const wrapped={launch:async options=>{
    const browser=await real.launch(options);
    return new Proxy(browser,{get(target,key){
      if(key==='newContext')return async opts=>{
        if(opts.ignoreHTTPSErrors!==false||opts.storageState!==undefined)throw fail('PRECHECK_SHAPE_CONTEXT_REJECTED');
        const context=await target.newContext(opts);
        return new Proxy(context,{get(ctx,name){
          if(name==='newPage')return async()=>{page=await ctx.newPage();return page;};
          if(name==='request'||name==='storageState')return ()=>{throw fail('PRECHECK_SHAPE_FALLBACK_DISABLED');};
          if(name==='newCDPSession')return async p=>{
            const guard=await ctx.newCDPSession(p);
            return new Proxy(guard,{get(cdp,method){
              if(method==='on')return (eventName,handler)=>cdp.on(eventName,event=>{
                if(eventName!=='Fetch.requestPaused')return handler(event);
                let url;try{url=new URL(event.request.url);}catch{}
                const response=event.responseStatusCode!==undefined||event.responseErrorReason!==undefined;
                const precheck=url?.origin===ORIGIN&&url.pathname===ENDPOINT;
                const authentication=url?.origin===ORIGIN&&url.pathname==='/authserver/login'&&event.request.method==='POST';
                if(!response&&(precheck&&Boolean(account)||authentication)){
                  if(authentication){authPostsBlocked++;stop('PRECHECK_SHAPE_AUTH_POST_BLOCKED');}
                  else{
                    observations++;
                    if(!observed){
                      const shape=requestShape(event.request,event.resourceType,account);
                      const decision=m.policy.decision(event.request,event.resourceType,{precheck:{active:Boolean(account),account,browserRequests:0}});
                      observed={phase,shape,mismatches:mismatches(shape),originalPolicyWouldAllow:decision.allowed,originalPolicyReason:decision.reason};
                    }
                  }
                  // No request shape, including a valid one, is released. No
                  // fallback GET, official response, cache or auth budget exists.
                  cdp.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'})
                    .then(()=>resolveObserved()).catch(()=>stop('PRECHECK_SHAPE_INTERCEPTION_FAILED'));
                  return;
                }
                return handler(event);
              });
              const value=Reflect.get(cdp,method);return typeof value==='function'?value.bind(cdp):value;
            }});
          };
          const value=Reflect.get(ctx,name);return typeof value==='function'?value.bind(ctx):value;
        }});
      };
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});
  }};
  try{
    adapter=await m.createAdapter(cfg,{chromium:wrapped,signal:deps.signal});
    const publicResult=await adapter.diagnose();
    if(terminalCode)throw fail(terminalCode);
    if(!publicResult.loginReady||!publicResult.requiredInitializationComplete||!['COMPATIBLE','COMPATIBLE_WITH_NONCRITICAL_BLOCKS'].includes(publicResult.networkCompatibility))throw fail('SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED');
    if(deps.onPublicReady)deps.onPublicReady();
    form=await m.cas.prepare(page);
    const slot='fosuShapeEvents'+crypto.randomBytes(12).toString('hex');
    await form.account.evaluate((element,key)=>{
      Object.defineProperty(element,key,{value:[],configurable:true});
      for(const type of ['focus','input','change','blur'])element.addEventListener(type,()=>{if(element[key].length<16)element[key].push(type);},{capture:true});
    },slot);
    account=await deps.readAccount();
    if(typeof account!=='string'||!account||account.length>256)throw fail('SCHOOL_AUTH_INPUT_REJECTED');
    // Match 915's binding-before-fill, fill, blur order. If the first request
    // already occurred during fill, stop triggering further events.
    phase='ACCOUNT_FILL';await form.account.fill(account);
    if(!observed&&!terminalCode){phase='ACCOUNT_BLUR';await form.account.blur();}
    phase='WAITING_FOR_PAGE_XHR';
    let timer;try{await Promise.race([pending,new Promise(yes=>{timer=setTimeout(yes,deps.waitMs||5000);})]);}finally{clearTimeout(timer);}
    if(terminalCode)throw fail(terminalCode);
    await adapter.prepare(); // Surface original guard's unknown/TLS failures.
    const stats=adapter.stats();if(stats.networkReviewRequired)throw fail('SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED');
    const state=await m.cas.scan(page);if(state.activeChallenge||m.cas.explicitChallenge(state.visibleText))throw fail('SCHOOL_SECURITY_CHALLENGE');
    const events=(await form.account.evaluate((element,key)=>element[key],slot)).filter(e=>EVENTS.has(e));
    if(!observed)throw fail('PRECHECK_SHAPE_NOT_OBSERVED');
    if(stats.passwordSubmissions!==0||stats.submissionReservations!==0||stats.precheckRequests!==0)throw fail('PRECHECK_SHAPE_BOUNDARY_VIOLATION');
    return {schema:'collector-precheck-shape.v1',observationStatus:'REQUEST_SHAPE_OBSERVED',status:'BLOCKED',
      code:observations>1?'PRECHECK_SHAPE_DUPLICATE_BLOCKED':observed.originalPolicyWouldAllow?'DIAGNOSTIC_ONLY_NO_LOGIN':'ACCOUNT_PRECHECK_PARAMETERS_REJECTED',
      installedRevision:REVISION,networkCompatibility:publicResult.networkCompatibility,...observed,eventOrder:events,
      additionalPrechecksBlocked:Math.max(0,observations-1),precheckRequestReleased:false,precheckNetworkRequests:0,
      fallbackGetInvoked:false,mainAuthenticationInvoked:false,authenticationPostsBlocked:authPostsBlocked,
      passwordRead:false,passwordSubmissions:0,submissionReservations:0,sessionSaved:false,schoolPageResourceRequests:stats.schoolRequests};
  }finally{account='';if(adapter)await adapter.close();}
}
function verifyInstalled(){
  if(fs.realpathSync('/opt/fosuclass/schedule-collector/current')!==ROOT)throw fail('PRECHECK_SHAPE_REVISION_MISMATCH');
  const receiptFile=path.join(ROOT,'.install-complete.json');if(fs.lstatSync(receiptFile).isSymbolicLink())throw fail('PRECHECK_SHAPE_SOURCE_MISMATCH');
  const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
  if(receipt.revision!==REVISION||receipt.bundleSha256!=='2b28122efd8dc93641c429fc311b9cefbfc1509a9f1eae5f5b8a045f2a730199'||receipt.runtimeVerified!==true)throw fail('PRECHECK_SHAPE_SOURCE_MISMATCH');
  for(const [name,expected] of Object.entries(SOURCE_HASHES)){
    const file=path.join(ROOT,name);if(fs.lstatSync(file).isSymbolicLink()||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected)throw fail('PRECHECK_SHAPE_SOURCE_MISMATCH');
  }
}
async function main(args=process.argv.slice(2)){
  if(args.length!==1||args[0]!=='--approve-precheck-shape')throw fail('PRECHECK_SHAPE_APPROVAL_REQUIRED');
  if(process.platform==='win32'||process.getuid()!==0)throw fail('PRECHECK_SHAPE_ROOT_REQUIRED');
  verifyInstalled();const m=modules(ROOT);m.auth.assertSafeRuntime();m.auth.secureDirectory(DATA);
  if(!process.stdin.isTTY||!process.stderr.isTTY)throw fail('SCHOOL_AUTH_INTERACTIVE_TTY_REQUIRED');
  const files=['school-auth-state.json','session.json','school-credentials.json'].map(n=>path.join(DATA,n));
  const before=files.map(metadata),control=new AbortController(),abort=()=>control.abort();
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  const unlock=require(path.join(ROOT,'tools/wyz-schedule-collector/runStore')).acquireLock(DATA,'school-session.lock'),timer=setTimeout(abort,60000);
  let result,failure;
  try{
    process.stdout.write('INSTALLATION_PASS stage=FIXED_915_READ_ONLY reinstall=NO\n');
    result=await probe({dataRoot:DATA,loginProfile:'mobile'},{root:ROOT,modules:m,signal:control.signal,
      chromium:require(path.join(ROOT,'tools/fosu-sync-client/node_modules/playwright')).chromium,
      onPublicReady:()=>process.stdout.write('CAS_PUBLIC_PASS stage=DIAGNOSTIC_PUBLIC_PAGE\n'),
      readAccount:async()=>(await require(path.join(ROOT,'tools/wyz-schedule-collector/terminalPrompt')).readHidden('学校账号（隐藏输入；本工具不读取密码）: ',{signal:control.signal,maxLength:256})).trim()});
  }catch(error){failure=error;}
  finally{unlock();clearTimeout(timer);process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);releaseInput();}
  const after=files.map(metadata);if(before.some((value,i)=>value!==after[i]))throw fail('PRECHECK_SHAPE_LOCAL_STATE_CHANGED');
  if(failure)throw failure;
  console.log(JSON.stringify({...result,authHistoryUnchanged:true,sessionUnchanged:true,credentialFileUnchanged:true}));
  process.exitCode=2; // Evidence collected; login/fix remain blocked for review.
}
function releaseInput(input=process.stdin){if(input.isTTY)input.pause();}
if(require.main===module)main().catch(error=>{
  releaseInput();
  const code=/^(?:(?:SCHOOL_|PRECHECK_SHAPE_)[A-Z_]{1,80}|COLLECTOR_STOPPED|COLLECTOR_LOCKED)$/.test(error.code||'')?error.code:'PRECHECK_SHAPE_FAILED';
  console.log(JSON.stringify({schema:'collector-precheck-shape.v1',status:code==='PRECHECK_SHAPE_FAILED'?'FAILED':'BLOCKED',code,passwordRead:false,mainAuthenticationInvoked:false}));
  process.exitCode=code==='PRECHECK_SHAPE_FAILED'?1:2;
});
module.exports={REVISION,requestShape,mismatches,probe,metadata,main,releaseInput};
