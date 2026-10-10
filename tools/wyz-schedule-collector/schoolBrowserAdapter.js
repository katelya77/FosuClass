"use strict";
const fs=require('fs');
const {AUTH_ORIGIN,SCHOOL_ORIGIN,AUTH_LOGIN_URL,contextOptions,resolveProfile,CAS_SERVICE_URL}=require('../fosu-sync-client/schoolLoginProfile');
const cas=require('../fosu-sync-client/schoolCasPage');
const fail=(code,stage)=>Object.assign(new Error(code),{code,diagnosticStage:stage});
async function createAdapter(cfg,deps={}){
  const auth=require('./schoolSession');auth.assertSafeRuntime();
  const loginProfile=resolveProfile(cfg.loginProfile||'mobile');
  if(require('./browserRuntime').runtime(cfg.dataRoot).mode!=='native')throw fail('SCHOOL_AUTH_NATIVE_BROWSER_REQUIRED','browser-start');
  const chromium=deps.chromium||require('../fosu-sync-client/node_modules/playwright').chromium;
  const browser=await chromium.launch({headless:true,timeout:30000,args:['--no-proxy-server']});
  const stats={schoolRequests:0,passwordSubmissions:0,submissionReservations:0,authResponseReceived:false,blockedResources:0,loginProfile,stage:'browser-start'};
  let policyError,prepared,armed=false,credentialsPhase=false,submissionClaimed=false,hooks={};
  const emit=(stage,fields={})=>{stats.stage=stage;if(deps.onDiagnostic)deps.onDiagnostic({stage,...fields});};
  const abort=()=>browser.close().catch(()=>{});
  if(deps.signal){if(deps.signal.aborted){await browser.close();throw fail('COLLECTOR_STOPPED','browser-start');}deps.signal.addEventListener('abort',abort,{once:true});}
  const reject=(code,stage)=>{policyError=fail(code,stage);};
  async function pageFor(storageState){
    const context=await browser.newContext({...contextOptions(cfg.loginProfile||'mobile'),serviceWorkers:'block',...(storageState?{storageState}:{})});
    const page=await context.newPage(),guard=await context.newCDPSession(page);
    // Every request and redirect hop is paused before release. No new origins
    // are trusted by this fix. Password-bearing requests are never inspected.
    guard.on('Fetch.requestPaused',async event=>{
      const responseStage=event.responseStatusCode!==undefined||event.responseErrorReason!==undefined;
      let allowed=auth.allowedUrl(event.request.url);
      const u=allowed?new URL(event.request.url):null;
      const authenticationPost=event.request.method==='POST'&&u?.origin===AUTH_ORIGIN&&u.pathname==='/authserver/login';
      if(allowed&&[301,302,303,307,308].includes(event.responseStatusCode)){
        const location=(event.responseHeaders||[]).find(h=>h.name.toLowerCase()==='location');let next;
        try{next=new URL(location&&location.value,event.request.url);}catch(_){}
        allowed=Boolean(location&&next&&auth.allowedUrl(next.href));
        if([307,308].includes(event.responseStatusCode)&&event.request.method==='POST')allowed=false;
      }
      try{
        if(!responseStage&&credentialsPhase&&!stats.submissionReservations&&!authenticationPost){allowed=false;reject('SCHOOL_PASSWORD_RESUBMISSION_BLOCKED','authentication-request');}
        if(!allowed){
          stats.blockedResources++;
          if(['Document','XHR','Fetch'].includes(event.resourceType))reject('SCHOOL_TLS_OR_ORIGIN_REJECTED','origin-policy');
          else if(['Script','Stylesheet'].includes(event.resourceType))reject('SCHOOL_LOGIN_RESOURCE_REJECTED','resource-policy');
        }
        if(!responseStage&&event.request.method==='POST'){
          // A legitimate JS button may submit only the same reviewed CAS path.
          // No POST is allowed during public diagnosis or Session checks.
          if(!authenticationPost||!armed||submissionClaimed){allowed=false;reject('SCHOOL_PASSWORD_RESUBMISSION_BLOCKED','authentication-request');}
          if(allowed&&u.searchParams.has('service')&&u.searchParams.get('service')!==CAS_SERVICE_URL){allowed=false;reject('SCHOOL_TLS_OR_ORIGIN_REJECTED','service-policy');}
          if(allowed){
            if(policyError)throw policyError;
            submissionClaimed=true; // Synchronous claim closes concurrent JS POST races.
            if(hooks.beforeAuthSubmit)await hooks.beforeAuthSubmit();
            stats.submissionReservations++;emit('authentication-request',{submissionReserved:true});
          }
        }
        if(responseStage&&authenticationPost){
          stats.authResponseReceived=true;
          if(hooks.onAuthResponse)await hooks.onAuthResponse();
          emit('authentication-response',{responseReceived:true,httpStatus:event.responseStatusCode||0});
        }
        if(!allowed){await guard.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'});return;}
        if(!responseStage)stats.schoolRequests++;
        await guard.send('Fetch.continueRequest',{requestId:event.requestId});
        if(!responseStage&&authenticationPost){
          stats.passwordSubmissions++;armed=false;
          if(hooks.onAuthSubmitReleased)await hooks.onAuthSubmitReleased();
          emit('authentication-released',{passwordSubmissions:stats.passwordSubmissions});
        }
      }catch(error){reject(auth.transportCode(error),error.diagnosticStage||'request-guard');await guard.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'}).catch(()=>{});abort();}
    });
    await guard.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'},{urlPattern:'*',requestStage:'Response'}]});
    return {context,page};
  }
  const inspect=async page=>{
    const state=await cas.scan(page);
    if(state.activeChallenge)return 'SCHOOL_SECURITY_CHALLENGE';
    const status=auth.classifyPage(page.url(),state.visibleText);
    return status==='SESSION_VALID'&&state.passwordCount>0?'SESSION_EXPIRED':status;
  };
  const adapter={
    stats:()=>({...stats}),
    async check(sessionPath){
      if(!fs.existsSync(sessionPath))return 'SESSION_EXPIRED';
      auth.secureFile(sessionPath);auth.validateSession(require('./runStore').readJson(sessionPath,null));
      const {page}=await pageFor(sessionPath);
      emit('protected-session-check');
      await page.goto(SCHOOL_ORIGIN+'/framework/xsMain.jsp',{waitUntil:'domcontentloaded',timeout:25000});
      return inspect(page);
    },
    async prepare(){
      if(prepared)return;
      prepared=await pageFor();emit('cas-navigation');
      await prepared.page.goto(AUTH_LOGIN_URL,{waitUntil:'domcontentloaded',timeout:25000});
      if(new URL(prepared.page.url()).origin!==AUTH_ORIGIN)throw fail('SCHOOL_LOGIN_FORM_CHANGED','cas-navigation');
      prepared.form=await cas.prepare(prepared.page,emit);
      if(policyError)throw policyError;
    },
    async diagnose(){
      await adapter.prepare();
      return {status:'CAS_PUBLIC_FORM_READY',...stats,credentialsRead:false,sessionSaved:false,precheck:'NOT_RUN_REQUIRES_ACCOUNT'};
    },
    async login(credentials,submissionHooks={}){
      await adapter.prepare();hooks=submissionHooks;
      const {context,page,form}=prepared;
      await form.account.fill(credentials.account);
      emit('precheck-request');stats.schoolRequests++;
      const response=await context.request.get(AUTH_ORIGIN+'/authserver/checkNeedCaptcha.htl?username='+encodeURIComponent(credentials.account),{timeout:10000,maxRedirects:0});
      if(!auth.allowedUrl(response.url())||new URL(response.url()).origin!==AUTH_ORIGIN)throw fail('SCHOOL_TLS_OR_ORIGIN_REJECTED','precheck-origin');
      if(!response.ok())throw fail('SCHOOL_LOGIN_PRECHECK_FAILED','precheck-response');
      const needed=cas.parseCaptcha(await response.text());emit('precheck-response',{challengeRequired:needed});
      if(needed||await inspect(page)==='SCHOOL_SECURITY_CHALLENGE')throw fail('SCHOOL_SECURITY_CHALLENGE','challenge-before-password');
      if(policyError)throw policyError;
      credentialsPhase=true;
      await form.password.fill(credentials.password);armed=true;emit('submit-button');
      await form.submit.click({timeout:10000});
      let status='SESSION_EXPIRED';
      for(let i=0;i<20;i++){
        if(policyError)throw policyError;
        await page.waitForTimeout(1000);
        status=await inspect(page);if(status!=='SESSION_EXPIRED')break;
      }
      if(policyError)throw policyError;
      if(!stats.submissionReservations||!stats.passwordSubmissions)throw fail('SCHOOL_LOGIN_NOT_COMPLETED','authentication-request');
      if(status!=='SESSION_VALID')throw fail(status==='SESSION_EXPIRED'?'SCHOOL_LOGIN_NOT_COMPLETED':status,'authentication-result');
      emit('protected-session-check');
      await page.goto(SCHOOL_ORIGIN+'/framework/xsMain.jsp',{waitUntil:'domcontentloaded',timeout:25000});
      const protectedStatus=await inspect(page);
      if(protectedStatus!=='SESSION_VALID')throw fail(protectedStatus==='SESSION_EXPIRED'?'SCHOOL_SESSION_EXPIRED':protectedStatus,'protected-session-check');
      emit('protected-session-valid',{protectedSessionValid:true});return context.storageState();
    },
    async close(){if(deps.signal)deps.signal.removeEventListener('abort',abort);await browser.close();}
  };
  for(const key of ['check','prepare','diagnose','login']){
    const work=adapter[key];adapter[key]=async(...args)=>{
      try{const result=await work(...args);if(policyError)throw policyError;return result;}
      catch(error){const actual=policyError||error;throw Object.assign(fail(auth.transportCode(actual),actual.diagnosticStage||stats.stage),{diagnostic:{...stats,stage:actual.diagnosticStage||stats.stage}});}
    };
  }
  return adapter;
}
module.exports={createAdapter};
