"use strict";
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const auth=require('./wyz-schedule-collector/schoolSession'),state=require('./wyz-schedule-collector/schoolAuthState'),cli=require('./wyz-schedule-collector/cli');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'fosu-auth-evidence-')),cfg={dataRoot:root,sessionPath:path.join(root,'session.json')},file=path.join(root,'school-auth-state.json');
let cases=0;
const clear=()=>{for(const name of fs.readdirSync(root))fs.unlinkSync(path.join(root,name));};
async function test(work){clear();await work();cases++;}
const error=code=>Object.assign(new Error('fixture private data'),{code});
async function main(){
  await test(async()=>{
    let closed=0,read=0;
    await assert.rejects(auth.interactiveSession(cfg,{approved:true,readCredentials:()=>{read++;},createAdapter:async()=>({prepare:async()=>{throw error('SCHOOL_LOGIN_ACCOUNT_FIELD_CHANGED');},close:async()=>closed++})}),/ACCOUNT_FIELD_CHANGED/);
    assert.equal(read,0);assert.equal(closed,1);assert.ok(!fs.existsSync(path.join(root,'school-session.lock')));
    const s=state.view(cfg);assert.equal(s.dailyBudgetUsed,0);assert.equal(s.failureCategory,'local_preflight');assert.ok(s.cooldownRemainingSeconds>0);assert.equal(s.blocked,true);
  });
  await test(async()=>{
    const old={windowStart:Date.now(),attempts:1,cooldownUntil:0};fs.writeFileSync(file,JSON.stringify(old),{mode:0o600});
    const lifecycle=state.lifecycle(cfg);lifecycle.failure('SCHOOL_LOGIN_PRECHECK_CHANGED',{stage:'precheck-response'});
    assert.equal(state.view(cfg).dailyBudgetUsed,1);assert.equal(state.view(cfg).submissionState,'LEGACY_UNVERIFIED');
    await assert.rejects(auth.interactiveSession(cfg,{approved:true,acknowledgeFailure:true,createAdapter:()=>assert.fail('cooldown must remain')}),/COOLDOWN/);
  });
  await test(async()=>{
    const lifecycle=state.lifecycle(cfg);lifecycle.hooks.beforeAuthSubmit();
    const s=state.view(cfg);assert.equal(s.dailyBudgetUsed,1);assert.equal(s.submissionState,'reserved_unknown');
    assert.throws(()=>state.lifecycle(cfg).check(),/COOLDOWN/);assert.throws(()=>lifecycle.hooks.beforeAuthSubmit(),/RESUBMISSION/);
    lifecycle.failure('SCHOOL_AUTH_TRANSPORT_FAILED');assert.equal(state.view(cfg).dailyBudgetUsed,1);assert.equal(state.view(cfg).failureCategory,'submission_outcome_unknown');
  });
  await test(async()=>{
    const lifecycle=state.lifecycle(cfg);lifecycle.hooks.beforeAuthSubmit();lifecycle.hooks.onAuthResponse();lifecycle.hooks.onAuthSubmitReleased();
    assert.equal(state.view(cfg).submissionState,'response_received');assert.equal(lifecycle.attempts(),1);
    lifecycle.failure('INVALID_CREDENTIALS');assert.equal(state.view(cfg).failureCategory,'authentication_rejected');
  });
  await test(async()=>{
    let closed=0;await assert.rejects(auth.interactiveSession(cfg,{approved:true,readCredentials:async()=>({account:'fixture-user',password:'synthetic'}),createAdapter:async()=>({prepare:async()=>{},login:async(_,hooks)=>{hooks.beforeAuthSubmit();throw error('SCHOOL_AUTH_TRANSPORT_FAILED');},close:async()=>closed++})}),/TRANSPORT_FAILED/);
    assert.equal(closed,1);assert.ok(!fs.existsSync(path.join(root,'school-session.lock')));assert.equal(state.view(cfg).submissionState,'reserved_unknown');
  });
  await test(async()=>{
    let launched=0;await assert.rejects(cli.main(['diagnose-login'],{skipRootCheck:true,cfg,authDeps:{createAdapter:()=>launched++}}),/NOT_AUTHORIZED/);assert.equal(launched,0);
    await assert.rejects(auth.interactiveSession(cfg,{approved:false,createAdapter:()=>launched++}),/NOT_AUTHORIZED/);assert.equal(launched,0);
  });
  await test(async()=>{
    const before=fs.readdirSync(root);let closed=0;
    await cli.main(['diagnose-login','--approve-school-access'],{skipRootCheck:true,cfg,output:()=>{},connection:()=>assert.fail('no Oracle'),authDeps:{createAdapter:async()=>({diagnose:async()=>({status:'CAS_PUBLIC_FORM_READY'}),close:async()=>closed++})}});
    assert.equal(closed,1);assert.deepEqual(fs.readdirSync(root),before);
  });
  await test(async()=>{
    fs.writeFileSync(file,'broken',{mode:0o600});assert.throws(()=>state.view(cfg),/STATE_INVALID/);assert.throws(()=>state.lifecycle(cfg),/STATE_INVALID/);assert.equal(fs.readFileSync(file,'utf8'),'broken');
  });
  await test(async()=>{
    for(const message of ['ERR_CERT_AUTHORITY_INVALID','Timeout 10000ms exceeded','Target page, context or browser has been closed']){
      clear();await assert.rejects(auth.interactiveSession(cfg,{approved:true,createAdapter:async()=>({prepare:async()=>{throw Error(message);},close:async()=>{}})}));
      assert.ok(!fs.existsSync(path.join(root,'school-session.lock')));assert.equal(state.view(cfg).dailyBudgetUsed,0);
    }
  });
  console.log('collector-auth-evidence: '+cases+' PASS; local fixture only; schoolRequests=0');
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
