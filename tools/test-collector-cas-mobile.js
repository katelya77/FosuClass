"use strict";
const fixture=require("./test-collector-login-browser-fixture");
const assert=require('assert/strict'),cas=require('./fosu-sync-client/schoolCasPage');
async function main(){
  // The existing Windows selectors support name-based inputs; the installed
  // WYZ path rejects the same normal HTML form before any password submission.
  const form=fixture.FORM.replace("id='username' ","").replace("id='password' ","").replace("id='login_submit'", "type='submit'");
  const variants=[
    {form}, {profile:'mobile-safari'}, {profile:'mobile-wechat'},
    {form:form.replace("<button type='submit'>登录</button>","<input type='submit' value='登录'>")},
    {form:form.replace("type='submit'","id='login'")},
    {form:form.replace("type='submit'","class='login-btn' type='button' onclick='this.form.requestSubmit()'")},
    {form:form.replace("<button type='submit'>登录</button>","<a id='login_submit' onclick='this.closest(\"form\").requestSubmit()'>登录</a>")},
    {form:"<html><body><div id='placeholder'></div><script>setTimeout(()=>document.querySelector('#placeholder').innerHTML="+JSON.stringify(form.match(/<form[\s\S]*<\/form>/)[0])+",400)</script></body></html>"},
    {form:"<html><body><button role='tab' onclick=\"document.querySelector('form').hidden=false;this.hidden=true\">账号密码登录</button>"+form.match(/<form[\s\S]*<\/form>/)[0].replace('<form ','<form hidden ')+"</body></html>"},
    {form:form.replace('统一身份认证 密码登录','统一身份认证 密码登录。账号或密码提示：如需帮助。验证码说明。\n如果出现风险提示，请输入验证码。')},
    {precheck:'{"needCaptcha":"false"}'}, {precheck:'false'}, {precheck:'{"isNeed":"false"}'},
    {precheck:'{"needCaptcha":"true"}',error:'SCHOOL_SECURITY_CHALLENGE'},
    {precheck:'{"unknown":false}',error:'SCHOOL_LOGIN_PRECHECK_CHANGED'},
    {precheckOk:false,error:'SCHOOL_LOGIN_PRECHECK_FAILED'},
    {form:form.replace('</form>',"<input name='captcha'></form>"),error:'SCHOOL_SECURITY_CHALLENGE',captcha:0},
    {form:form.replace('<input name=',"<input name='username'><input name="),error:'SCHOOL_LOGIN_ACCOUNT_FIELD_CHANGED',captcha:0},
    {form:form.replace('</head>',"<script src='https://unapproved.invalid/fixture.js'></script></head>"),error:'SCHOOL_LOGIN_RESOURCE_REJECTED',captcha:0,blocked:true},
    {diagnose:true},
    {form:form.replace("action='https://authserver.fosu.edu.cn/authserver/login'","action='https://authserver.fosu.edu.cn/authserver/login?service=https%3A%2F%2Fevil.invalid'"),error:'SCHOOL_TLS_OR_ORIGIN_REJECTED',captcha:0},
    {form:form.replace("type='submit'","class='login-btn' type='button' onclick=\"fetch('/authserver/unreviewed',{method:'POST',body:'fixture'})\""),error:'SCHOOL_PASSWORD_RESUBMISSION_BLOCKED',blocked:true},
    {ajax:true,form:"<html><body>统一身份认证 密码登录<div class='login-form'><input name='username'><input name='password' type='password'><button class='login-btn' type='button' onclick=\"fetch('/authserver/login',{method:'POST',body:'fixture'}).then(()=>location.href='https://100.fosu.edu.cn/framework/xsMain.jsp')\">登录</button></div></body></html>"},
    {form:form.replace("type='submit'","class='login-btn' type='button' onclick=\"fetch('/authserver/login',{method:'POST',body:'fixture'});fetch('/authserver/login',{method:'POST',body:'fixture'})\""),error:'SCHOOL_PASSWORD_RESUBMISSION_BLOCKED',posts:1,blocked:true},
    {credentialRejected:true,error:'INVALID_CREDENTIALS',posts:1},
    {form:fixture.FORM.replace('统一身份认证 密码登录','统一身份认证 登录失败'),error:'SCHOOL_LOGIN_PAGE_REJECTED',captcha:0},
  ];
  for(const [index,variant] of variants.entries()){
    try{await fixture.scenario(false,undefined,variant);console.log('fixture scenario '+(index+1)+' PASS');}catch(error){console.error('fixture scenario '+(index+1)+' failed; assertion='+(error.code||error.name));throw error;}
  }
  for(const input of [{isNeed:false},{needCaptcha:'false'},false,'false'])assert.equal(cas.parseCaptcha(input),false);
  assert.equal(cas.parseCaptcha({isNeed:false,needCaptcha:true}),true);
  for(const input of [{},null,'HTML', {isNeed:0}])assert.throws(()=>cas.parseCaptcha(input),/PRECHECK_CHANGED/);
  console.log("collector-cas-mobile: "+variants.length+" native Chromium scenarios PASS; synthetic credentials, closed local proxy; real schoolRequests=0");
}
main().catch(e=>{console.error("collector-cas-mobile: FAIL code="+(e.code||e.name));process.exitCode=1;}).finally(fixture.cleanup);
