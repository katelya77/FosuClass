"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const policy=require('./wyz-schedule-collector/schoolRequestPolicy');
const base='https://authserver.fosu.edu.cn/authserver/checkNeedCaptcha.htl';
const state=()=>({precheck:{active:true,account:'fixture-user',browserRequests:0}});
const req=query=>({url:base+'?'+query,method:'GET',headers:{}});
test('policy accepts only the two reviewed account query forms',()=>{
 for(const query of ['username=fixture-user','username=fixture-user&_=1791710000000','_=1791710000000&username=fixture-user']){
  const result=policy.decision(req(query),'XHR',state());assert.equal(result.allowed,true);assert.equal(result.accountPrecheck,true);
 }
});
test('policy rejects malformed cache busters, duplicate keys and encoding aliases',()=>{
 for(const query of ['username=fixture-user&_','username=fixture-user&_=','username=fixture-user&_=abc',
  'username=fixture-user&_=179171000000','username=fixture-user&_=17917100000000',
  'username=fixture-user&_=1791710000000&_=1791710000000','username=fixture-user&username=fixture-user&_=1791710000000',
  'username=fixture-user&_=1791710000000&other=1','username=different&_=1791710000000','username=&_=1791710000000',
  'username=fixture-user&%5F=1791710000000','username=fixture-user&_=179171000000%30',
  'user%6Eame=fixture-user&_=1791710000000','username=fixture-user%ZZ&_=1791710000000',
  'username=fixture-user&_=1791710000000&','username=fixture-user;_=1791710000000']){
  assert.equal(policy.decision(req(query),'XHR',state()).fatalCode,'SCHOOL_LOGIN_PRECHECK_REQUEST_REJECTED');
 }
});
test('all original origin, method, resource, body, context and budget gates remain',()=>{
 const good=req('username=fixture-user&_=1791710000000');
 for(const change of [{method:'POST'},{postData:'fixture'},{hasPostData:true},{postDataEntries:[{}]},
  {headers:{Authorization:'fixture'}},{headers:{'Proxy-Authorization':'fixture'}},
  {url:good.url.replace('https:','http:')},{url:good.url.replace('authserver.fosu.edu.cn','unapproved.invalid')},
  {url:good.url+'#fragment'}])assert.equal(policy.decision({...good,...change},'XHR',state()).allowed,false);
 const other={...good,url:good.url.replace('checkNeedCaptcha.htl','other.htl')};
 assert.equal(Boolean(policy.decision(other,'XHR',state()).accountPrecheck),false);
 assert.equal(policy.decision(other,'XHR',{...state(),credentialsPhase:true}).allowed,false);
 for(const type of ['Fetch','Document','Other','xhr',undefined])assert.equal(policy.decision(good,type,state()).allowed,false);
 assert.equal(policy.decision(good,'XHR',{}).allowed,false);
 assert.equal(policy.decision(good,'XHR',{precheck:{...state().precheck,active:false}}).allowed,false);
 assert.equal(policy.decision(good,'XHR',{precheck:{...state().precheck,account:'other'}}).allowed,false);
 assert.equal(policy.decision(good,'XHR',{precheck:{...state().precheck,browserRequests:1}}).fatalCode,'SCHOOL_LOGIN_PRECHECK_BUDGET_EXHAUSTED');
});
test('Chromium page-first and direct-first late XHR share exactly one official result',async()=>{
 const fixture=require('./test-collector-login-browser-fixture');
 function form(event='blur',delay=0,times=1,queryOrder=false){
  const query=queryOrder?"'_=1791710000000&username='+encodeURIComponent(u.value)":"'username='+encodeURIComponent(u.value)+'&_=1791710000000'";
  const send="for(let n=0;n<"+times+";n++){const x=new XMLHttpRequest();x.open('GET','/authserver/checkNeedCaptcha.htl?'+"+query+");x.send(null);}";
  return fixture.FORM.replace('</body>',"<script>const u=document.querySelector('#username');u.addEventListener('"+event+"',()=>{"+(delay?'setTimeout(()=>{'+send+'},'+delay+');':send)+"});</script></body>");
 }
 try{
  for(const event of ['input','change','blur'])await fixture.scenario(false,undefined,{form:form(event),captcha:0,expectedBrowserPrechecks:1});
  await fixture.scenario(false,undefined,{form:form('blur',0,1,true),captcha:0,expectedBrowserPrechecks:1});
  await fixture.scenario(false,undefined,{form:form('blur',1100),directPrecheckDelay:300,captcha:1,expectedBrowserPrechecks:0,postEvidence:{reason:'REUSE_VERIFIED_ACCOUNT_PRECHECK'}});
  await fixture.scenario(true,undefined,{form:form(),captcha:0,expectedBrowserPrechecks:1});
  await fixture.scenario(true,undefined,{form:form('blur',1100),directPrecheckDelay:300,captcha:1,expectedBrowserPrechecks:0});
  await fixture.scenario(false,undefined,{form:form(),precheck:'false',captcha:0,expectedBrowserPrechecks:1});
  await fixture.scenario(false,undefined,{form:form(),precheck:'{"unknown":false}',captcha:0,expectedBrowserPrechecks:1,blocked:true,error:'SCHOOL_LOGIN_PRECHECK_CHANGED'});
  await fixture.scenario(false,undefined,{form:form(),precheckRedirect:'https://unapproved.invalid/',captcha:0,expectedBrowserPrechecks:1,blocked:true,error:'SCHOOL_LOGIN_PRECHECK_FAILED'});
  await fixture.scenario(false,undefined,{form:form('blur',0,2),captcha:0,expectedBrowserPrechecks:1,blocked:true,error:'SCHOOL_LOGIN_PRECHECK_BUDGET_EXHAUSTED'});
  await fixture.scenario(false,undefined,{form:form(),interactive:true,protectedFile:true,captcha:0,expectedBrowserPrechecks:1});
 }finally{fixture.cleanup();}
});
