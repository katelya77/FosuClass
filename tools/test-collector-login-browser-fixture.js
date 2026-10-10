"use strict";
const assert=require("assert/strict"),fs=require("fs"),os=require("os"),path=require("path");
const {chromium}=require("./fosu-sync-client/node_modules/playwright"),auth=require("./wyz-schedule-collector/schoolSession");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"fosu-cas-browser-fixture-")),cfg={dataRoot:root,sessionPath:path.join(root,"session.json"),loginProfile:"mobile"};
const FORM="<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body>统一身份认证 密码登录<form method='post' action='https://authserver.fosu.edu.cn/authserver/login'><input id='username' name='username'><input id='password' name='password' type='password'><button id='login_submit'>登录</button></form></body></html>";
async function scenario(challenge,rejectedTarget,scenarioOptions={}){
  cfg.loginProfile=scenarioOptions.profile||"mobile";
  let browser;
  const launch={headless:true,proxy:{server:"http://127.0.0.1:9"}};
  try{browser=await chromium.launch({...launch,channel:"msedge"});}catch{browser=await chromium.launch(launch);}
  let submits=0,captcha=0,contexts=[],pages=[],blockedBeforeSend=0,diagnostics=[],reserved=0,released=0;
  const wrapped={close:()=>browser.close(),isConnected:()=>browser.isConnected(),newContext:async options=>{
    contexts.push(options);const ctx=await browser.newContext(options);
    return {
      newPage:async()=>{const page=await ctx.newPage();pages.push(page);return page;},
      // Native Chromium Fetch is exercised. Its continue command is replaced
      // by synthetic responses; any missed interception hits a closed local proxy.
      route:async()=>{},storageState:()=>ctx.storageState(),
      newCDPSession:async page=>{
        const cdp=await ctx.newCDPSession(page),paused=new Map();
        let policyListener;
        cdp.on("Fetch.requestPaused",event=>{paused.set(event.requestId,event);if(!auth.allowedUrl(event.request.url))blockedBeforeSend++;});
        return {on:(name,fn)=>{policyListener=fn;return cdp.on(name,fn);},send:async(method,params)=>{
          if(method==="Fetch.failRequest"){blockedBeforeSend++;return cdp.send(method,params);}
          if(method!=="Fetch.continueRequest")return cdp.send(method,params);
          const event=paused.get(params.requestId),u=new URL(event.request.url);
          if(event.fixtureResponse) return cdp.send("Fetch.fulfillRequest",event.fixtureResponse);
          if(event.responseStatusCode!==undefined || event.responseErrorReason!==undefined)return cdp.send(method,params);
          let status=200,body="",headers=[{name:"Content-Type",value:"text/html; charset=utf-8"}];
          if(u.origin==="https://authserver.fosu.edu.cn"&&u.pathname==="/authserver/login"){
            if(event.request.method==="POST"){submits++;status=scenarioOptions.ajax||scenarioOptions.credentialRejected?200:rejectedTarget?307:302;if(status!==200)headers.push({name:"Location",value:rejectedTarget||"https://100.fosu.edu.cn/framework/xsMain.jsp"});if(!scenarioOptions.credentialRejected)headers.push({name:"Set-Cookie",value:"fixture_session=synthetic; Domain=.fosu.edu.cn; Path=/; Secure; HttpOnly"});body=scenarioOptions.credentialRejected?'<html><body>统一身份认证 用户名或密码错误</body></html>':'{}';}
            else {assert.equal(u.searchParams.get('service'),require('./fosu-sync-client/schoolLoginProfile').CAS_SERVICE_URL);body=scenarioOptions.form||FORM;}
          }else if(u.origin==="https://100.fosu.edu.cn"&&u.pathname==="/framework/xsMain.jsp"){
            status=scenarioOptions.protectedStatus||200;
            const cookies=await ctx.cookies(u.href);
            body=cookies.some(c=>c.name==="fixture_session"&&c.value==="synthetic")?"<html><body>教学一体化服务平台 我的桌面</body></html>":FORM;
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
  const adapter=await auth.createAdapter(cfg,{onDiagnostic:value=>diagnostics.push(value),chromium:{launch:async options=>{assert.equal(options.headless,true);assert.ok(!options.args.some(a=>/certificate/.test(a)));return wrapped;}}});
  try{
    const expected=scenarioOptions.error||(rejectedTarget?'SCHOOL_TLS_OR_ORIGIN_REJECTED':challenge?'SCHOOL_SECURITY_CHALLENGE':null);
    const hooks={beforeAuthSubmit:()=>reserved++,onAuthSubmitReleased:()=>released++};
    const work=()=>scenarioOptions.diagnose?adapter.diagnose():adapter.login({account:"fixture-user",password:"fixture-only-secret"},hooks);
    if(expected)await assert.rejects(work(),error=>{assert.equal(error.code,expected);assert.ok(error.diagnostic.stage);return true;});
    else if(scenarioOptions.diagnose){const result=await work();assert.equal(result.credentialsRead,false);assert.equal(result.sessionSaved,false);}
    else {
      const state=await work();
      auth.validateSession(state);fs.writeFileSync(cfg.sessionPath,JSON.stringify(state),{mode:0o600});
      assert.equal(await adapter.check(cfg.sessionPath),"SESSION_VALID");assert.equal(contexts[1].storageState,cfg.sessionPath);
    }
    const expectedSubmits=scenarioOptions.posts===undefined?(scenarioOptions.diagnose||challenge||scenarioOptions.error?0:1):scenarioOptions.posts;
    assert.equal(submits,expectedSubmits);assert.equal(reserved,expectedSubmits);assert.equal(released,expectedSubmits);
    assert.equal(captcha,scenarioOptions.captcha===undefined?(scenarioOptions.diagnose?0:1):scenarioOptions.captcha);
    const output=JSON.stringify(diagnostics);
    for(const secret of ['fixture-user','fixture-only-secret','synthetic-session','fixture-csrf','?service=','?username='])assert.ok(!output.includes(secret),'diagnostics leaked fixture secret');
    if(rejectedTarget){assert.equal(blockedBeforeSend,1,"307 redirect denied before sending");return;}
    if(!scenarioOptions.blocked)assert.equal(blockedBeforeSend,0);
    for(const context of contexts){assert.equal(context.ignoreHTTPSErrors,false);assert.equal(context.isMobile,true);assert.equal(context.hasTouch,true);assert.equal(context.deviceScaleFactor,3);}
    const device=await pages[0].evaluate(()=>({userAgent:navigator.userAgent,scale:devicePixelRatio,touch:navigator.maxTouchPoints,screenWidth:screen.width}));
    assert.match(device.userAgent,scenarioOptions.profile==="mobile-safari"?/iPhone.*Safari/:/iPhone.*MicroMessenger/);assert.equal(device.scale,3);assert.ok(device.touch>0);assert.equal(device.screenWidth,390);
  }finally{await adapter.close();}
}
if(require.main===module)(async()=>{try{await scenario(false);await scenario(true);await scenario(false,"https://evil.invalid/fixture");await scenario(false,"http://100.fosu.edu.cn/fixture");console.log("collector-login-browser-fixture: 4 scenarios PASS; real Chromium, mobile context, one CAS POST, restored Session, challenge zero POST, 307 foreign origin/HTTP blocked before sending; closed local proxy + local CDP fixtures; schoolRequests=0");}finally{cleanup();}})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
function cleanup(){fs.rmSync(root,{recursive:true,force:true});}
module.exports={scenario,FORM,cleanup};
