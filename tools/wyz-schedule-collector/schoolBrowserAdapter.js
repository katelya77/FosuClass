"use strict";
const fs=require('fs');
const {AUTH_ORIGIN,SCHOOL_ORIGIN,AUTH_LOGIN_URL,contextOptions,resolveProfile}=require('../fosu-sync-client/schoolLoginProfile');
const cas=require('../fosu-sync-client/schoolCasPage');
const requestPolicy=require('./schoolRequestPolicy');
const fail=(code,stage)=>Object.assign(new Error(code),{code,diagnosticStage:stage});
async function createAdapter(cfg,deps={}){
  const auth=require('./schoolSession');auth.assertSafeRuntime();
  const loginProfile=resolveProfile(cfg.loginProfile||'mobile');
  if(require('./browserRuntime').runtime(cfg.dataRoot).mode!=='native')throw fail('SCHOOL_AUTH_NATIVE_BROWSER_REQUIRED','browser-start');
  const chromium=deps.chromium||require('../fosu-sync-client/node_modules/playwright').chromium;
  const browser=await chromium.launch({headless:true,timeout:30000,args:['--no-proxy-server']});
  const stats={schoolRequests:0,passwordSubmissions:0,submissionReservations:0,authResponseReceived:false,blockedResources:0,
    backgroundPostsBlocked:0,noncriticalPostsBlocked:0,authenticationPostsBlocked:0,networkReviewRequired:false,loginProfile,stage:'browser-start'};
  let policyError,prepared,armed=false,credentialsPhase=false,submissionClaimed=false,hooks={};
  const emit=(stage,fields={})=>{stats.stage=stage;if(deps.onDiagnostic)deps.onDiagnostic({stage,...fields});};
  const abort=()=>browser.close().catch(()=>{});
  if(deps.signal){if(deps.signal.aborted){await browser.close();throw fail('COLLECTOR_STOPPED','browser-start');}deps.signal.addEventListener('abort',abort,{once:true});}
  const reject=(code,stage)=>{if(!policyError)policyError=fail(code,stage);};
  async function pageFor(storageState){
    const context=await browser.newContext({...contextOptions(cfg.loginProfile||'mobile'),serviceWorkers:'block',...(storageState?{storageState}:{})});
    const page=await context.newPage(),guard=await context.newCDPSession(page);
    // Every request and redirect hop is paused before release. No new origins
    // are trusted by this fix. Password-bearing requests are never inspected.
    guard.on('Fetch.requestPaused',async event=>{
      const responseStage=event.responseStatusCode!==undefined||event.responseErrorReason!==undefined;
      const classification=requestPolicy.decision(event.request,event.resourceType,{armed,submissionClaimed,credentialsPhase,submissionReserved:stats.submissionReservations>0},deps.reviewedPublicPosts);
      let allowed=responseStage?classification.trusted:classification.allowed;
      const authenticationPost=event.request.method==='POST'&&classification.evidence.authenticationEndpoint;
      if(allowed&&[301,302,303,307,308].includes(event.responseStatusCode)){
        const location=(event.responseHeaders||[]).find(h=>h.name.toLowerCase()==='location');let next;
        try{next=new URL(location&&location.value,event.request.url);}catch(_){}
        allowed=Boolean(location&&next&&auth.allowedUrl(next.href));
        if([307,308].includes(event.responseStatusCode)&&event.request.method==='POST')allowed=false;
      }
      try{
        if(deps.signal?.aborted)throw fail('COLLECTOR_STOPPED',stats.stage);
        if(!responseStage&&!allowed){
          if(classification.fatalCode)reject(!classification.trusted&&['Script','Stylesheet'].includes(event.resourceType)?'SCHOOL_LOGIN_RESOURCE_REJECTED':classification.fatalCode,'request-policy');
          if(classification.reviewRequired)stats.networkReviewRequired=true;
          if(event.request.method==='POST'){
            if(authenticationPost)stats.authenticationPostsBlocked++;
            else{stats.backgroundPostsBlocked++;if(classification.noncritical)stats.noncriticalPostsBlocked++;}
          }
        }
        if(!allowed){
          stats.blockedResources++;
          if(!classification.trusted||responseStage){
            if(['Document','XHR','Fetch'].includes(event.resourceType))reject('SCHOOL_TLS_OR_ORIGIN_REJECTED','origin-policy');
            else if(['Script','Stylesheet'].includes(event.resourceType))reject('SCHOOL_LOGIN_RESOURCE_REJECTED','resource-policy');
          }
        }
        if(!responseStage&&authenticationPost){
          if(allowed){
            if(policyError)throw policyError;
            if(stats.networkReviewRequired)throw fail('SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED','public-network-review');
            submissionClaimed=true; // Synchronous claim closes concurrent JS POST races.
            if(hooks.beforeAuthSubmit)await hooks.beforeAuthSubmit();
            stats.submissionReservations++;emit('authentication-request',{submissionReserved:true});
          }
        }
        if(!responseStage&&(event.request.method==='POST'||classification.evidence.methodCategory==='OTHER'))emit('request-classification',{
          ...classification.evidence,blocked:!allowed,reason:classification.reason,authenticationReleased:false});
        if(responseStage&&authenticationPost&&submissionClaimed&&stats.submissionReservations){
          stats.authResponseReceived=true;
          if(hooks.onAuthResponse)await hooks.onAuthResponse();
          emit('authentication-response',{responseReceived:true,httpStatus:event.responseStatusCode||0});
        }
        if(!allowed){await guard.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'});return;}
        if(deps.signal?.aborted)throw fail('COLLECTOR_STOPPED',stats.stage);
        if(!responseStage)stats.schoolRequests++;
        await guard.send('Fetch.continueRequest',{requestId:event.requestId});
        if(!responseStage&&authenticationPost){
          stats.passwordSubmissions++;armed=false;
          if(hooks.onAuthSubmitReleased)await hooks.onAuthSubmitReleased();
          emit('authentication-released',{passwordSubmissions:stats.passwordSubmissions,authenticationReleased:true});
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
  const protectedCheck=async page=>{
    emit('protected-session-check');
    const response=await page.goto(SCHOOL_ORIGIN+'/framework/xsMain.jsp',{waitUntil:'domcontentloaded',timeout:25000});
    await page.waitForLoadState('load',{timeout:10000});
    emit('protected-page-response',{httpStatus:response?.status()||0});
    if(!response||response.status()!==200)throw fail('SCHOOL_PROTECTED_PAGE_REJECTED','protected-page-response');
    if(new URL(page.url()).origin===SCHOOL_ORIGIN&&new URL(page.url()).pathname!=='/framework/xsMain.jsp')return 'SCHOOL_PAGE_CHANGED';
    return inspect(page);
  };
  const adapter={
    stats:()=>({...stats}),
    async check(sessionPath){
      if(!fs.existsSync(sessionPath))return 'SESSION_EXPIRED';
      auth.secureFile(sessionPath);auth.validateSession(require('./runStore').readJson(sessionPath,null));
      const {page}=await pageFor(sessionPath);
      return protectedCheck(page);
    },
    async prepare({publicDiagnosis=false}={}){
      if(!prepared){
        prepared=await pageFor();emit('cas-navigation');
        await prepared.page.goto(AUTH_LOGIN_URL,{waitUntil:'domcontentloaded',timeout:25000});
        if(new URL(prepared.page.url()).origin!==AUTH_ORIGIN)throw fail('SCHOOL_LOGIN_FORM_CHANGED','cas-navigation');
        prepared.form=await cas.prepare(prepared.page,emit);
        await prepared.page.waitForTimeout(500);
        // Late bootstrap requests/challenges can arrive after DOM readiness.
        // Revalidate the form before any credential prompt, without emitting
        // page text, hidden values or form actions.
        const finalState=await cas.scan(prepared.page);
        if(finalState.activeChallenge||cas.explicitChallenge(finalState.visibleText))throw fail('SCHOOL_SECURITY_CHALLENGE','challenge-before-password');
        if(cas.credentialFailure(finalState.visibleText))throw fail('SCHOOL_LOGIN_PAGE_REJECTED','page-credential-error');
        if(finalState.accountCount!==1)throw fail('SCHOOL_LOGIN_ACCOUNT_FIELD_CHANGED','account-field');
        if(finalState.passwordCount!==1)throw fail('SCHOOL_LOGIN_PASSWORD_FIELD_CHANGED','password-field');
        if(finalState.submitCount!==1)throw fail('SCHOOL_LOGIN_SUBMIT_CHANGED','submit-button');
      }
      if(policyError)throw policyError;
      if(stats.networkReviewRequired&&!publicDiagnosis)throw fail('SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED','public-network-review');
    },
    async diagnose(){
      await adapter.prepare({publicDiagnosis:true});
      const networkCompatibility=stats.networkReviewRequired?'REVIEW_REQUIRED':stats.noncriticalPostsBlocked?'COMPATIBLE_WITH_NONCRITICAL_BLOCKS':'COMPATIBLE';
      emit('public-network-summary',{formReady:true,networkCompatibility,loginReady:!stats.networkReviewRequired,authenticationReleased:stats.passwordSubmissions>0});
      return {status:stats.networkReviewRequired?'CAS_PUBLIC_FORM_READY_NETWORK_REVIEW_REQUIRED':'CAS_PUBLIC_FORM_READY',...stats,
        formReady:true,networkCompatibility,loginReady:!stats.networkReviewRequired,credentialsRead:false,sessionSaved:false,
        authHistoryChanged:false,precheck:'NOT_RUN_REQUIRES_ACCOUNT'};
    },
    async login(credentials,submissionHooks={}){
      await adapter.prepare();hooks=submissionHooks;
      if(stats.networkReviewRequired)throw fail('SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED','public-network-review');
      const {context,page,form}=prepared;
      await form.account.fill(credentials.account);
      emit('precheck-request');stats.schoolRequests++;
      emit('request-classification',{methodCategory:'GET',originCategory:'school-auth',endpointCategory:'account-captcha-precheck',resourceType:'Fetch',authenticationEndpoint:false,browserInitiated:false,blocked:false,reason:'APPROVED_ACCOUNT_PRECHECK',authenticationReleased:false});
      const response=await context.request.get(AUTH_ORIGIN+'/authserver/checkNeedCaptcha.htl?username='+encodeURIComponent(credentials.account),{timeout:10000,maxRedirects:0});
      if(!auth.allowedUrl(response.url())||new URL(response.url()).origin!==AUTH_ORIGIN)throw fail('SCHOOL_TLS_OR_ORIGIN_REJECTED','precheck-origin');
      if(!response.ok())throw fail('SCHOOL_LOGIN_PRECHECK_FAILED','precheck-response');
      const needed=cas.parseCaptcha(await response.text());emit('precheck-response',{challengeRequired:needed});
      if(needed||await inspect(page)==='SCHOOL_SECURITY_CHALLENGE')throw fail('SCHOOL_SECURITY_CHALLENGE','challenge-before-password');
      if(policyError)throw policyError;
      if(stats.networkReviewRequired)throw fail('SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED','public-network-review');
      credentialsPhase=true;
      await form.password.fill(credentials.password);armed=true;emit('submit-button');
      await form.submit.click({timeout:10000});
      let status='SESSION_EXPIRED';
      for(let i=0;i<20;i++){
        if(policyError)throw policyError;
        await page.waitForTimeout(1000);
        status=await inspect(page);
        if(stats.passwordSubmissions&&new URL(page.url()).origin===SCHOOL_ORIGIN)break;
        if(!['SESSION_EXPIRED','SCHOOL_PAGE_CHANGED'].includes(status))break;
      }
      if(policyError)throw policyError;
      if(stats.networkReviewRequired)throw fail('SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED','public-network-review');
      if(!stats.submissionReservations||!stats.passwordSubmissions)throw fail('SCHOOL_LOGIN_NOT_COMPLETED','authentication-request');
      if(new URL(page.url()).origin!==SCHOOL_ORIGIN)throw fail(status==='SESSION_EXPIRED'?'SCHOOL_LOGIN_NOT_COMPLETED':status,'authentication-result');
      if(['INVALID_CREDENTIALS','SCHOOL_SECURITY_CHALLENGE','SCHOOL_TLS_OR_ORIGIN_REJECTED'].includes(status))throw fail(status,'authentication-result');
      const protectedStatus=await protectedCheck(page);
      if(protectedStatus!=='SESSION_VALID')throw fail(protectedStatus==='SESSION_EXPIRED'?'SCHOOL_SESSION_EXPIRED':protectedStatus,'protected-session-check');
      emit('protected-session-valid',{protectedSessionValid:true});return context.storageState();
    },
    async close(){if(deps.signal)deps.signal.removeEventListener('abort',abort);await browser.close();}
  };
  for(const key of ['check','prepare','diagnose','login']){
    const work=adapter[key];adapter[key]=async(...args)=>{
      try{const result=await work(...args);if(policyError)throw policyError;if(key==='check'&&stats.networkReviewRequired)throw fail('SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED','protected-network-review');return result;}
      catch(error){const actual=deps.signal?.aborted?fail('COLLECTOR_STOPPED','browser-cancelled'):policyError||(!browser.isConnected()||/has been closed|browser.*closed/i.test(error.message||'')?fail('SCHOOL_AUTH_BROWSER_CLOSED','browser-closed'):error);throw Object.assign(fail(auth.transportCode(actual),actual.diagnosticStage||stats.stage),{diagnostic:{...stats,stage:actual.diagnosticStage||stats.stage}});}
    };
  }
  return adapter;
}
module.exports={createAdapter};
