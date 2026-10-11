"use strict";
const fixture=require('./test-collector-login-browser-fixture'),assert=require('assert/strict'),policy=require('./wyz-schedule-collector/schoolRequestPolicy');
function form({event='blur',delay=0,times=1,suffix='',method='GET',navigate=false,synchronous=false}={}){
  const send=navigate?"location.href=url":"const x=new XMLHttpRequest();x.open('"+method+"',url,"+!synchronous+");try{x.send(null)}catch{}";
  const target=event==='password-focus'?"document.querySelector('#password')":"u",trigger=event==='password-focus'?'focus':event;
  const run="for(let i=0;i<"+times+";i++){const url='/authserver/checkNeedCaptcha.htl?username='+encodeURIComponent(u.value)+'"+suffix+"';"+send+"}";
  return fixture.FORM.replace('</body>',"<script>const u=document.querySelector('#username');"+target+".addEventListener('"+trigger+"',()=>{"+(delay?"setTimeout(()=>{"+run+"},"+delay+")":run)+"});</script></body>");
}
async function main(){
  let count=0;const req={url:'https://authserver.fosu.edu.cn/authserver/checkNeedCaptcha.htl?username=fixture-user',method:'GET',headers:{}};
  const precheck={active:true,account:'fixture-user',browserRequests:0,source:null},state={precheck};
  assert.equal(policy.decision(req,'XHR',state).allowed,true);count++;
  for(const change of [{url:req.url+'&fixture=1'},{url:req.url+'&username=fixture-user'},{url:req.url.replace('fixture-user','different')},{url:req.url.replace('username=fixture-user','account=fixture-user')},{method:'POST'},{url:req.url+'#fixture'},{postData:'fixture'},{hasPostData:true},{headers:{Authorization:'fixture'}}]){
    assert.equal(policy.decision({...req,...change},'XHR',state).fatalCode,'SCHOOL_LOGIN_PRECHECK_REQUEST_REJECTED');count++;
  }
  assert.equal(policy.decision(req,'Fetch',state).allowed,false);count++;
  assert.equal(policy.decision(req,'XHR',{precheck:{...precheck,browserRequests:1}}).fatalCode,'SCHOOL_LOGIN_PRECHECK_BUDGET_EXHAUSTED');count++;
  assert.equal(policy.decision(req,'XHR',{}).reason,'ACCOUNT_PRECHECK_NOT_AUTHORIZED');count++;
  assert.equal(policy.decision(req,'XHR',{precheck:{...precheck,active:false}}).allowed,false);count++;
  const cases=[
    {form:form(),captcha:0,expectedBrowserPrechecks:1},
    {form:form({event:'input'}),captcha:0,expectedBrowserPrechecks:1},
    {form:form({synchronous:true}),captcha:0,expectedBrowserPrechecks:1},
    {form:form({delay:1100}),directPrecheckDelay:300,captcha:1,expectedBrowserPrechecks:0,postEvidence:{reason:'REUSE_VERIFIED_ACCOUNT_PRECHECK'}},
    {form:form({event:'password-focus',synchronous:true}),captcha:1,expectedBrowserPrechecks:0,postEvidence:{reason:'REUSE_VERIFIED_ACCOUNT_PRECHECK'}},
    {form:form({times:2}),captcha:0,expectedBrowserPrechecks:1,blocked:true,error:'SCHOOL_LOGIN_PRECHECK_BUDGET_EXHAUSTED'},
    {form:form({suffix:'&fixture=1'}),captcha:0,expectedBrowserPrechecks:0,expectedPrecheckRequests:0,blocked:true,error:'SCHOOL_LOGIN_PRECHECK_REQUEST_REJECTED'},
    {form:form({method:'POST'}),captcha:0,expectedBrowserPrechecks:0,expectedPrecheckRequests:0,blocked:true,error:'SCHOOL_LOGIN_PRECHECK_REQUEST_REJECTED'},
    {form:form({navigate:true}),captcha:0,expectedBrowserPrechecks:0,expectedPrecheckRequests:0,blocked:true,error:'SCHOOL_LOGIN_PRECHECK_REQUEST_REJECTED'},
    {form:form(),precheckStatus:500,captcha:0,expectedBrowserPrechecks:1,blocked:true,error:'SCHOOL_LOGIN_PRECHECK_FAILED'},
    {form:form(),precheckRedirect:'https://unapproved.invalid/',captcha:0,expectedBrowserPrechecks:1,blocked:true,error:'SCHOOL_LOGIN_PRECHECK_FAILED'},
    {form:form(),precheck:'{"unreviewed":false}',captcha:0,expectedBrowserPrechecks:1,blocked:true,error:'SCHOOL_LOGIN_PRECHECK_CHANGED'},
    {form:form(),precheck:'{"isNeed":true}',captcha:0,expectedBrowserPrechecks:1,error:'SCHOOL_SECURITY_CHALLENGE'},
    {form:form(),precheck:'false',precheckContentType:'text/html',captcha:0,expectedBrowserPrechecks:1,blocked:true,error:'SCHOOL_LOGIN_PRECHECK_FAILED'},
    {form:form(),nativePrecheckResponse:true,captcha:0,expectedBrowserPrechecks:1},
    {form:form(),nativePrecheckResponse:true,precheck:'{"isNeed":true}',captcha:0,expectedBrowserPrechecks:1,error:'SCHOOL_SECURITY_CHALLENGE'},
    {form:form(),interactive:true,captcha:0,expectedCredentialsRead:1,expectedBrowserPrechecks:1},
    {form:form(),interactive:true,protectedFile:true,captcha:0,expectedBrowserPrechecks:1},
    {form:form(),preLoginExpiredCheck:true,captcha:0,expectedBrowserPrechecks:1},
    {form:form(),cancelDuringPrecheck:true,captcha:0,expectedBrowserPrechecks:0,expectedPrecheckRequests:1,blocked:true,error:'COLLECTOR_STOPPED'},
  ];
  for(const [index,options]of cases.entries()){await fixture.scenario(false,undefined,options);console.log('Account precheck '+(index+1)+' PASS');}
  console.log('account-precheck: '+count+' policy checks + '+cases.length+' real Chromium scenarios PASS; one official GET, exact same-account cached response only, no real school network');
}
main().catch(e=>{console.error('account-precheck FAIL '+(e.code||e.name));if(e.code==='ERR_ASSERTION')console.error(e.message);process.exitCode=1;}).finally(fixture.cleanup);
