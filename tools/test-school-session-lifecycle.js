"use strict";
const assert=require("assert"),fs=require("fs"),os=require("os"),path=require("path");
const auth=require("./wyz-schedule-collector/schoolSession");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"fosu-school-auth-fixture-"));
const cfg={dataRoot:root,sessionPath:path.join(root,"session.json"),schoolCredentialsPath:path.join(root,"school-auth.json")};
let attempts=0,checks=0,closed=0;
const writeCredentials=(extra={})=>fs.writeFileSync(cfg.schoolCredentialsPath,JSON.stringify({schema:1,account:"fixture-user",password:"fixture-only-password",recoveryEnabled:false,...extra}),{mode:0o600});
const clear=()=>{for(const name of ["school-auth-state.json","session.json","session.json.candidate"])if(fs.existsSync(path.join(root,name)))fs.unlinkSync(path.join(root,name));};
const adapter={check:async file=>{checks++;return file.endsWith(".candidate")?"SESSION_VALID":"SESSION_EXPIRED";},login:async()=>{attempts++;return {cookies:[{name:"fixture",value:"synthetic-session"}],origins:[]};},close:async()=>{closed++;}};
const deps={approved:true,manualRecovery:true,createAdapter:async()=>adapter,now:()=>1000000};
async function main(){
  assert.equal((await auth.ensureSession(cfg,{createAdapter:()=>assert.fail("no school access")})).status,"manual-session");
  writeCredentials();
  assert.equal((await auth.ensureSession(cfg,{createAdapter:()=>assert.fail("disabled recovery")})).status,"manual-session");
  await assert.rejects(auth.ensureSession(cfg,{...deps,approved:false}),/APPROVAL_REQUIRED/);
  const result=await auth.ensureSession(cfg,deps);assert.equal(result.status,"SESSION_RECOVERED");assert.equal(attempts,1);assert.equal(checks,2);assert.equal(closed,1);
  assert.equal(JSON.parse(fs.readFileSync(cfg.sessionPath)).cookies[0].value,"synthetic-session");assert.ok(!fs.existsSync(cfg.sessionPath+".candidate"));
  await auth.ensureSession(cfg,{...deps,createAdapter:async()=>({...adapter,check:async()=>"SESSION_VALID",login:()=>assert.fail("valid session must not relogin")})});
  clear();fs.writeFileSync(cfg.sessionPath,JSON.stringify({cookies:[{name:"old",value:"old-synthetic-session"}],origins:[]}),{mode:0o600});
  await assert.rejects(auth.ensureSession(cfg,{...deps,createAdapter:async()=>({...adapter,login:async()=>{throw {code:"INVALID_CREDENTIALS",message:"private input"};}})}),/INVALID_CREDENTIALS/);
  assert.equal(JSON.parse(fs.readFileSync(cfg.sessionPath)).cookies[0].value,"old-synthetic-session");
  await assert.rejects(auth.ensureSession(cfg,deps),/MANUAL_ACTION_REQUIRED/);
  assert.ok(!fs.readFileSync(path.join(root,"school-auth-state.json"),"utf8").includes("private input"));
  clear();await assert.rejects(auth.ensureSession(cfg,{...deps,createAdapter:async()=>({...adapter,check:async()=>"SCHOOL_SECURITY_CHALLENGE",login:()=>assert.fail("challenge cannot submit")})}),/SECURITY_CHALLENGE/);
  await assert.rejects(auth.ensureSession(cfg,deps),/MANUAL_ACTION_REQUIRED/);
  clear();await assert.rejects(auth.ensureSession(cfg,{...deps,createAdapter:async()=>({...adapter,login:async()=>{throw Error("https://private.invalid?ticket=synthetic");}})}),/SCHOOL_AUTH_TRANSPORT_FAILED/);
  await assert.rejects(auth.ensureSession(cfg,deps),/COOLDOWN/);
  clear();fs.writeFileSync(path.join(root,"school-auth-state.json"),JSON.stringify({windowStart:999999,attempts:2}));await assert.rejects(auth.ensureSession(cfg,deps),/DAILY_LIMIT/);
  clear();const control=new AbortController();control.abort();await assert.rejects(auth.ensureSession(cfg,{...deps,signal:control.signal}),/COLLECTOR_STOPPED/);assert.ok(!fs.existsSync(cfg.sessionPath));
  for(const u of ["http://100.fosu.edu.cn","https://100.fosu.edu.cn.evil.invalid","https://user:password@100.fosu.edu.cn","https://evil.invalid"])assert.equal(auth.allowedUrl(u),false);
  assert.equal(auth.classifyPage("https://100.fosu.edu.cn/framework/xsMain.jsp","教学一体化服务平台"),"SESSION_VALID");
  assert.equal(auth.classifyPage("https://100.fosu.edu.cn/framework/xsMain.jsp","unexpected"),"SCHOOL_PAGE_CHANGED");
  assert.equal(auth.classifyPage("https://authserver.fosu.edu.cn/authserver/login","密码错误，验证码"),"INVALID_CREDENTIALS");
  for(const file of ["login.js","sync.js","sessionVerifier.js"]){const s=fs.readFileSync(path.join(__dirname,"fosu-sync-client",file),"utf8");assert.ok(!s.includes("ignoreHTTPSErrors: true"));assert.ok(!s.includes("--ignore-certificate-errors"));}
  async function adapterFixture(challenge=false){
    let url="https://authserver.fosu.edu.cn/authserver/login",submitted=0,passwordFills=0,captchaChecks=0;
    const contexts=[],routes=[];
    const page={url:()=>url,goto:async target=>{url=target;},waitForTimeout:async()=>{},locator:selector=>({
      count:async()=>1,isVisible:async()=>true,innerText:async()=>url.includes("framework")?"教学一体化服务平台":"统一身份认证 账号登录",
      evaluate:async()=>"https://authserver.fosu.edu.cn/authserver/login",fill:async()=>{if(selector==="#password")passwordFills++;},click:async()=>{submitted++;url="https://100.fosu.edu.cn/framework/xsMain.jsp";}
    })};
    const browser={close:async()=>{},newContext:async options=>{contexts.push(options);return {route:async(_,handler)=>routes.push(handler),newPage:async()=>page,storageState:async()=>({cookies:[],origins:[]}),request:{get:async(target,options)=>{captchaChecks++;assert.equal(options.maxRedirects,0);return {ok:()=>true,url:()=>target,json:async()=>({isNeed:challenge})};}}};}};
    const real=await auth.createAdapter(cfg,{chromium:{launch:async options=>{assert.ok(!options.args.some(a=>a.includes("certificate")));return browser;}}});
    if(challenge)await assert.rejects(real.login({account:"fixture-user",password:"synthetic"}),/SECURITY_CHALLENGE/);else await real.login({account:"fixture-user",password:"synthetic"});
    assert.equal(contexts[0].ignoreHTTPSErrors,false);assert.equal(contexts[0].storageState,undefined);assert.equal(captchaChecks,1);assert.equal(submitted,challenge?0:1);assert.equal(passwordFills,challenge?0:1);
    let aborted=false;await routes[0]({request:()=>({url:()=>"http://100.fosu.edu.cn"}),abort:async()=>{aborted=true;},continue:()=>assert.fail("HTTP school route")});assert.equal(aborted,true);await real.close();
  }
  await adapterFixture(false);await adapterFixture(true);
  // Explicit, read-only check does not read credentials or attempt recovery.
  clear();fs.writeFileSync(cfg.sessionPath,JSON.stringify({cookies:[],origins:[]}),{mode:0o600});
  const before = fs.readFileSync(cfg.sessionPath);
  const oldCredentialsPath = cfg.schoolCredentialsPath; cfg.schoolCredentialsPath = path.join(root,"must-not-read-credentials.json");
  const checkDeps = { approved:true,createAdapter:async()=>({...adapter,check:async()=>"SESSION_VALID",login:()=>assert.fail("read-only check cannot login")}) };
  await assert.rejects(auth.checkSession(cfg,{...checkDeps,approved:false}),/APPROVAL_REQUIRED/);
  assert.deepEqual(await auth.checkSession(cfg,checkDeps),{status:"SESSION_VALID",schoolLoginAttempts:0,sessionChanged:false});
  assert.equal((await auth.checkSession(cfg,{...checkDeps,createAdapter:async()=>({...adapter,check:async()=>"SESSION_EXPIRED",login:()=>assert.fail("expired check cannot recover")})})).status,"SESSION_EXPIRED");
  await assert.rejects(auth.checkSession(cfg,{...checkDeps,createAdapter:async()=>({...adapter,check:async()=>"SCHOOL_SECURITY_CHALLENGE"})}),/SECURITY_CHALLENGE/);
  assert.deepEqual(fs.readFileSync(cfg.sessionPath),before);assert.equal(fs.existsSync(path.join(root,"school-auth-state.json")),false); cfg.schoolCredentialsPath=oldCredentialsPath;
  const previousDebug = process.env.DEBUG;
  try { process.env.DEBUG="pw:api"; await assert.rejects(auth.createAdapter(cfg,{chromium:{launch:()=>assert.fail("debug mode cannot launch credential browser")}}),/DEBUG_REJECTED/); } finally { if(previousDebug===undefined)delete process.env.DEBUG;else process.env.DEBUG=previousDebug; }
  console.log("school session: approval, single submission, cooldown, manual challenge, atomic replacement, strict TLS fixtures PASS; schoolRequests=0");
}
main().finally(()=>fs.rmSync(root,{recursive:true,force:true})).catch(e=>{console.error(e);process.exitCode=1;});
