"use strict";
const fixture=require('./test-collector-login-browser-fixture');
const assert=require('assert/strict'),policy=require('./wyz-schedule-collector/schoolRequestPolicy');
const background="<script>fetch('/authserver/fixture-public-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1})}).catch(()=>{});</script>";
// Local-only synthetic approval evidence. Production has NO public POST rule.
const rule={origin:'https://authserver.fosu.edu.cn',path:'/authserver/fixture-public-config',purpose:'public-bootstrap',criticality:'required',payload:{version:1}};
async function main(){
  assert.deepEqual(policy.REVIEWED_PUBLIC_POSTS,[]);
  const form=fixture.FORM.replace('</body>',background+'</body>');
  const variants=[
    {diagnose:true,form,blocked:true,networkStatus:'REVIEW_REQUIRED',postEvidence:{endpointCategory:'unknown-official-post',blocked:true,authenticationEndpoint:false}},
    {diagnose:true,form,reviewedPublicPosts:[rule],backgroundReleased:1,networkStatus:'COMPATIBLE',postEvidence:{reason:'REVIEWED_PUBLIC_PARAMETERS',blocked:false}},
    {diagnose:true,form:form.replace('{version:1}','{version:2}'),reviewedPublicPosts:[{...rule,criticality:'optional'}],blocked:true,networkStatus:'COMPATIBLE_WITH_NONCRITICAL_BLOCKS',postEvidence:{reason:'PUBLIC_PARAMETERS_REJECTED'}},
    {diagnose:true,form:form.replace('{version:1}','{version:2}'),reviewedPublicPosts:[rule],blocked:true,networkStatus:'REVIEW_REQUIRED'},
    {diagnose:true,form:form.replace('/fixture-public-config','/login'),blocked:true,error:'SCHOOL_AUTH_POST_NOT_AUTHORIZED',postEvidence:{endpointCategory:'cas-authentication',reason:'AUTHENTICATION_POST_NOT_AUTHORIZED'}},
    {diagnose:true,form:form.replace('/fixture-public-config','/checkNeedCaptcha.htl'),blocked:true,networkStatus:'REVIEW_REQUIRED',postEvidence:{endpointCategory:'account-captcha-precheck',reason:'ACCOUNT_PRECHECK_NOT_AUTHORIZED'}},
    {diagnose:true,form:form.replace('/authserver/fixture-public-config','https://unapproved.invalid/fixture'),blocked:true,error:'SCHOOL_TLS_OR_ORIGIN_REJECTED',postEvidence:{originCategory:'unapproved',reason:'ORIGIN_REJECTED'}},
    {diagnose:true,invokeCLI:true,form,blocked:true,error:'SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED',
      authState:{windowStart:Date.now(),attempts:1,blocked:true,cooldownUntil:0,lastFailureCode:'SCHOOL_LOGIN_FORM_CHANGED'},postEvidence:{reason:'BACKGROUND_POST_UNREVIEWED'}},
    {diagnose:true,invokeCLI:true,networkStatus:'COMPATIBLE'},
    {diagnose:true,invokeCLI:true,cancel:true,error:'COLLECTOR_STOPPED',captcha:0},
    {diagnose:true,invokeCLI:true,browserExit:true,error:'SCHOOL_AUTH_BROWSER_CLOSED',captcha:0},
    {diagnose:true,form:form.replace('</form>',"<input name='captcha'></form>"),blocked:true,error:'SCHOOL_SECURITY_CHALLENGE'},
    {diagnose:true,form:fixture.FORM.replace('</body>',"<script>setTimeout(()=>{const e=document.createElement('input');e.name='captcha';document.body.append(e)},400)</script></body>"),error:'SCHOOL_SECURITY_CHALLENGE'},
    {form,blocked:true,error:'SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED',captcha:0},
    {form,reviewedPublicPosts:[rule],backgroundReleased:1},
    {interactive:true},
    {interactive:true,candidateRejected:true,error:'SCHOOL_PROTECTED_PAGE_REJECTED',posts:1},
    {interactive:true,form,blocked:true,error:'SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED',captcha:0},
    {interactive:true,cancel:true,error:'COLLECTOR_STOPPED',captcha:0},
    {interactive:true,browserExit:true,error:'SCHOOL_AUTH_BROWSER_CLOSED',captcha:0},
  ];
  for(const [index,variant] of variants.entries()){await fixture.scenario(false,undefined,variant);console.log('POST fixture '+(index+1)+' PASS');}
  console.log('cas-post-policy: '+variants.length+' native Chromium scenarios PASS; no production POST allowlist expansion; public diagnosis preserves legacy auth history/Session; real schoolRequests=0');
}
main().catch(e=>{console.error('cas-post-policy: FAIL '+(e.code||e.message));if(e.code==='ERR_ASSERTION')console.error(e.message);process.exitCode=1;}).finally(fixture.cleanup);
