"use strict";
// Candidate sets originate in the existing Windows login path. Do not add a
// provider, guessed endpoint, untrusted origin or arbitrary JS invocation here.
const SELECTORS=Object.freeze({
  account:['input[name="username"]','#username','input[type="text"]'],
  password:['input[name="password"]','#password','input[type="password"]'],
  submit:['#login_submit','#login','button[type="submit"]','input[type="submit"]','.login-btn'],
  tab:['#userNameLogin','.userNameLogin','button','a','[role="tab"]','li','span'],
});
const LOGIN_TEXT=Object.freeze({tab:["账号登录","密码登录","账号密码登录"],submit:["登录","登 录","提交"]});
const {AUTH_ORIGIN,CAS_SERVICE_URL}=require('./schoolLoginProfile');
function fail(code,stage){return Object.assign(new Error(code),{code,diagnosticStage:stage});}
function credentialFailure(text){return /密码错误|密码有误|密码不正确|用户名或密码(?:错误|有误)|账号或密码(?:错误|有误)|账号密码错误|认证失败|登录失败|用户名不存在|用户不存在|incorrect (?:username|password|credentials)/i.test(text);}
function explicitChallenge(text){
  // Conditional help is not evidence that a challenge is currently active.
  const active=text.split(/[。\n]/).filter(line=>!/^(?:如果|如需|若|仅当)/.test(line.trim())).join('\n');
  return /(?:请|需要|必须|要求).{0,12}(?:输入验证码|完成.{0,6}(?:验证|滑块|拼图))|安全验证失败|风险验证|风险控制|滑块验证|人机验证|captcha required|risk control/i.test(active);
}
function parseCaptcha(data){
  if(typeof data==='string'){
    if(data.length>4096)throw fail('SCHOOL_LOGIN_PRECHECK_CHANGED','precheck-response');
    try{data=JSON.parse(data);}catch(_){throw fail('SCHOOL_LOGIN_PRECHECK_CHANGED','precheck-response');}
  }
  const values=typeof data==='boolean'?[data]:data&&typeof data==='object'&&!Array.isArray(data)?['isNeed','needCaptcha'].filter(k=>Object.hasOwn(data,k)).map(k=>data[k]):[];
  if(!values.length||values.some(v=>![true,false,'true','false'].includes(v)))throw fail('SCHOOL_LOGIN_PRECHECK_CHANGED','precheck-response');
  return values.some(v=>v===true||v==='true');
}
async function scan(page){
  return page.evaluate(({selectors,texts})=>{
    const visible=e=>e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&!e.closest('[hidden],[aria-hidden="true"]');
    const usable=e=>visible(e)&&!e.disabled&&!e.readOnly;
    const list=key=>Array.from(document.querySelectorAll(selectors[key].join(',')));
    const passwords=list('password'),passwordsVisible=passwords.filter(e=>usable(e)&&e.tagName==='INPUT'&&e.type==='password');
    const accounts=list('account'),submits=list('submit');
    const password=passwordsVisible.length===1?passwordsVisible[0]:null;
    const form=password?.form||null;
    const container=form||password?.closest('#pwdFromId,#pwdFrom,.login-form');
    const accountsVisible=accounts.filter(e=>usable(e)&&['text','email','tel'].includes(e.type)&&(!password||(form?e.form===form:container?.contains(e))));
    const named=accountsVisible.filter(e=>e.name==='username'||e.id==='username');
    const accountCandidates=named.length?named:accountsVisible;
    const account=accountCandidates.length===1?accountCandidates[0]:null;
    const buttons=Array.from(document.querySelectorAll('button,input[type="submit"],a'));
    const textButtons=buttons.filter(e=>texts.submit.includes((e.textContent||e.value||'').trim()));
    const allSubmits=Array.from(new Set([...submits,...textButtons]));
    const submitCandidates=allSubmits.filter(e=>usable(e)&&container?.contains(e)&&
      (form?(e.form===form||e.tagName==='A'&&e.matches('#login_submit,#login,.login-btn')&&e.hasAttribute('onclick')):(e.matches('#login_submit,#login,.login-btn')&&['BUTTON','A'].includes(e.tagName))));
    const submit=submitCandidates.length===1?submitCandidates[0]:null;
    const tabs=list('tab'),tabCandidates=tabs.filter(e=>usable(e)&&texts.tab.includes((e.textContent||'').trim())&&!container?.contains(e));
    const leafTabs=tabCandidates.filter(e=>!tabCandidates.some(other=>other!==e&&e.contains(other)));
    const activeChallenge=Array.from(document.querySelectorAll('input[name="captcha"],input[name="captchaResponse"],input[name="verifyCode"],#captcha,#captchaDiv,#sliderCaptcha,[role="dialog"]')).some(e=>visible(e)&&(e.tagName==='INPUT'||e.querySelector('input,img,canvas')||e.id==='sliderCaptcha'||/验证码|滑块|安全验证|人机验证/.test(e.textContent||'')));
    return {accountCount:accountCandidates.length,passwordCount:passwordsVisible.length,submitCount:submitCandidates.length,tabCount:leafTabs.length,
      accountIndex:accounts.indexOf(account),passwordIndex:passwords.indexOf(password),submitIndex:allSubmits.indexOf(submit),tabIndex:tabs.indexOf(leafTabs[0]),
      activeChallenge,formPresent:Boolean(form),method:form?.method?.toUpperCase()||'JS',action:form?.action||'',
      jsSubmit:Boolean(submit&&(submit.type==='button'||!form||submit.hasAttribute('onclick'))),
      // Text remains inside this module and must never be emitted/logged.
      visibleText:document.body?.innerText||'',textSubmitIndex:submit?buttons.indexOf(submit):-1};
  },{selectors:SELECTORS,texts:LOGIN_TEXT});
}
function publicCounts(scan){const value={};for(const k of ['accountCount','passwordCount','submitCount','tabCount','activeChallenge','formPresent','jsSubmit'])value[k]=scan[k];return value;}
async function prepare(page,emit=()=>{},options={}){
  await page.waitForLoadState('load',{timeout:10000});
  emit('cas-load',{navigationComplete:true});
  const until=Date.now()+(options.timeoutMs||8000);let clickedTab=false,last,stable=0;
  while(Date.now()<until){
    const state=await scan(page);last=state;
    if(state.activeChallenge||explicitChallenge(state.visibleText))throw fail('SCHOOL_SECURITY_CHALLENGE','challenge-before-password');
    if(credentialFailure(state.visibleText))throw fail('SCHOOL_LOGIN_PAGE_REJECTED','page-credential-error');
    if(state.accountCount===1&&state.passwordCount===1&&state.submitCount===1){
      stable++;if(stable>=2)break;
    }else{
      stable=0;
      if(!clickedTab&&state.tabCount===1&&(state.accountCount===0||state.passwordCount===0)){
        await page.locator(SELECTORS.tab.join(',')).nth(state.tabIndex).click({timeout:3000});clickedTab=true;
        emit('account-tab',{tabSwitched:true});
      }
    }
    await page.waitForTimeout(250);
  }
  emit('form-selection',publicCounts(last));
  if(last.accountCount!==1)throw fail('SCHOOL_LOGIN_ACCOUNT_FIELD_CHANGED','account-field');
  if(last.passwordCount!==1)throw fail('SCHOOL_LOGIN_PASSWORD_FIELD_CHANGED','password-field');
  if(last.submitCount!==1)throw fail('SCHOOL_LOGIN_SUBMIT_CHANGED','submit-button');
  if(last.formPresent){
    let action;try{action=new URL(last.action);}catch(_){}
    if(!action||action.origin!==AUTH_ORIGIN||action.pathname!=='/authserver/login'||action.username||action.password||action.searchParams.has('service')&&action.searchParams.get('service')!==CAS_SERVICE_URL)throw fail('SCHOOL_TLS_OR_ORIGIN_REJECTED','form-action');
    if(last.method!=='POST'&&!last.jsSubmit)throw fail('SCHOOL_LOGIN_SUBMIT_CHANGED','form-method');
  }else if(!last.jsSubmit)throw fail('SCHOOL_LOGIN_SUBMIT_CHANGED','javascript-submit');
  // Use the same bounded candidate set as scan. A unique visible DOM target is
  // mandatory; no .first(), arbitrary function call or generated fallback form.
  const account=page.locator(SELECTORS.account.join(',')).nth(last.accountIndex);
  const password=page.locator(SELECTORS.password.join(',')).nth(last.passwordIndex);
  let submit=page.locator(SELECTORS.submit.join(',')).nth(last.submitIndex);
  // The text-only standard button is the only additional Windows candidate.
  if(last.submitIndex>=await page.locator(SELECTORS.submit.join(',')).count())submit=page.locator('button,input[type="submit"],a').nth(last.textSubmitIndex);
  emit('form-ready',{tabSwitched:clickedTab,javascriptSubmit:last.jsSubmit});
  return {account,password,submit};
}
module.exports={SELECTORS,LOGIN_TEXT,credentialFailure,explicitChallenge,parseCaptcha,prepare,scan,publicCounts};
