"use strict";
const fixture=require('./test-collector-login-browser-fixture');
const assert=require('assert/strict'),policy=require('./wyz-schedule-collector/schoolRequestPolicy');
const background="<script>fetch('/authserver/fixture-public-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1})}).catch(()=>{});</script>";
// Local-only synthetic approval evidence. Production has NO public POST rule.
const responseContract={expected:{success:true},arrays:{languages:['code','name']},maxBytes:8192};
const responseBody=JSON.stringify({success:true,languages:[{code:'fixture',name:'fixture'}]});
const rule={origin:'https://authserver.fosu.edu.cn',path:'/authserver/fixture-public-config',purpose:'public-bootstrap',criticality:'required',payload:{version:1},response:responseContract,resourceTypes:['XHR','Fetch'],maxRequests:1,evidenceSha256:'a'.repeat(64)};
function policyCases(){
  const reviewed=policy.validateRules([rule]);
  const request={url:rule.origin+rule.path,method:'POST',headers:{'Content-Type':'application/json'},postData:'{"version":1}'};
  const state={armed:false,credentialsPhase:false,submissionReserved:false,publicPostCounts:new Map()};
  const cases=[
    [{},'XHR',state,reviewed,true,'REVIEWED_PUBLIC_PARAMETERS'],
    [{url:request.url+'?version=1'},'XHR',state,reviewed,false,'PUBLIC_PARAMETERS_REJECTED'],
    [{url:request.url+'-extra'},'XHR',state,reviewed,false,'BACKGROUND_POST_UNREVIEWED'],
    [{url:rule.origin+'/authserver/common/getLanguageTypes.htl'},'XHR',state,reviewed,false,'BACKGROUND_POST_UNREVIEWED'],
    [{url:'https://100.fosu.edu.cn'+rule.path},'XHR',state,reviewed,false,'BACKGROUND_POST_UNREVIEWED'],
    [{url:'http://authserver.fosu.edu.cn'+rule.path},'XHR',state,reviewed,false,'ORIGIN_REJECTED'],
    [{url:'https://authserver.fosu.edu.cn.unapproved.invalid'+rule.path},'XHR',state,reviewed,false,'ORIGIN_REJECTED'],
    [{url:'https://fixture:fixture@authserver.fosu.edu.cn'+rule.path},'XHR',state,reviewed,false,'ORIGIN_REJECTED'],
    [{},'Document',state,reviewed,false,'PUBLIC_PARAMETERS_REJECTED'],
    [{method:'GET',postData:undefined},'XHR',state,reviewed,false,'PUBLIC_INITIALIZATION_METHOD_REJECTED'],
    [{headers:{'Content-Type':'application/x-www-form-urlencoded'}},'XHR',state,reviewed,false,'PUBLIC_PARAMETERS_REJECTED'],
    [{postData:'{"version":2}'},'XHR',state,reviewed,false,'PUBLIC_PARAMETERS_REJECTED'],
    [{postData:'{"version":0,"version":1}'},'XHR',state,reviewed,false,'PUBLIC_PARAMETERS_REJECTED'],
    [{postData:'{"version":1,"account":"fixture"}'},'XHR',state,reviewed,false,'PUBLIC_PARAMETERS_REJECTED'],
    [{postData:'[{"version":1}]'},'XHR',state,reviewed,false,'PUBLIC_PARAMETERS_REJECTED'],
    [{postData:'x'.repeat(2049)},'XHR',state,reviewed,false,'PUBLIC_PARAMETERS_REJECTED'],
    [{},'XHR',{...state,credentialsPhase:true},reviewed,false,'CREDENTIAL_PHASE_REQUEST_REJECTED'],
    [{},'XHR',{...state,credentialsPhase:true,submissionReserved:true},reviewed,false,'CREDENTIAL_PHASE_REQUEST_REJECTED'],
    [{},'XHR',{...state,publicPostCounts:new Map([[rule.path,1]])},reviewed,false,'PUBLIC_INITIALIZATION_BUDGET_EXHAUSTED'],
    [{},'XHR',state,policy.validateRules([{...rule,criticality:'optional'}]),false,'OPTIONAL_INITIALIZATION_BLOCKED'],
    [{},'XHR',state,policy.validateRules([{...rule,purpose:'security-verification',payload:undefined,response:undefined}]),false,'SECURITY_VERIFICATION_REQUIRES_MANUAL_ACTION'],
    [{url:rule.origin+'/authserver/checkNeedCaptcha.htl',method:'GET',postData:undefined},'XHR',state,reviewed,false,'ACCOUNT_PRECHECK_NOT_AUTHORIZED'],
    [{url:rule.origin+'/authserver/checkNeedCaptcha.htl'},'XHR',state,reviewed,false,'ACCOUNT_PRECHECK_NOT_AUTHORIZED'],
    [{url:rule.origin+'/authserver/login'},'XHR',state,reviewed,false,'AUTHENTICATION_POST_NOT_AUTHORIZED'],
    [{url:rule.origin+'/authserver/login'},'XHR',{...state,armed:true},reviewed,true,'ONE_REVIEWED_AUTHENTICATION_POST'],
    [{url:rule.origin+'/authserver/login'},'XHR',{...state,armed:true,submissionClaimed:true},reviewed,false,'DUPLICATE_AUTHENTICATION_POST'],
    [{url:rule.origin+'/authserver/login?service=https%3A%2F%2Funapproved.invalid'},'XHR',{...state,armed:true},reviewed,false,'CAS_SERVICE_REJECTED'],
    [{url:rule.origin+'/authserver/login?service='+encodeURIComponent(require('./fosu-sync-client/schoolLoginProfile').CAS_SERVICE_URL)+'&service=https%3A%2F%2Funapproved.invalid'},'XHR',{...state,armed:true},reviewed,false,'CAS_SERVICE_REJECTED'],
  ];
  for(const [change,type,phase,rules,allowed,reason] of cases){const value=policy.decision({...request,...change},type,phase,rules);assert.equal(value.allowed,allowed);assert.equal(value.reason,reason);}
  const invalid=[
    {...rule,origin:'https://100.fosu.edu.cn'}, {...rule,path:'/authserver/login'}, {...rule,path:'/authserver/checkNeedCaptcha.htl'},
    {...rule,path:'/authserver/%2e%2e/fixture'}, {...rule,path:'/authserver/fixture?all=true'}, {...rule,path:'/authserver//fixture'},
    {...rule,resourceTypes:['Document']}, {...rule,resourceTypes:['XHR','XHR']}, {...rule,maxRequests:0}, {...rule,maxRequests:4},
    {...rule,payload:{username:'fixture'}}, {...rule,payload:{execution:'fixture'}}, {...rule,payload:{version:NaN}},
    {...rule,payload:{version:{any:true}}}, {...rule,payload:{version:'x'.repeat(129)}}, {...rule,evidenceSha256:'unreviewed'},
    {...rule,payload:{'unreviewed key':1}}, {...rule,payload:{['x'.repeat(65)]:1}}, {...rule,payload:Object.fromEntries(Array.from({length:9},(_,index)=>['field'+index,index]))},
    {...rule,purpose:'authentication'}, {...rule,criticality:'unknown'}, {...rule,allowAll:true}, {...rule,purpose:'security-verification'},
    {...rule,response:undefined}, {...rule,response:{...responseContract,expected:{}}}, {...rule,response:{...responseContract,expected:{token:'fixture'}}},
    {...rule,response:{...responseContract,arrays:{languages:['password']}}}, {...rule,response:{...responseContract,maxBytes:65536}},
  ];
  for(const value of invalid)assert.throws(()=>policy.validateRules([value]),/SCHOOL_PUBLIC_POST_RULE_REJECTED/);
  assert.throws(()=>policy.validateRules([rule,rule]),/SCHOOL_PUBLIC_POST_RULE_REJECTED/);
  assert.throws(()=>policy.validateRules({}),/SCHOOL_PUBLIC_POST_RULE_REJECTED/);
  const source={...rule,payload:{version:1},resourceTypes:['XHR']},frozen=policy.validateRules([source]);source.payload.version=2;source.resourceTypes.push('Document');
  assert.equal(frozen[0].payload.version,1);assert.deepEqual(frozen[0].resourceTypes,['XHR']);
  const privateRequest={...request,get postData(){assert.fail('credential-bearing body must never be inspected');}};
  assert.equal(policy.decision(privateRequest,'XHR',{...state,credentialsPhase:true,submissionReserved:true},reviewed).reason,'CREDENTIAL_PHASE_REQUEST_REJECTED');
  const authenticationRequest={...request,url:rule.origin+'/authserver/login',get postData(){assert.fail('authentication body must never be inspected');}};
  assert.equal(policy.decision(authenticationRequest,'XHR',{...state,armed:true},reviewed).reason,'ONE_REVIEWED_AUTHENTICATION_POST');
  const response={responseStatusCode:200,responseHeaders:[{name:'content-type',value:'application/json; charset=utf-8'}]};
  assert.equal(policy.publicResponseAllowed(response,responseBody,rule),true);
  for(const change of [{responseStatusCode:302},{responseStatusCode:500},{responseErrorReason:'Failed'},{responseHeaders:[{name:'content-type',value:'text/html'}]}])assert.equal(policy.publicResponseAllowed({...response,...change},responseBody,rule),false);
  const invalidBodies=['{}','{"success":false,"languages":[]}',responseBody.replace('"success":true','"success":false'),responseBody.replace('"fixture"','1'),responseBody.replace('"languages"','"unexpected"'),JSON.stringify({success:true,languages:[{code:'fixture',name:'fixture',token:'fixture'}]}),'x'.repeat(8193)];
  for(const body of invalidBodies)assert.equal(policy.publicResponseAllowed(response,body,rule),false);
  return cases.length+invalid.length+10+invalidBodies.length;
}
async function main(){
  assert.deepEqual(policy.REVIEWED_PUBLIC_POSTS,[]);
  const unitCount=policyCases();
  const form=fixture.FORM.replace('</body>',background+'</body>');
  const variants=[
    {diagnose:true,form,blocked:true,networkStatus:'REVIEW_REQUIRED',postEvidence:{endpointCategory:'unknown-official-post',blocked:true,authenticationEndpoint:false}},
    {diagnose:true,form,reviewedPublicPosts:[rule],backgroundReleased:1,networkStatus:'COMPATIBLE',postEvidence:{reason:'REVIEWED_PUBLIC_PARAMETERS',blocked:false}},
    {diagnose:true,form,reviewedPublicPosts:[{...rule,criticality:'optional'}],blocked:true,networkStatus:'COMPATIBLE_WITH_NONCRITICAL_BLOCKS',postEvidence:{reason:'OPTIONAL_INITIALIZATION_BLOCKED'}},
    {diagnose:true,form:form.replace('{version:1}','{version:2}'),reviewedPublicPosts:[{...rule,criticality:'optional'}],blocked:true,networkStatus:'REVIEW_REQUIRED',postEvidence:{reason:'PUBLIC_PARAMETERS_REJECTED'}},
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
    {diagnose:true,form,reviewedPublicPosts:[rule],initializationStatus:500,backgroundReleased:1,blocked:true,networkStatus:'REVIEW_REQUIRED'},
    {diagnose:true,form,reviewedPublicPosts:[rule],initializationContentType:'text/html',backgroundReleased:1,blocked:true,networkStatus:'REVIEW_REQUIRED'},
    {diagnose:true,form,reviewedPublicPosts:[rule],initializationStatus:302,initializationRedirect:'https://100.fosu.edu.cn/framework/xsMain.jsp',backgroundReleased:1,blocked:true,networkStatus:'REVIEW_REQUIRED'},
    {diagnose:true,form,reviewedPublicPosts:[rule],pendingInitialization:true,backgroundReleased:1,networkStatus:'REVIEW_REQUIRED'},
    {diagnose:true,reviewedPublicPosts:[rule],networkStatus:'REVIEW_REQUIRED'},
    {diagnose:true,form:form.replace('</body>',background+'</body>'),reviewedPublicPosts:[rule],backgroundReleased:1,blocked:true,networkStatus:'REVIEW_REQUIRED',postEvidence:{reason:'PUBLIC_INITIALIZATION_BUDGET_EXHAUSTED'}},
    {diagnose:true,form,reviewedPublicPosts:[{...rule,purpose:'security-verification',payload:undefined,response:undefined}],blocked:true,error:'SCHOOL_SECURITY_CHALLENGE',postEvidence:{requestPurpose:'security-verification'}},
    {diagnose:true,form:form.replace("'/authserver/fixture-public-config'","'/authserver/checkNeedCaptcha.htl'").replace("method:'POST'","method:'GET'").replace(",body:JSON.stringify({version:1})",''),blocked:true,networkStatus:'REVIEW_REQUIRED',postEvidence:{reason:'ACCOUNT_PRECHECK_NOT_AUTHORIZED'}},
    // The user's real path audit establishes identity/repetition only. Its
    // purpose and parameters are still unreviewed, so all three stay blocked.
    {diagnose:true,form:fixture.FORM.replace('</body>',Array(3).fill(background.replace('/authserver/fixture-public-config','/authserver/common/getLanguageTypes.htl')).join('')+'</body>'),blocked:true,expectedBlockedPosts:3,networkStatus:'REVIEW_REQUIRED',postEvidence:{endpointCategory:'unknown-official-post',reason:'BACKGROUND_POST_UNREVIEWED'}},
    {diagnose:true,form,reviewedPublicPosts:[rule],nativeInitializationResponse:true,backgroundReleased:1,networkStatus:'COMPATIBLE'},
    {diagnose:true,form,reviewedPublicPosts:[rule],nativeInitializationResponse:true,initializationBody:'{"success":false,"languages":[]}',backgroundReleased:1,blocked:true,networkStatus:'REVIEW_REQUIRED'},
    {form,reviewedPublicPosts:[rule],preLoginExpiredCheck:true,backgroundReleased:2},
  ];
  for(const [index,variant] of variants.entries()){await fixture.scenario(false,undefined,variant);console.log('POST fixture '+(index+1)+' PASS');}
  console.log('cas-post-policy: '+unitCount+' policy checks + '+variants.length+' native Chromium scenarios PASS; no production POST allowlist expansion; public diagnosis preserves legacy auth history/Session; real schoolRequests=0');
}
main().catch(e=>{console.error('cas-post-policy: FAIL '+(e.code||e.message));if(e.code==='ERR_ASSERTION')console.error(e.message);process.exitCode=1;}).finally(fixture.cleanup);
