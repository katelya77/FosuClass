"use strict";
// Deterministic planning only. No network, queue mutation, timer or publication.
const crypto=require("node:crypto");
const KINDS=["class","teacher","classroom","course"], HASH=/^[a-f0-9]{64}$/, REV=/^[a-f0-9]{40}$/;
const fail=code=>{throw Object.assign(new Error(code),{code,statusCode:400});};
const hash=value=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function acceptance(history,term) {
  const reviewed=kind=>history.find(r=>r.mode==="sample"&&r.term===term&&r.samplePolicy?.kind===kind&&r.result==="PENDING SAMPLE REVIEW"&&HASH.test(r.canonicalHash||"")&&r.sampleHumanReview?.decision==="confirmed"&&r.sampleHumanReview.comparisonAttested===true&&r.sampleHumanReview.canonicalHash===r.canonicalHash);
  const a=reviewed("class"),b=reviewed("four");
  return {classReviewed:!!a,fourReviewed:!!b,classRunId:a?.id||null,fourRunId:b?.id||null,ready:!!a&&!!b,
    code:!a?"CLASS_SAMPLE_REVIEW_REQUIRED":!b?"FOUR_SOURCE_SAMPLE_REVIEW_REQUIRED":"FORMAL_SCOPE_APPROVAL_REQUIRED",
    executionLocked:true,publication:"NOT_APPROVED",coverageValid:false};
}
function validateScope(s) {
  if(!s||Object.keys(s).some(k=>!["term","sourceRevision","catalogHash","requestBudget","overheadBudget","freshnessMs","targets"].includes(k))||!/^\d{4}-\d{4}-[12]$/.test(s.term||"")||!REV.test(s.sourceRevision||"")||!HASH.test(s.catalogHash||"")||!Number.isSafeInteger(s.requestBudget)||s.requestBudget<1||s.requestBudget>120||!Number.isSafeInteger(s.overheadBudget)||s.overheadBudget<0||s.overheadBudget>=s.requestBudget||!Number.isSafeInteger(s.freshnessMs)||s.freshnessMs<0||s.freshnessMs>86400000||!Array.isArray(s.targets)||s.targets.length<1||s.targets.length>120)fail("INCREMENTAL_SCOPE_REJECTED");
  const seen=new Set();
  const targets=s.targets.map(t=>{
    if(!t||Object.keys(t).some(k=>!["kind","targetId","reviewedHash","reviewedAt"].includes(k))||!KINDS.includes(t.kind)||typeof t.targetId!=="string"||!t.targetId||t.targetId.length>160||/[\r\n<>\\]/.test(t.targetId)||/https?:\/\//.test(t.targetId)||t.reviewedHash!==null&&!HASH.test(t.reviewedHash||"")||t.reviewedAt!==null&&!Number.isFinite(Date.parse(t.reviewedAt)))fail("INCREMENTAL_TARGET_REJECTED");
    const key=t.kind+":"+t.targetId;if(seen.has(key))fail("INCREMENTAL_TARGET_DUPLICATE");seen.add(key);
    return {kind:t.kind,targetId:t.targetId,reviewedHash:t.reviewedHash,reviewedAt:t.reviewedAt};
  }).sort((a,b)=>a.kind+":"+a.targetId < b.kind+":"+b.targetId ? -1 : a.kind+":"+a.targetId > b.kind+":"+b.targetId ? 1 : 0);
  return {...s,targets};
}
function preview(input,history,now=Date.now()) {
  const scope=validateScope(input),gate=acceptance(history,scope.term);
  const sources=Object.fromEntries(KINDS.map(k=>[k,{selected:0,needsRequest:0,reusableReviewed:0,uploaded:0,reviewed:0,coverage:"SCOPED_ONLY"}]));
  const targets=scope.targets.map(t=>{
    // Last-reviewed hashes are input to a draft, never current-school evidence.
    const fresh=!!t.reviewedHash&&Date.parse(t.reviewedAt)<=now&&now-Date.parse(t.reviewedAt)<scope.freshnessMs;
    const stat=sources[t.kind];stat.selected++;fresh?stat.reusableReviewed++:stat.needsRequest++;
    return {...t,action:fresh?"REUSE_REVIEWED_CANDIDATE":"REQUEST_ON_APPROVED_RUN",liveSchoolValidated:false};
  });
  const requestTargets=targets.filter(t=>t.action==="REQUEST_ON_APPROVED_RUN").length;
  const requiredBudget=scope.overheadBudget+requestTargets;
  return {schema:"collector-incremental-preview.v1",scope,scopeHash:hash(scope),gate,targets,sources,requiredBudget,
    budgetSufficient:requiredBudget<=scope.requestBudget,requestBudget:scope.requestBudget,
    status:!gate.ready?"BLOCKED":requiredBudget>scope.requestBudget?"BLOCKED":"DRAFT",
    code:!gate.ready?gate.code:requiredBudget>scope.requestBudget?"INCREMENTAL_BUDGET_INSUFFICIENT":"INDEPENDENT_SCOPE_APPROVAL_REQUIRED",
    uploadPolicy:"SKIP_IDENTICAL_REVIEWED_CANONICAL_HASH",executionLocked:true,schoolRequests:0,publishable:false,coverageValid:false};
}
function resumeDecision(input,approval,progress,now=Date.now()) {
  const scope=validateScope(input),scopeHash=hash(scope);
  const blocked=code=>({status:"BLOCKED",code,replayAllowed:false,schoolRequests:0});
  if(!approval||approval.scopeHash!==scopeHash||approval.publication!=="NOT_APPROVED"||approval.independentlyApproved!==true||!/^sc-[A-Za-z0-9-]{1,100}$/.test(approval.runId||""))return blocked("INCREMENTAL_SCOPE_APPROVAL_REQUIRED");
  if(!Number.isFinite(Date.parse(approval.expiresAt))||Date.parse(approval.expiresAt)<=now)return blocked("INCREMENTAL_SCOPE_EXPIRED");
  if(!progress||progress.schema!=="collector-incremental-progress.v1"||progress.runId!==approval.runId||progress.scopeHash!==scopeHash||progress.sourceRevision!==scope.sourceRevision||progress.catalogHash!==scope.catalogHash||["reserved","completed","failed"].some(k=>!Number.isSafeInteger(progress[k])||progress[k]<0)||progress.reserved>scope.requestBudget||!Array.isArray(progress.targets))return blocked("INCREMENTAL_PROGRESS_SCOPE_MISMATCH");
  if(progress.pendingRequest!==null)return blocked("INCREMENTAL_REQUEST_OUTCOME_UNKNOWN");
  if(progress.completed+progress.failed!==progress.reserved||progress.targets.length>progress.completed)return blocked("INCREMENTAL_PROGRESS_SCOPE_MISMATCH");
  const expected=new Set(scope.targets.map(t=>t.kind+":"+t.targetId)),seen=new Set(),done=[];
  for(const t of progress.targets){const key=t.kind+":"+t.targetId;if(!expected.has(key)||seen.has(key))return blocked("INCREMENTAL_PROGRESS_TARGET_MISMATCH");seen.add(key);
    if(t.state!=="PARSED"||!HASH.test(t.canonicalHash||"")||!HASH.test(t.decodedResponseSha256||""))return blocked("INCREMENTAL_TARGET_REVIEW_REQUIRED");done.push(key);}
  const remaining=scope.requestBudget-progress.reserved;
  const uncompleted=[...expected].filter(k=>!seen.has(k));
  return {status:uncompleted.length>remaining?"BLOCKED":"RESUME_PLAN_READY",code:uncompleted.length>remaining?"INCREMENTAL_BUDGET_INSUFFICIENT":"INDEPENDENT_EXECUTION_GATE_REQUIRED",
    completed:done,remainingTargets:uncompleted,remainingBudget:remaining,executionLocked:true,replayAllowed:false,schoolRequests:0};
}
function uploadKey(runId,term,kind,targetId,canonicalHash){if(!/^sc-[A-Za-z0-9-]{1,100}$/.test(runId||"")||!/^\d{4}-\d{4}-[12]$/.test(term||"")||!KINDS.includes(kind)||typeof targetId!=="string"||!targetId||!HASH.test(canonicalHash||""))fail("INCREMENTAL_UPLOAD_KEY_REJECTED");return "inc-"+hash([runId,term,kind,targetId,canonicalHash]);}
module.exports={acceptance,validateScope,preview,resumeDecision,uploadKey};
