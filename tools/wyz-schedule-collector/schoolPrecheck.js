"use strict";
const cas=require('../fosu-sync-client/schoolCasPage');
const fail=code=>Object.assign(new Error(code),{code,diagnosticStage:'precheck-response'});
function create(account,onRequest,onResponse){
  let source=null,browserRequests=0,result=null,resolve,reject;
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});pending.catch(()=>{});
  return {
    account,active:true,
    get source(){return source;},get browserRequests(){return browserRequests;},
    browser(){
      if(++browserRequests>1)throw fail('SCHOOL_LOGIN_PRECHECK_BUDGET_EXHAUSTED');
      if(!source){source='browser';onRequest(source);return 'network';}
      if(source==='direct')return 'cache';
      throw fail('SCHOOL_LOGIN_PRECHECK_BUDGET_EXHAUSTED');
    },
    direct(){if(source)return false;source='direct';onRequest(source);return true;},
    complete(status,type,body){
      if(status!==200||type&&!/^(application\/json|text\/plain)(?:\s*;|$)/i.test(type))throw fail('SCHOOL_LOGIN_PRECHECK_FAILED');
      if(typeof body!=='string'||Buffer.byteLength(body)>2048)throw fail('SCHOOL_LOGIN_PRECHECK_CHANGED');
      let value;try{value=JSON.parse(body);}catch{throw fail('SCHOOL_LOGIN_PRECHECK_CHANGED');}
      if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).some(key=>!['isNeed','needCaptcha'].includes(key)))throw fail('SCHOOL_LOGIN_PRECHECK_CHANGED');
      const needed=cas.parseCaptcha(body);
      result={body,type,needed};resolve(result);onResponse(needed,source);return result;
    },
    fail(error){reject(fail(error.code||'SCHOOL_LOGIN_PRECHECK_FAILED'));},
    async wait(timeout=3000){
      let timer;
      try{return await Promise.race([pending,new Promise((_,no)=>{timer=setTimeout(()=>no(fail('SCHOOL_LOGIN_PRECHECK_FAILED')),timeout);})]);}
      finally{clearTimeout(timer);}
    },
    close(){this.active=false;this.account='';if(result)result.body='';reject(fail('COLLECTOR_STOPPED'));}
  };
}
module.exports={create};
