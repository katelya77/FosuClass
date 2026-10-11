"use strict";
const fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os'),cp=require('child_process');
let checkCount=0;
const assert=new Proxy(require('assert/strict'),{get:(target,key)=>typeof target[key]==='function'&&key!=='AssertionError'?((...args)=>{checkCount++;return target[key](...args);}):target[key]});
const audit=require('./wyz-schedule-collector/casPublicAudit'),fixture=require('./test-collector-login-browser-fixture');
const INSTALLED='6fe02a552e7511bc27a2f4751db302ebb7a8e001';
function installedModules(){
  // Load the real installed version from its pinned Git blobs, rather than a
  // replacement API stub or the modified adapter under test. CI must retain
  // repository history; an unavailable pinned base is a test failure.
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fosu-installed-cas-6fe-'));
  try{
    const files=['tools/wyz-schedule-collector/schoolSession.js','tools/wyz-schedule-collector/schoolBrowserAdapter.js','tools/wyz-schedule-collector/schoolRequestPolicy.js','tools/wyz-schedule-collector/schoolAuthState.js','tools/wyz-schedule-collector/runStore.js','tools/wyz-schedule-collector/browserRuntime.js','tools/fosu-sync-client/schoolCasPage.js','tools/fosu-sync-client/schoolLoginProfile.js','shared/syncCacheStore.js'];
    for(const file of files){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,cp.execFileSync('git',['show',INSTALLED+':'+file],{cwd:path.join(__dirname,'..'),maxBuffer:2*1024*1024}));}
    return {root,moduleRoot:path.join(root,'tools/wyz-schedule-collector')};
  }catch(error){fs.rmSync(root,{recursive:true,force:true});throw error;}
}
async function main(){
  const request={url:'https://authserver.fosu.edu.cn'+audit.TARGET+'?account=fixture-private-account',headers:{'Content-Type':'application/json; charset=utf-8'},postData:JSON.stringify({username:'fixture-private-account',password:'fixture-private-password',locale:'fixture-private-language',token:'fixture-private-token'})};
  const summary=audit.parameterSummary(request),output=JSON.stringify(summary);
  assert.equal(audit.auditFailure({code:'SCHOOL_FIXTURE_PRIVATE_TOKEN'},'browser-start').code,'SCHOOL_PUBLIC_AUDIT_BROWSER_START_FAILED');
  for(const value of ['fixture-private-account','fixture-private-password','fixture-private-language','fixture-private-token'])assert.ok(!output.includes(value));
  assert.equal(summary.sensitiveParameterPresent,true);assert.equal(summary.bodyFormat,'json-object');assert.equal(summary.bodyEmpty,false);
  assert.equal(audit.parameterSummary({...request,postData:undefined}).bodyEmpty,true);
  assert.equal(audit.parameterSummary({...request,postData:undefined,hasPostData:true}).bodyEmpty,null);
  assert.equal(audit.parameterSummary({...request,headers:{'Content-Type':'application/x-www-form-urlencoded'},postData:'account=fixture-private-account&locale=fixture-private-language'}).bodyFormat,'form-urlencoded');
  assert.equal(audit.publicScriptPath('https://authserver.fosu.edu.cn/authserver/js/login.js?token=fixture-private-token'),'/authserver/js/login.js');
  assert.equal(audit.publicScriptPath('https://unapproved.invalid/authserver/js/login.js'),null);
  const source="// fixture-private-comment\nconst ticket='fixture-private-ticket', password=202610101234, language='fixture-private-language';\nconst template=`fixture-private-template\n${ticket}`;const regex=/fixture-private-regex/;const map={fixtureAuditSecretAlphaBeta:true};\n$.ajax({url:'/authserver/common/getLanguageTypes.htl',method:'POST',data:{},success:function(resp){$('#language').append(resp.languageTypes);},error:function(){$('#login').prop('disabled',true);}});";
  const masked=audit.sanitizedPublicSource(source),evidence=audit.sourceSummary(source);
  for(const value of ['fixture-private-comment','fixture-private-ticket','202610101234','fixture-private-language','fixture-private-template','fixture-private-regex','fixtureAuditSecretAlphaBeta'])assert.ok(!masked.includes(value));
  assert.equal(masked.split('\n').length,source.split('\n').length);assert.match(masked,/#language/);assert.match(masked,/#login/);assert.match(masked,/disabled/);
  assert.ok(!audit.sanitizedPublicSource("$('#login_fixture_private_selector').hide();").includes('login_fixture_private_selector'));
  assert.ok(!audit.sanitizedPublicSource("const 机密姓名属性={机密对象属性:true};").includes('机密'));
  const excerpts=audit.sanitizedCallExcerpts(masked);assert.ok(excerpts.join('').length<=6000);assert.equal(excerpts.join('').includes('fixtureAuditSecretAlphaBeta'),false);
  assert.equal(evidence.purposeConfirmed,false);assert.ok(evidence.knownUsageSignals.includes('error'));assert.equal(evidence.endpointOccurrences,1);
  const shell=fs.readFileSync(path.join(__dirname,'../docs/cas-sample-closure/PAM-PUBLIC-AUDIT.sh'),'utf8');
  assert.ok(!shell.includes('\r'));assert.ok(shell.includes('6fe02a552e7511bc27a2f4751db302ebb7a8e001'));
  const acceptedWrapper=cp.execFileSync('git',['show',INSTALLED+':deploy/wyz/fosu-collector.sh'],{cwd:path.join(__dirname,'..'),encoding:'utf8'});
  const browserEnvironment='export PLAYWRIGHT_BROWSERS_PATH=/var/lib/fosuclass/schedule-collector/browsers';
  assert.ok(acceptedWrapper.includes(browserEnvironment));assert.ok(shell.includes(browserEnvironment));
  const node=shell.split("node <<'CAS_PUBLIC_AUDIT_NODE'\n")[1].split('\nCAS_PUBLIC_AUDIT_NODE')[0];
  const moduleSource=fs.readFileSync(path.join(__dirname,'wyz-schedule-collector/casPublicAudit.js'),'utf8').replace(/\r\n/g,'\n');
  assert.ok(node.startsWith(moduleSource.slice(0,moduleSource.lastIndexOf('module.exports='))));new vm.Script(node);
  const background="<script>function getLanguageTypes(){fetch('/authserver/common/getLanguageTypes.htl',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});}getLanguageTypes();getLanguageTypes();getLanguageTypes();</script>";
  await fixture.scenario(false,undefined,{audit:true,diagnose:true,form:fixture.FORM.replace('</body>',background+'</body>'),blocked:true,expectedBlockedPosts:3,networkStatus:'REVIEW_REQUIRED',authState:{windowStart:Date.now(),attempts:1,blocked:true,cooldownUntil:0}});
  const installed=installedModules(),state=path.join(installed.root,'private-state');fs.mkdirSync(state,{mode:0o700});
  const cfg={dataRoot:state,sessionPath:path.join(state,'session.json'),loginProfile:'mobile'};
  try{
    const oldAuth=require(path.join(installed.moduleRoot,'schoolSession'));assert.equal(typeof oldAuth.createAdapter,'function');
    const sentinel=Buffer.from(JSON.stringify({windowStart:Date.now(),attempts:1,blocked:true,cooldownUntil:0}));fs.writeFileSync(path.join(state,'school-auth-state.json'),sentinel,{mode:0o600});
    const launchFailure=await audit.audit(cfg,{moduleRoot:installed.moduleRoot,chromium:{launch:async()=>{throw new Error('Executable unavailable at fixture-private-path with fixture-private-token');}}});
    assert.equal(launchFailure.status,'BLOCKED');assert.equal(launchFailure.code,'SCHOOL_PUBLIC_AUDIT_BROWSER_START_FAILED');assert.equal(launchFailure.stage,'browser-start');assert.equal(launchFailure.reason,'BROWSER_RUNTIME_UNAVAILABLE');
    assert.deepEqual(launchFailure.endpointAudit,[]);assert.equal(launchFailure.passwordSubmissions,0);assert.equal(launchFailure.credentialsRead,false);assert.equal(launchFailure.authHistoryChanged,false);assert.equal(launchFailure.sessionMetadataChanged,false);
    assert.equal(JSON.stringify(launchFailure).includes('fixture-private'),false);assert.deepEqual(fs.readFileSync(path.join(state,'school-auth-state.json')),sentinel);assert.ok(!fs.existsSync(path.join(state,'school-session.lock')));
    const control=new AbortController();control.abort();const cancelled=await audit.audit(cfg,{moduleRoot:installed.moduleRoot,signal:control.signal,chromium:{launch:async()=>assert.fail('cancel must stop before launch')}});
    assert.equal(cancelled.code,'COLLECTOR_STOPPED');assert.equal(cancelled.stage,'runtime-validation');assert.equal(cancelled.passwordSubmissions,0);
    await fixture.scenario(false,undefined,{authModuleRoot:installed.moduleRoot,audit:true,diagnose:true,form:fixture.FORM.replace('</body>',background+'</body>'),blocked:true,expectedBlockedPosts:3,networkStatus:'REVIEW_REQUIRED',authState:{windowStart:Date.now(),attempts:1,blocked:true,cooldownUntil:0}});
  }finally{fs.rmSync(installed.root,{recursive:true,force:true});}
  console.log('cas-public-audit: '+checkCount+' privacy/control-flow/inline/installed-API checks + 2 native Chromium audits PASS; real pinned 6fe modules, installed POST guard preserved, 3 target requests blocked, no school network/extra GET/credentials/auth history change');
}
main().catch(error=>{console.error('cas-public-audit: FAIL '+(error.code||error.message));process.exitCode=1;}).finally(fixture.cleanup);
