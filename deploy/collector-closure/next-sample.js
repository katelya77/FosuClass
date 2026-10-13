"use strict";
// Host-side orchestration through the existing native admin Cookie/RBAC/CSRF API.
// The caller supplies real host probes and auth; no secrets enter output/files here.
const crypto=require("node:crypto"), c=require("./contract");
const fail=code=>{throw Object.assign(new Error(code),{code});};
function validateScope(s,now=Date.now()) {
  const keys=["schema","kind","term","requestBudget","entityLimit","concurrency","delayMinMs","delayMaxMs","allowOneLogin","schoolWindowApproved","approvedAt","expiresAt","wyzRevision","oracleRevision","publication"];
  if(!s||Object.keys(s).some(k=>!keys.includes(k))||s.schema!=="collector-next-sample-scope.v1"||s.kind!=="class"||s.term!=="2026-2027-1"||s.requestBudget!==40||s.entityLimit!==1||s.concurrency!==1||s.delayMinMs!==900||s.delayMaxMs!==1300||typeof s.allowOneLogin!=="boolean"||s.schoolWindowApproved!==true||s.wyzRevision!==c.WYZ_REVISION||s.oracleRevision!==c.ORACLE_REVISION||s.publication!=="NOT_APPROVED")fail("NEXT_SAMPLE_EXPLICIT_SCOPE_REQUIRED");
  if(!Number.isFinite(Date.parse(s.approvedAt))||Date.parse(s.approvedAt)>now+60000||!Number.isFinite(Date.parse(s.expiresAt))||Date.parse(s.expiresAt)<=now||Date.parse(s.expiresAt)<=Date.parse(s.approvedAt)||Date.parse(s.expiresAt)-Date.parse(s.approvedAt)>1800000)fail("NEXT_SAMPLE_SCOPE_EXPIRED");
  return s;
}
async function queue(scope,deps) {
  validateScope(scope,deps.now?.()||Date.now());
  const before=await deps.probe();c.validateOracleEvidence(before,deps.now?.()||Date.now());
  let state=await deps.load();
  const scopeHash=crypto.createHash("sha256").update(JSON.stringify(scope)).digest("hex");
  if(state&&state.scopeHash!==scopeHash)fail("NEXT_SAMPLE_SCOPE_CHANGED");
  const view=await deps.wire("GET","/api/admin/schedule-collector/overview");
  if(view.success!==true||view.overview?.health?.oracleRevision!==c.ORACLE_REVISION||view.overview?.permissions?.sample!==true)fail("NEXT_SAMPLE_ADMIN_RBAC_REQUIRED");
  c.validateReadiness(view.overview.readiness);
  if(view.overview.status.current&&!view.overview.status.current.finishedAt&&!state)fail("NEXT_SAMPLE_EXISTING_RUN_IN_FLIGHT");
  // Persist a stable key before POST. Retry only this idempotent Oracle operation,
  // never a school call. An uncertain response keeps the exact same key.
  if(!state){state={schema:"collector-next-sample-queue.v1",scopeHash,idempotencyKey:"sample-f076-"+crypto.randomBytes(16).toString("hex"),phase:"PREPARED"};await deps.save(state);}
  if(state.phase==="QUEUED")return state;
  const requestId=state.idempotencyKey;
  const response=await deps.wire("POST","/api/admin/schedule-collector/actions/sample",{term:scope.term,sampleKind:"class",requestBudget:40,idempotencyKey:state.idempotencyKey},requestId);
  const r=response?.queued?.run;
  if(response.success!==true||!r||r.id===c.RETIRED_RUN||r.mode!=="sample"||r.term!==scope.term||r.samplePolicy?.kind!=="class"||r.samplePolicy.entityLimit!==1||r.samplePolicy.requestBudget!==40||r.sampleOnly!==true||r.publishable!==false||r.coverageValid!==false||r.finishedAt||r.stage!=="idle")fail("NEXT_SAMPLE_QUEUE_RECEIPT_INVALID");
  if(Date.parse(r.approvalExpiresAt)<Date.parse(scope.expiresAt))fail("NEXT_SAMPLE_QUEUE_WINDOW_TOO_SHORT");
  const audit=await deps.wire("GET","/api/admin/audit-logs");
  const entry=audit.items?.find(v=>v.requestId===requestId&&v.action==="schedule-collector-sample"&&v.authMethod==="admin-cookie"&&v.scopes?.includes("admin:full"));
  if(audit.success!==true||!entry)fail("NEXT_SAMPLE_NATIVE_AUDIT_REQUIRED");
  state={...state,phase:"QUEUED",runId:r.id,term:r.term,requestBudget:40,entityLimit:1,allowOneLogin:scope.allowOneLogin,schoolWindowExpiresAt:scope.expiresAt,approvalExpiresAt:r.approvalExpiresAt,audited:true,authMethod:"admin-cookie",oraclePreflight:before,schoolRequests:0,sampleOnly:true,publishable:false,coverageValid:false};await deps.save(state);return state;
}
module.exports={validateScope,queue};
