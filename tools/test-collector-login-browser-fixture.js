"use strict";
const assert=require("assert/strict"),fs=require("fs"),os=require("os"),path=require("path");
const {chromium}=require("./fosu-sync-client/node_modules/playwright"),auth=require("./wyz-schedule-collector/schoolSession");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"fosu-cas-browser-fixture-")),cfg={dataRoot:root,sessionPath:path.join(root,"session.json"),loginProfile:"mobile"};
const FORM="<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body>统一身份认证 密码登录<form method='post' action='https://authserver.fosu.edu.cn/authserver/login'><input id='username' name='username'><input id='password' name='password' type='password'><button id='login_submit'>登录</button></form></body></html>";
async function scenario(challenge,rejectedTarget,scenarioOptions={}){
  const selectedAuth=scenarioOptions.authModuleRoot?require(path.join(scenarioOptions.authModuleRoot,'schoolSession')):auth;
  cfg.loginProfile=scenarioOptions.profile||"mobile";
  if(scenarioOptions.interactive)for(const name of ['session.json','school-auth-state.json'])fs.rmSync(path.join(root,name),{force:true});
  let browser;
  const launch={headless:true,proxy:{server:"http://127.0.0.1:9",...(scenarioOptions.nativeInitializationResponse?{bypass:'127.0.0.1,localhost'}:{})}};
  try{browser=await chromium.launch({...launch,channel:"msedge"});}catch{browser=await chromium.launch(launch);}
  let localInitialization;
  if(scenarioOptions.nativeInitializationResponse){
    localInitialization=require('http').createServer((req,res)=>{res.writeHead(scenarioOptions.initializationStatus||200,{'Content-Type':scenarioOptions.initializationContentType||'application/json','Access-Control-Allow-Origin':'*'});res.end(scenarioOptions.initializationBody||JSON.stringify({success:true,languages:[{code:'fixture',name:'fixture'}]}));});
    await new Promise(resolve=>localInitialization.listen(0,'127.0.0.1',resolve));
  }
  let submits=0,captcha=0,contexts=[],pages=[],blockedBeforeSend=0,diagnostics=[],reserved=0,released=0,backgroundReleased=0;
  const wrapped={close:()=>browser.close(),isConnected:()=>browser.isConnected(),newContext:async options=>{
    contexts.push(options);const ctx=await browser.newContext(options);
    return {
      newPage:async()=>{const page=await ctx.newPage();pages.push(page);if(localInitialization){
        const goto=page.goto.bind(page),url=page.url.bind(page);
        page.goto=(target,options)=>{const value=new URL(target);return goto('http://127.0.0.1:'+localInitialization.address().port+value.pathname+value.search,options);};
        page.url=()=>{const value=new URL(url());return 'https://authserver.fosu.edu.cn'+value.pathname+value.search;};
      }return page;},
      // Native Chromium Fetch is exercised. Its continue command is replaced
      // by synthetic responses; any missed interception hits a closed local proxy.
      route:async()=>{},storageState:()=>ctx.storageState(),
      newCDPSession:async page=>{
        const cdp=await ctx.newCDPSession(page),paused=new Map();
        // The real response-body cases keep the browser entirely on localhost.
        // Only the guard's event view is mapped to the synthetic school origin;
        // the HTTP response and Fetch.getResponseBody remain native CDP.
        const mapped=event=>{if(!localInitialization)return event;const value=new URL(event.request.url);return value.hostname==='127.0.0.1'?{...event,request:{...event.request,url:'https://authserver.fosu.edu.cn'+value.pathname+value.search}}:event;};
        let policyListener;
        cdp.on("Fetch.requestPaused",raw=>{const event=mapped(raw);paused.set(event.requestId,event);if(!selectedAuth.allowedUrl(event.request.url))blockedBeforeSend++;});
        return {on:(name,fn)=>{if(name==='Fetch.requestPaused'){policyListener=fn;return cdp.on(name,raw=>fn(mapped(raw)));}return cdp.on(name,fn);},send:async(method,params)=>{
          if(method==="Fetch.failRequest"){blockedBeforeSend++;return cdp.send(method,params);}
          if(method==='Fetch.getResponseBody'&&paused.get(params.requestId)?.fixtureResponse){return {body:paused.get(params.requestId).fixtureResponse.body,base64Encoded:true};}
          if(method!=="Fetch.continueRequest")return cdp.send(method,params);
          const event=paused.get(params.requestId),u=new URL(event.request.url);
          if(event.fixtureResponse) return cdp.send("Fetch.fulfillRequest",event.fixtureResponse);
          if(event.responseStatusCode!==undefined || event.responseErrorReason!==undefined)return cdp.send(method,params);
          let status=200,body="",headers=[{name:"Content-Type",value:"text/html; charset=utf-8"}];
          if(u.origin==="https://authserver.fosu.edu.cn"&&u.pathname==="/authserver/login"){
            if(event.request.method==="POST"){submits++;status=scenarioOptions.ajax||scenarioOptions.credentialRejected?200:rejectedTarget?307:302;if(status!==200)headers.push({name:"Location",value:rejectedTarget||"https://100.fosu.edu.cn/framework/xsMain.jsp"});if(!scenarioOptions.credentialRejected)headers.push({name:"Set-Cookie",value:"fixture_session=synthetic; Domain=.fosu.edu.cn; Path=/; Secure; HttpOnly"});body=scenarioOptions.credentialRejected?'<html><body>统一身份认证 用户名或密码错误</body></html>':'{}';}
            else {assert.equal(u.searchParams.get('service'),require('./fosu-sync-client/schoolLoginProfile').CAS_SERVICE_URL);body=scenarioOptions.form||FORM;}
          }else if(u.origin==="https://100.fosu.edu.cn"&&u.pathname==="/framework/xsMain.jsp"){
            status=scenarioOptions.candidateRejected&&options.storageState?.endsWith('.candidate')?500:scenarioOptions.protectedStatus||200;
            const cookies=await ctx.cookies(u.href);
            body=cookies.some(c=>c.name==="fixture_session"&&c.value==="synthetic")?"<html><body>教学一体化服务平台 我的桌面</body></html>":FORM;
            if(scenarioOptions.preLoginExpiredCheck&&!cookies.length){status=302;headers.push({name:'Location',value:require('./fosu-sync-client/schoolLoginProfile').AUTH_LOGIN_URL});body='';}
          }else if(u.origin==='https://authserver.fosu.edu.cn'&&u.pathname==='/authserver/fixture-public-config'&&event.request.method==='POST'){
            backgroundReleased++;
            if(scenarioOptions.pendingInitialization)return;
            if(localInitialization)return cdp.send(method,params);
            body=scenarioOptions.initializationBody||JSON.stringify({success:true,languages:[{code:'fixture',name:'fixture'}]});status=scenarioOptions.initializationStatus||200;headers=[{name:'Content-Type',value:scenarioOptions.initializationContentType||'application/json'}];
            if(scenarioOptions.initializationRedirect)headers.push({name:'Location',value:scenarioOptions.initializationRedirect});
          }else status=404;
          const fixtureResponse={requestId:params.requestId,responseCode:status,responseHeaders:headers,body:Buffer.from(body).toString("base64")};
          // FulfillRequest at Request stage skips Chromium's response pause;
          // inject that documented event shape to exercise the response policy.
          if(status>=300&&status<400||event.request.method==='POST'){
            const responseEvent={...event,responseStatusCode:status,responseHeaders:headers,fixtureResponse};
            paused.set(params.requestId,responseEvent);policyListener(responseEvent);return;
          }
          return cdp.send("Fetch.fulfillRequest",fixtureResponse);
        }};
      },
      request:{get:async(target,options)=>{captcha++;assert.ok(target.startsWith("https://authserver.fosu.edu.cn/authserver/checkNeedCaptcha.htl?"));assert.equal(options.maxRedirects,0);return {ok:()=>scenarioOptions.precheckOk!==false,url:()=>target,text:async()=>scenarioOptions.precheck===undefined?JSON.stringify({isNeed:challenge}):scenarioOptions.precheck};}},
    };
  }};
  const control=new AbortController();
  if(scenarioOptions.authState)fs.writeFileSync(path.join(root,'school-auth-state.json'),JSON.stringify(scenarioOptions.authState),{mode:0o600});
  const snapshots=new Map(['session.json','school-auth-state.json'].filter(name=>fs.existsSync(path.join(root,name))).map(name=>[name,fs.readFileSync(path.join(root,name))]));
  const adapterDeps={signal:control.signal,onDiagnostic:value=>{diagnostics.push(value);if(value.stage==='form-ready'){if(scenarioOptions.cancel)control.abort();if(scenarioOptions.browserExit)browser.close().catch(()=>{});}},reviewedPublicPosts:scenarioOptions.reviewedPublicPosts,chromium:{launch:async options=>{assert.equal(options.headless,true);assert.ok(!options.args.some(a=>/certificate/.test(a)));return wrapped;}}};
  let adapter;if(!scenarioOptions.audit)adapter=await selectedAuth.createAdapter(cfg,adapterDeps);
  try{
    const expected=scenarioOptions.error||(rejectedTarget?'SCHOOL_TLS_OR_ORIGIN_REJECTED':challenge?'SCHOOL_SECURITY_CHALLENGE':null);
    const hooks={beforeAuthSubmit:()=>reserved++,onAuthSubmitReleased:()=>released++};
    let credentialsRead=0;
    const work=async()=>{if(scenarioOptions.preLoginExpiredCheck){fs.writeFileSync(cfg.sessionPath,JSON.stringify({cookies:[],origins:[]}),{mode:0o600});assert.equal(await adapter.check(cfg.sessionPath),'SESSION_EXPIRED');}return scenarioOptions.interactive?selectedAuth.interactiveSession(cfg,{approved:true,signal:control.signal,confirmReuse:()=>false,
      readCredentials:()=>{credentialsRead++;return {account:'fixture-user',password:'fixture-only-secret'};},createAdapter:()=>({
        prepare:()=>adapter.prepare(),stats:()=>adapter.stats(),close:()=>adapter.close(),check:p=>adapter.check(p),login:(c,h)=>adapter.login(c,{
          ...h,beforeAuthSubmit:async()=>{await h.beforeAuthSubmit();reserved++;},onAuthSubmitReleased:async()=>{await h.onAuthSubmitReleased();released++;}})})}):scenarioOptions.invokeCLI?require('./wyz-schedule-collector/cli').main(['diagnose-login','--approve-school-access'],{
      skipRootCheck:true,cfg,signal:control.signal,output:value=>diagnostics.push(value),connection:()=>assert.fail('diagnose must not contact Oracle'),ask:()=>assert.fail('diagnose must not prompt credentials'),
      authDeps:{createAdapter:()=>adapter}}):scenarioOptions.audit?require('./wyz-schedule-collector/casPublicAudit').audit(cfg,{moduleRoot:scenarioOptions.authModuleRoot,chromium:adapterDeps.chromium,createAdapter:async(value,observedDeps)=>{adapter=await selectedAuth.createAdapter(value,{...adapterDeps,...observedDeps});return adapter;}}):scenarioOptions.diagnose?adapter.diagnose():adapter.login({account:"fixture-user",password:"fixture-only-secret"},hooks);};
    if(expected)await assert.rejects(work(),error=>{assert.equal(error.code,expected);assert.ok(error.diagnostic.stage);return true;});
    else if(scenarioOptions.diagnose){const result=await work();assert.equal(result.credentialsRead,false);assert.equal(result.sessionSaved,false);if(scenarioOptions.audit){assert.equal(result.purposeConfirmed,false);assert.equal(result.endpointAudit.length,3);assert.ok(result.sourceEvidence.length);assert.equal(result.extraScriptGetRequests,0);diagnostics.push(result);}if(scenarioOptions.networkStatus){assert.equal(result.networkCompatibility,scenarioOptions.networkStatus,scenarioOptions.nativeInitializationResponse?JSON.stringify(diagnostics):undefined);assert.equal(result.formReady,true);if(!scenarioOptions.audit)assert.equal(result.loginReady,scenarioOptions.networkStatus!=='REVIEW_REQUIRED');assert.equal(result.requiredInitializationComplete,scenarioOptions.networkStatus!=='REVIEW_REQUIRED');}}
    else if(scenarioOptions.interactive){
      const result=await work();assert.equal(result.status,'SESSION_SAVED');assert.equal(result.passwordPersisted,false);assert.equal(result.schoolLoginAttempts,1);
      selectedAuth.validateSession(JSON.parse(fs.readFileSync(cfg.sessionPath)));assert.ok(contexts.some(c=>c.storageState===cfg.sessionPath+'.candidate'));
      if(process.platform!=='win32')assert.equal(fs.statSync(cfg.sessionPath).mode&0o777,0o600);
    }else {
      const state=await work();
      selectedAuth.validateSession(state);fs.writeFileSync(cfg.sessionPath,JSON.stringify(state),{mode:0o600});
      assert.equal(await adapter.check(cfg.sessionPath),"SESSION_VALID");assert.equal(contexts[scenarioOptions.preLoginExpiredCheck?2:1].storageState,cfg.sessionPath);
    }
    const expectedSubmits=scenarioOptions.posts===undefined?(scenarioOptions.diagnose||challenge||scenarioOptions.error?0:1):scenarioOptions.posts;
    assert.equal(submits,expectedSubmits);assert.equal(reserved,expectedSubmits);assert.equal(released,expectedSubmits);
    assert.equal(captcha,scenarioOptions.captcha===undefined?(scenarioOptions.diagnose?0:1):scenarioOptions.captcha);
    assert.equal(backgroundReleased,scenarioOptions.backgroundReleased||0);
    if(scenarioOptions.expectedBlockedPosts!==undefined)assert.equal(adapter.stats().backgroundPostsBlocked,scenarioOptions.expectedBlockedPosts);
    if(scenarioOptions.interactive){assert.equal(credentialsRead,scenarioOptions.captcha===0?0:1);assert.ok(!fs.existsSync(cfg.sessionPath+'.candidate'));assert.ok(!fs.existsSync(path.join(root,'school-session.lock')));if(scenarioOptions.candidateRejected)assert.ok(!fs.existsSync(cfg.sessionPath));assert.equal(JSON.parse(fs.readFileSync(path.join(root,'school-auth-state.json'))).attempts||0,expectedSubmits);}
    const output=JSON.stringify(diagnostics);
    for(const secret of ['fixture-user','fixture-only-secret','fixture_session','synthetic','fixture-csrf','?service=','?username='])assert.ok(!output.includes(secret),'diagnostics leaked fixture secret');
    if(scenarioOptions.postEvidence){const records=diagnostics.filter(d=>d.stage==='request-classification');assert.ok(records.length);for(const [key,value] of Object.entries(scenarioOptions.postEvidence))assert.ok(records.some(d=>d[key]===value),key);assert.ok(!output.includes('/fixture-public-config'));}
    if(scenarioOptions.diagnose){assert.equal(adapter.stats().passwordSubmissions,0);assert.equal(adapter.stats().submissionReservations,0);for(const [name,value] of snapshots)assert.deepEqual(fs.readFileSync(path.join(root,name)),value);assert.ok(!fs.existsSync(path.join(root,'school-session.lock')));}
    if(rejectedTarget){assert.equal(blockedBeforeSend,1,"307 redirect denied before sending");return;}
    if(!scenarioOptions.blocked)assert.equal(blockedBeforeSend,0);
    for(const context of contexts){assert.equal(context.ignoreHTTPSErrors,false);assert.equal(context.isMobile,true);assert.equal(context.hasTouch,true);assert.equal(context.deviceScaleFactor,3);}
    if(scenarioOptions.cancel||scenarioOptions.browserExit||scenarioOptions.invokeCLI||scenarioOptions.interactive||scenarioOptions.audit)return;
    const device=await pages[0].evaluate(()=>({userAgent:navigator.userAgent,scale:devicePixelRatio,touch:navigator.maxTouchPoints,screenWidth:screen.width}));
    assert.match(device.userAgent,scenarioOptions.profile==="mobile-safari"?/iPhone.*Safari/:/iPhone.*MicroMessenger/);assert.equal(device.scale,3);assert.ok(device.touch>0);assert.equal(device.screenWidth,390);
  }finally{if(adapter)await adapter.close();if(localInitialization)await new Promise(resolve=>localInitialization.close(resolve));}
}
if(require.main===module)(async()=>{try{await scenario(false);await scenario(true);await scenario(false,"https://evil.invalid/fixture");await scenario(false,"http://100.fosu.edu.cn/fixture");console.log("collector-login-browser-fixture: 4 scenarios PASS; real Chromium, mobile context, one CAS POST, restored Session, challenge zero POST, 307 foreign origin/HTTP blocked before sending; closed local proxy + local CDP fixtures; schoolRequests=0");}finally{cleanup();}})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
function cleanup(){fs.rmSync(root,{recursive:true,force:true});}
module.exports={scenario,FORM,cleanup};
